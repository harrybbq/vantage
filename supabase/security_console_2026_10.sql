-- ============================================================================
-- Security console — October 2026 (owner-only Upgrade → Security)
-- ============================================================================
-- Run AFTER audit_schema_2026_10.sql, in the Supabase SQL editor.
-- One transaction: if any statement fails, nothing changes. Re-runnable.
--
-- Additive only: three NEW tables and two NEW functions. No existing
-- table, column, row or policy is touched.
--
--   security_tickets       the owner's ticket queue: auto-raised by
--                          netlify/functions/security-sweep.js, raised by
--                          users from Settings → Report a problem
--                          (support-ticket.js), or by the owner by hand.
--   web_vitals             anonymous real-user page performance
--                          (vitals-beacon.js) — path + five numbers, no
--                          user id, no IP, no user agent.
--   owner_db_stats()       database health for the console, one call.
--   security_ticket_raise  raise / bump / re-open a ticket by fingerprint.
--   security_accepted_findings  advisor findings the owner has accepted.
--
-- All tables: RLS on with NO policies, and no grants to anon or
-- authenticated — only the service role (the Netlify functions) can read
-- or write them. Both functions are EXECUTE for service_role only.
--
-- Every consumer in the code fails soft until this is run.
-- ============================================================================
begin;

-- ── Tickets ─────────────────────────────────────────────────────────────
create table if not exists public.security_tickets (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  source        text not null check (source in ('auto', 'user', 'owner')),
  kind          text not null,
  severity      text not null check (severity in ('critical', 'high', 'medium', 'low')),
  title         text not null check (char_length(title) between 1 and 200),
  detail        jsonb not null default '{}'::jsonb,
  status        text not null default 'open' check (status in ('open', 'ack', 'resolved')),
  -- The condition's identity for auto tickets (see netlify/lib/sweepRules.js).
  -- NULL for user and owner tickets; a unique column allows many NULLs.
  fingerprint   text unique,
  count         integer not null default 1,
  last_seen_at  timestamptz default now(),
  note          text,
  reporter_id   uuid references auth.users(id) on delete set null,
  resolved_at   timestamptz,
  resolved_by   uuid
);
create index if not exists security_tickets_status_seen_idx
  on public.security_tickets (status, last_seen_at desc);
-- support-ticket.js counts one account's tickets since midnight (5/day).
create index if not exists security_tickets_reporter_created_idx
  on public.security_tickets (reporter_id, created_at desc) where reporter_id is not null;

alter table public.security_tickets enable row level security;   -- no policies: service role only
revoke all on public.security_tickets from anon, authenticated;
grant select, insert, update, delete on public.security_tickets to service_role;

-- ── Real-user web vitals ────────────────────────────────────────────────
create table if not exists public.web_vitals (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  path         text check (path is null or char_length(path) <= 200),
  lcp          real,
  inp          real,
  cls          real,
  ttfb         real,
  fcp          real,
  nav_type     text,
  device       text
);
create index if not exists web_vitals_occurred_at_idx on public.web_vitals (occurred_at desc);

alter table public.web_vitals enable row level security;   -- no policies: service role only
revoke all on public.web_vitals from anon, authenticated;
grant select, insert, delete on public.web_vitals to service_role;
-- Retention: 1 in 5 page loads, one small row each. Trim by hand, or schedule:
--   delete from public.web_vitals where occurred_at < now() - interval '90 days';

-- ── Accepted advisor findings ───────────────────────────────────────────
-- A Supabase advisor finding the owner has looked at and accepted (e.g.
-- RLS enabled with no policies, on purpose). Keyed by the advisor's own
-- stable `cache_key`. Accepted findings stop counting on the Overview
-- and the sweep stops raising tickets for them. Un-accept = delete row.
create table if not exists public.security_accepted_findings (
  cache_key    text primary key check (char_length(cache_key) between 1 and 300),
  accepted_at  timestamptz not null default now(),
  accepted_by  uuid,
  note         text
);
alter table public.security_accepted_findings enable row level security;   -- no policies: service role only
revoke all on public.security_accepted_findings from anon, authenticated;
grant select, insert, update, delete on public.security_accepted_findings to service_role;

-- ── owner_db_stats() ────────────────────────────────────────────────────
-- One jsonb for the console's Database panel. Catalog/statistics reads
-- only — no user table is scanned (row counts are the planner's
-- estimates, reltuples). SECURITY DEFINER so it can see every backend in
-- pg_stat_activity; search_path '' so nothing can be shadowed.
create or replace function public.owner_db_stats()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'db_size_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'max_connections', pg_catalog.current_setting('max_connections')::integer,
    'connections', (
      select jsonb_build_object(
        'total',  count(*),
        'active', count(*) filter (where a.state = 'active'),
        'idle',   count(*) filter (where a.state like 'idle%'))
      from pg_catalog.pg_stat_activity a
      where a.backend_type = 'client backend'),
    'cache_hit_pct', (
      select round(100.0 * sum(d.blks_hit) / nullif(sum(d.blks_hit) + sum(d.blks_read), 0), 2)
      from pg_catalog.pg_stat_database d
      where d.datname = pg_catalog.current_database()),
    'started_at', pg_catalog.pg_postmaster_start_time(),
    'uptime_sec', floor(extract(epoch from (pg_catalog.now() - pg_catalog.pg_postmaster_start_time())))::bigint,
    'dead_tuple_ratio', (
      select round(sum(s.n_dead_tup)::numeric / nullif(sum(s.n_live_tup) + sum(s.n_dead_tup), 0), 4)
      from pg_catalog.pg_stat_user_tables s),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'rows', t.est_rows, 'bytes', t.bytes) order by t.bytes desc)
      from (
        select n.nspname || '.' || c.relname as name,
               greatest(c.reltuples, 0)::bigint as est_rows,
               pg_catalog.pg_total_relation_size(c.oid) as bytes
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p')
          and n.nspname in ('public', 'auth', 'storage')
        order by pg_catalog.pg_total_relation_size(c.oid) desc
        limit 10
      ) t), '[]'::jsonb)
  );
$$;
revoke all on function public.owner_db_stats() from public, anon, authenticated;
grant execute on function public.owner_db_stats() to service_role;

-- ── security_ticket_raise() ─────────────────────────────────────────────
-- Atomic upsert by fingerprint. New condition → new open ticket. Same
-- condition again → count + 1, last_seen_at now, detail/title/severity
-- refreshed, status kept (open stays open, ack stays ack). Resolved →
-- re-opened. The owner's note is never overwritten.
create or replace function public.security_ticket_raise(
  p_fingerprint text, p_kind text, p_severity text, p_title text, p_detail jsonb)
returns jsonb
language sql volatile security definer set search_path = ''
as $$
  insert into public.security_tickets as t
    (source, kind, severity, title, detail, fingerprint, last_seen_at)
  values
    ('auto', left(p_kind, 60), p_severity, left(p_title, 200), coalesce(p_detail, '{}'::jsonb),
     left(p_fingerprint, 200), pg_catalog.now())
  on conflict (fingerprint) do update set
    count        = t.count + 1,
    last_seen_at = pg_catalog.now(),
    updated_at   = pg_catalog.now(),
    detail       = excluded.detail,
    title        = excluded.title,
    severity     = excluded.severity,
    status       = case when t.status = 'resolved' then 'open' else t.status end,
    resolved_at  = case when t.status = 'resolved' then null else t.resolved_at end,
    resolved_by  = case when t.status = 'resolved' then null else t.resolved_by end
  returning jsonb_build_object('id', t.id, 'status', t.status, 'count', t.count);
$$;
revoke all on function public.security_ticket_raise(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.security_ticket_raise(text, text, text, text, jsonb) to service_role;

commit;

-- ── After running, these should all return true ─────────────────────────
-- select to_regclass('public.security_tickets') is not null, to_regclass('public.web_vitals') is not null;
-- select (public.owner_db_stats() ? 'db_size_bytes');
-- select not has_table_privilege('authenticated', 'public.security_tickets', 'select');
-- select not has_function_privilege('authenticated', 'public.owner_db_stats()', 'execute');
