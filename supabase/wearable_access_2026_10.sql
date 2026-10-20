-- ════════════════════════════════════════════════════════════════════
-- wearable_access_2026_10.sql — who may CONNECT WHOOP / Oura while the
-- providers review Vantage (STARTUP_REQUIREMENTS item 127, 2026-10-20)
--
-- WHOOP lets an unapproved app link at most 10 members, and Oura's API
-- caps an unapproved app at 10 users. Without a list, the 11th person to
-- press Connect bounces off the provider's own error page and comes back
-- to "WHOOP connect failed (denied)". With it, Vantage says why before
-- the person leaves the app, and a slot stays free for WHOOP's reviewer.
--
-- The switch ships OPEN — running this file changes nothing for anyone
-- until the owner flips it (Settings → Tools → Wearable access, or
-- wearable_access_set_mode below). Same shape as web_access_2026_10b.sql.
-- ════════════════════════════════════════════════════════════════════
--
-- WHAT IT DOES
--   1. public.config gains 'wearable_access' = 'open' (inserted only if
--      missing — an existing value is never overwritten). Values:
--        'open'      — anyone signed in may start a WHOOP/Oura connect.
--        'allowlist' — only the owner, the accounts listed below, and
--                      accounts that ALREADY hold a token row for that
--                      provider (so "Reconnect WHOOP" keeps working for
--                      everyone connected today).
--      Missing row, or a failed read → the connect functions treat it as
--      'open' (today's behaviour).
--   2. public.wearable_access_allowlist(id identity, user_id uuid unique
--      → auth.users ON DELETE CASCADE, note, added_at, added_by → auth.users
--      ON DELETE SET NULL). One list for both providers. RLS on, NO
--      client policies, every privilege revoked from anon/authenticated.
--      The Netlify connect functions read it with the service role; the
--      owner manages it through the RPCs below.
--   3. Owner RPCs — each checks is_app_owner() and raises 42501
--      otherwise; granted to authenticated (the check inside gates),
--      revoked from public/anon. Accounts are added BY HANDLE; nothing
--      returns a user id or an email:
--        wearable_access_list()                → (id, handle, display_name, note, added_at)
--        wearable_access_add(handle, note)     → the row
--        wearable_access_remove(id)            → boolean
--        wearable_access_set_mode(mode)        → jsonb summary
--        wearable_access_summary()             → jsonb {mode, listed, cap,
--                                                 whoop_connected, oura_connected}
--      The add refuses past WEARABLE_ACCESS_CAP (9 listed: with the owner
--      that is WHOOP's 10). Keep one of the 9 for WHOOP's reviewer account.
--   4. ops_log marks on mode changes and list edits when public.ops_mark
--      exists (recovery_2026_10b.sql) — fail soft; counts only.
--
-- EXISTING ROWS: none are changed. The only write to an existing table
--   is one INSERT … ON CONFLICT DO NOTHING into public.config. Nothing
--   touches whoop_tokens / oura_tokens — accounts already connected keep
--   syncing whatever the mode.
--
-- PREREQUISITES
--   · supabase/paywall_schema.sql   (public.config — live)
--   · supabase/owner_content.sql    (public.is_app_owner() — live)
--   · supabase/social_schema.sql    (profiles.handle — live)
--   · whoop_schema.sql / oura_schema.sql only for the connected counts
--     (a missing table counts as 0).
--
-- RE-RUNNABLE: create … if not exists / create or replace / on conflict.
--   One transaction.
--
-- VERIFY after running (SQL editor):
--   select key, value from public.config where key = 'wearable_access';
--     -- expect 'open'
--   select has_table_privilege('authenticated', 'public.wearable_access_allowlist', 'select'),
--          has_function_privilege('anon', 'public.wearable_access_add(text,text)', 'execute'),
--          has_function_privilege('authenticated', 'public.wearable_access_list()', 'execute');
--     -- expect false, false, true
--   Then in the app (signed in as the owner, web): Settings → Tools →
--   Wearable access shows "Open to everyone" and an empty list.
--   Then Supabase → Advisors (security + performance).
--
-- TO LIMIT CONNECTS (owner)
--   1. Add each person's handle in the panel (they need a handle: Settings
--      → Account). Add the test account you give WHOOP's reviewer too.
--   2. Switch the panel to "Invite-only". A non-listed account pressing
--      Connect WHOOP now sees "WHOOP connections are limited while WHOOP
--      reviews Vantage …" instead of WHOOP's error page.
--   From the SQL editor the RPCs refuse (no session = not the owner);
--   there, use:  update public.config set value = 'open' where key = 'wearable_access';
-- ════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  perform public.ops_mark('sql', 'wearable_access_2026_10.sql — start');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

do $$ begin
  if to_regprocedure('public.is_app_owner()') is null then
    raise exception 'wearable_access_2026_10.sql needs public.is_app_owner() — run supabase/owner_content.sql first';
  end if;
  if to_regclass('public.config') is null then
    raise exception 'wearable_access_2026_10.sql needs public.config — run supabase/paywall_schema.sql first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'handle') then
    raise exception 'wearable_access_2026_10.sql needs profiles.handle — run supabase/social_schema.sql first';
  end if;
end $$;

-- ── 1. The mode ─────────────────────────────────────────────────────
insert into public.config (key, value)
values ('wearable_access', 'open')
on conflict (key) do nothing;

-- ── 2. The list ─────────────────────────────────────────────────────
create table if not exists public.wearable_access_allowlist (
  id       bigint generated always as identity primary key,
  user_id  uuid not null unique references auth.users(id) on delete cascade,
  note     text check (note is null or char_length(note) <= 200),
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null
);

alter table public.wearable_access_allowlist enable row level security;
-- No policies on purpose: with RLS on and no policy, clients see nothing.
revoke all on public.wearable_access_allowlist from public, anon, authenticated;
-- The connect functions read it with the service role.
grant select on public.wearable_access_allowlist to service_role;

-- ── 3. Internal helpers (not callable from a client) ───────────────
create or replace function public.wearable_access_mode() returns text
language sql stable security definer set search_path = '' as $$
  select case when lower(btrim(coalesce(
           (select value from public.config where key = 'wearable_access'), 'open'))) = 'allowlist'
         then 'allowlist' else 'open' end;
$$;
revoke all on function public.wearable_access_mode() from public, anon, authenticated;

-- 9 listed + the owner = WHOOP's 10-member cap for an unapproved app.
create or replace function public.wearable_access_cap() returns int
language sql immutable set search_path = '' as $$ select 9 $$;
revoke all on function public.wearable_access_cap() from public, anon, authenticated;

create or replace function public.wearable_access_count_tokens(p_table text) returns int
language plpgsql stable security definer set search_path = '' as $$
declare v_n int := 0;
begin
  if p_table not in ('whoop_tokens', 'oura_tokens') then return 0; end if;
  if to_regclass('public.' || p_table) is null then return 0; end if;
  execute format('select count(*) from public.%I', p_table) into v_n;
  return v_n;
end;
$$;
revoke all on function public.wearable_access_count_tokens(text) from public, anon, authenticated;

create or replace function public.wearable_access_summary_json() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'mode', public.wearable_access_mode(),
    'listed', (select count(*) from public.wearable_access_allowlist),
    'cap', public.wearable_access_cap(),
    'whoop_connected', public.wearable_access_count_tokens('whoop_tokens'),
    'oura_connected', public.wearable_access_count_tokens('oura_tokens'));
$$;
revoke all on function public.wearable_access_summary_json() from public, anon, authenticated;

create or replace function public.wearable_access_mark(p_label text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  select count(*) into v_n from public.wearable_access_allowlist;
  begin
    perform public.ops_mark('wearable_access', p_label,
      jsonb_build_object('actor', 'rpc:wearable_access', 'mode', public.wearable_access_mode(), 'listed', v_n));
  exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then
    null;   -- recovery_2026_10b.sql not run yet: the edit still stands
  end;
end;
$$;
revoke all on function public.wearable_access_mark(text) from public, anon, authenticated;

create or replace function public.wearable_access_require_owner() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(public.is_app_owner(), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.wearable_access_require_owner() from public, anon, authenticated;

-- ── 4. Owner management ─────────────────────────────────────────────
create or replace function public.wearable_access_list()
returns table (id bigint, handle text, display_name text, note text, added_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.wearable_access_require_owner();
  return query
    select a.id, p.handle::text, p.display_name::text, a.note, a.added_at
      from public.wearable_access_allowlist a
      left join public.profiles p on p.id = a.user_id
     order by a.added_at desc, a.id desc
     limit 100;
end;
$$;
revoke all on function public.wearable_access_list() from public, anon;
grant execute on function public.wearable_access_list() to authenticated;

create or replace function public.wearable_access_add(p_handle text, p_note text default null)
returns table (id bigint, handle text, display_name text, note text, added_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_handle text := btrim(coalesce(p_handle, ''));
  v_note   text := nullif(left(btrim(coalesce(p_note, '')), 200), '');
  v_uid    uuid;
  v_n      int;
begin
  perform public.wearable_access_require_owner();
  if left(v_handle, 1) = '@' then v_handle := substr(v_handle, 2); end if;
  if v_handle !~ '^[a-zA-Z0-9_]{3,20}$' then
    raise exception 'invalid handle' using errcode = '22023';
  end if;
  select p.id into v_uid from public.profiles p where lower(p.handle::text) = lower(v_handle);
  if v_uid is null then
    raise exception 'no such handle' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.wearable_access_allowlist a where a.user_id = v_uid) then
    select count(*) into v_n from public.wearable_access_allowlist;
    if v_n >= public.wearable_access_cap() then
      raise exception 'list is full' using errcode = '54000';
    end if;
  end if;
  insert into public.wearable_access_allowlist as a (user_id, note, added_by)
  values (v_uid, v_note, auth.uid())
  on conflict (user_id) do update set note = coalesce(excluded.note, a.note);
  perform public.wearable_access_mark('wearable access: list entry added');
  return query
    select a.id, p.handle::text, p.display_name::text, a.note, a.added_at
      from public.wearable_access_allowlist a
      left join public.profiles p on p.id = a.user_id
     where a.user_id = v_uid;
end;
$$;
revoke all on function public.wearable_access_add(text, text) from public, anon;
grant execute on function public.wearable_access_add(text, text) to authenticated;

create or replace function public.wearable_access_remove(p_id bigint)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform public.wearable_access_require_owner();
  delete from public.wearable_access_allowlist a where a.id = p_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then perform public.wearable_access_mark('wearable access: list entry removed'); end if;
  return v_n > 0;
end;
$$;
revoke all on function public.wearable_access_remove(bigint) from public, anon;
grant execute on function public.wearable_access_remove(bigint) to authenticated;

create or replace function public.wearable_access_set_mode(p_mode text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_mode text := lower(btrim(coalesce(p_mode, '')));
begin
  perform public.wearable_access_require_owner();
  if v_mode not in ('open', 'allowlist') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  insert into public.config as c (key, value) values ('wearable_access', v_mode)
  on conflict (key) do update set value = excluded.value;
  perform public.wearable_access_mark('wearable access: mode set to ' || v_mode);
  return public.wearable_access_summary_json();
end;
$$;
revoke all on function public.wearable_access_set_mode(text) from public, anon;
grant execute on function public.wearable_access_set_mode(text) to authenticated;

create or replace function public.wearable_access_summary()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.wearable_access_require_owner();
  return public.wearable_access_summary_json();
end;
$$;
revoke all on function public.wearable_access_summary() from public, anon;
grant execute on function public.wearable_access_summary() to authenticated;

do $$ begin
  perform public.ops_mark('sql', 'wearable_access_2026_10.sql — done');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

commit;
