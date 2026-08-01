-- ============================================================
-- Lock the leaderboard input columns on `profiles`
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================
--
-- This is item 23 in STARTUP_REQUIREMENTS.md, and the follow-up that
-- profiles_column_lockdown.sql explicitly left open:
--
--   "`level`, `prestige`, `ratings*` remain client-writable because the
--    app writes them from the client today ... They are leaderboard
--    inputs, so they are forgeable by anyone willing to call PostgREST
--    directly."
--
-- ── The exploit this closes ──────────────────────────────────
-- get-leaderboard.js ranks the all-time board by
--   prestige * 100 + ratings_ovr
-- and both were granted to `authenticated`. Any signed-in user could
-- skip the app entirely:
--
--   PATCH /rest/v1/profiles?id=eq.<their own uid>
--   Authorization: Bearer <their own session JWT>
--   {"prestige": 99, "ratings_ovr": 99}
--
-- …and hold first place permanently. No purchase, no activity, and
-- nothing in the app to undo it. AdminEditModal being owner-only in the
-- UI never mattered — a UI gate is not an access control.
--
-- ── Before running ───────────────────────────────────────────
-- Deploy the code change first. AdminEditModal now writes through
-- netlify/functions/admin-set-rating (session verified, owner checked,
-- values re-clamped) instead of PostgREST, so revoking these columns
-- does not break the owner's rating editor. Running this against the
-- OLD client would make that editor fail with a permissions error.
--
-- Set OWNER_EMAIL on Netlify (comma-separated for more than one) or
-- the function denies everyone — it fails closed on purpose.

-- Re-grant the same allow-list as profiles_column_lockdown.sql, minus
-- the four leaderboard inputs. `revoke` first: a table-level grant
-- beats a column-level one, so the column list only takes effect once
-- the table-wide grant is gone.
revoke update on public.profiles from authenticated, anon;

grant update (
  handle,
  display_name,
  avatar_url,
  is_searchable,
  last_active_at,
  leaderboard_optin,
  leaderboard_color,
  -- `level` stays for now. It is cosmetic on the friend card and is
  -- published by usePublishProfile on a debounce; revoking it without
  -- moving that write server-side would break the card silently. It is
  -- NOT a leaderboard input — get-leaderboard reads ratings_ovr — so it
  -- is the least valuable thing on this list to forge.
  level
) on public.profiles to authenticated;

-- prestige, ratings, ratings_ovr and ratings_computed_at are now
-- server-owned: written by recompute-ratings (derived from real data),
-- prestige-up (guarded by OVR >= 99), snapshot-ratings, and
-- admin-set-rating (owner only). All four hold the service-role key,
-- which column grants do not apply to.

-- ── Verify ───────────────────────────────────────────────────
-- Expect NO rows for prestige / ratings / ratings_ovr /
-- ratings_computed_at (nor tier, from the earlier lockdown):
--
--   select column_name, privilege_type
--   from information_schema.column_privileges
--   where table_name = 'profiles'
--     and grantee = 'authenticated'
--     and privilege_type = 'UPDATE'
--   order by column_name;
--
-- And as an ordinary signed-in user, this must now FAIL:
--   update profiles set ratings_ovr = 99, prestige = 99 where id = auth.uid();
--
-- Existing values are untouched — this changes permissions only, so no
-- one's current rating, prestige or rank moves.
