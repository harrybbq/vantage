-- ════════════════════════════════════════════════════════════════════
-- web_access_2026_10b.sql — the web gate switch (STARTUP_REQUIREMENTS 131)
-- Owner decision 2026-10-20: at public launch Vantage is used through the
-- iPhone/Android apps. In a web browser the full app is for an owner-kept
-- allow-list only (the owner + personal friends); everyone else signed in
-- on the web sees "Vantage is on iPhone and Android". The switch ships
-- OPEN — running this file changes nothing for anyone until the owner
-- flips it (Settings → Tools → Web access, or web_access_set_mode below).
-- ════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES
--   1. public.config gains the key 'web_access' = 'open' (inserted only if
--      missing — an existing value is never overwritten). Values:
--        'open'      — today: the web app is for everyone.
--        'allowlist' — the web app is for the owner + the list below.
--      config already has a public read policy (paywall_schema.sql), so
--      the client reads the mode with a plain select. Missing row or a
--      failed read → the client treats it as 'open'.
--   2. public.web_access_allowlist(email citext pk, note, added_at,
--      added_by) — RLS on, NO client policies, every privilege revoked
--      from anon/authenticated. Read and written only through the owner
--      RPCs below. added_by references auth.users ON DELETE SET NULL
--      (not cascade: the rows are the owner's list of other people, and
--      deleting one account must not delete anyone else's entry).
--   3. public.web_access_allowed() → boolean, for the caller:
--        true  when the mode is not 'allowlist';
--        true  when the caller is the app owner (is_app_owner());
--        true  when the caller's CONFIRMED auth email is on the list;
--        false otherwise (and for a caller with no session).
--   4. Owner management RPCs — each checks is_app_owner() and raises
--      42501 otherwise; granted to authenticated (the check inside does
--      the gating), revoked from public/anon:
--        web_access_list()               → (email, note, added_at)
--        web_access_add(email, note)     → the row
--        web_access_remove(email)        → boolean (was it there)
--        web_access_set_mode(mode)       → jsonb {mode, listed}
--      None of them ever returns a user id.
--   5. Mode changes and list edits write an ops_log mark when
--      public.ops_mark exists (recovery_2026_10b.sql) — fail soft. The
--      mark holds the action and the list size, never an email (ops_log
--      holds nothing that outlives an account).
--
-- EXISTING ROWS: none are changed. The only write to an existing table
--   is one INSERT … ON CONFLICT DO NOTHING into public.config.
--
-- PREREQUISITES
--   · supabase/paywall_schema.sql   (public.config — live)
--   · supabase/owner_content.sql    (public.is_app_owner() and the owner
--     registered in private.app_owner — live). The file refuses to run
--     without is_app_owner().
--   · supabase/recovery_2026_10b.sql is optional (ops_log marks).
--
-- RE-RUNNABLE: create … if not exists / create or replace / on conflict.
--   One transaction.
--
-- VERIFY after running (SQL editor):
--   select key, value from public.config where key = 'web_access';
--     -- expect 'open' (or whatever it was already set to)
--   select has_table_privilege('authenticated', 'public.web_access_allowlist', 'select'),
--          has_function_privilege('anon', 'public.web_access_add(text,text)', 'execute'),
--          has_function_privilege('authenticated', 'public.web_access_allowed()', 'execute');
--     -- expect false, false, true
--   Then in the app (signed in as the owner, web): Settings → Tools →
--   Web access shows "Open to everyone" and an empty list.
--   Then Supabase → Advisors (security + performance).
--
-- LAUNCH DAY (owner)
--   1. Add yourself? Not needed — the owner is always allowed. Add your
--      friends' sign-in emails in the panel (or web_access_add below).
--   2. Switch the panel to "Invite-only". Verify with a non-listed test
--      account in a private window: it gets the app-store page.
--   Reopen any time with the same panel (or web_access_set_mode('open')).
--   From the SQL editor the RPCs refuse (no session = not the owner);
--   there, use:  update public.config set value = 'open' where key = 'web_access';
-- ════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  perform public.ops_mark('sql', 'web_access_2026_10b.sql — start');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

-- Prerequisite check: the owner test every RPC below relies on.
do $$ begin
  if to_regprocedure('public.is_app_owner()') is null then
    raise exception 'web_access_2026_10b.sql needs public.is_app_owner() — run supabase/owner_content.sql first';
  end if;
  if to_regclass('public.config') is null then
    raise exception 'web_access_2026_10b.sql needs public.config — run supabase/paywall_schema.sql first';
  end if;
end $$;

-- ── 1. The mode ─────────────────────────────────────────────────────
insert into public.config (key, value)
values ('web_access', 'open')
on conflict (key) do nothing;

-- ── 2. The list ─────────────────────────────────────────────────────
-- citext: already installed by social_schema.sql (handles); a no-op then.
create extension if not exists citext;

create table if not exists public.web_access_allowlist (
  email    citext primary key
           check (char_length(email::text) between 3 and 254
                  and email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  note     text check (note is null or char_length(note) <= 200),
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null
);

alter table public.web_access_allowlist enable row level security;
-- No policies on purpose: with RLS on and no policy, clients see nothing.
revoke all on public.web_access_allowlist from public, anon, authenticated;

-- ── 3. Internal helpers (not callable from a client) ───────────────
create or replace function public.web_access_mode() returns text
language sql stable security definer set search_path = '' as $$
  select case when lower(btrim(coalesce(
           (select value from public.config where key = 'web_access'), 'open'))) = 'allowlist'
         then 'allowlist' else 'open' end;
$$;
revoke all on function public.web_access_mode() from public, anon, authenticated;

create or replace function public.web_access_mark(p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  select count(*) into v_n from public.web_access_allowlist;
  begin
    perform public.ops_mark('web_access', p_label,
      jsonb_build_object('actor', 'rpc:web_access', 'mode', public.web_access_mode(), 'listed', v_n));
  exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then
    null;   -- recovery_2026_10b.sql not run yet: the edit still stands
  end;
end;
$$;
revoke all on function public.web_access_mark(text) from public, anon, authenticated;

create or replace function public.web_access_require_owner() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(public.is_app_owner(), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.web_access_require_owner() from public, anon, authenticated;

create or replace function public.web_access_clean_email(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(v) < 3 or char_length(v) > 254
     or v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function public.web_access_clean_email(text) from public, anon, authenticated;

-- ── 4. The caller's own answer ──────────────────────────────────────
create or replace function public.web_access_allowed() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if public.web_access_mode() <> 'allowlist' then return true; end if;
  if v_uid is null then return false; end if;
  if coalesce(public.is_app_owner(), false) then return true; end if;
  -- Confirmed emails only: an unconfirmed sign-up using a listed
  -- address must not inherit that person's access.
  return exists (
    select 1
      from auth.users u
      join public.web_access_allowlist a on lower(a.email::text) = lower(u.email)
     where u.id = v_uid
       and u.email_confirmed_at is not null
  );
end;
$$;
revoke all on function public.web_access_allowed() from public, anon;
grant execute on function public.web_access_allowed() to authenticated;

-- ── 5. Owner management ─────────────────────────────────────────────
create or replace function public.web_access_list()
returns table (email text, note text, added_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.web_access_require_owner();
  return query
    select a.email::text, a.note, a.added_at
      from public.web_access_allowlist a
     order by a.added_at desc, a.email::text
     limit 500;
end;
$$;
revoke all on function public.web_access_list() from public, anon;
grant execute on function public.web_access_list() to authenticated;

create or replace function public.web_access_add(p_email text, p_note text default null)
returns table (email text, note text, added_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_note  text := nullif(left(btrim(coalesce(p_note, '')), 200), '');
begin
  perform public.web_access_require_owner();
  v_email := public.web_access_clean_email(p_email);
  insert into public.web_access_allowlist as a (email, note, added_by)
  values (v_email, v_note, auth.uid())
  on conflict on constraint web_access_allowlist_pkey
    do update set note = coalesce(excluded.note, a.note);
  perform public.web_access_mark('web access: list entry added');
  return query
    select a.email::text, a.note, a.added_at
      from public.web_access_allowlist a
     where lower(a.email::text) = v_email;
end;
$$;
revoke all on function public.web_access_add(text, text) from public, anon;
grant execute on function public.web_access_add(text, text) to authenticated;

create or replace function public.web_access_remove(p_email text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_n int;
begin
  perform public.web_access_require_owner();
  delete from public.web_access_allowlist a where lower(a.email::text) = v_email;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform public.web_access_mark('web access: list entry removed'); end if;
  return v_n > 0;
end;
$$;
revoke all on function public.web_access_remove(text) from public, anon;
grant execute on function public.web_access_remove(text) to authenticated;

create or replace function public.web_access_set_mode(p_mode text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_n int;
begin
  perform public.web_access_require_owner();
  if v_mode not in ('open', 'allowlist') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  insert into public.config as c (key, value) values ('web_access', v_mode)
  on conflict (key) do update set value = excluded.value;
  perform public.web_access_mark('web access: mode set to ' || v_mode);
  select count(*) into v_n from public.web_access_allowlist;
  return jsonb_build_object('mode', v_mode, 'listed', v_n);
end;
$$;
revoke all on function public.web_access_set_mode(text) from public, anon;
grant execute on function public.web_access_set_mode(text) to authenticated;

do $$ begin
  perform public.ops_mark('sql', 'web_access_2026_10b.sql — done');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

commit;
