-- Oura Ring integration — OAuth token storage.
-- Run in Supabase SQL editor (or via migration).
--
-- Deliberately a mirror of whoop_tokens rather than a shared
-- `wearable_tokens` table: merging them would mean migrating live WHOOP
-- rows, and a token table is the wrong place to take that risk for the
-- sake of tidiness. If a third wearable ever lands, THAT is the moment
-- to generalise — with all three in view.
--
-- RLS is enabled with NO policies: only the service role (Netlify
-- functions) can read/write tokens. Clients never see refresh tokens.
--
-- The FK is `on delete cascade` per the standing rule — every
-- user-scoped table must vanish with the account, or delete-account
-- leaves an orphan and a GDPR problem.

create table if not exists public.oura_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

alter table public.oura_tokens enable row level security;
