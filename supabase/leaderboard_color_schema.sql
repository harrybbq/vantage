-- ============================================================
-- Vantage — leaderboard name colour (Pro)
-- Run in the Supabase SQL Editor. Idempotent.
--
-- Adds an optional accent-colour hex that Pro users opt into (Settings
-- → Friends → "Colour my leaderboard name"). get-leaderboard reads it
-- best-effort and the client renders the name in that colour. NULL =
-- off (default). The existing self-update RLS policy on `profiles`
-- already lets a user write their own row, so no new policy is needed.
-- ============================================================

alter table profiles
  add column if not exists leaderboard_color text;

-- Guard the format so only a #rrggbb hex (or NULL) can be stored.
alter table profiles
  drop constraint if exists profiles_leaderboard_color_format,
  add  constraint profiles_leaderboard_color_format
       check (leaderboard_color is null or leaderboard_color ~ '^#[0-9a-fA-F]{6}$');
