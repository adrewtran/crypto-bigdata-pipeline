import os
from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    avg,
    col,
    count,
    current_timestamp,
    expr,
    from_json,
    lit,
    max as spark_max,
    min as spark_min,
    sum as spark_sum,
    window,
)
from pyspark.sql.types import DoubleType, LongType, StringType, StructField, StructType

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:29092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "crypto-trades")
METADATA_PATH = os.getenv("METADATA_PATH", "file:///opt/spark-apps/data/static_coin_metadata.csv")
CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "/tmp/spark-checkpoints/crypto-trades")
TRADE_COUNT_ALERT_THRESHOLD = int(os.getenv("TRADE_COUNT_ALERT_THRESHOLD", "30"))

spark = (
    SparkSession.builder
    .appName("Real-Time Crypto Analytics Pipeline")
    .config("spark.hadoop.fs.defaultFS", os.getenv("HADOOP_FS_DEFAULTFS", "hdfs://namenode:9000"))
    .config("spark.sql.warehouse.dir", os.getenv("SPARK_SQL_WAREHOUSE_DIR", "hdfs://namenode:9000/user/hive/warehouse"))
    .config("hive.metastore.uris", os.getenv("HIVE_METASTORE_URIS", "thrift://hive-metastore:9083"))
    .enableHiveSupport()
    .getOrCreate()
)

spark.sparkContext.setLogLevel("WARN")

spark.sql("CREATE DATABASE IF NOT EXISTS crypto_analytics")
spark.sql("""
CREATE TABLE IF NOT EXISTS crypto_analytics.crypto_trade_summary (
  window_start TIMESTAMP,
  window_end TIMESTAMP,
  symbol STRING,
  coin_name STRING,
  category STRING,
  avg_price DOUBLE,
  min_price DOUBLE,
  max_price DOUBLE,
  total_volume DOUBLE,
  trade_count BIGINT,
  processed_at TIMESTAMP
)
STORED AS PARQUET
""")
spark.sql("""
CREATE TABLE IF NOT EXISTS crypto_analytics.crypto_alerts (
  window_start TIMESTAMP,
  window_end TIMESTAMP,
  symbol STRING,
  coin_name STRING,
  alert_type STRING,
  alert_message STRING,
  current_avg_price DOUBLE,
  processed_at TIMESTAMP
)
STORED AS PARQUET
""")

coin_metadata = (
    spark.read
    .option("header", True)
    .option("inferSchema", True)
    .csv(METADATA_PATH)
)

trade_schema = StructType([
    StructField("symbol", StringType(), False),
    StructField("price", DoubleType(), False),
    StructField("quantity", DoubleType(), False),
    StructField("tradeTime", LongType(), False),
    StructField("eventTime", LongType(), False),
])

raw_stream = (
    spark.readStream
    .format("kafka")
    .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP_SERVERS)
    .option("subscribe", KAFKA_TOPIC)
    .option("startingOffsets", "latest")
    .load()
)

parsed_trades = (
    raw_stream
    .selectExpr("CAST(value AS STRING) AS json_value")
    .select(from_json(col("json_value"), trade_schema).alias("trade"))
    .select("trade.*")
    .withColumn("event_ts", (col("eventTime") / 1000).cast("timestamp"))
)

enriched_trades = parsed_trades.join(coin_metadata, on="symbol", how="left")

summary_stream = (
    enriched_trades
    .withWatermark("event_ts", "30 seconds")
    .groupBy(
        window(col("event_ts"), "10 seconds"),
        col("symbol"),
        col("coin_name"),
        col("category"),
    )
    .agg(
        avg("price").alias("avg_price"),
        spark_min("price").alias("min_price"),
        spark_max("price").alias("max_price"),
        spark_sum("quantity").alias("total_volume"),
        count(lit(1)).alias("trade_count"),
    )
    .select(
        col("window.start").alias("window_start"),
        col("window.end").alias("window_end"),
        "symbol",
        "coin_name",
        "category",
        "avg_price",
        "min_price",
        "max_price",
        "total_volume",
        "trade_count",
        current_timestamp().alias("processed_at"),
    )
)

def write_to_hive(batch_df, batch_id):
    if batch_df.rdd.isEmpty():
        return

    ordered_summary = batch_df.select(
        "window_start",
        "window_end",
        "symbol",
        "coin_name",
        "category",
        "avg_price",
        "min_price",
        "max_price",
        "total_volume",
        "trade_count",
        "processed_at",
    )

    ordered_summary.write.mode("append").insertInto("crypto_analytics.crypto_trade_summary")

    alerts = (
        ordered_summary
        .where(col("trade_count") >= lit(TRADE_COUNT_ALERT_THRESHOLD))
        .select(
            "window_start",
            "window_end",
            "symbol",
            "coin_name",
            lit("HIGH_TRADE_ACTIVITY").alias("alert_type"),
            expr("concat(symbol, ' has high activity: ', cast(trade_count as string), ' trades in 10 seconds')").alias("alert_message"),
            col("avg_price").alias("current_avg_price"),
            current_timestamp().alias("processed_at"),
        )
    )

    if not alerts.rdd.isEmpty():
        alerts.write.mode("append").insertInto("crypto_analytics.crypto_alerts")

query = (
    summary_stream.writeStream
    .foreachBatch(write_to_hive)
    .outputMode("update")
    .option("checkpointLocation", CHECKPOINT_DIR)
    .trigger(processingTime="10 seconds")
    .start()
)

query.awaitTermination()
