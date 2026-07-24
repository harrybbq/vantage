-- ============================================================
-- Vantage — Open Banking connections (FOUNDATION, not yet used)
-- Run in the Supabase SQL editor when Open Banking goes live.
-- Idempotent — safe to re-run. Until then the client is fail-soft and
-- this table can stay absent with no impact.
--
-- Stores only the minimum needed to refresh a connection: the provider
-- session/consent id and its expiry. Access tokens are held server-side
-- (Netlify env / short-lived), NEVER in this table or the client, mirroring
-- the whoop_tokens pattern. No raw transactions are persisted here.
-- ============================================================

create table if not exists bank_connections (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  provider     text not null default 'enable_banking',
  session_id   text,                    -- provider consent/session reference
  institution  text,                    -- display name of the linked bank
  status       text not null default 'connected',
  consent_expires_at timestamptz,       -- Open Banking consents expire (~90d)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table bank_connections enable row level security;

-- A user can see and manage only their own connection row.
drop policy if exists bank_connections_select on bank_connections;
create policy bank_connections_select on bank_connections for select
  using (auth.uid() = user_id);

drop policy if exists bank_connections_delete on bank_connections;
create policy bank_connections_delete on bank_connections for delete
  using (auth.uid() = user_id);

-- Writes come from the service role (Netlify functions) after the
-- server-side OAuth exchange — no client insert/update policy on purpose.
