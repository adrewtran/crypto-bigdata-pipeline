CREATE DATABASE IF NOT EXISTS crypto_analytics;

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
STORED AS PARQUET;

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
STORED AS PARQUET;
