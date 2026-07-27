-- ============================================================
-- Lock the paywall columns on `profiles`
-- Run this in the Supabase SQL Editor.
-- ============================================================
--
-- THE PROBLEM
--
-- paywall_schema.sql deliberately gave `profiles` no UPDATE policy,
-- with the comment "Only service role can update tier (client can't
-- elevate itself)". social_schema.sql later added:
--
--   create policy "profiles: self update"
--     on profiles for update
--     using (id = auth.uid()) with check (id = auth.uid());
--
-- so a user could edit their handle and display name. But an RLS
-- policy gates ROWS, not COLUMNS — there is no way to express "you may
-- update your own row, except this field". The policy therefore also
-- handed every user their own `tier`:
--
--   await supabase.from('profiles')
--     .update({ tier: 'lifetime' }).eq('id', myUid)
--
-- That is a complete paywall bypass using the public anon key. The
-- INSERT policy has the same shape, so a brand-new user could also
-- create their row with tier already set.
--
-- THE FIX
--
-- Column-level privileges, which is the mechanism that actually gates
-- columns. Supabase grants `authenticated` table-wide UPDATE/INSERT by
-- default, and a table-level grant beats any column-level one, so each
-- has to be revoked first and then re-granted per column.
--
-- The row policies stay exactly as they are — this only narrows WHICH
-- FIELDS those policies can reach. service_role is untouched, so the
-- RevenueCat webhook and the rating/prestige cron keep working.

-- ── UPDATE ───────────────────────────────────────────────────
revoke update on public.profiles from authenticated, anon;

-- Only the fields the app legitimately lets a user change about
-- themselves. Anything absent here is server-owned from now on.
grant update (
  handle,
  display_name,
  avatar_url,
  is_searchable,
  last_active_at,
  leaderboard_optin,
  leaderboard_color,
  -- Written by src/lib/friends/queries.js updateOwnProfile(). Forgeable
  -- and arguably server-owned, but revoking it would break that call
  -- today — see the note at the bottom.
  level,
  -- Written by AdminEditModal (owner-only, but a CLIENT write). Same
  -- caveat as `level`.
  prestige,
  ratings,
  ratings_ovr,
  ratings_computed_at
) on public.profiles to authenticated;

-- ── INSERT ───────────────────────────────────────────────────
-- First-login creates the row. It needs an id and nothing else: `tier`
-- defaults to 'free', which is the whole point.
revoke insert on public.profiles from authenticated, anon;

grant insert (
  id,
  handle,
  display_name,
  avatar_url
) on public.profiles to authenticated;

-- ── Verify ───────────────────────────────────────────────────
-- Expect NO row for tier / tier_updated_at / waitlist_joined_at /
-- lifetime_rating.
--
--   select column_name, privilege_type
--   from information_schema.column_privileges
--   where table_name = 'profiles' and grantee = 'authenticated'
--   order by column_name, privilege_type;
--
-- And as a signed-in user, this must now fail:
--   update profiles set tier = 'lifetime' where id = auth.uid();

-- ── Still open after this ────────────────────────────────────
-- `level`, `prestige`, `ratings*` remain client-writable because the
-- app writes them from the client today (updateOwnProfile and
-- AdminEditModal). They are leaderboard inputs, so they are forgeable
-- by anyone willing to call PostgREST directly. Closing that means
-- moving those writes behind a service-role function first, then
-- dropping them from the grant above. Worth doing before the
-- leaderboard means anything competitively.
