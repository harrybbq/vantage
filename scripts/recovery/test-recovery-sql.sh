#!/usr/bin/env bash
# Dry-run supabase/recovery_2026_10b.sql on a throwaway local Postgres 16
# and check export → import end to end (STARTUP_REQUIREMENTS items 27, 82).
#
#   bash scripts/recovery/test-recovery-sql.sh
#
# Needs the Postgres 16 server binaries (default /usr/lib/postgresql/16/bin,
# override with PGBIN=…). Run as root it drops to the `postgres` OS user
# with setpriv. Everything lives in a temp dir that is deleted on exit.
# Not part of `npm run build` (the build machine has no Postgres); the
# node test for netlify/lib/opsMark.js is (check:opsmark).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_TEST:-54329}"
WORK="$(mktemp -d /tmp/vb-recovery-test.XXXXXX)"
chmod 755 "$WORK"

as_pg() {
  if [ "$(id -u)" = "0" ]; then
    setpriv --reuid=postgres --regid=postgres --init-groups -- "$@"
  else
    "$@"
  fi
}

cleanup() {
  if [ -n "${KEEP:-}" ]; then echo "KEEP set: cluster left running in $WORK (port $PORT)"; return; fi
  as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

[ "$(id -u)" = "0" ] && chown postgres:postgres "$WORK"
as_pg "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null

# Copy the SQL into the temp dir so the postgres user can read it.
cp "$HERE"/test/*.sql "$REPO/supabase/recovery_2026_10b.sql" "$REPO/supabase/user_data_history_schema.sql" "$WORK/"
[ "$(id -u)" = "0" ] && chown -R postgres:postgres "$WORK"

psql_() { as_pg "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres "$@"; }

echo "· fresh database: the start/done convention runs before ops_mark exists"
psql_ -d postgres -c "create database conv"
psql_ -d conv -c "do \$\$ begin perform public.ops_mark('sql', 'x.sql — start'); exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null; end \$\$;"

echo "· the copy: schema + history trigger + recovery SQL + data at T"
psql_ -d postgres -c "create database copy"
psql_ -d copy -f "$WORK/00_stub.sql" -f "$WORK/01_schema.sql" -f "$WORK/user_data_history_schema.sql"
psql_ -d copy -f "$WORK/recovery_2026_10b.sql"
psql_ -d copy -f "$WORK/recovery_2026_10b.sql"          # re-runnable
psql_ -d copy -f "$WORK/02_seed.sql"

echo "· production = the copy, then everything that happened after T"
psql_ -d postgres -c "create database prod template copy"
psql_ -d prod -f "$WORK/03_prod_drift.sql"

echo "· export Alice and Carol from the copy"
psql_ -d copy -At -c "select public.export_user_bundle('aaaaaaaa-0000-4000-8000-000000000001', 'test copy at T')" > "$WORK/alice.json"
psql_ -d copy -At -c "select public.export_user_bundle('cccccccc-0000-4000-8000-000000000003', 'test copy at T')" > "$WORK/carol.json"
[ "$(id -u)" = "0" ] && chown postgres:postgres "$WORK"/*.json
echo "  alice bundle: $(wc -c < "$WORK/alice.json") bytes"

echo "· assertions"
# Bundles are read server-side (pg_read_file): a 450 kB argument would
# exceed the kernel's per-argument limit.
psql_ -d copy -v dir="$WORK" -f "$WORK/04_assert_copy.sql"
psql_ -d prod -v dir="$WORK" -f "$WORK/05_assert_prod.sql"

echo "OK — recovery SQL dry-run passed"
