#!/bin/sh
set -e
# 首次启动自动下载中国边界数据（持久卷里已有则跳过）
if [ ! -f /app/server/data/geojson/100000_full.json ]; then
  echo "首次启动：下载中国边界数据到 server/data/geojson/ ..."
  node server/scripts/bootstrap-geo.js
fi
exec "$@"
