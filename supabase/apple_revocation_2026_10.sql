-- ════════════════════════════════════════════════════════════════════
-- apple_revocation_2026_10.sql — Sign in with Apple token storage
-- (STARTUP_REQUIREMENTS item 117, store pack gap P8)
-- Run in the Supabase SQL editor. Owner-run; nothing applies it for you.
-- ════════════════════════════════════════════════════════════════════
--
-- WHY
--   Apple expects an app that offers Sign in with Apple to revoke the
--   user's Apple tokens when they delete their account. Supabase hands
--   the Apple refresh token to the client once, right after sign-in, and
--   does not keep it. The apple-token function stores it here; the
--   delete-account function reads it before deleting the auth user and
--   revokes it at Apple afterwards. See netlify/lib/appleRevoke.js and
--   docs/SIGN_IN_WITH_APPLE.md.
--
-- WHAT IT DOES
--   public.apple_tokens(user_id pk → auth.users ON DELETE CASCADE, token,
--   enc, client_kind, created_at, updated_at). One row per account (the
--   newest Apple sign-in wins). RLS on, NO policies, every privilege
--   revoked from anon/authenticated: only the service role (Netlify
--   functions) reads or writes it; no client can read a token back.
--     token        — the refresh token; AES-256-GCM ciphertext when
--                    APPLE_TOKEN_SECRET is set in Netlify (enc says which)
--     enc          — 'aes-256-gcm-v1' | 'none'
--     client_kind  — 'services' (Supabase OAuth, the Services ID) |
--                    'bundle' (reserved for a future native SIWA plugin)
--   The cascade means deleting an account removes its row — which is
--   why delete-account reads it first.
--
-- EXISTING ROWS: none are read or changed. New table only.
--
-- UNTIL THIS RUNS: apple-token answers { stored: false } and
--   delete-account finds nothing to revoke; both carry on (fail soft).
--   Tokens are only captured at sign-in, so accounts that signed in with
--   Apple before this ran (and before the client change shipped) have
--   nothing stored until they next sign in with Apple.
--
-- RE-RUNNABLE: create … if not exists. One transaction.
--
-- VERIFY after running:
--   select has_table_privilege('authenticated', 'public.apple_tokens', 'select'),
--          has_table_privilege('anon', 'public.apple_tokens', 'insert'),
--          has_table_privilege('service_role', 'public.apple_tokens', 'insert');
--     -- expect false, false, true
--   Then sign in with Apple once (web or app) and check ONE row appears:
--   select count(*), max(updated_at), min(enc) from public.apple_tokens;
--   (Do not select the token column.) Then Supabase → Advisors (security).
-- ════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  perform public.ops_mark('sql', 'apple_revocation_2026_10.sql — start');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

create table if not exists public.apple_tokens (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  token       text not null check (char_length(token) between 16 and 4096),
  enc         text not null default 'none' check (enc in ('none', 'aes-256-gcm-v1')),
  client_kind text not null default 'services' check (client_kind in ('services', 'bundle')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.apple_tokens enable row level security;
-- No policies on purpose: with RLS on and no policy, clients see nothing.
revoke all on public.apple_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.apple_tokens to service_role;

do $$ begin
  perform public.ops_mark('sql', 'apple_revocation_2026_10.sql — done');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

commit;
