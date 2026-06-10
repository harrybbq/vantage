-- ── Prestige schema (Vantage) ───────────────────────────────────────────────
--
-- OVR stays 0-99. At 99 the user may "prestige": prestige += 1 (cap 99)
-- and the competitive baseline resets so the climb starts again — no
-- user_data is wiped. Display = colour band + Roman numeral (P-badge).
--
-- prestige / prestige_baseline are written ONLY by the server
-- (netlify/functions/prestige-up.js). The baseline is the per-category
-- raw-points snapshot at prestige time; recomputeUser subtracts it so
-- the canonical OVR restarts from the floor. See docs/RANKING_SYSTEM.md.

alter table public.profiles
  add column if not exists prestige smallint not null default 0,
  add column if not exists prestige_baseline jsonb not null default '{}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_prestige_range,
  add constraint profiles_prestige_range check (prestige >= 0 and prestige <= 99);

-- Single sortable "lifetime" key for leaderboards: P3 · 47 → 347.
alter table public.profiles
  add column if not exists lifetime_rating int
    generated always as (coalesce(prestige, 0) * 100 + coalesce(ratings_ovr, 0)) stored;

create index if not exists profiles_lifetime_rating_optin_idx
  on public.profiles (lifetime_rating desc)
  where leaderboard_optin = true;
