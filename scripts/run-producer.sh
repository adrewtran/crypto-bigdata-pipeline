#!/usr/bin/env bash
set -euo pipefail

docker compose exec producer bash -lc '
  cd /app/producer
  mvn -q package
  java -jar target/crypto-kafka-producer-1.0.0.jar
'
