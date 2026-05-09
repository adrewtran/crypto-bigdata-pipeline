#!/usr/bin/env bash
set -euo pipefail

docker compose exec dashboard bash -lc '
  apt-get update >/dev/null && apt-get install -y --no-install-recommends gcc libsasl2-dev >/dev/null
  pip install --no-cache-dir -r dashboard/requirements.txt
  streamlit run dashboard/app.py --server.address=0.0.0.0 --server.port=8501
'
