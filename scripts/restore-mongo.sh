#!/usr/bin/env bash
set -euo pipefail
URI="${1:?usage: restore-mongo.sh MONGODB_URI DUMP_DIR}"
DIR="${2:?usage: restore-mongo.sh MONGODB_URI DUMP_DIR}"
echo "WARNING: restoring $DIR into $URI (destructive --drop). Never use against production without separate authorization."
mongorestore --uri="$URI" --gzip --drop "$DIR"
echo "Restore finished"
