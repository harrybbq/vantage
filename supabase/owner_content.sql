-- ── Owner-only content ───────────────────────────────────────────────────────
--
-- Personal planning content for the owner-only Upgrade section (Career plan,
-- money projection, cert roadmap, target companies). It used to be written
-- into the source, which ships in the public JS bundle and sits in a public
-- git repo — so anything personal in it was readable without logging in.
-- Now the client fetches it at runtime and Postgres decides who may read it.
--
-- ── Who "the owner" is ──
-- private.app_owner holds the owner's auth user id. The `private` schema is
-- not exposed through the Data API, so the list cannot be read or edited
-- from a client; only is_app_owner() (SECURITY DEFINER) looks at it. The
-- owner is registered ONCE, by login email, at the bottom of this file —
-- so no user id is ever written into the repo.
--
-- ── What is allowed ──
--   select / insert / update : authenticated AND is_app_owner()
--   delete                   : nobody from a client (no policy)
--   anon                     : no privileges at all
-- Every update archives the previous `data` to owner_content_history first.
--
-- Apply: run the whole file in the Supabase SQL editor, after replacing the
-- placeholder email in step 5. Safe to re-run.

-- 1. The owner list, out of the API's reach.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_owner (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
revoke all on private.app_owner from public, anon, authenticated;

-- 2. The check every policy below uses.
create or replace function public.is_app_owner() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from private.app_owner where user_id = auth.uid());
$$;
revoke all on function public.is_app_owner() from public, anon;
grant execute on function public.is_app_owner() to authenticated;

-- 3. The content, one row per key (e.g. 'career.plan', 'career.status').
create table if not exists public.owner_content (
  key        text primary key check (key ~ '^[a-z0-9_.-]{1,64}$'),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.owner_content enable row level security;
revoke all on public.owner_content from anon;
grant select, insert, update on public.owner_content to authenticated;

drop policy if exists "owner content read"   on public.owner_content;
drop policy if exists "owner content insert" on public.owner_content;
drop policy if exists "owner content update" on public.owner_content;
create policy "owner content read" on public.owner_content
  for select to authenticated using (public.is_app_owner());
create policy "owner content insert" on public.owner_content
  for insert to authenticated with check (public.is_app_owner());
create policy "owner content update" on public.owner_content
  for update to authenticated using (public.is_app_owner()) with check (public.is_app_owner());
-- No delete policy on purpose: a row can be overwritten (and the old value
-- is archived below) but not removed from the client.

-- 4. History: the previous value of every update, newest 30 per key kept.
create table if not exists public.owner_content_history (
  id          bigint generated always as identity primary key,
  key         text not null,
  data        jsonb not null,
  archived_at timestamptz not null default now()
);
create index if not exists owner_content_history_key_idx
  on public.owner_content_history (key, archived_at desc);
alter table public.owner_content_history enable row level security;
revoke all on public.owner_content_history from anon;
grant select on public.owner_content_history to authenticated;
drop policy if exists "owner content history read" on public.owner_content_history;
create policy "owner content history read" on public.owner_content_history
  for select to authenticated using (public.is_app_owner());

create or replace function public.owner_content_archive() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if old.data is distinct from new.data then
    insert into public.owner_content_history (key, data) values (old.key, old.data);
    delete from public.owner_content_history
     where key = old.key
       and id not in (select id from public.owner_content_history
                       where key = old.key order by archived_at desc limit 30);
  end if;
  return new;
end;
$$;

drop trigger if exists owner_content_archive on public.owner_content;
create trigger owner_content_archive
  before update on public.owner_content
  for each row execute function public.owner_content_archive();

-- 5. Register the owner — by login email, so no id is written anywhere.
--    Replace the placeholder with the email you sign in with, then run.
do $$
declare n int;
begin
  insert into private.app_owner (user_id)
  select id from auth.users where lower(email) = lower('REPLACE_WITH_YOUR_LOGIN_EMAIL')
  on conflict do nothing;
  get diagnostics n = row_count;
  if not exists (select 1 from private.app_owner) then
    raise exception 'No owner registered — check the email in step 5.';
  end if;
  raise notice 'Owner rows added: %', n;
end $$;
