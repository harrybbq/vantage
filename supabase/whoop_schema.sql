-- WHOOP integration — OAuth token storage.
-- Run in Supabase SQL editor (or via migration).
--
-- RLS is enabled with NO policies: only the service role (Netlify
-- functions) can read/write tokens. Clients never see refresh tokens.

create table if not exists public.whoop_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

alter table public.whoop_tokens enable row level security;
