#!/bin/sh
set -eu

# A newly mounted volume replaces the ownership baked into the image.
if [ "$(id -u)" = "0" ]; then
  db_dir="$(dirname "${SQLITE_PATH:-/data/rental.sqlite}")"
  backup_dir="${BACKUP_DIR:-/data/backups}"
  mkdir -p "$db_dir" "$backup_dir"
  chown node:node "$db_dir" "$backup_dir"
  exec su-exec node:node "$@"
fi
exec "$@"
