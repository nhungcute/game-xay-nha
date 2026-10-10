#!/bin/sh
# Postgres backup (docs/11 §9): pg_dump custom format into /backups, keep the newest $KEEP files.
# `backup.sh loop` (compose service): one dump at start, then every $INTERVAL_SECONDS (default daily).
# `backup.sh once`: a single dump (pnpm db:backup).
set -eu
KEEP="${KEEP:-7}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-86400}"
dump() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  tmp="/backups/.xaynha-$stamp.dump.partial"
  pg_dump -h postgres -U xaynha -d xaynha -Fc -f "$tmp"
  mv "$tmp" "/backups/xaynha-$stamp.dump"
  echo "backup: /backups/xaynha-$stamp.dump ($(wc -c < "/backups/xaynha-$stamp.dump") bytes)"
  # Retention: newest $KEEP dumps survive.
  ls -1t /backups/xaynha-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do rm -f "$old"; echo "backup: removed $old"; done
}
case "${1:-loop}" in
  once) dump ;;
  loop) while true; do dump || echo "backup: FAILED (will retry next interval)" >&2; sleep "$INTERVAL_SECONDS"; done ;;
  *) echo "usage: backup.sh once|loop" >&2; exit 2 ;;
esac
