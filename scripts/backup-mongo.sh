#!/usr/bin/env bash
set -euo pipefail
URI="${1:?usage: backup-mongo.sh MONGODB_URI [out_dir]}"
OUT="${2:-./backups}"
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%d-%H%M%S)
DIR="$OUT/relay-$STAMP"
echo "Backing up to $DIR (directory format)"
mongodump --uri="$URI" --out="$DIR" --gzip
echo "OK $DIR"
