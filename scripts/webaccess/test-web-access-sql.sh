#!/usr/bin/env bash
# Dry-run supabase/web_access_2026_10b.sql on a throwaway local Postgres 16
# (STARTUP_REQUIREMENTS item 131).
#
#   bash scripts/webaccess/test-web-access-sql.sh
#
# Databases: one missing is_app_owner() (the file must refuse), one
# WITHOUT recovery_2026_10b.sql (ops_mark missing — every mark fails
# soft) and one WITH it (marks written, no emails in them).
# Needs the Postgres 16 server binaries (PGBIN=… to override). Run as
# root it drops to the `postgres` OS user with setpriv. Everything lives
# in a temp dir that is deleted on exit. Not part of `npm run build`
# (the build machine has no Postgres).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_TEST:-54331}"
WORK="$(mktemp -d /tmp/vb-webaccess-test.XXXXXX)"
chmod 755 "$WORK"

as_pg() {
  if [ "$(id -u)" = "0" ]; then
    setpriv --reuid=postgres --regid=postgres --init-groups -- "$@"
  else
    "$@"
  fi
}
cleanup() {
  as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

[ "$(id -u)" = "0" ] && chown postgres:postgres "$WORK"
as_pg "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null

cp "$HERE"/test/*.sql "$REPO/supabase/web_access_2026_10b.sql" "$REPO/supabase/paywall_schema.sql" \
   "$REPO/supabase/recovery_2026_10b.sql" "$WORK/"
[ "$(id -u)" = "0" ] && chown -R postgres:postgres "$WORK"
psql_() { as_pg "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres "$@"; }

echo "· refuses to run without is_app_owner()"
psql_ -d postgres -c "create database bare"
psql_ -d bare -c "create table public.config (key text primary key, value text not null)"
if psql_ -d bare -f "$WORK/web_access_2026_10b.sql" >/dev/null 2>&1; then echo "FAIL: ran without is_app_owner"; exit 1; fi
psql_ -d bare -At -c "select count(*) from pg_tables where tablename = 'web_access_allowlist'" | grep -qx 0
psql_ -d bare -At -c "select count(*) from public.config" | grep -qx 0

echo "· without ops_mark: apply, re-run keeps an existing value, assertions"
psql_ -d postgres -c "create database nomark"
psql_ -d nomark -f "$WORK/00_stub.sql" -f "$WORK/paywall_schema.sql"
psql_ -d nomark -f "$WORK/web_access_2026_10b.sql"
psql_ -d nomark -c "update public.config set value = 'allowlist' where key = 'web_access'"
psql_ -d nomark -f "$WORK/web_access_2026_10b.sql"
psql_ -d nomark -At -c "select value from public.config where key = 'web_access'" | grep -qx allowlist
psql_ -d nomark -At -c "select value from public.config where key = 'pro_live'" | grep -qx false
psql_ -d nomark -c "update public.config set value = 'open' where key = 'web_access'"
psql_ -d nomark -f "$WORK/01_assert.sql" >/dev/null

echo "· with ops_mark (recovery_2026_10b.sql first)"
psql_ -d postgres -c "create database marks"
psql_ -d marks -f "$WORK/00_stub.sql" -f "$WORK/paywall_schema.sql" -f "$WORK/recovery_2026_10b.sql"
psql_ -d marks -f "$WORK/web_access_2026_10b.sql"
psql_ -d marks -f "$WORK/02_marks.sql" >/dev/null
psql_ -d marks -f "$WORK/01_assert.sql" >/dev/null

echo "OK — web access SQL dry-run passed"
