-- ════════════════════════════════════════════════════════════════════
-- recovery_2026_10b.sql — restore markers + one-user recovery
-- STARTUP_REQUIREMENTS items 27 (PITR) and 82 (practise recovery).
-- Procedure: docs/RESTORE_RUNBOOK.md and scripts/recovery/README.md.
-- ════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES
--   1. public.ops_log — an append-only log of operations ("restore
--      markers"). Every owner-run SQL file, migration phase and bulk job
--      writes a mark, so the right point-in-time to restore to can be
--      read off a table instead of guessed during an incident.
--        · RLS on, NO client policies. anon/authenticated get nothing.
--        · service_role may SELECT and INSERT only; UPDATE / DELETE /
--          TRUNCATE are revoked AND refused by a trigger (even for the
--          table owner, unless someone drops the trigger on purpose).
--   2. public.ops_mark(kind, label, details) → timestamptz — writes one
--      mark and returns its time. SQL editor (postgres) and service_role
--      only (netlify/lib/opsMark.js calls it over PostgREST).
--   3. One-user recovery, so a backup or PITR copy can bring back ONE
--      person's rows without rolling everyone else back:
--        · public.export_user_bundle(p_user uuid, p_source_note text)
--            run in a RESTORED COPY (Supabase "Restore to a new project"
--            from a daily backup or a PITR point). Returns every
--            user-scoped row for that user as JSON + a manifest.
--        · public.import_user_bundle(p_bundle jsonb, p_mode text,
--            p_tables text[], p_allow_email_mismatch boolean)
--            run in PRODUCTION. 'dry_run' (default) reports what would
--            happen and keeps nothing; 'restore_missing' INSERTS rows
--            that are missing by primary key and nothing else — it never
--            updates or deletes a row, and it NEVER overwrites
--            user_data.state: the bundle's state is added as a new
--            user_data_history snapshot (reason 'bundle-restore') for the
--            runbook's guarded restore step to bring back deliberately.
--        · public.recovery_bundles — RLS on, no policies, SQL editor
--            only. restore_missing keeps the bundle and its report here
--            (cascades with the account; delete within 30 days).
--      All recovery functions are SECURITY DEFINER with search_path '',
--      revoked from public/anon/authenticated/service_role: SQL editor
--      only.
--
-- EXISTING ROWS: none are touched by running this file. Only CALLING
--   import_user_bundle(..., 'restore_missing') writes, and then only
--   inserts (missing rows, one user_data_history snapshot, one
--   recovery_bundles row, one ops_log mark).
--
-- PREREQUISITES: none to run it. The state step of import_user_bundle
--   uses public.user_data_history (supabase/user_data_history_schema.sql,
--   already live) and reports instead of failing if it is missing.
--   For export_user_bundle to exist in a restored copy, the copy must be
--   from AFTER this file was run — otherwise run this file in the copy
--   first (it is additive and safe there).
--
-- RE-RUNNABLE: create … if not exists / create or replace / drop trigger
--   if exists. One transaction.
--
-- VERIFY after running:
--   select * from public.ops_log order by at desc limit 5;
--     -- expect 'recovery_2026_10b.sql — done' (and '— start' on re-runs)
--   select public.ops_mark('note', 'verify ops_mark');   -- returns a time
--   select has_table_privilege('authenticated', 'public.ops_log', 'select'),
--          has_function_privilege('authenticated', 'public.ops_mark(text,text,jsonb)', 'execute'),
--          has_function_privilege('authenticated', 'public.import_user_bundle(jsonb,text,text[],boolean)', 'execute');
--     -- expect false, false, false
--   select tbl, policy from public.recovery_user_tables() order by rank, tbl;
--     -- every user-scoped table, with what restore_missing does with it
--   Then Supabase → Advisors (security + performance).
-- ════════════════════════════════════════════════════════════════════

begin;

-- Convention (docs/RESTORE_RUNBOOK.md "Restore markers"): every owner-run
-- SQL file starts and ends with a mark. Fail soft, so a file still runs
-- on a database where this one hasn't been applied yet.
do $$ begin
  perform public.ops_mark('sql', 'recovery_2026_10b.sql — start');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

-- ── 1. ops_log ──────────────────────────────────────────────────────
-- Not user-scoped: no user_id column, so no auth.users FK. Recovery marks
-- carry a one-way `user_ref` (recovery_user_ref below), never a raw id or
-- email, so the log holds nothing that outlives an account deletion.
-- `at` is clock_timestamp(), not now(): the start and done marks of a
-- one-transaction file must not share the transaction's start time.
create table if not exists public.ops_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default clock_timestamp(),
  kind    text not null check (char_length(kind) between 1 and 40),
  label   text not null check (char_length(label) between 1 and 300),
  actor   text not null default session_user,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);
create index if not exists ops_log_at_idx on public.ops_log (at desc);

alter table public.ops_log enable row level security;
-- No policies on purpose: with RLS on and no policy, clients see nothing.
revoke all on public.ops_log from public, anon, authenticated;
revoke update, delete, truncate, references, trigger on public.ops_log from service_role;
grant select, insert on public.ops_log to service_role;

create or replace function public.ops_log_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ops_log is append-only: marks are never changed or removed'
    using errcode = '42501';
end;
$$;
revoke all on function public.ops_log_append_only() from public, anon, authenticated;

drop trigger if exists ops_log_no_change on public.ops_log;
create trigger ops_log_no_change before update or delete on public.ops_log
  for each row execute function public.ops_log_append_only();
drop trigger if exists ops_log_no_truncate on public.ops_log;
create trigger ops_log_no_truncate before truncate on public.ops_log
  for each statement execute function public.ops_log_append_only();

-- ── 2. ops_mark ─────────────────────────────────────────────────────
-- details.actor (optional) names the caller, e.g. 'netlify:retention';
-- otherwise the session user ('postgres' in the SQL editor).
create or replace function public.ops_mark(kind text, label text, details jsonb default '{}'::jsonb)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_details jsonb := case when jsonb_typeof(ops_mark.details) = 'object'
                          then ops_mark.details else '{}'::jsonb end;
  v_at timestamptz;
begin
  insert into public.ops_log (kind, label, actor, details)
  values (
    left(coalesce(nullif(btrim(ops_mark.kind), ''), 'note'), 40),
    left(coalesce(nullif(btrim(ops_mark.label), ''), '(no label)'), 300),
    left(coalesce(nullif(btrim(v_details ->> 'actor'), ''), session_user::text), 80),
    v_details - 'actor'
  )
  returning public.ops_log.at into v_at;
  return v_at;
end;
$$;
revoke all on function public.ops_mark(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ops_mark(text, text, jsonb) to service_role;

-- ── 3. Recovery helpers ─────────────────────────────────────────────

-- One-way reference for logs: lets the operator confirm "this mark is
-- that user" given the id, without the log holding the id itself.
create or replace function public.recovery_user_ref(p_user uuid)
returns text language sql immutable set search_path = '' as $$
  select left(md5('vantage-recovery:' || p_user::text), 12);
$$;

-- What restore_missing does with each table. Keep in step with the table
-- list in docs/RESTORE_RUNBOOK.md.
--   restore  inserted by default when missing (the user's own rows only)
--   review   exported; inserted ONLY when named in p_tables — rows that
--            involve another person (DMs, friendships, blocks, groups) or
--            server-owned state, where re-inserting could undo someone's
--            deliberate action. Unknown (new) tables default here.
--   never    exported for the record (secrets stripped), never imported:
--            credentials that have rotated, queues that would re-fire,
--            counters.
--   skip     not exported (diagnostics / ops tables / handled separately).
create or replace function public.recovery_table_policy(p_table text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_table in ('nutrition_log', 'nutrition_macros', 'nutrition_macro_targets',
                     'nutrition_daily_summary', 'body_weight_log', 'body_measurements',
                     'training_sessions', 'training_sets', 'rota_config', 'tracker_streaks',
                     'rating_snapshots', 'coach_nudges', 'daily_log', 'state_archive')
      then 'restore'
    when p_table in ('whoop_tokens', 'oura_tokens', 'bank_connections', 'push_tokens',
                     'notifications_queue', 'ai_usage', 'client_builds', 'app_config_users',
                     'daily_log_backfill_runs', 'restore_holding')
      then 'never'
    when p_table in ('user_data', 'ops_log', 'recovery_bundles', 'client_errors',
                     'security_tickets', 'security_accepted_findings', 'web_vitals')
      then 'skip'
    else 'review'
  end;
$$;

-- Insert order: parents before children (FKs inside the user's own data).
create or replace function public.recovery_table_rank(p_table text)
returns int language sql immutable set search_path = '' as $$
  select case
    when p_table = 'profiles' then 0
    when p_table in ('nutrition_macros', 'training_sessions', 'groups', 'messages',
                     'food_contributions') then 1
    else 2
  end;
$$;

-- Every user-scoped table in `public`, found from the catalog rather than
-- a hand list, so a table added later is picked up automatically (as
-- 'review' until classified above). User-scoped = has a single-column FK
-- to auth.users(id) or public.profiles(id); user_cols = those columns.
create or replace function public.recovery_user_tables()
returns table (tbl text, user_cols text[], policy text, rank int)
language sql stable security definer set search_path = '' as $$
  select c.relname::text,
         array_agg(distinct a.attname::text order by a.attname::text),
         public.recovery_table_policy(c.relname::text),
         public.recovery_table_rank(c.relname::text)
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c      on c.oid = k.conrelid
    join pg_catalog.pg_namespace n  on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_catalog.pg_attribute a  on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
   where k.contype = 'f'
     and pg_catalog.array_length(k.conkey, 1) = 1
     and k.confrelid in (pg_catalog.to_regclass('auth.users'), pg_catalog.to_regclass('public.profiles'))
     and c.relkind in ('r', 'p')
     and not c.relispartition
     and c.relname <> 'user_data'
   group by c.relname;
$$;

create or replace function public.recovery_pk_cols(p_rel regclass)
returns text[] language sql stable set search_path = '' as $$
  select array_agg(a.attname::text order by array_position(i.indkey::int2[], a.attnum))
    from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = p_rel and i.indisprimary;
$$;

-- Columns a row can be inserted with (no dropped or generated columns).
create or replace function public.recovery_insert_cols(p_rel regclass)
returns text[] language sql stable set search_path = '' as $$
  select array_agg(a.attname::text order by a.attnum)
    from pg_catalog.pg_attribute a
   where a.attrelid = p_rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
$$;

create or replace function public.recovery_jsonb_pick(p_obj jsonb, p_keys text[])
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(coalesce(p_obj, '{}'::jsonb)) e
   where e.key = any(p_keys);
$$;

-- Secrets never travel in a bundle (it gets copied between projects and
-- through a clipboard): OAuth tokens, push tokens, provider session ids.
-- Applied to the rows of 'never' tables, which hold them.
create or replace function public.recovery_redact(p_row jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select p_row - array['access_token', 'refresh_token', 'id_token', 'token', 'session_id', 'secret'];
$$;

revoke all on function public.recovery_user_ref(uuid)                 from public, anon, authenticated;
revoke all on function public.recovery_table_policy(text)              from public, anon, authenticated;
revoke all on function public.recovery_table_rank(text)                from public, anon, authenticated;
revoke all on function public.recovery_user_tables()                   from public, anon, authenticated, service_role;
revoke all on function public.recovery_pk_cols(regclass)               from public, anon, authenticated;
revoke all on function public.recovery_insert_cols(regclass)           from public, anon, authenticated;
revoke all on function public.recovery_jsonb_pick(jsonb, text[])       from public, anon, authenticated;
revoke all on function public.recovery_redact(jsonb)                   from public, anon, authenticated;

-- ── 4. recovery_bundles ─────────────────────────────────────────────
-- What restore_missing restored, and from what: the whole bundle, its
-- report, and the history snapshot it added. Personal data — delete the
-- row once the user has confirmed, and within 30 days (runbook).
create table if not exists public.recovery_bundles (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  imported_at         timestamptz not null default now(),
  source_exported_at  timestamptz,
  source_note         text,
  history_snapshot_id bigint,
  bundle              jsonb not null,
  report              jsonb not null default '{}'::jsonb
);
create index if not exists recovery_bundles_user_idx on public.recovery_bundles (user_id);
alter table public.recovery_bundles enable row level security;
revoke all on public.recovery_bundles from public, anon, authenticated, service_role;

-- ── 5. export_user_bundle — run in the RESTORED COPY ────────────────
create or replace function public.export_user_bundle(p_user uuid, p_source_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ident   jsonb;
  v_ud      jsonb := null;
  v_tables  jsonb := '{}'::jsonb;
  v_counts  jsonb := '{}'::jsonb;
  v_pols    jsonb := '{}'::jsonb;
  v_hints   jsonb := '{}'::jsonb;
  v_rows    jsonb;
  v_where   text;
  v_total   int := 0;
  v_x       timestamptz;
  r         record;
begin
  if p_user is null then
    raise exception 'export_user_bundle: p_user is required';
  end if;

  -- Identity for matching only: id, email, created_at. Never the password
  -- hash, tokens or metadata.
  select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at)
    into v_ident from auth.users u where u.id = p_user;
  if v_ident is null then
    raise exception 'export_user_bundle: no auth.users row with that id in THIS database';
  end if;

  if pg_catalog.to_regclass('public.user_data') is not null then
    execute 'select to_jsonb(u) from public.user_data u where u.id = $1' into v_ud using p_user;
  end if;

  for r in select t.* from public.recovery_user_tables() t
            where t.policy <> 'skip' order by t.rank, t.tbl loop
    select string_agg(format('t.%I = $1', c), ' or ') into v_where from unnest(r.user_cols) c;
    -- 'never' tables (tokens, queues) are listed for the record with
    -- their secret columns stripped; everything else is exported whole
    -- (a generic strip would also hit ordinary columns like session_id).
    execute format('select coalesce(jsonb_agg(%s), ''[]''::jsonb) from public.%I t where %s',
                   case when r.policy = 'never' then 'public.recovery_redact(to_jsonb(t))' else 'to_jsonb(t)' end,
                   r.tbl, v_where)
      into v_rows using p_user;
    v_tables := v_tables || jsonb_build_object(r.tbl, jsonb_build_object(
                  'match_cols', to_jsonb(r.user_cols), 'policy', r.policy, 'rows', v_rows));
    v_counts := v_counts || jsonb_build_object(r.tbl, jsonb_array_length(v_rows));
    v_pols   := v_pols   || jsonb_build_object(r.tbl, r.policy);
    v_total  := v_total + jsonb_array_length(v_rows);
  end loop;

  -- Where in time this copy sits: the newest ops mark and the newest save.
  if pg_catalog.to_regclass('public.ops_log') is not null then
    select max(o.at) into v_x from public.ops_log o;
    v_hints := v_hints || jsonb_build_object('latest_ops_mark', v_x);
  end if;
  if pg_catalog.to_regclass('public.user_data') is not null then
    execute 'select max(u.updated_at) from public.user_data u' into v_x;
    v_hints := v_hints || jsonb_build_object('latest_user_data_save', v_x);
  end if;

  begin
    perform public.ops_mark('recovery', 'export_user_bundle',
      jsonb_build_object('user_ref', public.recovery_user_ref(p_user), 'rows', v_total,
                         'source_note', left(coalesce(p_source_note, ''), 200)));
  exception when others then null;   -- a mark must never block an export
  end;

  return jsonb_build_object(
    'format', 'vantage-user-bundle',
    'version', 1,
    'manifest', jsonb_build_object(
      'schema_version', 1,
      'exported_at', clock_timestamp(),
      'source_note', p_source_note,
      'source_db', current_database(),
      'server_version', current_setting('server_version'),
      'copy_hints', v_hints,
      'tables', v_counts,
      'policies', v_pols,
      'rows_total', v_total,
      'user_data_present', v_ud is not null,
      'state_bytes', case when v_ud is null then null else pg_column_size(v_ud -> 'state') end,
      'redacted_keys_in_never_tables', to_jsonb(array['access_token', 'refresh_token', 'id_token', 'token', 'session_id', 'secret'])
    ),
    'identity', v_ident,
    'user_data', v_ud,
    'tables', v_tables
  );
end;
$$;
revoke all on function public.export_user_bundle(uuid, text) from public, anon, authenticated, service_role;

-- ── 6. import_user_bundle — run in PRODUCTION ───────────────────────
create or replace function public.import_user_bundle(
  p_bundle jsonb,
  p_mode text default 'dry_run',
  p_tables text[] default null,
  p_allow_email_mismatch boolean default false
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_mode      text := lower(btrim(coalesce(p_mode, 'dry_run')));
  v_refusal   text := null;
  v_uid       uuid;
  v_email_b   text;
  v_email_p   text;
  v_selected  text[];
  v_report    jsonb := '{}'::jsonb;
  v_tabrep    jsonb := '{}'::jsonb;
  v_udrep     jsonb := '{}'::jsonb;
  v_totals    jsonb;
  v_snap_id   bigint := null;
  v_bundle_id bigint := null;
  v_tot_ins   int := 0;
  v_tot_conf  int := 0;
  v_tot_fail  int := 0;
  v_tot_ok    int := 0;
  -- per table
  t           record;
  v_rel       regclass;
  v_pk        text[];
  v_cols      text[];
  v_has_ident boolean;
  v_rows      jsonb;
  v_row       jsonb;
  v_keys      text[];
  v_ignored   text[];
  v_prod      jsonb;
  v_norm      jsonb;
  v_n         int;
  v_pass      int;
  v_retry     jsonb;
  v_next      jsonb;
  c_ins int; c_same int; c_conf int; c_uniq int; c_fail int; c_notsel int; c_notme int;
  v_conf_sample jsonb; v_fail_sample jsonb; v_fail_states jsonb;
  -- user_data
  v_bud       jsonb;
  v_pud       jsonb;
  v_state_b   jsonb;
  v_has_vbm   boolean := pg_catalog.to_regprocedure('public.vb_state_meaningful(jsonb)') is not null;
  v_mb        boolean;
  v_mp        boolean;
  v_err_state text;
  v_err_msg   text;
  v_pfx       text;   -- 'dry_run (rolled back): ' in a dry run
begin
  -- ── Refusals: report and mark, write nothing else ──
  if v_mode not in ('dry_run', 'restore_missing') then
    v_refusal := 'p_mode must be ''dry_run'' or ''restore_missing''';
  elsif p_bundle is null or jsonb_typeof(p_bundle) <> 'object'
        or p_bundle ->> 'format' is distinct from 'vantage-user-bundle' then
    v_refusal := 'not a Vantage user bundle (format)';
  elsif p_bundle ->> 'version' is distinct from '1' then
    v_refusal := 'unsupported bundle version ' || coalesce(p_bundle ->> 'version', 'null');
  else
    begin
      v_uid := (p_bundle -> 'identity' ->> 'id')::uuid;
    exception when others then v_uid := null;
    end;
    if v_uid is null then
      v_refusal := 'bundle has no valid identity.id';
    else
      select u.email into v_email_p from auth.users u where u.id = v_uid;
      if not found then
        v_refusal := 'that user id does not exist in this database''s auth.users — refusing (an account created again gets a NEW id; match it by hand)';
      else
        v_email_b := p_bundle -> 'identity' ->> 'email';
        if lower(btrim(v_email_b)) is distinct from lower(btrim(v_email_p)) and not coalesce(p_allow_email_mismatch, false) then
          v_refusal := 'email in the bundle differs from production for this id — confirm identity another way, then pass p_allow_email_mismatch => true';
        end if;
      end if;
    end if;
  end if;

  if v_refusal is not null then
    begin
      perform public.ops_mark('recovery', 'import_user_bundle refused',
        jsonb_build_object('mode', v_mode, 'reason', v_refusal,
                           'user_ref', case when v_uid is null then null else public.recovery_user_ref(v_uid) end));
    exception when others then null;
    end;
    return jsonb_build_object('ok', false, 'mode', v_mode, 'refused', v_refusal);
  end if;

  v_pfx := case when v_mode = 'dry_run' then 'dry_run (rolled back): ' else '' end;

  -- Which tables are written: the 'restore' set, or exactly what was named.
  if p_tables is null then
    select coalesce(array_agg(x.tbl), '{}') into v_selected
      from public.recovery_user_tables() x where x.policy = 'restore';
  else
    select coalesce(array_agg(lower(btrim(s))), '{}') into v_selected from unnest(p_tables) s;
  end if;

  -- ── Everything below runs inside one block. In dry_run it ends by
  --    raising VBDRY, which rolls every insert back while the report
  --    (plain variables) survives. So dry_run reports exactly what
  --    restore_missing would do — FKs, unique keys, triggers — and keeps
  --    nothing.
  begin
    for t in select x.* from public.recovery_user_tables() x
              where p_bundle -> 'tables' ? x.tbl
              order by x.rank, x.tbl loop
      v_rows := coalesce(p_bundle -> 'tables' -> t.tbl -> 'rows', '[]'::jsonb);
      if jsonb_typeof(v_rows) <> 'array' then v_rows := '[]'::jsonb; end if;

      if t.policy in ('never', 'skip') then
        v_tabrep := v_tabrep || jsonb_build_object(t.tbl, jsonb_build_object(
          'policy', t.policy, 'rows_in_bundle', jsonb_array_length(v_rows),
          'status', 'never imported (credentials/queues/counters — see runbook)'));
        continue;
      end if;

      v_rel  := format('public.%I', t.tbl)::regclass;
      v_pk   := public.recovery_pk_cols(v_rel);
      v_cols := public.recovery_insert_cols(v_rel);
      select exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = v_rel and a.attidentity = 'a' and not a.attisdropped)
        into v_has_ident;

      if v_pk is null then
        v_tabrep := v_tabrep || jsonb_build_object(t.tbl, jsonb_build_object(
          'policy', t.policy, 'rows_in_bundle', jsonb_array_length(v_rows),
          'status', 'skipped: table has no primary key, so "missing" cannot be decided'));
        continue;
      end if;

      c_ins := 0; c_same := 0; c_conf := 0; c_uniq := 0; c_fail := 0; c_notsel := 0; c_notme := 0;
      v_conf_sample := '[]'::jsonb; v_fail_sample := '[]'::jsonb; v_fail_states := '{}'::jsonb;
      v_ignored := '{}';
      v_retry := '[]'::jsonb;

      -- Pass 1 classifies every row and inserts the missing ones; rows
      -- whose insert failed get one retry in pass 2 (a reply before the
      -- message it quotes, a child before its parent in the same table).
      for v_pass in 1..2 loop
        v_next := '[]'::jsonb;
        for v_row in select e from jsonb_array_elements(case when v_pass = 1 then v_rows else v_retry end) e loop
          if v_pass = 1 then
            if jsonb_typeof(v_row) <> 'object' then c_notme := c_notme + 1; continue; end if;
            -- The row must belong to THIS user by production's own FK
            -- columns — a hand-edited bundle can't smuggle in someone else.
            if not exists (select 1 from unnest(t.user_cols) uc where v_row ->> uc = v_uid::text) then
              c_notme := c_notme + 1; continue;
            end if;
            select v_ignored || coalesce(array_agg(k), '{}') into v_ignored
              from jsonb_object_keys(v_row) k where not (k = any(v_cols)) and not (k = any(v_ignored));

            execute format('select to_jsonb(p) from %s p where (%s) = (select %s from pg_catalog.jsonb_populate_record(null::%s, $1) b)',
                           v_rel,
                           (select string_agg(format('p.%I', k), ', ') from unnest(v_pk) k),
                           (select string_agg(format('b.%I', k), ', ') from unnest(v_pk) k),
                           v_rel)
              into v_prod using v_row;

            if v_prod is not null then
              select coalesce(array_agg(k), '{}') into v_keys from jsonb_object_keys(v_row) k where k = any(v_cols);
              execute format('select to_jsonb(b) from pg_catalog.jsonb_populate_record(null::%s, $1) b', v_rel)
                into v_norm using v_row;
              if public.recovery_jsonb_pick(v_norm, v_keys) = public.recovery_jsonb_pick(v_prod, v_keys) then
                c_same := c_same + 1;
              else
                c_conf := c_conf + 1;   -- production differs: production is kept, always
                if jsonb_array_length(v_conf_sample) < 5 then
                  v_conf_sample := v_conf_sample || jsonb_build_array(public.recovery_jsonb_pick(v_row, v_pk));
                end if;
              end if;
              continue;
            end if;

            if not (t.tbl = any(v_selected)) then
              c_notsel := c_notsel + 1; continue;
            end if;
          end if;

          select coalesce(array_agg(k), '{}') into v_keys from jsonb_object_keys(v_row) k where k = any(v_cols);
          begin
            execute format('insert into %s (%s) %s select %s from pg_catalog.jsonb_populate_record(null::%s, $1) b on conflict do nothing',
                           v_rel,
                           (select string_agg(format('%I', k), ', ') from unnest(v_keys) k),
                           case when v_has_ident then 'overriding system value' else '' end,
                           (select string_agg(format('b.%I', k), ', ') from unnest(v_keys) k),
                           v_rel)
              using v_row;
            get diagnostics v_n = row_count;
            if v_n = 1 then c_ins := c_ins + 1; else c_uniq := c_uniq + 1; end if;
          exception when others then
            get stacked diagnostics v_err_state = returned_sqlstate, v_err_msg = message_text;
            if v_pass = 1 then
              v_next := v_next || jsonb_build_array(v_row);
            else
              c_fail := c_fail + 1;
              v_fail_states := v_fail_states || jsonb_build_object(v_err_state,
                                 coalesce((v_fail_states ->> v_err_state)::int, 0) + 1);
              if jsonb_array_length(v_fail_sample) < 5 then
                v_fail_sample := v_fail_sample || jsonb_build_array(jsonb_build_object(
                  'pk', public.recovery_jsonb_pick(v_row, v_pk), 'sqlstate', v_err_state,
                  'message', left(v_err_msg, 200)));
              end if;
            end if;
          end;
        end loop;
        v_retry := v_next;
        exit when jsonb_array_length(v_retry) = 0;
      end loop;

      v_tabrep := v_tabrep || jsonb_build_object(t.tbl, jsonb_build_object(
        'policy', t.policy,
        'selected', t.tbl = any(v_selected),
        'rows_in_bundle', jsonb_array_length(v_rows),
        'insert', c_ins,
        'already_present', c_same,
        'conflict_production_kept', c_conf,
        'skipped_other_unique', c_uniq,
        'failed', c_fail,
        'not_selected', c_notsel,
        'not_this_user', c_notme,
        'conflict_sample_pk', v_conf_sample,
        'failed_by_sqlstate', v_fail_states,
        'failed_sample', v_fail_sample,
        'ignored_columns', to_jsonb(v_ignored)));
      v_tot_ins  := v_tot_ins + c_ins;
      v_tot_conf := v_tot_conf + c_conf;
      v_tot_fail := v_tot_fail + c_fail;
      v_tot_ok   := v_tot_ok + c_same;
    end loop;

    -- Tables in the bundle that production doesn't have (or that aren't
    -- user-scoped here): reported, never created.
    select v_tabrep || coalesce(jsonb_object_agg(k, jsonb_build_object(
             'status', 'not a user-scoped table in this database — nothing done',
             'rows_in_bundle', jsonb_array_length(coalesce(p_bundle -> 'tables' -> k -> 'rows', '[]'::jsonb)))), '{}'::jsonb)
      into v_tabrep
      from jsonb_object_keys(coalesce(p_bundle -> 'tables', '{}'::jsonb)) k
     where not exists (select 1 from public.recovery_user_tables() x where x.tbl = k);

    -- ── user_data: NEVER overwritten. The bundle's state becomes a new
    --    user_data_history snapshot; the runbook's guarded UPDATE brings
    --    it back deliberately, with the user's devices closed.
    v_bud := p_bundle -> 'user_data';
    if v_bud is null or jsonb_typeof(v_bud) <> 'object' or jsonb_typeof(v_bud -> 'state') is distinct from 'object' then
      v_udrep := jsonb_build_object('status', 'no user_data state in the bundle');
    elsif pg_catalog.to_regclass('public.user_data') is null then
      v_udrep := jsonb_build_object('status', 'public.user_data does not exist here — nothing done');
    else
      v_state_b := v_bud -> 'state';
      execute 'select to_jsonb(u) from public.user_data u where u.id = $1' into v_pud using v_uid;
      if v_has_vbm then
        -- vb_state_meaningful calls vb_arrlen/vb_objlen unqualified, so it
        -- needs `public` on the path. Only for this call (the setting is
        -- local to this sub-block and undone with it); informational, so
        -- any failure just leaves the flags null.
        begin
          perform pg_catalog.set_config('search_path', 'public', true);
          execute 'select public.vb_state_meaningful($1), public.vb_state_meaningful($2)'
            into v_mb, v_mp using v_state_b, v_pud -> 'state';
          perform pg_catalog.set_config('search_path', '', true);
        exception when others then
          v_mb := null; v_mp := null;
        end;
      end if;
      v_udrep := jsonb_build_object(
        'bundle_state_bytes', pg_column_size(v_state_b),
        'production_state_bytes', case when v_pud is null then null else pg_column_size(v_pud -> 'state') end,
        'bundle_updated_at', v_bud -> 'updated_at',
        'production_updated_at', v_pud -> 'updated_at',
        'bundle_meaningful', v_mb,
        'production_meaningful', v_mp,
        'bundle_has_backgrounds', v_state_b ? 'backgrounds',
        'production_has_backgrounds', coalesce((v_pud -> 'state') ? 'backgrounds', false));

      if v_pud is null then
        -- No row at all: inserting one overwrites nothing.
        v_keys := array(select k from unnest(array['id', 'state', 'photo', 'updated_at']) k
                         where k = any(public.recovery_insert_cols('public.user_data'::regclass)));
        begin
          execute format('insert into public.user_data (%s) select %s from pg_catalog.jsonb_populate_record(null::public.user_data, $1) b on conflict do nothing',
                         (select string_agg(format('%I', k), ', ') from unnest(v_keys) k),
                         (select string_agg(format('b.%I', k), ', ') from unnest(v_keys) k))
            using jsonb_build_object('id', v_uid, 'state', v_state_b, 'photo', v_bud -> 'photo', 'updated_at', clock_timestamp());
          get diagnostics v_n = row_count;
          v_udrep := v_udrep || jsonb_build_object('status', v_pfx ||
                       case when v_n = 1 then 'production had no user_data row — inserted from the bundle'
                            else 'a user_data row appeared meanwhile — left as it is' end);
        exception when others then
          get stacked diagnostics v_err_state = returned_sqlstate, v_err_msg = message_text;
          v_udrep := v_udrep || jsonb_build_object('status', 'insert failed', 'sqlstate', v_err_state, 'message', left(v_err_msg, 200));
        end;
      elsif v_pud -> 'state' = v_state_b then
        v_udrep := v_udrep || jsonb_build_object('status', 'production state is identical — nothing to do');
      elsif pg_catalog.to_regclass('public.user_data_history') is null then
        v_udrep := v_udrep || jsonb_build_object('status',
                     'state differs but public.user_data_history is missing — the bundle is kept in recovery_bundles only');
      elsif exists (select 1 from public.user_data_history h
                     where h.user_id = v_uid and h.state = v_state_b) then
        -- Re-running the import must not stack identical snapshots.
        select max(h.id) into v_snap_id from public.user_data_history h
         where h.user_id = v_uid and h.state = v_state_b;
        v_udrep := v_udrep || jsonb_build_object('status',
                     'state differs — an identical user_data_history snapshot already exists (production state untouched)',
                     'history_snapshot_id', v_snap_id);
      else
        insert into public.user_data_history (user_id, state, reason)
        values (v_uid, v_state_b, 'bundle-restore')
        returning id into v_snap_id;
        v_udrep := v_udrep || jsonb_build_object('status', v_pfx ||
                     'state differs — added as user_data_history snapshot (production state untouched)',
                     'history_snapshot_id', case when v_mode = 'restore_missing' then v_snap_id end);
      end if;

      -- The photo column is never written here either; the runbook has
      -- the guarded one-liner for an empty photo.
      v_udrep := v_udrep || jsonb_build_object('photo', case
        when v_pud is null then 'n/a'
        when v_bud -> 'photo' is null or v_bud -> 'photo' = 'null'::jsonb then 'none in bundle'
        when v_pud -> 'photo' is null or v_pud -> 'photo' = 'null'::jsonb then 'production has none — restorable (runbook: photo step)'
        when v_pud -> 'photo' = v_bud -> 'photo' then 'same'
        else 'differs — production kept' end);
    end if;

    v_totals := jsonb_build_object('insert', v_tot_ins, 'already_present', v_tot_ok,
                                   'conflict_production_kept', v_tot_conf, 'failed', v_tot_fail);
    v_report := jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'note', case when v_mode = 'dry_run'
                   then 'dry_run: nothing was kept. Counts are what restore_missing would do (every insert was tried and rolled back).'
                   else 'restore_missing: missing rows inserted; no existing row was updated or deleted; production user_data.state untouched.' end,
      'user_ref', public.recovery_user_ref(v_uid),
      'bundle_exported_at', p_bundle -> 'manifest' -> 'exported_at',
      'bundle_source_note', p_bundle -> 'manifest' -> 'source_note',
      'email_matched', lower(btrim(v_email_b)) is not distinct from lower(btrim(v_email_p)),
      'selected_tables', to_jsonb(v_selected),
      'totals', v_totals,
      'user_data', v_udrep,
      'tables', v_tabrep);

    if v_mode = 'restore_missing' then
      insert into public.recovery_bundles (user_id, source_exported_at, source_note, history_snapshot_id, bundle, report)
      values (v_uid,
              case when p_bundle -> 'manifest' ->> 'exported_at' ~ '^\d{4}-' then (p_bundle -> 'manifest' ->> 'exported_at')::timestamptz end,
              left(p_bundle -> 'manifest' ->> 'source_note', 300),
              v_snap_id, p_bundle, v_report)
      returning id into v_bundle_id;
      v_report := v_report || jsonb_build_object('recovery_bundle_id', v_bundle_id);
    else
      raise exception using errcode = 'VBDRY', message = 'dry run — rolled back';
    end if;
  exception when sqlstate 'VBDRY' then
    null;   -- dry_run: all inserts above are undone; v_report is kept
  end;

  perform public.ops_mark('recovery', 'import_user_bundle ' || v_mode,
    jsonb_build_object('user_ref', public.recovery_user_ref(v_uid),
                       'totals', v_totals,
                       'bundle_exported_at', p_bundle -> 'manifest' -> 'exported_at',
                       'history_snapshot_id', case when v_mode = 'restore_missing' then v_snap_id end,
                       'recovery_bundle_id', v_bundle_id));
  return v_report;
end;
$$;
revoke all on function public.import_user_bundle(jsonb, text, text[], boolean) from public, anon, authenticated, service_role;

do $$ begin
  perform public.ops_mark('sql', 'recovery_2026_10b.sql — done');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

commit;
