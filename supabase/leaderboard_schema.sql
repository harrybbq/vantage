-- ── Leaderboard schema (Vantage) ───────────────────────────────────────────
--
-- Two surfaces feed off this:
--   • get-leaderboard.js          — reads profiles + rating_snapshots, never RLS-bypassing client.
--   • snapshot-ratings.js (cron)  — daily writes one row per opted-in user into rating_snapshots.
--
-- See docs/RANKING_SYSTEM.md for the trust boundary and the rule that
-- rating maths only ever runs in derive.js / recompute-ratings.js. This
-- schema is plumbing for the leaderboard — no derivation here.

-- 3.1  Opt-in flag for global leaderboard.
--      Default true so the board has data on day one; users can opt out
--      anytime via Settings → Privacy. Friends scope ignores this flag
--      (friendship is the consent).
alter table public.profiles
  add column if not exists leaderboard_optin boolean not null default true;

-- 3.2  Fast top-100 query path for the all-time global board.
--      Partial index keyed on the opt-in subset; sub-millisecond at any
--      realistic v1 scale.
create index if not exists profiles_ratings_ovr_optin_idx
  on public.profiles (ratings_ovr desc)
  where leaderboard_optin = true;

-- 3.3  Daily rating snapshots — feeds the weekly-climb metric
--      (current_ovr − snapshot_ovr_from_~7d_ago). One row per user per
--      day, written by the snapshot-ratings scheduled function.
create table if not exists public.rating_snapshots (
  id             bigserial primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  ovr            smallint not null,
  brain          smallint not null,
  finance        smallint not null,
  fitness        smallint not null,
  social         smallint not null,
  snapshotted_at timestamptz not null default now()
);

-- Per-user "closest snapshot to N days ago" lookup index. Used both in
-- the leaderboard query (DISTINCT ON user_id ORDER BY snapshotted_at DESC)
-- and in the snapshot job's 6-hour idempotency check.
create index if not exists rating_snapshots_user_time_idx
  on public.rating_snapshots (user_id, snapshotted_at desc);

-- 3.4  RLS — clients have no access. Only the service role (used by the
--      Netlify functions) reads or writes. Keeping snapshots off the
--      client surface avoids leaking anyone's historical OVR curve.
alter table public.rating_snapshots enable row level security;
-- (no policies = no client read/write; service role bypasses RLS)
--
-- TODO (post v1): prune snapshots older than 90 days. At 1000 users ×
-- 365 days × ~40 bytes/row ≈ 15 MB/yr; tolerable but not free forever.
