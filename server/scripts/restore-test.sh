#!/usr/bin/env bash
set -euo pipefail
DUMP="${1:?usage: restore-test.sh <db-dump.sql>}"
supabase start
# Port 54122, not the Supabase CLI's stock 54322 default — this repo's
# committed supabase/config.toml remaps it (the winnat remap; see HANDOFF
# invariant #10 / server/test/db/clients.ts's ADMIN_URL, which every other
# script and test in this repo already uses).
DB_URL="postgresql://postgres:postgres@127.0.0.1:54122/postgres"
psql "$DB_URL" -c "drop schema public cascade; create schema public;"
psql "$DB_URL" < "$DUMP"
NODE_ENV=test npm --prefix server run test:db -- integration/loop
echo "restore test passed against $DUMP"
