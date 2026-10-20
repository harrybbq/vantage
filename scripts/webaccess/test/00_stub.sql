-- Test-only stub of the Supabase pieces web_access_2026_10b.sql needs:
-- API roles, auth.users (+ email_confirmed_at) and auth.uid(), Supabase's
-- default privileges, and the owner test from owner_content.sql (the
-- owner is registered here by id instead of by email). Never run this
-- against a real project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  email_confirmed_at timestamptz,
  created_at         timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- owner_content.sql steps 1–2, in effect.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.app_owner (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
create or replace function public.is_app_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_owner where user_id = auth.uid());
$$;
revoke all on function public.is_app_owner() from public, anon;
grant execute on function public.is_app_owner() to authenticated;

-- People: owner, a listed friend (mixed-case address), a stranger, an
-- unconfirmed sign-up using the friend's address, a listed-but-unconfirmed.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000001', 'owner@example.com',    now()),
  ('00000000-0000-4000-8000-000000000002', 'Friend@Example.com',   now()),
  ('00000000-0000-4000-8000-000000000003', 'stranger@example.com', now()),
  ('00000000-0000-4000-8000-000000000004', 'friend@example.com',   null),
  ('00000000-0000-4000-8000-000000000005', 'pending@example.com',  null);
insert into private.app_owner (user_id) values ('00000000-0000-4000-8000-000000000001');
