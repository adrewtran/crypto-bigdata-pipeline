#!/usr/bin/env sh
set -eu

if ! /opt/hive/bin/schematool -dbType postgres -info; then
  /opt/hive/bin/schematool -dbType postgres -initSchema
fi

exec /opt/hive/bin/hive --service metastore
