-- ============================================================================
-- DRAFT — DO NOT RUN.
-- Reviewed in docs/STATE_SIZE_PLAN.md (STARTUP_REQUIREMENTS items 25 and 26).
--
-- Nothing in this file has been run against the Supabase project. Each
-- section belongs to one phase of the plan and is run ONLY when the owner
-- approves that phase — never the whole file at once. Section 4 (cleanup)
-- is deliberately inside a block comment so that running the file by
-- mistake cannot create it.
--
-- Conventions (pull_request_template.md, SQL):
--   · additive and re-runnable (if not exists / drop … if exists);
--   · every user-scoped table: RLS on + references auth.users(id) on delete
--     cascade (item 20) + explicit grants (Supabase grants everything on new
--     public tables to anon/authenticated by default, so revoke first);
--   · every security definer function: set search_path = '' and
--     revoke execute from public, anon (and authenticated unless meant for
--     clients);
--   · no update/delete of existing rows anywhere outside section 4.
--
-- Sections:
--   0. Phase 0  — preflight (read-only) + flags + build census
--   1. Phase I1 — media bucket, ledger, hash-guarded swap, restore
--   2. Phase L1 — daily_log, journal, validation, write functions
--   3. Phase L4 — backfill, verify, reconciler bookkeeping
--   4. Phase L7 — archive, cleanup, absorb   (COMMENTED OUT)
--   5. Verification queries (read-only)
-- ============================================================================


-- ============================================================================
-- 0. PHASE 0 — preflight and flags
-- ============================================================================

-- ── 0a. Read-only preflight. Run these first; they change nothing. ──────────
--
-- Is the AUDIT version of vb_state_meaningful live? (It walks every key with
-- jsonb_each; the older user_data_history_schema.sql version does not, and
-- would not count the cleanup marker.) Expect true.
-- select pg_get_functiondef('public.vb_state_meaningful(jsonb)'::regprocedure) ilike '%jsonb_each%' as audit_version_live;
--
-- Is the health-token expression index from the audit SQL present? Expect 1.
-- select count(*) from pg_indexes where indexname = 'user_data_health_token_idx';
--
-- Size measurement, aggregates only — no content leaves the database.
-- octet_length(::text) is the wire size before gzip; pg_column_size is the
-- stored (TOAST-compressed) size. Heavy (detoasts every row): run once, at a
-- quiet time.
-- select count(*) as users,
--        round(avg(octet_length(state::text)))                                   as avg_bytes,
--        percentile_cont(0.5) within group (order by octet_length(state::text)) as p50_bytes,
--        percentile_cont(0.9) within group (order by octet_length(state::text)) as p90_bytes,
--        max(octet_length(state::text))                                          as max_bytes,
--        round(avg(pg_column_size(state)))                                       as avg_stored
--   from public.user_data;
--
-- select e.key, count(*) as users_with_key,
--        round(avg(octet_length(e.value::text))) as avg_bytes,
--        max(octet_length(e.value::text))        as max_bytes
--   from public.user_data u, jsonb_each(u.state) e
--  group by e.key
--  order by avg(octet_length(e.value::text)) desc
--  limit 30;
--
-- How much of the state is data: URIs, per field family (bytes only):
-- select 'backgrounds' as field, sum(octet_length(b.value #>> '{}')) as bytes
--   from public.user_data u, jsonb_each(case when jsonb_typeof(u.state->'backgrounds') = 'object' then u.state->'backgrounds' else '{}'::jsonb end) b
--  where b.value #>> '{}' like 'data:%'
-- union all
-- select 'holidays', sum(octet_length(h->>'imageUrl'))
--   from public.user_data u, jsonb_array_elements(case when jsonb_typeof(u.state->'holidays') = 'array' then u.state->'holidays' else '[]'::jsonb end) h
--  where h->>'imageUrl' like 'data:%'
-- union all
-- select 'shopItems', sum(octet_length(s->>'imageUrl'))
--   from public.user_data u, jsonb_array_elements(case when jsonb_typeof(u.state->'shopItems') = 'array' then u.state->'shopItems' else '[]'::jsonb end) s
--  where s->>'imageUrl' like 'data:%'
-- union all
-- select 'savings', sum(octet_length(g->>'image'))
--   from public.user_data u, jsonb_array_elements(case when jsonb_typeof(u.state->'savings') = 'array' then u.state->'savings' else '[]'::jsonb end) g
--  where g->>'image' like 'data:%';

begin;

-- ── 0b. Remote flags. Global values, readable by signed-in users. ───────────
-- Written only by the owner in the SQL editor. Defaults are all OFF, and the
-- client treats "could not read" as OFF — today's behaviour.
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to authenticated;
drop policy if exists "app_config: read" on public.app_config;
create policy "app_config: read" on public.app_config
  for select to authenticated using (true);

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

-- Per-user overrides (owner-first canary). Own row only, so one user can
-- never see which other accounts are canaries.
create table if not exists public.app_config_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  flags      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_config_users enable row level security;
revoke all on public.app_config_users from anon, authenticated;
grant select on public.app_config_users to authenticated;
drop policy if exists "app_config_users: own read" on public.app_config_users;
create policy "app_config_users: own read" on public.app_config_users
  for select to authenticated using ((select auth.uid()) = user_id);

-- ── 0c. Build census: "is anyone still on an old build?" ────────────────────
create table if not exists public.client_builds (
  user_id      uuid not null references auth.users(id) on delete cascade,
  platform     text not null check (platform in ('web', 'native')),
  build        bigint not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, platform)
);
alter table public.client_builds enable row level security;   -- no policies: written by the function below
revoke all on public.client_builds from anon, authenticated;

create or replace function public.note_client_build(p_platform text, p_build bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not allowed'; end if;
  if p_platform not in ('web', 'native') or p_build is null or p_build < 0 then
    raise exception 'bad arguments';
  end if;
  insert into public.client_builds as c (user_id, platform, build, last_seen_at)
  values (uid, p_platform, p_build, now())
  on conflict (user_id, platform) do update
    set build = excluded.build, last_seen_at = now();
end;
$$;
revoke all on function public.note_client_build(text, bigint) from public, anon;
grant execute on function public.note_client_build(text, bigint) to authenticated;

commit;


-- ============================================================================
-- 1. PHASE I1 — pictures to Storage
-- ============================================================================
-- Ship WITH this: 'media' added to STORAGE_BUCKETS in
-- netlify/functions/delete-account.js, before any object is written
-- (storage.objects has no FK to auth.users).

begin;

-- ── 1a. Bucket. Private; read + insert own folder only. ─────────────────────
-- NO update and NO delete policy for clients: paths are content-addressed
-- (<uid>/<kind>/<sha256>.<ext>), so nothing is ever overwritten, and a
-- client that cannot delete cannot lose a picture through a bug. Orphans are
-- swept by the owner (phase I5), never by a client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media owner read"   on storage.objects;
drop policy if exists "media owner insert" on storage.objects;

create policy "media owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "media owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 1b. Ledger. Server-only; keeps the ORIGINAL data URI for 90 days. ───────
-- Storage is not covered by database backups or PITR, so the original stays
-- here until the owner-approved purge in phase I5.
create table if not exists public.media_ledger (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('background', 'holiday', 'shop', 'savings')),
  item_key       text not null,           -- background section, or the item's id
  uri_sha256     text not null,           -- sha256 of the data: URI string as stored (swap guard)
  content_sha256 text not null,           -- sha256 of the decoded bytes (storage path)
  bytes          integer not null,
  mime           text not null,
  storage_path   text not null,           -- <uid>/<kind>/<content_sha256>.<ext>
  original       text,                    -- the data: URI; set to null only by the I5 purge
  status         text not null default 'uploaded'
                 check (status in ('uploaded', 'verified', 'swapped', 'changed', 'restored')),
  created_at     timestamptz not null default now(),
  swapped_at     timestamptz,
  purged_at      timestamptz,
  unique (user_id, kind, item_key, uri_sha256)
);
create index if not exists media_ledger_user_idx on public.media_ledger (user_id, status);
alter table public.media_ledger enable row level security;   -- no policies: service role only
revoke all on public.media_ledger from anon, authenticated;

-- ── 1c. Where a picture lives in the state, as a jsonb path. ─────────────────
-- Arrays are located by the item's id, never by a remembered index: the user
-- may reorder between the migrator's read and its swap. Returns null when the
-- item is missing or its id is not unique (refuse rather than guess).
create or replace function public.media_state_path(p_state jsonb, p_kind text, p_key text)
returns text[]
language plpgsql stable set search_path = ''
as $$
declare
  arr_key text;
  field   text;
  n       integer;
  idx     integer;
begin
  if p_kind = 'background' then
    return array['backgrounds', p_key];
  end if;
  arr_key := case p_kind when 'holiday' then 'holidays' when 'shop' then 'shopItems' when 'savings' then 'savings' end;
  field   := case p_kind when 'savings' then 'image' else 'imageUrl' end;
  if arr_key is null or jsonb_typeof(p_state -> arr_key) is distinct from 'array' then
    return null;
  end if;
  select count(*), min(e.ord) - 1
    into n, idx
    from jsonb_array_elements(p_state -> arr_key) with ordinality as e(val, ord)
   where e.val ->> 'id' = p_key;
  if n <> 1 then return null; end if;
  return array[arr_key, idx::text, field];
end;
$$;
revoke all on function public.media_state_path(jsonb, text, text) from public, anon, authenticated;

-- ── 1d. The swap. Service role only. ─────────────────────────────────────────
-- Replaces ONE data URI with its 'vbm:media/<path>' reference, and only if the
-- field still holds exactly the value that was uploaded (hash match). Locks
-- the row so it serialises with client CAS saves and server writers; bumps
-- updated_at so any open client conflicts and three-way merges (base = old
-- URI, remote = ref → the ref wins) instead of writing its copy back.
-- → 'swapped' | 'already' | 'changed' (user edited it meanwhile — retry next
--   sweep) | 'missing'
create or replace function public.media_swap_ref(
  p_user uuid, p_kind text, p_key text, p_expected_uri_sha text, p_ref text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  st   jsonb;
  path text[];
  cur  text;
begin
  if p_user is null or p_ref is null
     or p_ref !~ ('^vbm:media/' || p_user::text || '/(bg|holiday|shop|savings)/[0-9a-f]{64}\.(jpg|png|webp)$') then
    raise exception 'bad arguments';
  end if;

  select u.state into st from public.user_data u where u.id = p_user for update;
  if st is null then return 'missing'; end if;

  path := public.media_state_path(st, p_kind, p_key);
  if path is null then return 'missing'; end if;
  cur := st #>> path;
  if cur is null then return 'missing'; end if;
  if cur = p_ref then return 'already'; end if;      -- re-run after a success: nothing to do
  if encode(sha256(convert_to(cur, 'UTF8')), 'hex') <> p_expected_uri_sha then
    update public.media_ledger set status = 'changed'
     where user_id = p_user and kind = p_kind and item_key = p_key
       and uri_sha256 = p_expected_uri_sha and status in ('uploaded', 'verified');
    return 'changed';
  end if;

  update public.user_data
     set state = jsonb_set(state, path, to_jsonb(p_ref), false),
         updated_at = now()
   where id = p_user;

  update public.media_ledger set status = 'swapped', swapped_at = now()
   where user_id = p_user and kind = p_kind and item_key = p_key
     and uri_sha256 = p_expected_uri_sha;
  return 'swapped';
end;
$$;
revoke all on function public.media_swap_ref(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.media_swap_ref(uuid, text, text, text, text) to service_role;

-- ── 1e. Rollback for one user: put the originals back. Service role only. ───
-- Only where the field STILL holds the reference this ledger row wrote — a
-- picture the user replaced since is left alone. Bumps updated_at.
create or replace function public.media_restore_user(p_user uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  st   jsonb;
  r    record;
  path text[];
  n    integer := 0;
begin
  if p_user is null then raise exception 'bad arguments'; end if;
  select u.state into st from public.user_data u where u.id = p_user for update;
  if st is null then return 0; end if;

  for r in
    select id, kind, item_key, storage_path, original
      from public.media_ledger
     where user_id = p_user and status = 'swapped' and original is not null
     order by id
  loop
    path := public.media_state_path(st, r.kind, r.item_key);
    if path is not null and st #>> path = 'vbm:media/' || r.storage_path then
      st := jsonb_set(st, path, to_jsonb(r.original), false);
      update public.media_ledger set status = 'restored' where id = r.id;
      n := n + 1;
    end if;
  end loop;

  if n > 0 then
    update public.user_data set state = st, updated_at = now() where id = p_user;
  end if;
  return n;
end;
$$;
revoke all on function public.media_restore_user(uuid) from public, anon, authenticated;
grant execute on function public.media_restore_user(uuid) to service_role;

commit;


-- ============================================================================
-- 2. PHASE L1 — per-day logs table
-- ============================================================================

begin;

-- ── 2a. The table. ──────────────────────────────────────────────────────────
-- kind 'burn' stores { <entry id>: { label, kcal, start?, steps?, ord } } so
-- that writers touching different entries of one day never clobber each
-- other; the client view sorts by ord then id and strips ord.
-- src mirrors data's keys: key → 'manual'|'whoop'|'oura'|'apple'|'backfill'|'absorb'.
-- created_at is server-stamped and immutable (trigger); clients cannot write
-- this table at all except through daily_log_apply.
create table if not exists public.daily_log (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('vitals', 'burn', 'body', 'mood')),
  day        date not null check (day between date '2000-01-01' and date '2100-01-01'),
  data       jsonb not null default '{}'::jsonb,
  src        jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, day),
  constraint daily_log_data_object check (jsonb_typeof(data) = 'object'),
  constraint daily_log_src_object  check (jsonb_typeof(src) = 'object'),
  constraint daily_log_data_size   check (pg_column_size(data) <= 16384)
);
-- Delta sync on open / poll: rows changed since the client's cursor.
create index if not exists daily_log_user_updated_idx on public.daily_log (user_id, updated_at);

alter table public.daily_log enable row level security;
revoke all on public.daily_log from anon, authenticated;
grant select on public.daily_log to authenticated;
drop policy if exists "daily_log: own read" on public.daily_log;
create policy "daily_log: own read" on public.daily_log
  for select to authenticated using ((select auth.uid()) = user_id);
-- Deliberately NO insert / update / delete policy or grant for clients.
-- Not added to the supabase_realtime publication: no realtime needed.

-- ── 2b. Journal of every overwrite or removal. ──────────────────────────────
create table if not exists public.daily_log_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  day         date not null,
  data        jsonb not null,
  src         jsonb not null,
  replaced_at timestamptz not null default now()
);
create index if not exists daily_log_history_user_idx
  on public.daily_log_history (user_id, kind, day, replaced_at desc);
alter table public.daily_log_history enable row level security;
revoke all on public.daily_log_history from anon, authenticated;
grant select on public.daily_log_history to authenticated;
drop policy if exists "daily_log_history: own read" on public.daily_log_history;
create policy "daily_log_history: own read" on public.daily_log_history
  for select to authenticated using ((select auth.uid()) = user_id);

-- BEFORE UPDATE: identity and created_at never change; a write that changes
-- nothing is skipped entirely (no updated_at bump → no delta traffic when a
-- cron re-sends the same days).
create or replace function public.daily_log_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.data = old.data and new.src = old.src then
    return null;
  end if;
  new.user_id    := old.user_id;
  new.kind       := old.kind;
  new.day        := old.day;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

-- AFTER UPDATE: keep the old row whenever an existing key's value changed or
-- disappeared. Purely additive writes are not journaled. 90-day retention,
-- trimmed per day-row as it is written (cheap: indexed).
create or replace function public.daily_log_journal()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from jsonb_each(old.data) o
              where (new.data -> o.key) is distinct from o.value) then
    insert into public.daily_log_history (user_id, kind, day, data, src)
    values (old.user_id, old.kind, old.day, old.data, old.src);
    delete from public.daily_log_history h
     where h.user_id = old.user_id and h.kind = old.kind and h.day = old.day
       and h.replaced_at < now() - interval '90 days';
  end if;
  return null;
end;
$$;

-- Trigger functions cannot be called as RPCs, but the advisor flags them;
-- EXECUTE is checked only when a trigger is created, never when it fires.
revoke all on function public.daily_log_touch()   from public, anon, authenticated;
revoke all on function public.daily_log_journal() from public, anon, authenticated;

drop trigger if exists trg_daily_log_touch on public.daily_log;
create trigger trg_daily_log_touch
  before update on public.daily_log
  for each row execute function public.daily_log_touch();

drop trigger if exists trg_daily_log_journal on public.daily_log;
create trigger trg_daily_log_journal
  after update on public.daily_log
  for each row execute function public.daily_log_journal();

-- ── 2c. Helpers. Internal; no client execute. ───────────────────────────────
create or replace function public.vb_is_date(p text)
returns boolean
language plpgsql immutable set search_path = ''
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  perform p::date;               -- '2026-02-30' raises → false
  return p::date between date '2000-01-01' and date '2100-01-01';
exception when others then
  return false;
end;
$$;
revoke all on function public.vb_is_date(text) from public, anon, authenticated;

-- burnLog day array → keyed object. Missing ids become 'legacy-<n>', a
-- duplicated id becomes '<id>#<n>' (reported by verify; none expected).
create or replace function public.daily_log_burn_obj(p_arr jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  with entries as (
    select x.val, x.ord, coalesce(nullif(x.val ->> 'id', ''), 'legacy-' || x.ord) as base_id
      from jsonb_array_elements(case when jsonb_typeof(p_arr) = 'array' then p_arr else '[]'::jsonb end)
           with ordinality as x(val, ord)
     where jsonb_typeof(x.val) = 'object'
  ), keyed as (
    select val, ord,
           case when count(*) over (partition by base_id) > 1 then base_id || '#' || ord else base_id end as id
      from entries
  )
  select coalesce(jsonb_object_agg(id, (val - 'id') || jsonb_build_object('ord', ord)), '{}'::jsonb)
    from keyed;
$$;
revoke all on function public.daily_log_burn_obj(jsonb) from public, anon, authenticated;

-- Remove listed keys (and, server-only, keys with a prefix) from an object.
create or replace function public.daily_log_strip(p_obj jsonb, p_keys jsonb, p_prefix text)
returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(p_obj) e
   where not (coalesce(p_keys, '[]'::jsonb) ? e.key)
     and (p_prefix is null or left(e.key, length(p_prefix)) <> p_prefix);
$$;
revoke all on function public.daily_log_strip(jsonb, jsonb, text) from public, anon, authenticated;

-- Value validation for NEW writes (the backfill never validates values — it
-- copies what exists, so nothing is dropped; verify reports oddities).
-- Ranges are deliberately WIDER than the UI's (lib/vitals/metrics.js,
-- VitalsHistoryCard EDIT_LIMITS) so a value the app accepts is never refused.
-- Unknown keys are allowed (future metrics need no migration) if small.
create or replace function public.daily_log_valid_value(p_kind text, p_key text, p_val jsonb)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  n numeric;
  t text := jsonb_typeof(p_val);
begin
  if p_kind in ('vitals', 'body', 'mood') then
    if p_key !~ '^[A-Za-z][A-Za-z0-9_]{0,31}$' then return false; end if;
    if t = 'number' then
      n := (p_val #>> '{}')::numeric;
      return case p_key
        when 'weight'     then n between 20 and 400
        when 'sleep'      then n between 0 and 24
        when 'rhr'        then n between 20 and 250
        when 'hrv'        then n between 0 and 500
        when 'recovery'   then n between 0 and 100
        when 'strain'     then n between 0 and 25
        when 'burnKcal'   then n between 0 and 20000
        when 'stepsWhoop' then n between 0 and 200000
        when 'stepsOura'  then n between 0 and 200000
        when 'waist'      then n between 10 and 400
        when 'bodyFat'    then n between 1 and 80
        when 'mood'       then n between 0 and 10
        else abs(n) <= 1000000
      end;
    end if;
    if p_key in ('weight','sleep','rhr','hrv','recovery','strain','burnKcal',
                 'stepsWhoop','stepsOura','waist','bodyFat','mood') then
      return false;                        -- known metrics must be numbers
    end if;
    return t = 'boolean' or (t = 'string' and length(p_val #>> '{}') <= 64);
  elsif p_kind = 'burn' then
    if p_key !~ '^[A-Za-z0-9_.:#-]{1,80}$' or t <> 'object' then return false; end if;
    if jsonb_typeof(p_val -> 'kcal') is distinct from 'number'
       or (p_val ->> 'kcal')::numeric not between 0 and 20000 then return false; end if;
    if p_val ? 'label' and (jsonb_typeof(p_val -> 'label') <> 'string' or length(p_val ->> 'label') > 120) then return false; end if;
    if p_val ? 'start' and (jsonb_typeof(p_val -> 'start') <> 'string' or length(p_val ->> 'start') > 40) then return false; end if;
    if p_val ? 'steps' and (jsonb_typeof(p_val -> 'steps') <> 'number' or (p_val ->> 'steps')::numeric not between 0 and 200000) then return false; end if;
    if p_val ? 'ord'   and jsonb_typeof(p_val -> 'ord') <> 'number' then return false; end if;
    return octet_length(p_val::text) <= 1024;
  end if;
  return false;
end;
$$;
revoke all on function public.daily_log_valid_value(text, text, jsonb) from public, anon, authenticated;

-- ── 2d. The write core. Never called directly by anyone. ────────────────────
-- p_ops: [{ kind, day, set:{…}, unset:[…], unset_prefix? }]  (≤ 400 per call)
-- Each op is one atomic row upsert: data = (data − unset − prefix) || set.
-- Invalid ops are skipped and reported per op; nothing is half-applied.
create or replace function public.daily_log_apply_core(
  p_user uuid, p_source text, p_ops jsonb, p_client boolean)
returns table (out_kind text, out_day date, out_status text)
language plpgsql security definer set search_path = ''
as $$
declare
  op        jsonb;
  k         text;
  d         date;
  s         jsonb;
  u         jsonb;
  up        text;
  srcs      jsonb;
  unset_n   integer;
  unset_d   integer;
begin
  if p_user is null then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) > 400 then
    raise exception 'bad batch';
  end if;

  -- Bulk-removal brake (server side; the client has its own). No screen in
  -- the app removes this much at once; a diff that does is a bug.
  select coalesce(sum(case when jsonb_typeof(o -> 'unset') = 'array' then jsonb_array_length(o -> 'unset') else 0 end), 0),
         count(*) filter (where jsonb_typeof(o -> 'unset') = 'array' and jsonb_array_length(o -> 'unset') > 0)
    into unset_n, unset_d
    from jsonb_array_elements(p_ops) o;
  if p_client and (unset_n > 200 or unset_d > 31) then
    raise exception 'bulk removal refused';
  end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    k  := op ->> 'kind';
    out_kind := k; out_day := null;

    if k is null or k not in ('vitals', 'burn', 'body', 'mood') or (p_client and k = 'mood') then
      out_status := 'bad-kind'; return next; continue;
    end if;
    if not public.vb_is_date(op ->> 'day') then
      out_status := 'bad-day'; return next; continue;
    end if;
    d := (op ->> 'day')::date;
    out_day := d;
    if d > current_date + 2 then
      out_status := 'bad-day'; return next; continue;
    end if;

    s  := coalesce(op -> 'set', '{}'::jsonb);
    u  := coalesce(op -> 'unset', '[]'::jsonb);
    up := op ->> 'unset_prefix';
    if jsonb_typeof(s) <> 'object' or jsonb_typeof(u) <> 'array'
       or octet_length(s::text) > 8192
       or (select count(*) from jsonb_object_keys(s)) > 40
       or jsonb_array_length(u) > 100
       or exists (select 1 from jsonb_array_elements(u) x where jsonb_typeof(x) <> 'string')
       or (up is not null and (p_client or up !~ '^(whoop|oura|ah-steps)-$')) then
      out_status := 'bad-op'; return next; continue;
    end if;
    if exists (select 1 from jsonb_each(s) e where not public.daily_log_valid_value(k, e.key, e.value)) then
      out_status := 'invalid'; return next; continue;
    end if;

    -- Nothing to add and no row yet: do not create an empty row.
    if s = '{}'::jsonb and not exists (
         select 1 from public.daily_log t where t.user_id = p_user and t.kind = k and t.day = d) then
      out_status := 'noop'; return next; continue;
    end if;

    select coalesce(jsonb_object_agg(e.key, to_jsonb(p_source)), '{}'::jsonb)
      into srcs from jsonb_each(s) e;

    insert into public.daily_log as t (user_id, kind, day, data, src)
    values (p_user, k, d, s, srcs)
    on conflict (user_id, kind, day) do update
      set data = public.daily_log_strip(t.data, u, up) || excluded.data,
          src  = public.daily_log_strip(t.src,  u, up) || excluded.src;

    out_status := 'ok'; return next;
  end loop;
end;
$$;
revoke all on function public.daily_log_apply_core(uuid, text, jsonb, boolean) from public, anon, authenticated, service_role;

-- ── 2e. Client entry point: own rows, source 'manual'. ──────────────────────
create or replace function public.daily_log_apply(p_ops jsonb)
returns table (out_kind text, out_day date, out_status text)
language sql security definer set search_path = ''
as $$
  select * from public.daily_log_apply_core((select auth.uid()), 'manual', p_ops, true);
$$;
revoke all on function public.daily_log_apply(jsonb) from public, anon;
grant execute on function public.daily_log_apply(jsonb) to authenticated;

-- ── 2f. Server entry point: crons, health-sync, whoop-/oura-sync. ───────────
create or replace function public.daily_log_apply_service(p_user uuid, p_source text, p_ops jsonb)
returns table (out_kind text, out_day date, out_status text)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_source not in ('whoop', 'oura', 'apple') then raise exception 'bad source'; end if;
  return query select * from public.daily_log_apply_core(p_user, p_source, p_ops, false);
end;
$$;
revoke all on function public.daily_log_apply_service(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.daily_log_apply_service(uuid, text, jsonb) to service_role;

-- kcal of one burn entry, the way recompute.js reads it (Number(a.kcal) || 0).
create or replace function public.daily_log_kcal(p_entry jsonb)
returns numeric
language sql immutable set search_path = ''
as $$
  select case
           when jsonb_typeof(p_entry -> 'kcal') = 'number' then (p_entry ->> 'kcal')::numeric
           when jsonb_typeof(p_entry -> 'kcal') = 'string' and (p_entry ->> 'kcal') ~ '^-?\d+(\.\d+)?$'
             then (p_entry ->> 'kcal')::numeric
           else 0
         end;
$$;
revoke all on function public.daily_log_kcal(jsonb) from public, anon, authenticated;

-- ── 2g. Ranking inputs (phase L5, recompute.js). Service role only. ─────────
-- One small row per day instead of moving the logs. Mirrors
-- netlify/lib/recompute.js vitalsPoints (a day counts if weight, sleep or rhr
-- is non-null) and burnPoints (sum of numeric kcal). Parity-tested by
-- scripts/check-ratings-parity.mjs before ratings_from_table is switched on.
-- core_vital_srcs / burn_kcal_server carry PER-KEY provenance, so the later
-- anti-forgery rule (plan §3.6 — an owner decision) can tell a weight the
-- server attested from one the client typed, on the same day row.
create or replace function public.daily_log_rating_days(p_user uuid)
returns table (out_kind text, out_day date, has_core_vital boolean, core_vital_srcs text[],
               burn_kcal numeric, burn_kcal_server numeric, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select t.kind,
         t.day,
         case when t.kind = 'vitals' then
           coalesce(jsonb_typeof(t.data -> 'weight'), 'null') <> 'null'
           or coalesce(jsonb_typeof(t.data -> 'sleep'), 'null') <> 'null'
           or coalesce(jsonb_typeof(t.data -> 'rhr'), 'null') <> 'null'
         end,
         case when t.kind = 'vitals' then
           (select array_agg(distinct coalesce(t.src ->> k, 'unknown'))
              from unnest(array['weight', 'sleep', 'rhr']) k
             where coalesce(jsonb_typeof(t.data -> k), 'null') <> 'null')
         end,
         case when t.kind = 'burn' then
           (select coalesce(sum(public.daily_log_kcal(e.value)), 0) from jsonb_each(t.data) e)
         end,
         case when t.kind = 'burn' then
           (select coalesce(sum(public.daily_log_kcal(e.value)), 0) from jsonb_each(t.data) e
             where t.src ->> e.key in ('whoop', 'oura'))
         end,
         t.created_at
    from public.daily_log t
   where t.user_id = p_user and t.kind in ('vitals', 'burn');
$$;
revoke all on function public.daily_log_rating_days(uuid) from public, anon, authenticated;
grant execute on function public.daily_log_rating_days(uuid) to service_role;

commit;


-- ============================================================================
-- 3. PHASE L4 — backfill and verify
-- ============================================================================

begin;

-- Bookkeeping for the nightly reconciler (re-run the backfill only for users
-- whose state moved since their last run). Server only.
create table if not exists public.daily_log_backfill_runs (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  last_run_at      timestamptz not null default now(),
  state_updated_at timestamptz,
  result           jsonb not null default '{}'::jsonb
);
alter table public.daily_log_backfill_runs enable row level security;   -- no policies
revoke all on public.daily_log_backfill_runs from anon, authenticated;

-- ── 3a. Backfill ONE user. Idempotent, resumable, never removes anything. ───
-- · Locks the user_data row, so it serialises with client CAS saves and
--   stateWrite.js; the snapshot it copies is consistent.
-- · STATE WINS key by key; keys only the table has are kept. This is correct
--   ONLY because every dual-writer writes state FIRST and the table only after
--   the state write succeeded (plan §4, L2/L3 write-order rule) — so the table
--   is never newer than state, and a lasting difference means an old build
--   wrote state alone or a table write failed.
-- · Values are NOT validated: everything that exists is copied. Day keys that
--   are not real ISO dates cannot become rows; they are COUNTED and left in
--   state untouched (verify reports them; cleanup archives them).
-- · Reads state inside Postgres — no state crosses the wire.
create or replace function public.daily_log_backfill_user(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  st        jsonb;
  su        timestamptz;
  n_plain   integer := 0;
  n_burn    integer := 0;
  n_invalid integer := 0;
  res       jsonb;
begin
  if p_user is null then raise exception 'bad arguments'; end if;
  select u.state, u.updated_at into st, su from public.user_data u where u.id = p_user for update;
  if st is null then return jsonb_build_object('status', 'missing'); end if;

  -- Day keys we cannot store (reported, never dropped).
  select count(*) into n_invalid
    from (values ('vitalsLog'), ('burnLog'), ('bodyLog'), ('moodLog')) m(skey),
         lateral jsonb_each(case when jsonb_typeof(st -> m.skey) = 'object' then st -> m.skey else '{}'::jsonb end) e
   where not public.vb_is_date(e.key);

  -- vitals / body / mood: the day object as is.
  with good as (
    select m.kind, e.key::date as day, e.value as v
      from (values ('vitals', 'vitalsLog'), ('body', 'bodyLog'), ('mood', 'moodLog')) m(kind, skey),
           lateral jsonb_each(case when jsonb_typeof(st -> m.skey) = 'object' then st -> m.skey else '{}'::jsonb end) e
     where public.vb_is_date(e.key) and jsonb_typeof(e.value) = 'object' and e.value <> '{}'::jsonb
  ), ins as (
    insert into public.daily_log as t (user_id, kind, day, data, src)
    select p_user, g.kind, g.day, g.v,
           (select coalesce(jsonb_object_agg(x.key, '"backfill"'::jsonb), '{}'::jsonb) from jsonb_each(g.v) x)
      from good g
    on conflict (user_id, kind, day) do update
      set data = t.data || excluded.data,
          src  = t.src || (select coalesce(jsonb_object_agg(x.key, '"backfill"'::jsonb), '{}'::jsonb)
                             from jsonb_each(excluded.data) x
                            where (t.data -> x.key) is distinct from x.value)
    returning 1
  ) select count(*) into n_plain from ins;

  -- burn: array → keyed object.
  with good as (
    select e.key::date as day, public.daily_log_burn_obj(e.value) as obj
      from jsonb_each(case when jsonb_typeof(st -> 'burnLog') = 'object' then st -> 'burnLog' else '{}'::jsonb end) e
     where public.vb_is_date(e.key) and jsonb_typeof(e.value) = 'array' and jsonb_array_length(e.value) > 0
  ), ins as (
    insert into public.daily_log as t (user_id, kind, day, data, src)
    select p_user, 'burn', g.day, g.obj,
           (select coalesce(jsonb_object_agg(x.key, '"backfill"'::jsonb), '{}'::jsonb) from jsonb_each(g.obj) x)
      from good g
     where g.obj <> '{}'::jsonb
    on conflict (user_id, kind, day) do update
      set data = t.data || excluded.data,
          src  = t.src || (select coalesce(jsonb_object_agg(x.key, '"backfill"'::jsonb), '{}'::jsonb)
                             from jsonb_each(excluded.data) x
                            where (t.data -> x.key) is distinct from x.value)
    returning 1
  ) select count(*) into n_burn from ins;

  res := jsonb_build_object(
    'status', 'ok',
    'rows_written_plain', n_plain,     -- rows inserted or actually changed
    'rows_written_burn',  n_burn,
    'invalid_day_keys',   n_invalid,
    'state_updated_at',   su);

  insert into public.daily_log_backfill_runs as r (user_id, last_run_at, state_updated_at, result)
  values (p_user, now(), su, res)
  on conflict (user_id) do update
    set last_run_at = now(), state_updated_at = excluded.state_updated_at, result = excluded.result;

  return res;
end;
$$;
revoke all on function public.daily_log_backfill_user(uuid) from public, anon, authenticated;
grant execute on function public.daily_log_backfill_user(uuid) to service_role;

-- ── 3b. Verify ONE user: is every value in state present, equal, in the table? ──
-- days_missing   — a valid state day with data but no row
-- values_differ  — a row exists but some state key/entry is absent or different
-- invalid_keys   — state day keys that cannot be rows (not real ISO dates)
-- extra_in_table — INFORMATIONAL: days where the table holds keys/entries the
--                  state does not (a removal that has not reached the table,
--                  or a value only a server wrote). Not a gate; after L5 such
--                  values show in the app, so watch that it stays small.
-- The gate to phase L5 is 0 / 0 for every user for 14 consecutive days.
create or replace function public.daily_log_verify_user(p_user uuid)
returns table (out_kind text, state_days integer, rows_present integer,
               days_missing integer, values_differ integer, invalid_keys integer,
               extra_in_table integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  st jsonb;
begin
  select u.state into st from public.user_data u where u.id = p_user;
  if st is null then return; end if;

  return query
  with m(kind, skey) as (values ('vitals', 'vitalsLog'), ('body', 'bodyLog'), ('mood', 'moodLog'), ('burn', 'burnLog')),
  sd as (
    select m.kind, e.key, e.value
      from m, lateral jsonb_each(case when jsonb_typeof(st -> m.skey) = 'object' then st -> m.skey else '{}'::jsonb end) e
  ),
  valid as (
    select sd.kind, sd.key::date as day,
           case when sd.kind = 'burn' then public.daily_log_burn_obj(sd.value) else sd.value end as v
      from sd
     where public.vb_is_date(sd.key)
       and ((sd.kind = 'burn' and jsonb_typeof(sd.value) = 'array' and jsonb_array_length(sd.value) > 0)
         or (sd.kind <> 'burn' and jsonb_typeof(sd.value) = 'object' and sd.value <> '{}'::jsonb))
  ),
  cmp as (
    select v.kind, v.day, t.data,
           case
             when t.data is null then null
             when v.kind = 'burn' then not exists (
               select 1 from jsonb_each(v.v) e
                where (t.data -> e.key) is null
                   or ((t.data -> e.key) - 'ord') <> (e.value - 'ord'))
             else t.data @> v.v
           end as ok,
           case
             when t.data is null then false
             else exists (select 1 from jsonb_object_keys(t.data) tk where not (v.v ? tk))
           end as extra
      from valid v
      left join public.daily_log t
        on t.user_id = p_user and t.kind = v.kind and t.day = v.day
  )
  select m.kind,
         (select count(*)::int from cmp where cmp.kind = m.kind),
         (select count(*)::int from cmp where cmp.kind = m.kind and cmp.data is not null),
         (select count(*)::int from cmp where cmp.kind = m.kind and cmp.data is null),
         (select count(*)::int from cmp where cmp.kind = m.kind and cmp.ok = false),
         (select count(*)::int from sd where sd.kind = m.kind and not public.vb_is_date(sd.key)),
         (select count(*)::int from cmp where cmp.kind = m.kind and cmp.extra)
    from m;
end;
$$;
revoke all on function public.daily_log_verify_user(uuid) from public, anon, authenticated;
grant execute on function public.daily_log_verify_user(uuid) to service_role;

commit;

-- ── 3c. Owner-run batches (SQL editor runs as the service role). ────────────
-- Back up first (plan §7). Run in batches; each call is one short transaction.
--
-- First pass, 50 users at a time, oldest-touched first:
-- select u.id, public.daily_log_backfill_user(u.id)
--   from public.user_data u
--   left join public.daily_log_backfill_runs r on r.user_id = u.id
--  where r.user_id is null
--  order by u.updated_at
--  limit 50;
--
-- Reconciler (nightly during L4–L6): users whose state moved since last run.
-- select u.id, public.daily_log_backfill_user(u.id)
--   from public.user_data u
--   join public.daily_log_backfill_runs r on r.user_id = u.id
--  where u.updated_at > coalesce(r.state_updated_at, '-infinity')
--  limit 200;
--
-- Gate report — must be empty before L5:
-- select u.id, v.*
--   from public.user_data u, lateral public.daily_log_verify_user(u.id) v
--  where v.days_missing > 0 or v.values_differ > 0;
--
-- Invalid keys to review (counts only):
-- select u.id, v.out_kind, v.invalid_keys
--   from public.user_data u, lateral public.daily_log_verify_user(u.id) v
--  where v.invalid_keys > 0;


-- ============================================================================
-- 4. PHASE L7 — cleanup. COMMENTED OUT. DO NOT CREATE UNTIL THE OWNER
--    APPROVES L7 (plan §4: old builds gone, min_build raised, L5 stable).
-- ============================================================================
/*
begin;

-- Whole copies of every state key cleanup or absorb removes. Server only.
create table if not exists public.state_archive (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  reason      text not null check (reason in ('cleanup', 'absorb')),
  archived_at timestamptz not null default now()
);
create index if not exists state_archive_user_idx on public.state_archive (user_id, archived_at desc);
alter table public.state_archive enable row level security;   -- no policies
revoke all on public.state_archive from anon, authenticated;

-- Cleanup ONE user, in one transaction:
--   lock → verify (refuse on any missing/differing value; on invalid keys
--   unless p_allow_invalid) → archive each log key whole → remove the keys
--   and write the logsInTables marker → bump updated_at.
-- The marker is a non-empty object not on MEANINGFUL_IGNORE, so the anti-wipe
-- guard (JS + audit vb_state_meaningful) keeps treating the row as real data.
-- Bumping updated_at makes every open client conflict and merge: an
-- untouched copy accepts the removal; an edited copy is kept and absorbed.
create or replace function public.daily_log_cleanup_user(p_user uuid, p_allow_invalid boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  st    jsonb;
  bad   integer;
  inv   integer;
  keys  text[] := array['vitalsLog', 'burnLog', 'bodyLog', 'moodLog'];
  k     text;
  days  jsonb := '{}'::jsonb;
begin
  if p_user is null then raise exception 'bad arguments'; end if;
  select u.state into st from public.user_data u where u.id = p_user for update;
  if st is null then return jsonb_build_object('status', 'missing'); end if;
  if st ? 'logsInTables' and not (st ?| keys) then return jsonb_build_object('status', 'already'); end if;

  select coalesce(sum(days_missing + values_differ), 0), coalesce(sum(invalid_keys), 0)
    into bad, inv
    from public.daily_log_verify_user(p_user);
  if bad > 0 then return jsonb_build_object('status', 'refused', 'mismatches', bad); end if;
  if inv > 0 and not p_allow_invalid then return jsonb_build_object('status', 'refused', 'invalid_keys', inv); end if;

  foreach k in array keys loop
    if st ? k then
      insert into public.state_archive (user_id, key, value, reason) values (p_user, k, st -> k, 'cleanup');
      days := days || jsonb_build_object(k, case when jsonb_typeof(st -> k) = 'object'
                                                 then (select count(*) from jsonb_object_keys(st -> k)) else 0 end);
    end if;
  end loop;

  update public.user_data
     set state = (state - keys) || jsonb_build_object('logsInTables',
                   jsonb_build_object('v', 1, 'at', now(), 'days', days)),
         updated_at = now()
   where id = p_user;

  return jsonb_build_object('status', 'cleaned', 'days', days);
end;
$$;
revoke all on function public.daily_log_cleanup_user(uuid, boolean) from public, anon, authenticated;
grant execute on function public.daily_log_cleanup_user(uuid, boolean) to service_role;

-- Absorb a log key that REAPPEARED after cleanup (an old build, or a restored
-- local backup). Set-if-absent: the table wins on any key it already holds;
-- new days/keys/entries are kept. Archive first, then remove from state.
create or replace function public.daily_log_absorb_user(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  st   jsonb;
  keys text[] := array['vitalsLog', 'burnLog', 'bodyLog', 'moodLog'];
  k    text;
  n    integer := 0;
begin
  if p_user is null then raise exception 'bad arguments'; end if;
  select u.state into st from public.user_data u where u.id = p_user for update;
  if st is null or not (st ? 'logsInTables') then return jsonb_build_object('status', 'not-cleaned'); end if;
  if not (st ?| keys) then return jsonb_build_object('status', 'nothing'); end if;

  foreach k in array keys loop
    if st ? k then
      insert into public.state_archive (user_id, key, value, reason) values (p_user, k, st -> k, 'absorb');
    end if;
  end loop;

  with good as (
    select m.kind, e.key::date as day,
           case when m.kind = 'burn' then public.daily_log_burn_obj(e.value) else e.value end as v
      from (values ('vitals', 'vitalsLog'), ('body', 'bodyLog'), ('mood', 'moodLog'), ('burn', 'burnLog')) m(kind, skey),
           lateral jsonb_each(case when jsonb_typeof(st -> m.skey) = 'object' then st -> m.skey else '{}'::jsonb end) e
     where public.vb_is_date(e.key)
  ), ins as (
    insert into public.daily_log as t (user_id, kind, day, data, src)
    select p_user, g.kind, g.day, g.v,
           (select coalesce(jsonb_object_agg(x.key, '"absorb"'::jsonb), '{}'::jsonb) from jsonb_each(g.v) x)
      from good g
     where jsonb_typeof(g.v) = 'object' and g.v <> '{}'::jsonb
    on conflict (user_id, kind, day) do update
      set data = excluded.data || t.data,          -- table wins
          src  = excluded.src  || t.src
    returning 1
  ) select count(*) into n from ins;

  update public.user_data set state = state - keys, updated_at = now() where id = p_user;
  return jsonb_build_object('status', 'absorbed', 'rows', n);
end;
$$;
revoke all on function public.daily_log_absorb_user(uuid) from public, anon, authenticated;
grant execute on function public.daily_log_absorb_user(uuid) to service_role;

commit;

-- Owner-run, after a backup, 25 users at a time:
-- select u.id, public.daily_log_cleanup_user(u.id)
--   from public.user_data u
--  where not (u.state ? 'logsInTables')
--  order by u.updated_at
--  limit 25;
--
-- Undo for one user/key (put the archived copy back; the table rows remain):
-- update public.user_data u
--    set state = jsonb_set(u.state, array[a.key], a.value, true), updated_at = now()
--   from (select key, value from public.state_archive
--          where user_id = '<uuid>' and key = 'vitalsLog' order by archived_at desc limit 1) a
--  where u.id = '<uuid>';
*/


-- ============================================================================
-- 5. Verification queries (read-only). Run after each section.
-- ============================================================================
--
-- Expect false for every row (clients must not write these tables directly):
-- select t, has_table_privilege('authenticated', t, 'insert') as ins,
--           has_table_privilege('authenticated', t, 'update') as upd,
--           has_table_privilege('authenticated', t, 'delete') as del,
--           has_table_privilege('anon', t, 'select')          as anon_sel
--   from unnest(array['public.daily_log', 'public.daily_log_history', 'public.media_ledger',
--                     'public.client_builds', 'public.app_config', 'public.app_config_users',
--                     'public.daily_log_backfill_runs']) t;
--
-- Expect: authenticated can execute ONLY daily_log_apply and note_client_build:
-- select p.proname,
--        has_function_privilege('authenticated', p.oid, 'execute') as authed,
--        has_function_privilege('anon', p.oid, 'execute')          as anon
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and (p.proname like 'daily_log%' or p.proname like 'media_%' or p.proname in ('note_client_build', 'vb_is_date'))
--  order by 1;
--
-- RLS on, and the policies present:
-- select relname, relrowsecurity from pg_class
--  where relname in ('daily_log', 'daily_log_history', 'media_ledger', 'client_builds',
--                    'app_config', 'app_config_users', 'daily_log_backfill_runs');
-- select tablename, policyname, cmd, roles from pg_policies
--  where tablename in ('daily_log', 'daily_log_history', 'app_config', 'app_config_users')
--     or (schemaname = 'storage' and policyname like 'media %');
--
-- Every new user-scoped FK cascades (item 20):
-- select conrelid::regclass, confdeltype from pg_constraint
--  where confrelid = 'auth.users'::regclass
--    and conrelid::regclass::text in ('daily_log', 'daily_log_history', 'media_ledger', 'client_builds',
--                                     'app_config_users', 'daily_log_backfill_runs', 'state_archive');
--  -- confdeltype must be 'c' on every row.
--
-- The cleanup marker counts as real data (expect true):
-- select public.vb_state_meaningful('{"logsInTables":{"v":1,"days":{"vitalsLog":3}}}'::jsonb);
--
-- Per-user image progress (counts only):
-- select status, count(*), sum(bytes) from public.media_ledger group by status;
--
-- State size before/after, per phase (aggregate):
-- select round(avg(octet_length(state::text))) as avg_bytes,
--        max(octet_length(state::text))        as max_bytes
--   from public.user_data;
--
-- Then: Supabase → Advisors (security + performance) must be clean.
