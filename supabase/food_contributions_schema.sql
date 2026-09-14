-- ── Foods people add themselves ──────────────────────────────────────────
--
-- Run this in the Supabase SQL Editor. Until it is applied the "Show
-- user additions" toggle stays hidden and the food search carries on
-- exactly as it does now — the client and the function both treat a
-- missing table as "no community results".
--
-- ── Why this exists ──────────────────────────────────────────────────
-- Open Food Facts, USDA and FatSecret between them still miss things:
-- the local bakery, the gym's protein bar, half of British own-brand
-- shelves, and almost anything cooked from scratch. Everyone who hits
-- one of those gaps types the panel in by hand, and that typing is
-- thrown away the moment it is logged. This keeps it, so the next
-- person who searches the same thing finds it.
--
-- ── What it is careful about ─────────────────────────────────────────
-- It is a free-text field that other people read, which is the same
-- exposure a group picture is. Three things bound it:
--
--   1. Opt IN to contribute. The box is unticked; nothing is shared
--      because somebody logged their lunch.
--   2. Opt IN to see. Community results are off until the searcher
--      turns them on, and are badged when they arrive, so nobody is
--      handed a stranger's text without asking for it.
--   3. Reportable, and self-hiding. Three reports takes an entry out of
--      search until a person looks at it. One report per account, so it
--      cannot be done by one person with a loop.
--
-- No nutrition is attributed to anybody in search results. `contributed_by`
-- exists for moderation and rate-limiting and is never selected into a
-- response — what somebody eats is not a thing to publish next to their
-- name.
--
-- Idempotent — safe to re-run.

-- ── 1. The foods ──────────────────────────────────────────────────────
create table if not exists public.food_contributions (
  id             bigserial primary key,
  name           text not null check (char_length(btrim(name)) between 2 and 80),
  brand          text check (brand is null or char_length(btrim(brand)) <= 60),
  -- Per the serving below, exactly as the rest of the app stores food.
  serving_g      numeric not null default 100 check (serving_g > 0 and serving_g <= 5000),
  serving_unit   text not null default 'g' check (serving_unit in ('g', 'ml')),
  calories       numeric not null default 0 check (calories  >= 0 and calories  <= 2000),
  protein_g      numeric not null default 0 check (protein_g >= 0 and protein_g <= 200),
  carbs_g        numeric not null default 0 check (carbs_g   >= 0 and carbs_g   <= 200),
  fat_g          numeric not null default 0 check (fat_g     >= 0 and fat_g     <= 200),
  fibre_g        numeric not null default 0 check (fibre_g   >= 0 and fibre_g   <= 200),
  sugar_g        numeric not null default 0 check (sugar_g   >= 0 and sugar_g   <= 200),
  sodium_mg      numeric not null default 0 check (sodium_mg >= 0 and sodium_mg <= 100000),
  contributed_by uuid not null references public.profiles(id) on delete cascade,
  -- 'visible' is in search; 'hidden' is not. Reports flip it; a person
  -- flips it back.
  status         text not null default 'visible' check (status in ('visible', 'hidden')),
  reports        integer not null default 0,
  created_at     timestamptz not null default now()
);

-- The same food, added by forty people, is forty ways to pick wrong.
-- Name and brand together are the identity; the first one in wins and
-- later attempts conflict rather than piling up.
create unique index if not exists food_contributions_identity
  on public.food_contributions (lower(btrim(name)), lower(coalesce(btrim(brand), '')));

-- Search is `name ilike '%term%'`, which cannot use a b-tree. trigram
-- can, and the extension is already available on Supabase.
create extension if not exists pg_trgm;
create index if not exists food_contributions_name_trgm
  on public.food_contributions using gin (lower(name) gin_trgm_ops)
  where status = 'visible';

create index if not exists food_contributions_mine
  on public.food_contributions (contributed_by, created_at desc);

-- ── 2. Reports ────────────────────────────────────────────────────────
create table if not exists public.food_contribution_reports (
  contribution_id bigint not null references public.food_contributions(id) on delete cascade,
  reporter_id     uuid   not null references public.profiles(id) on delete cascade,
  reason          text check (reason is null or char_length(reason) <= 200),
  created_at      timestamptz not null default now(),
  -- One report per person per entry. Without this the threshold below
  -- is "one person with a for-loop".
  primary key (contribution_id, reporter_id)
);

-- Counting in a trigger rather than trusting a client to increment: the
-- count is the thing that hides an entry, so it is not a number any
-- client gets to write.
create or replace function public.bump_food_contribution_reports()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.food_contribution_reports
   where contribution_id = new.contribution_id;
  update public.food_contributions
     set reports = n,
         -- Three different accounts is enough to take it out of search
         -- until somebody looks. The entry is not deleted: a wrong
         -- hiding has to be reversible, and the food is still somebody's
         -- work.
         status = case when n >= 3 then 'hidden' else status end
   where id = new.contribution_id;
  return new;
end $$;

drop trigger if exists food_contribution_reports_bump on public.food_contribution_reports;
create trigger food_contribution_reports_bump
  after insert on public.food_contribution_reports
  for each row execute function public.bump_food_contribution_reports();

-- ── 3. RLS ────────────────────────────────────────────────────────────
alter table public.food_contributions        enable row level security;
alter table public.food_contribution_reports enable row level security;

-- Search results are assembled by the `food-search` function with the
-- service key, the same as every other source it merges — so there is no
-- client read policy for other people's entries. What a signed-in user
-- may read directly is their OWN contributions, which is what "things I
-- added" needs and nothing more.
create policy "food_contributions: own read" on public.food_contributions
  for select to authenticated using (contributed_by = auth.uid());

create policy "food_contributions: own insert" on public.food_contributions
  for insert to authenticated with check (contributed_by = auth.uid());

-- Deleting your own entry is allowed; editing one is not. An entry that
-- could be edited after other people had it in their logs is an entry
-- whose numbers change under them.
create policy "food_contributions: own delete" on public.food_contributions
  for delete to authenticated using (contributed_by = auth.uid());

-- `reports` and `status` are not the contributor's to set — there is no
-- update policy at all, and the column grants say so twice.
revoke update on public.food_contributions from authenticated, anon;

create policy "food_contribution_reports: own insert" on public.food_contribution_reports
  for insert to authenticated with check (reporter_id = auth.uid());

create policy "food_contribution_reports: own read" on public.food_contribution_reports
  for select to authenticated using (reporter_id = auth.uid());

-- ── 4. Verify ─────────────────────────────────────────────────────────
-- Expect two rows.
select table_name,
       (select count(*) from information_schema.columns c
         where c.table_name = t.table_name and c.table_schema = 'public') as columns
from information_schema.tables t
where table_schema = 'public'
  and table_name in ('food_contributions', 'food_contribution_reports')
order by table_name;
