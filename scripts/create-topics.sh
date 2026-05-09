#!/usr/bin/env bash
set -euo pipefail

docker compose exec kafka kafka-topics \
  --bootstrap-server kafka:29092 \
  --create \
  --if-not-exists \
  --topic crypto-trades \
  --partitions 3 \
  --replication-factor 1

docker compose exec kafka kafka-topics \
  --bootstrap-server kafka:29092 \
  --describe \
  --topic crypto-trades
