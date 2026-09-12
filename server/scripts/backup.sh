#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="${BACKUP_DIR:-./backup}"
mkdir -p "$OUT"

echo "pg_dump -> $OUT/db-$STAMP.sql"
pg_dump "$DATABASE_URL_ADMIN" --no-owner --no-privileges > "$OUT/db-$STAMP.sql"

echo "mirror audio bucket -> $OUT/audio-$STAMP/"
supabase storage cp -r "ss:///audio" "$OUT/audio-$STAMP/" --experimental

echo "backup complete: $OUT/db-$STAMP.sql + $OUT/audio-$STAMP/"
