-- ============================================================
-- VisionBoard Social / Friends Schema
-- Run this in the Supabase SQL Editor AFTER paywall_schema.sql.
-- Idempotent — safe to re-run.
--
-- Order matters here: tables must all exist before any RLS policy
-- that references them is created. We create every table first,
-- then attach RLS / policies / triggers / functions afterwards.
-- ============================================================

-- citext gives us case-insensitive UNIQUE on handles without a
-- separate lower() index. Supabase ships with the extension; this
-- statement is a no-op when it's already enabled.
create extension if not exists citext;

-- ── 1. Extend `profiles` with social columns ────────────────
alter table profiles
  add column if not exists handle           citext unique,
  add column if not exists display_name     text,
  add column if not exists avatar_url       text,
  add column if not exists level            int  not null default 1,
  add column if not exists is_searchable    boolean not null default true,
  add column if not exists last_active_at   timestamptz;

alter table profiles
  drop constraint if exists profiles_handle_format,
  add  constraint profiles_handle_format
       check (handle is null or handle ~ '^[a-zA-Z0-9_]{3,20}$');

-- ── 2. Create every social table FIRST (no policies yet) ────
-- Doing all the DDL up front means the RLS policies below can
-- reference any table without ordering hazards.

create table if not exists friendships (
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index if not exists friendships_addressee_status_idx
  on friendships (addressee_id, status);
create index if not exists friendships_requester_status_idx
  on friendships (requester_id, status);

create table if not exists blocks (
  blocker_id  uuid not null references auth.users(id) on delete cascade,
  blocked_id  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public_stats (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  level          int  not null default 1,
  current_streak int  not null default 0,
  streak_habit   text,
  heatmap_days   jsonb not null default '[]'::jsonb,  -- [{ymd, intensity, summary?}, …]
  recent_wins    jsonb not null default '[]'::jsonb,  -- [{icon, name}, …]
  updated_at     timestamptz not null default now()
);

create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references auth.users(id) on delete cascade,
  reported_id  uuid not null references auth.users(id) on delete cascade,
  reason       text,
  context      text,
  created_at   timestamptz not null default now(),
  check (reporter_id <> reported_id)
);

-- Enable RLS on all four. Policies attached below.
alter table friendships  enable row level security;
alter table blocks       enable row level security;
alter table public_stats enable row level security;
alter table reports      enable row level security;

-- ── 3. Profiles RLS — broadened so friends + searchable
--    profiles are visible to other users. Replaces the tighter
--    "own read" policy from paywall_schema.sql. Tier remains
--    untouchable from the client (no UPDATE policy that would
--    allow it). ──

drop policy if exists "profiles: own read" on profiles;
drop policy if exists "profiles: visible read" on profiles;

create policy "profiles: visible read"
  on profiles for select
  using (
    -- Always your own row
    id = auth.uid()
    -- Anyone whose row is searchable AND has claimed a handle
    or (is_searchable = true and handle is not null)
    -- Anyone you have a friendship row with (either direction, any state)
    or exists (
      select 1 from friendships f
      where (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
         or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
    )
  );

drop policy if exists "profiles: self update" on profiles;
create policy "profiles: self update"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── 4. friendships policies ─────────────────────────────────
-- Either party can read the row.
drop policy if exists "friendships: party read" on friendships;
create policy "friendships: party read"
  on friendships for select
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Insert: only as yourself, only as 'pending', and only if not
-- blocked in either direction.
drop policy if exists "friendships: insert as requester" on friendships;
create policy "friendships: insert as requester"
  on friendships for insert
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    and not exists (
      select 1 from blocks
      where (blocker_id = addressee_id and blocked_id = requester_id)
         or (blocker_id = requester_id and blocked_id = addressee_id)
    )
  );

-- Update: only the addressee can flip pending → accepted.
drop policy if exists "friendships: addressee accepts" on friendships;
create policy "friendships: addressee accepts"
  on friendships for update
  using (addressee_id = auth.uid() and status = 'pending')
  with check (addressee_id = auth.uid() and status = 'accepted');

-- Delete: either party can delete (decline / unfriend).
drop policy if exists "friendships: party delete" on friendships;
create policy "friendships: party delete"
  on friendships for delete
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- ── 5. Friend cap trigger ───────────────────────────────────
-- Free users get 5 accepted friends; Pro/Lifetime get unlimited.
-- Reads tier from the profiles table — guaranteed to exist for
-- the row's user(s) because paywall flow inserts on first login.
--
-- Fires on insert (won't matter — RLS only allows pending) AND
-- update (the real entry point — addressee accepts).

create or replace function check_friend_cap() returns trigger
language plpgsql security definer as $$
declare
  acceptor_tier text;
  acceptor_count int;
  requester_tier text;
  requester_count int;
begin
  if new.status <> 'accepted' then
    return new;
  end if;

  -- Acceptor (the addressee at this point) — count THEIR side.
  select tier into acceptor_tier from profiles where id = new.addressee_id;
  if acceptor_tier is null then acceptor_tier := 'free'; end if;
  if acceptor_tier = 'free' then
    select count(*) into acceptor_count from friendships
      where (requester_id = new.addressee_id or addressee_id = new.addressee_id)
        and status = 'accepted';
    if acceptor_count >= 5 then
      raise exception 'Friend limit reached for this account (Free tier: 5 friends).';
    end if;
  end if;

  -- Requester — count THEIR side too. Stops a free user who's
  -- already at 5 from receiving a 6th by being the requester on a
  -- pair the other person accepts.
  select tier into requester_tier from profiles where id = new.requester_id;
  if requester_tier is null then requester_tier := 'free'; end if;
  if requester_tier = 'free' then
    select count(*) into requester_count from friendships
      where (requester_id = new.requester_id or addressee_id = new.requester_id)
        and status = 'accepted';
    if requester_count >= 5 then
      raise exception 'The other user has hit their free-tier friend cap.';
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists friendship_cap_check_insert on friendships;
create trigger friendship_cap_check_insert
  before insert on friendships
  for each row execute function check_friend_cap();

drop trigger if exists friendship_cap_check_update on friendships;
create trigger friendship_cap_check_update
  before update on friendships
  for each row execute function check_friend_cap();

-- ── 6. public_stats policies ───────────────────────────────
-- Read: self always, friends always. Strangers — never.
drop policy if exists "public_stats: friend read" on public_stats;
create policy "public_stats: friend read"
  on public_stats for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = public_stats.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = public_stats.user_id))
    )
  );

-- Write: self only (separate insert + update so the upsert path
-- through PostgREST passes both checks).
drop policy if exists "public_stats: self upsert" on public_stats;
create policy "public_stats: self upsert"
  on public_stats for insert
  with check (user_id = auth.uid());

drop policy if exists "public_stats: self update" on public_stats;
create policy "public_stats: self update"
  on public_stats for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 7. blocks policies ────────────────────────────────────
-- Read: only the blocker (so a blocked user can't tell they've
-- been blocked, only that the requested action mysteriously failed).
drop policy if exists "blocks: blocker read" on blocks;
create policy "blocks: blocker read"
  on blocks for select using (blocker_id = auth.uid());

drop policy if exists "blocks: blocker insert" on blocks;
create policy "blocks: blocker insert"
  on blocks for insert with check (blocker_id = auth.uid());

drop policy if exists "blocks: blocker delete" on blocks;
create policy "blocks: blocker delete"
  on blocks for delete using (blocker_id = auth.uid());

-- ── 8. reports policy ─────────────────────────────────────
-- Insert-only triage queue. Service role reads; regular users
-- can never select. No update / delete policies.
drop policy if exists "reports: anyone insert" on reports;
create policy "reports: anyone insert"
  on reports for insert with check (reporter_id = auth.uid());

-- ── 9. RPC: search_profiles_by_handle ─────────────────────
-- Strict search: prefix match, case-insensitive (citext does the
-- work), capped at 10, excludes self + blocked rows on both sides.

create or replace function search_profiles_by_handle(q text)
returns table (
  id            uuid,
  handle        text,
  display_name  text,
  avatar_url    text,
  level         int,
  ratings_ovr   int
)
language sql security definer set search_path = public as $$
  select p.id, p.handle::text, p.display_name, p.avatar_url, p.level, p.ratings_ovr
  from profiles p
  where p.is_searchable = true
    and p.handle is not null
    and p.handle ilike q || '%'
    and p.id <> auth.uid()
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id      and b.blocked_id = auth.uid())
    )
  limit 10
$$;

revoke all on function search_profiles_by_handle(text) from public;
grant execute on function search_profiles_by_handle(text) to authenticated;

-- ── End ────────────────────────────────────────────────────
