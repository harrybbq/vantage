-- ============================================================================
-- Retention + shared cache + ingest caps — launch batch D, 2026-10-20
-- (STARTUP_REQUIREMENTS items 91, 95, 96; DPIA G11 / G13)
-- ============================================================================
-- Run in the Supabase SQL editor. One transaction: if any statement fails,
-- nothing changes. Re-runnable (if not exists / create or replace / guards).
--
-- WHAT IT DOES
--   1. public.function_cache — one row per shared answer (the global
--      leaderboard first, item 91). Service role only. get-leaderboard
--      reads/writes it; until this runs it falls back to per-instance cache.
--   2. public.ingest_caps + a trigger on client_errors and web_vitals —
--      a durable, cross-instance hourly cap on the two open write endpoints
--      (item 95): past 1,000 client errors or 3,000 vitals rows in an hour,
--      further inserts are refused until the hour turns.
--   3. public.retention_prune(target, limit, dry_run) — deletes ONE small
--      batch (≤ limit, max 2,000) of old operational rows, oldest first, for
--      one named target, and returns how many. The weekly Netlify function
--      netlify/functions/retention-prune.js calls it in a loop (item 96).
--      Windows (hard-coded here; netlify/lib/retention.js mirrors them and
--      a build check fails if they differ):
--        client_errors        older than 30 days
--        web_vitals           older than 90 days
--        rating_snapshots     older than 90 days (readers need ≤ 21: the
--                             weekly climb looks back ≤ 20 days, leagues
--                             read from Monday)
--        notifications_queue  sent more than 30 days ago, or dead (5 failed
--                             attempts, never sent) and created > 30 days ago
--        coach_nudges         detected more than 60 days ago
--        reports              CLOSED (actioned/dismissed) more than 12 months
--                             ago, and not retention_hold. Open reports are
--                             never pruned. The evidence (reported_snapshot,
--                             context) is on the row and goes with it — the
--                             docs/ABUSE_HANDLING.md 12-month rule.
--        function_cache       built more than 1 day ago
--        ingest_caps          hour bucket more than 2 days old
--   4. reports.retention_hold (boolean, default false) — set it to true on
--      any report referred to the police / IWF, and retention leaves it
--      alone for as long as they ask (ABUSE_HANDLING.md). Owner sets it in
--      the SQL editor:  update public.reports set retention_hold = true
--                       where id = '<report id>';
--   5. Indexes so every prune batch is an index range scan, not a table scan.
--
-- NEVER USER CONTENT. This file deletes NOTHING when run, and the function
-- can only ever touch the eight operational tables named above. It does not
-- reference, and can never delete from, user_data, user_data_history,
-- nutrition_log, messages, friendships, profiles, push_tokens, blocks,
-- groups or any other table holding what a user made — any other target
-- name raises an exception. (Asserted in netlify/lib/efficiency.test.mjs.)
--
-- EXISTING ROWS: none updated or deleted by running this file. Deleting old
-- operational rows is the point of item 96, but that only happens when the
-- weekly function calls retention_prune — after you've run this and looked
-- at the dry-run counts below if you want to.
--
-- PREREQUISITES (run earlier; any missing table is skipped, not an error):
--   leaderboard_schema.sql        (rating_snapshots)
--   notifications_schema.sql      (notifications_queue)
--   coach_nudges_schema.sql       (coach_nudges)
--   social_schema.sql             (reports)
--   audit_schema_2026_10.sql      (client_errors, reports.status/actioned_at)
--   security_console_2026_10.sql  (web_vitals)
-- A target whose table is missing just fails that batch (logged by the
-- function as "failed (400)"); every other target still runs.
--
-- VERIFY AFTER RUNNING
--   -- objects exist
--   select to_regclass('public.function_cache'), to_regclass('public.ingest_caps'),
--          to_regprocedure('public.retention_prune(text,integer,boolean)');
--   -- dry run: rows the FIRST batch would take, per target (deletes nothing)
--   select t, public.retention_prune(t, 2000, true) as would_delete
--   from unnest(array['client_errors','web_vitals','rating_snapshots',
--     'notifications_queue','coach_nudges','reports','function_cache',
--     'ingest_caps']) t;
--   -- refuses anything else (expect: ERROR ... is not a retention target)
--   select public.retention_prune('user_data', 1, true);
--   -- not callable by app users (expect: false, false)
--   select has_function_privilege('anon', 'public.retention_prune(text,integer,boolean)', 'execute'),
--          has_function_privilege('authenticated', 'public.retention_prune(text,integer,boolean)', 'execute');
--   Then run Supabase → Advisors (Security + Performance), per item 81.
-- ============================================================================
begin;

-- ── 1. Shared cache (item 91) ───────────────────────────────────────────
-- Not user-scoped: the key is a fixed string ('leaderboard:global:weekly:v1')
-- and the payload is the public top-100 board (opted-in users only). A
-- deleted user's row there lives until the next rebuild (≤ 5 min while the
-- board is viewed) or the next prune (> 1 day old).
create table if not exists public.function_cache (
  key       text primary key check (char_length(key) between 1 and 200),
  payload   jsonb not null,
  built_at  timestamptz not null default now()
);
alter table public.function_cache enable row level security;  -- no policies: service role only
revoke all on public.function_cache from anon, authenticated;
grant select, insert, update, delete on public.function_cache to service_role;
create index if not exists function_cache_built_at_idx on public.function_cache (built_at);

-- ── 2. Durable ingest caps for the open write endpoints (item 95) ───────
create table if not exists public.ingest_caps (
  bucket  text not null,
  hour    timestamptz not null,
  n       integer not null default 0,
  primary key (bucket, hour)
);
alter table public.ingest_caps enable row level security;     -- no policies: service role only
revoke all on public.ingest_caps from anon, authenticated;
grant select, insert, update, delete on public.ingest_caps to service_role;
create index if not exists ingest_caps_hour_idx on public.ingest_caps (hour);

-- BEFORE INSERT, per row: bump this table's counter for the current hour;
-- refuse past the cap given as the trigger argument. A refusal rolls the
-- bump back too, so the counter sits at the cap until the hour turns.
-- PostgREST answers the refusal with 400, which both functions treat as
-- "back off for ten minutes".
create or replace function public.ingest_cap_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  cap integer := coalesce(nullif(tg_argv[0], '')::integer, 1000);
  cnt integer;
begin
  insert into public.ingest_caps as c (bucket, hour, n)
  values (tg_table_name, date_trunc('hour', now()), 1)
  on conflict (bucket, hour) do update set n = c.n + 1
  returning c.n into cnt;
  if cnt > cap then
    raise exception 'ingest cap reached for % this hour', tg_table_name using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.ingest_cap_check() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.client_errors') is not null then
    drop trigger if exists client_errors_ingest_cap on public.client_errors;
    create trigger client_errors_ingest_cap before insert on public.client_errors
      for each row execute function public.ingest_cap_check('1000');
  end if;
  if to_regclass('public.web_vitals') is not null then
    drop trigger if exists web_vitals_ingest_cap on public.web_vitals;
    create trigger web_vitals_ingest_cap before insert on public.web_vitals
      for each row execute function public.ingest_cap_check('3000');
  end if;
end $$;

-- ── 4. Legal hold on reports ────────────────────────────────────────────
-- Additive column with a constant default: no rewrite, existing rows read
-- false. Not in the authenticated INSERT column grant (audit_schema), so a
-- client can never set it; only the owner, in the SQL editor.
do $$
begin
  if to_regclass('public.reports') is not null then
    alter table public.reports add column if not exists retention_hold boolean not null default false;
  end if;
end $$;

-- ── 5. Indexes for the prune batches ────────────────────────────────────
-- client_errors (occurred_at desc) and web_vitals (occurred_at desc) already
-- have one (audit_schema_2026_10 / security_console_2026_10).
do $$
begin
  if to_regclass('public.rating_snapshots') is not null then
    create index if not exists rating_snapshots_snapshotted_at_idx
      on public.rating_snapshots (snapshotted_at);
  end if;
  if to_regclass('public.notifications_queue') is not null then
    create index if not exists notifications_queue_sent_at_idx
      on public.notifications_queue (sent_at) where sent_at is not null;
    create index if not exists notifications_queue_dead_idx
      on public.notifications_queue (created_at) where sent_at is null and attempt_count >= 5;
  end if;
  if to_regclass('public.coach_nudges') is not null then
    create index if not exists coach_nudges_detected_at_idx
      on public.coach_nudges (detected_at);
  end if;
  if to_regclass('public.reports') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'reports' and column_name = 'status') then
    create index if not exists reports_closed_idx
      on public.reports ((coalesce(actioned_at, created_at)))
      where status in ('actioned', 'dismissed');
  end if;
end $$;

-- ── 3. The prune function (item 96) ─────────────────────────────────────
-- One batch, one named target. Windows are fixed here, not parameters: the
-- caller can make a batch smaller, never a window shorter. PL/pgSQL plans
-- each branch only when it runs, so a target whose table is missing fails
-- alone (the function reports it) without breaking the others.
create or replace function public.retention_prune(
  p_target  text,
  p_limit   integer default 500,
  p_dry_run boolean default false
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  lim integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  n   integer := 0;
  m   integer := 0;
begin
  if p_target = 'client_errors' then
    if p_dry_run then
      select count(*) into n from (select 1 from public.client_errors
        where occurred_at < now() - interval '30 days' limit lim) s;
    else
      delete from public.client_errors where id in (
        select id from public.client_errors
        where occurred_at < now() - interval '30 days'
        order by occurred_at limit lim);
      get diagnostics n = row_count;
    end if;

  elsif p_target = 'web_vitals' then
    if p_dry_run then
      select count(*) into n from (select 1 from public.web_vitals
        where occurred_at < now() - interval '90 days' limit lim) s;
    else
      delete from public.web_vitals where id in (
        select id from public.web_vitals
        where occurred_at < now() - interval '90 days'
        order by occurred_at limit lim);
      get diagnostics n = row_count;
    end if;

  elsif p_target = 'rating_snapshots' then
    if p_dry_run then
      select count(*) into n from (select 1 from public.rating_snapshots
        where snapshotted_at < now() - interval '90 days' limit lim) s;
    else
      delete from public.rating_snapshots where id in (
        select id from public.rating_snapshots
        where snapshotted_at < now() - interval '90 days'
        order by snapshotted_at limit lim);
      get diagnostics n = row_count;
    end if;

  elsif p_target = 'notifications_queue' then
    -- Sent rows first, then dead ones (never sent, 5 failed attempts).
    if p_dry_run then
      select count(*) into n from (select 1 from public.notifications_queue
        where sent_at is not null and sent_at < now() - interval '30 days' limit lim) s;
      select count(*) into m from (select 1 from public.notifications_queue
        where sent_at is null and attempt_count >= 5 and created_at < now() - interval '30 days'
        limit greatest(lim - n, 0)) s;
    else
      delete from public.notifications_queue where id in (
        select id from public.notifications_queue
        where sent_at is not null and sent_at < now() - interval '30 days'
        order by sent_at limit lim);
      get diagnostics n = row_count;
      if n < lim then
        delete from public.notifications_queue where id in (
          select id from public.notifications_queue
          where sent_at is null and attempt_count >= 5 and created_at < now() - interval '30 days'
          order by created_at limit lim - n);
        get diagnostics m = row_count;
      end if;
    end if;
    n := n + m;

  elsif p_target = 'coach_nudges' then
    if p_dry_run then
      select count(*) into n from (select 1 from public.coach_nudges
        where detected_at < now() - interval '60 days' limit lim) s;
    else
      delete from public.coach_nudges where id in (
        select id from public.coach_nudges
        where detected_at < now() - interval '60 days'
        order by detected_at limit lim);
      get diagnostics n = row_count;
    end if;

  elsif p_target = 'reports' then
    -- CLOSED reports only, 12 months after closing; never open, never held.
    if p_dry_run then
      select count(*) into n from (select 1 from public.reports
        where status in ('actioned', 'dismissed')
          and coalesce(actioned_at, created_at) < now() - interval '12 months'
          and not retention_hold
        limit lim) s;
    else
      delete from public.reports where id in (
        select id from public.reports
        where status in ('actioned', 'dismissed')
          and coalesce(actioned_at, created_at) < now() - interval '12 months'
          and not retention_hold
        order by coalesce(actioned_at, created_at) limit lim);
      get diagnostics n = row_count;
    end if;

  elsif p_target = 'function_cache' then
    if p_dry_run then
      select count(*) into n from (select 1 from public.function_cache
        where built_at < now() - interval '1 day' limit lim) s;
    else
      delete from public.function_cache where key in (
        select key from public.function_cache
        where built_at < now() - interval '1 day'
        order by built_at limit lim);
      get diagnostics n = row_count;
    end if;

  elsif p_target = 'ingest_caps' then
    if p_dry_run then
      select count(*) into n from (select 1 from public.ingest_caps
        where hour < now() - interval '2 days' limit lim) s;
    else
      delete from public.ingest_caps where (bucket, hour) in (
        select bucket, hour from public.ingest_caps
        where hour < now() - interval '2 days'
        order by hour limit lim);
      get diagnostics n = row_count;
    end if;

  else
    raise exception 'retention_prune: % is not a retention target', p_target
      using errcode = '22023';
  end if;

  return n;
end;
$$;
revoke all on function public.retention_prune(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.retention_prune(text, integer, boolean) to service_role;

commit;
