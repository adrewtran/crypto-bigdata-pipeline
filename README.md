# Real-Time Crypto Analytics Pipeline

Final Big Data course project using Kafka, Spark Structured Streaming, Hive, and Streamlit.

## Architecture

```text
Binance WebSocket
      ↓
Java Kafka Producer
      ↓
Kafka topic: crypto-trades
      ↓
Spark Structured Streaming
      ↓
Hive database/tables
      ↓
Streamlit Dashboard reading from Hive
```

This project intentionally uses **Hive as the persistent storage layer**. Spark writes processed micro-batch results into Hive tables using `foreachBatch`. The Streamlit dashboard does not read directly from Kafka, Spark memory, CSV files, Elasticsearch, or local-only Parquet files. It reads from Hive through HiveServer2.

## Requirement Mapping

### Part 1: Kafka Producer

Implemented in:

```text
producer/src/main/java/com/example/producer/CryptoKafkaProducer.java
```

The Java producer connects to Binance WebSocket combined trade streams:

```text
btcusdt@trade
ethusdt@trade
solusdt@trade
```

It normalizes each Binance trade event into this JSON format and publishes to Kafka topic `crypto-trades`:

```json
{
  "symbol": "BTCUSDT",
  "price": 65000.12,
  "quantity": 0.004,
  "tradeTime": 1710000000000,
  "eventTime": 1710000000100
}
```

### Part 2: Spark Structured Streaming

Implemented in:

```text
spark/crypto_streaming_job.py
```

Spark Structured Streaming reads from Kafka topic `crypto-trades`, parses JSON, converts `eventTime` into a timestamp column, joins the live stream with static metadata from:

```text
data/static_coin_metadata.csv
```

The enrichment file contains:

```text
symbol,coin_name,category
BTCUSDT,Bitcoin,Layer 1
ETHUSDT,Ethereum,Layer 1 / Smart Contract
SOLUSDT,Solana,Layer 1 / High Throughput
```

Spark calculates 10-second window aggregations:

- average price by symbol
- total volume by symbol
- trade count by symbol
- min price
- max price

### Part 3: Hive Storage

Implemented in:

```text
spark/hive_schema.sql
spark/crypto_streaming_job.py
```

Hive database:

```sql
crypto_analytics
```

Hive tables:

```sql
crypto_analytics.crypto_trade_summary
crypto_analytics.crypto_alerts
```

Spark enables Hive support with:

```python
.enableHiveSupport()
```

Spark writes each streaming micro-batch into Hive using `foreachBatch` and `insertInto`.

The project uses a checkpoint directory for fault tolerance:

```text
/tmp/spark-checkpoints/crypto-trades
```

### Part 4: Streamlit Dashboard

Implemented in:

```text
dashboard/app.py
```

The dashboard reads from Hive using PyHive and refreshes every 5 seconds.

It shows:

- latest average price by symbol
- volume chart
- trade count chart
- min/max price table
- latest alerts

## Docker Services

`docker-compose.yml` includes:

- `zookeeper`
- `kafka`
- `kafka-ui`
- `namenode`
- `datanode`
- `spark-master`
- `spark-worker`
- `hive-metastore`
- `hive-server`
- `hive-metastore-postgresql`
- `producer`
- `dashboard`

HDFS is included because Hive normally stores managed table data in a warehouse directory. The persistent storage layer is still Hive: Spark writes to Hive tables and Streamlit reads from Hive tables.

## Setup

From the project root:

```bash
cd crypto-bigdata-pipeline
```

Start all containers:

```bash
docker compose up -d
```

Check containers:

```bash
docker compose ps
```

Create the Kafka topic:

```bash
./scripts/create-topics.sh
```

Open useful UIs:

```text
Kafka UI:      http://localhost:8080
Spark Master: http://localhost:8081
HDFS UI:       http://localhost:9870
Streamlit:     http://localhost:8501
HiveServer2:   localhost:10000
```

## Run Commands

Open three terminals from the project root.

Terminal 1: run Spark Structured Streaming:

```bash
./scripts/run-spark.sh
```

Terminal 2: run Java Kafka producer:

```bash
./scripts/run-producer.sh
```

Terminal 3: run Streamlit dashboard:

```bash
./scripts/run-dashboard.sh
```

Then open:

```text
http://localhost:8501
```

## Demo Steps

1. Start Docker services.
2. Create topic `crypto-trades`.
3. Start Spark streaming job.
4. Start Java producer.
5. Confirm events are flowing in Kafka UI.
6. Wait for Spark to process a few 10-second windows.
7. Open Streamlit dashboard.
8. Show that dashboard data comes from Hive tables.

## Verify Kafka Topic

```bash
docker compose exec kafka kafka-console-consumer \
  --bootstrap-server kafka:29092 \
  --topic crypto-trades \
  --from-beginning \
  --max-messages 5
```

Expected output:

```json
{"symbol":"BTCUSDT","price":65000.12,"quantity":0.004,"tradeTime":1710000000000,"eventTime":1710000000100}
{"symbol":"ETHUSDT","price":3200.55,"quantity":0.07,"tradeTime":1710000000200,"eventTime":1710000000210}
```

## Verify Hive Tables

Open Hive shell through HiveServer2 container:

```bash
docker compose exec hive-server beeline -u jdbc:hive2://localhost:10000 -n hive
```

Run:

```sql
SHOW DATABASES;
USE crypto_analytics;
SHOW TABLES;
SELECT * FROM crypto_trade_summary ORDER BY processed_at DESC LIMIT 10;
SELECT * FROM crypto_alerts ORDER BY processed_at DESC LIMIT 10;
```

Expected `crypto_trade_summary` output columns:

```text
window_start | window_end | symbol | coin_name | category | avg_price | min_price | max_price | total_volume | trade_count | processed_at
```

Expected `crypto_alerts` output columns:

```text
window_start | window_end | symbol | coin_name | alert_type | alert_message | current_avg_price | processed_at
```

## Expected Dashboard Output

The Streamlit dashboard should show:

1. Metric cards for latest average price per symbol.
2. Table with latest min price, max price, total volume, and trade count.
3. Bar chart for volume by symbol.
4. Bar chart for trade count by symbol.
5. Line chart for average price trend.
6. Alert table from `crypto_analytics.crypto_alerts`.

## Important Notes

- Kafka is used only for real-time ingestion.
- Spark Structured Streaming is used for real-time processing.
- Hive is the persistent storage layer.
- Streamlit is only the dashboard layer and reads from Hive.
- The static CSV is only used for enrichment before writing to Hive.
- Processed results are not stored as CSV.
- The project does not replace Hive with Elasticsearch, plain Parquet output, or any other storage layer.

## Troubleshooting

### Dashboard says Hive has no data

Run the producer and Spark job for at least 20–30 seconds. Spark writes data every 10 seconds.

### Kafka topic does not exist

Run:

```bash
./scripts/create-topics.sh
```

### Spark cannot find Kafka source

The Spark script uses this package in `run-spark.sh`:

```text
org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1
```

Make sure the container can access the internet the first time Spark downloads dependencies.

### Alerts table is empty

That is normal if trading activity is low. Lower the threshold:

```bash
export TRADE_COUNT_ALERT_THRESHOLD=5
./scripts/run-spark.sh
```

Or edit `TRADE_COUNT_ALERT_THRESHOLD` in `spark/crypto_streaming_job.py`.

## Stop Everything

```bash
docker compose down
```

To remove volumes too:

```bash
docker compose down -v
```
