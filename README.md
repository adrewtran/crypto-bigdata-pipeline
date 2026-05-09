# Real-Time Crypto Analytics Pipeline

Final Big Data course project implementing a real-time cryptocurrency analytics pipeline with Kafka, Spark Structured Streaming, Hive, and a React/FastAPI dashboard.

The system ingests live cryptocurrency trades, processes them in streaming windows, persists the processed analytics in Hive, and visualizes the latest results in a browser dashboard. This README is written as both setup documentation and a project report for evaluation.

## Architecture Overview

```text
Live crypto trades
      ↓
Java Kafka Producer
      ↓
Kafka topic: crypto-trades
      ↓
Spark Structured Streaming
      ↓
Hive managed tables on HDFS
      ↓
React Dashboard reading from Hive through FastAPI
```

This project intentionally uses **Hive as the persistent storage layer**. Spark writes processed micro-batch results into Hive tables using `foreachBatch`. The dashboard does not read directly from Kafka, Spark memory, CSV files, Elasticsearch, or local-only Parquet files. The FastAPI backend reads from Hive through HiveServer2, and the React frontend renders the results.

## Technology Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Ingestion | Java, Kafka, Zookeeper | Collect live trades and publish normalized events |
| Stream processing | Spark Structured Streaming | Parse, enrich, window, and aggregate trade events |
| Persistent storage | Hive, HDFS, PostgreSQL Metastore | Store processed analytical tables |
| API | FastAPI, PyHive | Read Hive data and serve dashboard JSON |
| Frontend | React, Plotly | Display metrics, charts, tables, and alerts |
| Deployment | Docker Compose | Run the full stack locally |

## Requirement Mapping

### Part 1: Kafka Producer

Implemented in:

```text
producer/src/main/java/com/example/producer/CryptoKafkaProducer.java
```

The Java producer defaults to Coinbase's public WebSocket because Binance can return HTTP 451 from some locations/networks. It subscribes to these Coinbase products:

```text
BTC-USD
ETH-USD
SOL-USD
```

It maps those products into the pipeline's USDT-style symbols:

```text
BTCUSDT
ETHUSDT
SOLUSDT
```

If Binance works in your environment, set `MARKET_DATA_SOURCE=binance`. The Binance mode connects to combined trade streams:

```text
btcusdt@trade
ethusdt@trade
solusdt@trade
```

It normalizes each trade event into this JSON format and publishes to Kafka topic `crypto-trades`:

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

Spark calculates 10-second event-time window aggregations:

- average price by symbol
- total volume by symbol
- trade count by symbol
- min price
- max price
- high-activity alert records when a symbol crosses the configured trade-count threshold

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

### Part 4: React/FastAPI Dashboard

Implemented in:

```text
dashboard/backend/main.py
dashboard/frontend/src/main.jsx
```

The dashboard API reads from Hive using PyHive. The React single-page app polls the API every 5 seconds and updates metrics, tables, and charts without reloading the whole page.

It shows:

- latest average price by symbol
- volume chart
- trade count chart
- min/max price table
- latest alerts

For stability, the FastAPI backend uses lightweight Hive reads and performs dashboard ordering and response limiting in the API process. It also keeps the last successful payload in memory so a temporary Hive read issue does not immediately blank the dashboard.

## Docker Services

`docker-compose.yml` includes:

| Service | Purpose |
| --- | --- |
| `zookeeper` | Kafka coordination |
| `kafka` | Message broker for trade events |
| `kafka-ui` | Browser UI for inspecting Kafka topics |
| `namenode` | HDFS NameNode |
| `datanode` | HDFS DataNode |
| `spark-master` | Spark cluster master |
| `spark-worker` | Spark worker node |
| `hive-metastore` | Hive metadata service |
| `hive-server` | HiveServer2 SQL endpoint |
| `hive-metastore-postgresql` | PostgreSQL database for Hive Metastore metadata |
| `producer` | Java market-data producer container |
| `dashboard` | React/FastAPI dashboard container |

HDFS is included because Hive normally stores managed table data in a warehouse directory. The persistent storage layer is still Hive: Spark writes to Hive tables and the dashboard API reads from Hive tables.

## Prerequisites

- Docker Desktop or Docker Engine with Docker Compose v2.
- Internet access on first run so Maven, npm, and Spark packages can be downloaded.
- Recommended minimum: 6 GB RAM available to Docker for the full stack.

## Setup

From the project root:

```bash
cd crypto-bigdata-pipeline
```

Build and start all containers:

```bash
docker compose up -d --build
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

| Component | URL |
| --- | --- |
| Dashboard | http://localhost:8501 |
| Kafka UI | http://localhost:8080 |
| Spark Master | http://localhost:8081 |
| HDFS NameNode | http://localhost:9870 |
| HiveServer2 | `localhost:10000` |

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

Terminal 3: build React assets and restart the FastAPI dashboard service:

```bash
./scripts/run-dashboard.sh
```

Then open:

```text
http://localhost:8501
```

After the producer and Spark job have run for 20-30 seconds, the dashboard should show processed Hive data.

## Demo Steps

1. Start Docker services.
2. Create topic `crypto-trades`.
3. Start Spark streaming job.
4. Start Java producer.
5. Confirm events are flowing in Kafka UI.
6. Wait for Spark to process a few 10-second windows.
7. Open the dashboard.
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
SELECT window_start, window_end, symbol, coin_name, category, avg_price, min_price, max_price, total_volume, trade_count, processed_at
FROM crypto_trade_summary
LIMIT 10;
SELECT window_start, window_end, symbol, coin_name, alert_type, alert_message, current_avg_price, processed_at
FROM crypto_alerts
LIMIT 10;
```

Expected `crypto_trade_summary` output columns:

```text
window_start | window_end | symbol | coin_name | category | avg_price | min_price | max_price | total_volume | trade_count | processed_at
```

Expected `crypto_alerts` output columns:

```text
window_start | window_end | symbol | coin_name | alert_type | alert_message | current_avg_price | processed_at
```

## Verify Dashboard API

```bash
curl -sS http://localhost:8501/api/health
curl -sS http://localhost:8501/api/summary
curl -sS http://localhost:8501/api/alerts
```

Expected API behavior:

- `/api/health` returns API status, Hive status, and refresh interval.
- `/api/summary` returns recent rows from `crypto_analytics.crypto_trade_summary`.
- `/api/alerts` returns recent rows from `crypto_analytics.crypto_alerts`.

## Expected Dashboard Output

The React dashboard should show:

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
- HDFS stores the managed Hive table files.
- FastAPI is only the dashboard API layer and reads from Hive.
- React is only the dashboard UI layer and gets processed results from the FastAPI API.
- The static CSV is only used for enrichment before writing to Hive.
- Processed results are not stored as CSV.
- The project does not replace Hive with Elasticsearch, plain Parquet output, or any other storage layer.

## Troubleshooting

### Dashboard says Hive has no data

Run the producer and Spark job for at least 20–30 seconds. Spark writes data every 10 seconds.

Check the dashboard API:

```bash
curl -sS http://localhost:8501/api/health
```

### Dashboard API returns 503

Hive may still be starting or Spark may not have created the tables yet. Check the services and recent logs:

```bash
docker compose ps
docker compose logs --tail 80 hive-server
docker compose logs --tail 80 dashboard
```

After Hive is ready, restart only the dashboard service:

```bash
docker compose restart dashboard
```

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

Use `docker compose down -v` only when you intentionally want to delete persisted Kafka, Hive, HDFS, and PostgreSQL state.
