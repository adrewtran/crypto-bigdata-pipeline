#!/usr/bin/env bash
set -euo pipefail

docker compose exec dashboard bash -lc '
  apt-get update >/dev/null && apt-get install -y --no-install-recommends gcc libsasl2-dev nodejs npm >/dev/null
  pip install --no-cache-dir -r dashboard/requirements.txt
  cd dashboard/frontend
  npm install
  npm run build
'

docker compose restart dashboard
