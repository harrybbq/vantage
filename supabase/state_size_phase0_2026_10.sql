-- ════════════════════════════════════════════════════════════════════
-- state_size_phase0_2026_10.sql — Phase 0 of the state-size migration
-- (docs/STATE_SIZE_PLAN.md §4; STARTUP_REQUIREMENTS items 25–26)
-- Run in the Supabase SQL editor. Owner-run; nothing applies it for you.
-- ════════════════════════════════════════════════════════════════════
--
-- WHY
--   Before any state moves out of user_data.state, two things must
--   exist: a way to stop an out-of-date build BEFORE it loads (a gate
--   binds only builds that already contain it, so it has to ship first),
--   and a census that says when old builds have gone. Nothing moves in
--   this phase.
--
-- WHAT IT DOES
--   1. public.app_config(key pk, value jsonb, updated_at). Global flags,
--      written only by the owner in this editor. Seeded (insert-if-
--      missing, never overwritten):
--        state_shrink — every migration flag, all false
--        min_build    — { "web": 0, "native": 0 } (0 = no minimum)
--      Signed-in users read every row. Signed-out visitors read the
--      min_build row only: the app checks it while the session is still
--      being restored.
--   2. public.app_config_users(user_id pk → auth.users ON DELETE CASCADE,
--      flags jsonb). Per-user overrides for the owner-first canary. Each
--      user reads only their own row.
--   3. public.client_builds(user_id → auth.users ON DELETE CASCADE,
--      platform, build, first_seen_at, last_seen_at), one row per user,
--      platform and build. Keyed by build too, so a second device still
--      on an old build stays visible. RLS on, no policies: written only by…
--   4. public.note_client_build(platform, build). The app calls it at most
--      once per user, platform and build on a device (src/lib/
--      buildGateClient.js). Rejects a build stamp from the future.
--
-- EXISTING ROWS: none are read or changed. New tables and one function.
--
-- UNTIL THIS RUNS: the app's min_build read errors and the gate treats
--   that as "no minimum"; the census call is a no-op. Today's behaviour.
--
-- RE-RUNNABLE: create … if not exists / create or replace / on conflict
--   do nothing. One transaction.
--
-- VERIFY after running:
--   select key, value from public.app_config order by key;
--     -- expect min_build {"web": 0, "native": 0} and state_shrink (all false)
--   select has_table_privilege('anon', 'public.client_builds', 'select'),
--          has_table_privilege('authenticated', 'public.client_builds', 'select'),
--          has_function_privilege('anon', 'public.note_client_build(text,bigint)', 'execute'),
--          has_function_privilege('authenticated', 'public.note_client_build(text,bigint)', 'execute');
--     -- expect false, false, false, true
--   Open the app once, then:
--   select platform, build, count(*) from public.client_builds group by 1, 2 order by build desc;
--   Then Supabase → Advisors (security + performance).
--
-- THE CENSUS — which builds are people on? (counts only)
--   select platform, build, to_timestamp(build / 1000.0) as built_at,
--          count(distinct user_id) as users, max(last_seen_at) as last_seen
--     from public.client_builds
--    where last_seen_at > now() - interval '14 days'
--    group by 1, 2 order by platform, build desc;
--
-- REQUIRING AN UPDATE (owner) — builds OLDER than the number stop before
-- the app loads. Pick the number from the census (a build you have seen
-- running), never a guess:
--   update public.app_config
--      set value = jsonb_set(value, '{web}', to_jsonb(<build>::bigint)), updated_at = now()
--    where key = 'min_build';
-- Undo (everyone back in on their next load):
--   update public.app_config set value = '{"web": 0, "native": 0}'::jsonb, updated_at = now()
--    where key = 'min_build';
-- The app ignores a minimum from the future (a typo can't lock out the
-- newest build), and a running app never stops mid-session.
-- ════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  perform public.ops_mark('sql', 'state_size_phase0_2026_10.sql — start');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

-- ── 1. Global flags ─────────────────────────────────────────────────
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from public, anon, authenticated;
grant select on public.app_config to anon, authenticated;
drop policy if exists "app_config: read" on public.app_config;
create policy "app_config: read" on public.app_config
  for select to authenticated using (true);
drop policy if exists "app_config: read min_build" on public.app_config;
create policy "app_config: read min_build" on public.app_config
  for select to anon using (key = 'min_build');

insert into public.app_config (key, value) values
  ('state_shrink', jsonb_build_object(
      'media_uploads',        false,   -- I3
      'media_migrate',        false,   -- I4 (on-open self-migration)
      'logs_server_shadow',   false,   -- L2
      'logs_client_shadow',   false,   -- L3
      'logs_read_from_table', false,   -- L5 client
      'ratings_from_table',   false)), -- L5 server
  ('min_build', jsonb_build_object('web', 0, 'native', 0))
on conflict (key) do nothing;

-- ── 2. Per-user overrides (owner-first canary) ──────────────────────
-- Own row only, so one user can never see which accounts are canaries.
create table if not exists public.app_config_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  flags      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_config_users enable row level security;
revoke all on public.app_config_users from public, anon, authenticated;
grant select on public.app_config_users to authenticated;
drop policy if exists "app_config_users: own read" on public.app_config_users;
create policy "app_config_users: own read" on public.app_config_users
  for select to authenticated using ((select auth.uid()) = user_id);

-- ── 3. Build census ─────────────────────────────────────────────────
create table if not exists public.client_builds (
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null check (platform in ('web', 'native')),
  build         bigint not null check (build > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (user_id, platform, build)
);
alter table public.client_builds enable row level security;   -- no policies: written by the function below
revoke all on public.client_builds from public, anon, authenticated;
create index if not exists client_builds_seen_idx on public.client_builds (last_seen_at);

create or replace function public.note_client_build(p_platform text, p_build bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not allowed' using errcode = '42501'; end if;
  -- A stamp is a build time in ms: never ≤ 0, never in the future.
  if p_platform not in ('web', 'native') or p_build is null or p_build <= 0
     or p_build > (extract(epoch from now()) * 1000)::bigint + 600000 then
    raise exception 'bad arguments' using errcode = '22023';
  end if;
  insert into public.client_builds as c (user_id, platform, build)
  values (uid, p_platform, p_build)
  on conflict (user_id, platform, build) do update
    set last_seen_at = now();
end;
$$;
revoke all on function public.note_client_build(text, bigint) from public, anon;
grant execute on function public.note_client_build(text, bigint) to authenticated;

do $$ begin
  perform public.ops_mark('sql', 'state_size_phase0_2026_10.sql — done');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

commit;
