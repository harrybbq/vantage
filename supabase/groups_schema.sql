-- ── Group leagues (Vantage) ───────────────────────────────────────────────
--
-- Run this in the Supabase SQL Editor. Until it is applied the Groups
-- tab shows "not set up yet" and everything else on the leaderboard
-- carries on working — the client treats a missing table as "no group".
--
-- ── What this models ──────────────────────────────────────────────────
-- A group is up to 20 people who share one weekly score. That score is
-- the sum of how much each member's OVR GREW since Monday — not the sum
-- of their OVRs. The distinction is the whole design:
--
--   · a group cannot win by recruiting one person with a huge rating,
--     because a rating you already had is worth nothing this week;
--   · a member who does nothing costs the group nothing, so nobody is
--     under pressure to drop the friend having a bad month;
--   · and the thing being ranked is effort over a week, which is the
--     thing the app can actually see.
--
-- Groups sit in one of ten divisions. Each Monday the top three in a
-- division go up, the bottom three go down, and everyone else holds.
-- Iron is the floor: nothing relegates out of it.
--
-- The individual leaderboard is untouched and still there. Groups sit
-- on top of it rather than replacing it.

-- ── 1. Groups ─────────────────────────────────────────────────────────
create table if not exists public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 2 and 32),
  -- Shown on the crest. Six-hex or null; validated again in the function.
  crest_color  text check (crest_color is null or crest_color ~ '^#[0-9a-fA-F]{6}$'),
  -- Groups are invite-only. The code is the invite: unguessable, and
  -- rotatable by the owner if it leaks.
  invite_code  text not null unique,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  -- 1 = Obsidian (top) … 10 = Iron (floor). New groups start at the floor.
  division     smallint not null default 10 check (division between 1 and 10),
  created_at   timestamptz not null default now()
);

create index if not exists groups_division_idx on public.groups (division);

-- ── 2. Membership ─────────────────────────────────────────────────────
create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- One group per person. Belonging to two would mean one week of growth
-- counted twice, which is the cheapest possible cheat.
create unique index if not exists group_members_one_per_user
  on public.group_members (user_id);

-- Twenty seats, enforced where it cannot be talked around. Doing this in
-- the function only would leave the limit one race apart from failing.
create or replace function public.enforce_group_seat_limit()
returns trigger language plpgsql as $$
declare seats int;
begin
  select count(*) into seats from public.group_members where group_id = new.group_id;
  if seats >= 20 then
    raise exception 'group is full' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists group_members_seat_limit on public.group_members;
create trigger group_members_seat_limit
  before insert on public.group_members
  for each row execute function public.enforce_group_seat_limit();

-- ── 3. Settled weeks ──────────────────────────────────────────────────
-- One row per group per week, written by the settle-leagues cron. This
-- is what makes a promotion checkable afterwards: without it, "we went
-- up last week" is a claim about a number nobody kept.
create table if not exists public.league_weeks (
  id            bigserial primary key,
  group_id      uuid not null references public.groups(id) on delete cascade,
  week_start    date not null,
  division      smallint not null,
  score         integer not null,
  position      smallint not null,
  outcome       text not null check (outcome in ('promoted', 'held', 'relegated')),
  settled_at    timestamptz not null default now(),
  unique (group_id, week_start)
);

create index if not exists league_weeks_group_idx
  on public.league_weeks (group_id, week_start desc);

-- ── 4. Coin grants ────────────────────────────────────────────────────
-- The top three contributors in each group are paid on Monday. Coins
-- live in the user's own state JSON, which the server must not rewrite
-- (see the data-safety rule in CLAUDE.md), so the server records the
-- grant here and the client credits itself once and stamps claimed_at.
-- Idempotent by row: a grant can be claimed exactly once.
create table if not exists public.coin_grants (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     integer not null check (amount > 0),
  reason     text not null,
  week_start date,
  granted_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index if not exists coin_grants_unclaimed_idx
  on public.coin_grants (user_id) where claimed_at is null;

-- One payout per user per week, whatever else goes wrong upstream.
create unique index if not exists coin_grants_one_per_week
  on public.coin_grants (user_id, week_start) where week_start is not null;

-- ── 5. RLS ────────────────────────────────────────────────────────────
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.league_weeks  enable row level security;
alter table public.coin_grants   enable row level security;

-- Reading a group's name and division is how a division table is drawn,
-- so any signed-in user may read groups and memberships. What is NOT
-- readable this way is anybody's rating: the board is assembled by the
-- `groups` function with the service key, which joins profiles itself.
create policy "groups: read" on public.groups
  for select to authenticated using (true);

create policy "group_members: read" on public.group_members
  for select to authenticated using (true);

create policy "league_weeks: read" on public.league_weeks
  for select to authenticated using (true);

-- Everything that CHANGES a group goes through the function, which
-- checks seats, ownership and one-group-per-user server-side. No client
-- insert/update/delete policies exist on purpose: without them the
-- table is read-only to the anon and authenticated roles, and the
-- service role (which bypasses RLS) is the only writer.
--
-- The one exception is claiming a grant, which the client must do
-- itself because it is the client that owns the coin balance.
create policy "coin_grants: own read" on public.coin_grants
  for select to authenticated using (user_id = auth.uid());

create policy "coin_grants: own claim" on public.coin_grants
  for update to authenticated
  using (user_id = auth.uid() and claimed_at is null)
  with check (user_id = auth.uid());

-- A claim may only ever set claimed_at — not the amount. Column grants
-- are the mechanism for that; row policies gate rows, not fields (the
-- lesson from profiles_column_lockdown.sql).
revoke update on public.coin_grants from authenticated, anon;
grant update (claimed_at) on public.coin_grants to authenticated;

-- ── 6. Verify ─────────────────────────────────────────────────────────
-- Expect four rows.
select table_name, (select count(*) from information_schema.columns c
                    where c.table_name = t.table_name and c.table_schema = 'public') as columns
from information_schema.tables t
where table_schema = 'public'
  and table_name in ('groups', 'group_members', 'league_weeks', 'coin_grants')
order by table_name;
