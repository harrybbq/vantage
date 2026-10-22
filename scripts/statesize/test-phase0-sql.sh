#!/usr/bin/env bash
# Dry-run supabase/state_size_phase0_2026_10.sql on a throwaway local
# Postgres 16 (docs/STATE_SIZE_PLAN.md, Phase 0).
#
#   bash scripts/statesize/test-phase0-sql.sh
#
# Uses the Supabase stub from scripts/webaccess/test/00_stub.sql (API
# roles, auth.users, auth.uid() from request.jwt.claim.sub, default
# privileges). Applies the file twice, then checks the grants, what anon
# and a signed-in user can read, the census function and the cascades.
# Needs the Postgres 16 server binaries (PGBIN=… to override). Run as
# root it drops to the `postgres` OS user with setpriv. Not part of
# `npm run build` (the build machine has no Postgres).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT_TEST:-54332}"
WORK="$(mktemp -d /tmp/vb-phase0-test.XXXXXX)"
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

cp "$REPO/scripts/webaccess/test/00_stub.sql" "$REPO/supabase/state_size_phase0_2026_10.sql" \
   "$REPO/supabase/recovery_2026_10b.sql" "$WORK/"
[ "$(id -u)" = "0" ] && chown -R postgres:postgres "$WORK"
psql_() { as_pg "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres "$@"; }
val() { psql_ -d t -At -c "$1"; }
expect() { local got; got="$(val "$2")"; [ "$got" = "$3" ] || { echo "FAIL: $1 — expected [$3], got [$got]"; exit 1; }; echo "  ok  $1"; }
refuses() { if psql_ -d t -c "$2" >/dev/null 2>&1; then echo "FAIL: $1 — was allowed"; exit 1; fi; echo "  ok  $1"; }

U1=00000000-0000-4000-8000-000000000002
U2=00000000-0000-4000-8000-000000000003
NOW_MS="(extract(epoch from now()) * 1000)::bigint"

echo "· without ops_mark: applies, and re-applies"
psql_ -d postgres -c "create database t"
psql_ -d t -f "$WORK/00_stub.sql" >/dev/null
psql_ -d t -f "$WORK/state_size_phase0_2026_10.sql"
psql_ -d t -c "update public.app_config set value = '{\"web\": 5, \"native\": 0}' where key = 'min_build'"
psql_ -d t -f "$WORK/state_size_phase0_2026_10.sql"
expect "re-run never overwrites a set value" "select value->>'web' from public.app_config where key = 'min_build'" "5"
psql_ -d t -c "update public.app_config set value = '{\"web\": 0, \"native\": 0}' where key = 'min_build'"
expect "seeded flags are all off" "select bool_or(v::boolean) from public.app_config, jsonb_each_text(value) e(k, v) where key = 'state_shrink'" "f"

echo "· grants"
expect "client_builds closed to clients" "select has_table_privilege('anon','public.client_builds','select') or has_table_privilege('authenticated','public.client_builds','select') or has_table_privilege('authenticated','public.client_builds','insert')" "f"
expect "anon cannot call the census" "select has_function_privilege('anon','public.note_client_build(text,bigint)','execute')" "f"
expect "signed-in users can" "select has_function_privilege('authenticated','public.note_client_build(text,bigint)','execute')" "t"
expect "no client writes to app_config" "select has_table_privilege('authenticated','public.app_config','insert') or has_table_privilege('authenticated','public.app_config','update') or has_table_privilege('anon','public.app_config','delete')" "f"
expect "no client writes to overrides" "select has_table_privilege('authenticated','public.app_config_users','insert') or has_table_privilege('authenticated','public.app_config_users','update')" "f"

echo "· what each role reads"
expect "anon sees min_build only" "set role anon; select string_agg(key, ',' order by key) from public.app_config" "min_build"
expect "signed-in sees every flag row" "set role authenticated; select set_config('request.jwt.claim.sub', '$U1', false); select string_agg(key, ',' order by key) from public.app_config" "$U1
min_build,state_shrink"
psql_ -d t -c "insert into public.app_config_users (user_id, flags) values ('$U1', '{\"media_uploads\": true}'), ('$U2', '{}')"
expect "overrides: own row only" "set role authenticated; select set_config('request.jwt.claim.sub', '$U1', false); select count(*) from public.app_config_users" "$U1
1"

echo "· the census"
refuses "no session → refused" "set role authenticated; select public.note_client_build('web', 1)"
refuses "anon → refused" "set role anon; select public.note_client_build('web', 1)"
psql_ -d t -c "set role authenticated; select set_config('request.jwt.claim.sub', '$U1', false); select public.note_client_build('web', $NOW_MS - 1000); select public.note_client_build('web', $NOW_MS - 1000); select public.note_client_build('web', $NOW_MS - 90000000); select public.note_client_build('native', $NOW_MS - 1000);" >/dev/null
expect "one row per user, platform and build" "select count(*) from public.client_builds where user_id = '$U1'" "3"
refuses "a build from the future" "set role authenticated; select set_config('request.jwt.claim.sub', '$U1', false); select public.note_client_build('web', $NOW_MS + 3600000)"
refuses "a bad platform" "set role authenticated; select set_config('request.jwt.claim.sub', '$U1', false); select public.note_client_build('ios', 1)"
refuses "a zero build" "set role authenticated; select set_config('request.jwt.claim.sub', '$U1', false); select public.note_client_build('web', 0)"
refuses "a client cannot read the census" "set role authenticated; select set_config('request.jwt.claim.sub', '$U1', false); select count(*) from public.client_builds"

echo "· account deletion cascades"
psql_ -d t -c "delete from auth.users where id = '$U1'"
expect "census rows gone" "select count(*) from public.client_builds where user_id = '$U1'" "0"
expect "override row gone" "select count(*) from public.app_config_users where user_id = '$U1'" "0"
expect "global flags untouched" "select count(*) from public.app_config" "2"

echo "· with ops_mark (recovery_2026_10b.sql): marks written"
psql_ -d postgres -c "create database m"
psql_ -d m -f "$WORK/00_stub.sql" -f "$WORK/recovery_2026_10b.sql" >/dev/null
psql_ -d m -f "$WORK/state_size_phase0_2026_10.sql"
got="$(psql_ -d m -At -c "select count(*) from public.ops_log where label like 'state_size_phase0_2026_10.sql%'")"
[ "$got" = "2" ] || { echo "FAIL: expected 2 ops marks, got $got"; exit 1; }
echo "  ok  start + done marks"

echo "phase0 SQL: all checks passed"
