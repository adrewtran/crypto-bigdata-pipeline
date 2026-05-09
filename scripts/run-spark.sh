#!/usr/bin/env bash
set -euo pipefail

docker compose exec namenode hdfs dfs -mkdir -p /user/hive/warehouse /tmp/spark-checkpoints
docker compose exec namenode hdfs dfs -chmod -R 777 /user/hive /tmp/spark-checkpoints

docker compose exec spark-master bash -lc '
  mkdir -p /tmp/spark-ivy
  /opt/spark/bin/spark-submit \
    --master spark://spark-master:7077 \
    --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1 \
    --conf spark.jars.ivy=/tmp/spark-ivy \
    --conf spark.sql.shuffle.partitions=3 \
    --conf spark.hadoop.fs.defaultFS=hdfs://namenode:9000 \
    --conf spark.sql.warehouse.dir=hdfs://namenode:9000/user/hive/warehouse \
    --conf spark.hadoop.hive.metastore.uris=thrift://hive-metastore:9083 \
    /opt/spark-apps/spark/crypto_streaming_job.py
'
