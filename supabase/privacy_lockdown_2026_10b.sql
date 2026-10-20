-- ============================================================================
-- Privacy lockdown — STARTUP_REQUIREMENTS items 83, 84 and 99
-- Run in the Supabase SQL Editor. One transaction; safe to re-run.
-- ============================================================================
--
-- ── RUN ORDER — DEPLOY FIRST, THEN RUN THIS ─────────────────────────────────
--   1. Merge + deploy the code (Netlify). That build:
--        · reads your own private profile fields through my_profile() and
--          friends' presence through friend_presence(), falling back to
--          today's direct selects while those functions don't exist;
--        · selects only the columns granted below everywhere else;
--        · writes handle / display_name / avatar_url through the new
--          netlify/functions/profile-update (service role), which works
--          whatever the grants are;
--        · records consent changes in consent_events, failing soft while
--          the table doesn't exist.
--      So the deployed client works against BOTH the old and new grants.
--   2. Then run this file.
--   Running it BEFORE the deploy would break the live (old) client: its
--   own-profile read selects `tier`, and its name/avatar writes PATCH
--   columns this revokes — the paywall would read "free" and profile
--   edits would fail until the deploy lands. No data would be lost (this
--   changes permissions only), but don't do it in that order.
--
-- ── PREREQUISITES (already run in the live DB) ──────────────────────────────
--   social_schema.sql, leaderboard_schema.sql, leaderboard_color_schema.sql,
--   ratings_schema.sql, leaderboard_column_lockdown.sql, audit_schema_2026_10.sql
--   (profiles.suspended_at, ai_usage). The guard below stops with a clear
--   message if a column this grants is missing.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────────────
--   A. my_profile()       — your own whole profile row as jsonb (definer,
--                           auth.uid() only). Replaces own-row reads of
--                           tier, last_active_at, is_searchable, …
--   B. friend_presence()  — last_active_at for your ACCEPTED friends only.
--   C. Column-level SELECT on profiles for `authenticated`:
--        id, handle, display_name, avatar_url, level, ratings_ovr, suspended_at
--      Everything else (tier, ratings, prestige*, last_active_at,
--      is_searchable, leaderboard_*, lifetime_rating, …) is no longer
--      readable on other people's rows. (src/lib/friends/profileColumns.js
--      is the client's copy of this list; a test keeps them equal.)
--   D. UPDATE: handle / display_name / avatar_url leave the client grant —
--      only profile-update (service role: name filter + avatar screening)
--      writes them. INSERT narrowed to `id` for the same reason.
--   E. consent_events — append-only record of consent given / withdrawn.
--
-- Touches NO existing rows: grants, two functions, one new table.
-- service_role and SECURITY DEFINER functions (search, invites, friend
-- cap, notification triggers, leaderboard/groups functions) are not
-- affected by column grants.
--
-- ── VERIFY AFTER RUNNING ────────────────────────────────────────────────────
--   -- 1. Column SELECT grants: expect exactly the seven public columns.
--   select column_name from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'profiles'
--      and grantee = 'authenticated' and privilege_type = 'SELECT'
--    order by 1;
--   -- 2. UPDATE grants: expect is_searchable, last_active_at, leaderboard_color,
--   --    leaderboard_optin, level — and NOT handle / display_name / avatar_url.
--   select column_name from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'profiles'
--      and grantee = 'authenticated' and privilege_type = 'UPDATE'
--    order by 1;
--   -- 3. consent_events: expect SELECT for authenticated, INSERT + SELECT for
--   --    service_role, and NO UPDATE / DELETE / TRUNCATE for either. (The
--   --    authenticated INSERT is column-level: user_id, kind, granted,
--   --    copy_version — see information_schema.column_privileges.)
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'consent_events'
--      and grantee in ('anon', 'authenticated', 'service_role')
--    order by 1, 2;
--   -- 4. In the app: open Settings (handle, search/leaderboard toggles show),
--   --    the friends rail (online dots), the paywall tier, and change your
--   --    display name — all should behave exactly as before.
-- ============================================================================

begin;

-- ── Guard: every column granted below must exist ────────────────────────────
do $$
declare
  c text;
begin
  foreach c in array array['id', 'handle', 'display_name', 'avatar_url', 'level',
                           'ratings_ovr', 'suspended_at', 'last_active_at', 'is_searchable',
                           'leaderboard_optin', 'leaderboard_color', 'tier']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'profiles'
                      and column_name = c) then
      raise exception 'profiles.% is missing — run the prerequisite SQL listed in this file''s header first.', c;
    end if;
  end loop;
end
$$;

-- ── A. Your own row, private fields included ────────────────────────────────
-- jsonb (to_jsonb) so it keeps working whichever optional columns exist —
-- the same trick preview_friend_invite uses. Returns NULL when you have no
-- row yet (the client then creates it with `id` only).
create or replace function public.my_profile()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(p) from public.profiles p where p.id = auth.uid()
$$;
revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- ── B. Friends' presence — accepted friends only ────────────────────────────
-- last_active_at drives the online dot on the friends rail. It used to be
-- readable on every searchable stranger's row; now only an accepted friend
-- sees it (and a user who turned presence off publishes NULL anyway).
create or replace function public.friend_presence()
returns table (id uuid, last_active_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.last_active_at
    from public.profiles p
    join public.friendships f
      on f.status = 'accepted'
     and ((f.requester_id = auth.uid() and f.addressee_id = p.id)
       or (f.addressee_id = auth.uid() and f.requester_id = p.id))
   where auth.uid() is not null
     and p.suspended_at is null
$$;
revoke all on function public.friend_presence() from public, anon;
grant execute on function public.friend_presence() to authenticated;

-- ── C. Column-level SELECT (item 83) ─────────────────────────────────────────
-- Same mechanism as UPDATE in profiles_column_lockdown.sql and as `groups`
-- in group_crest_schema.sql: a table-level grant beats a column list, so
-- revoke the table grant first, then grant the columns. The row policy
-- ("profiles: visible read" — own row, searchable rows, friendship rows)
-- is unchanged: it still decides WHICH rows; this decides WHICH FIELDS.
-- Policy expressions (is_searchable, handle) are not subject to the
-- caller's column privileges, so the policy keeps working.
revoke select on public.profiles from authenticated, anon;
grant select (
  id,
  handle,
  display_name,
  avatar_url,
  level,
  ratings_ovr,     -- OVR chip on friends / requests / search (item 103: category
                   -- `ratings` stay visible only where the leaderboard and group
                   -- functions show them — they read with the service role)
  suspended_at     -- the inbox's "Account suspended" note
) on public.profiles to authenticated;

-- ── D. Server-owned public text (item 84) ────────────────────────────────────
-- handle / display_name / avatar_url are what strangers see, so they are
-- written only by netlify/functions/profile-update (name filter + avatar
-- screening, service role). The rest of the self-update list from
-- leaderboard_column_lockdown.sql stays client-writable.
-- Re-granting the full list (rather than revoking three columns) makes the
-- result the same whatever state the earlier grants were left in.
revoke update on public.profiles from authenticated, anon;
grant update (
  is_searchable,
  last_active_at,
  leaderboard_optin,
  leaderboard_color,
  level
) on public.profiles to authenticated;

-- First login creates the row with `id` only (useSubscription). handle /
-- display_name / avatar_url leave the INSERT grant too, or a brand-new
-- account could create its row with an unfiltered name.
revoke insert on public.profiles from authenticated, anon;
grant insert (id) on public.profiles to authenticated;

-- ── E. consent_events — durable, append-only consent record (item 99) ───────
-- One row each time health / AI consent is granted or withdrawn, written by
-- the client's consent logic (src/lib/consent/ledger.js). The servers that
-- honour consent (sync crons, AI functions) read the latest row per kind.
-- Cascades with the account (item 20's rule).
create table if not exists public.consent_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('health', 'ai')),
  granted      boolean not null,
  copy_version text not null default 'unknown' check (char_length(copy_version) between 1 and 40),
  created_at   timestamptz not null default now()
);
create index if not exists consent_events_user_kind_idx
  on public.consent_events (user_id, kind, created_at desc);

alter table public.consent_events enable row level security;

drop policy if exists "consent_events: insert own" on public.consent_events;
create policy "consent_events: insert own"
  on public.consent_events for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "consent_events: read own" on public.consent_events;
create policy "consent_events: read own"
  on public.consent_events for select to authenticated
  using (user_id = auth.uid());

-- No UPDATE or DELETE for anyone but the cascade. created_at / id are not
-- in the INSERT grant, so a row can't be back-dated.
-- service_role (the functions) reads, and may insert; it doesn't update or
-- delete either. The deletion cascade runs as the table owner, so revoking
-- DELETE here does not stop an account's rows going with it.
revoke all on public.consent_events from public, anon, authenticated, service_role;
grant select on public.consent_events to authenticated;
grant insert (user_id, kind, granted, copy_version) on public.consent_events to authenticated;
grant select, insert on public.consent_events to service_role;

-- Append-only even for roles that do hold UPDATE (the table owner). The
-- account-deletion cascade is a DELETE, so it is unaffected.
create or replace function public.consent_events_append_only()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'consent_events is append-only.' using errcode = '42501';
end;
$$;
drop trigger if exists consent_events_no_update on public.consent_events;
create trigger consent_events_no_update before update on public.consent_events
  for each row execute function public.consent_events_append_only();

-- Durable brake (item 81): 60 rows an hour per account is far beyond any
-- real toggling and stops a script from filling the table.
create or replace function public.throttle_consent_events()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.consent_events
       where user_id = new.user_id
         and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many consent changes — try again later.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists consent_events_throttle on public.consent_events;
create trigger consent_events_throttle before insert on public.consent_events
  for each row execute function public.throttle_consent_events();
revoke execute on function public.consent_events_append_only() from public, anon, authenticated;
revoke execute on function public.throttle_consent_events() from public, anon, authenticated;

commit;
