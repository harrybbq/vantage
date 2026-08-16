-- ============================================================
-- Lifetime grants (founder / early supporter)
-- Run in the Supabase SQL Editor.
-- ============================================================
--
-- Lifetime is a GRANT, never a purchase. It is deliberately absent
-- from the paywall (see UNSELLABLE in src/components/PaywallModal.jsx)
-- so the public can only ever buy Free → Pro.
--
-- Since profiles_column_lockdown.sql, `tier` is server-owned — the
-- client cannot write it at all. That's the point: it's also what
-- makes this file the only way to hand out lifetime. The SQL Editor
-- runs as service_role, which the lockdown deliberately left alone.
--
-- ── Before running ───────────────────────────────────────────
-- Every account must have signed in at least once, or there is no
-- auth.users row to match and the update quietly affects 0 rows (the
-- verification query at the bottom will show that).
--
-- The file is re-runnable: the `is distinct from 'lifetime'` guard
-- makes an existing grant a no-op, so adding a name and running the
-- whole thing again costs nothing and cannot double-apply.

with grantees(email) as (
  values
    ('harrym3002@outlook.com'),      -- owner
    ('anotherone650@gmail.com')      -- co-owner
    -- finlaycarsonm@gmail.com — granted 2026-07-29, revoked 2026-08-16.
    -- Removing a line from this list does NOT revoke anything: the
    -- statement only ever sets tier TO lifetime, so an existing grant
    -- survives until it is explicitly taken back. See the revoke block
    -- at the bottom of this file.
)
update public.profiles p
set tier = 'lifetime',
    tier_updated_at = now()
from auth.users u
join grantees g on lower(u.email) = lower(g.email)
where p.id = u.id
  and p.tier is distinct from 'lifetime';   -- no-op if already granted

-- ── Verify ───────────────────────────────────────────────────
-- Expect one row per grantee showing tier = 'lifetime'. A missing row
-- means that address has never signed in, or is spelled differently
-- from the one on the account.
select u.email, p.tier, p.tier_updated_at
from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) in (
  'harrym3002@outlook.com',
  'anotherone650@gmail.com',
  'finlaycarsonm@gmail.com'   -- kept here so a revoke can be verified too
);

-- ── Note on RevenueCat ───────────────────────────────────────
-- These grants live only in profiles.tier, which useSubscription
-- treats as canonical. Its reconciliation with RevenueCat is one-way
-- (RC can upgrade in memory, never demote), so a grantee with no RC
-- entitlement still reads as lifetime and cannot be downgraded by a
-- webhook. Nothing extra is needed in the RC dashboard.
--
-- To revoke later:
--   update public.profiles set tier = 'free', tier_updated_at = now()
--   where id = (select id from auth.users where lower(email) = lower('…'));


-- ── Revoking a grant ─────────────────────────────────────────
-- Deleting a name from `grantees` above is not enough — that statement
-- only ever sets tier TO lifetime, so an existing grant persists. A
-- revoke has to be its own statement.
--
-- The one trap: do NOT blanket-set 'free'. If the account also holds a
-- real RevenueCat subscription, that would strip something they paid
-- for, and profiles.tier would then disagree with RevenueCat until the
-- next webhook event happened to fire. So the revoke drops to 'free'
-- ONLY where the current tier is still the granted 'lifetime', and it
-- is worth checking the RevenueCat dashboard for an active entitlement
-- on that email first.
--
-- Revoked 2026-08-16 — finlaycarsonm@gmail.com:
--
--   -- 1. Look before writing:
--   select u.email, p.tier, p.tier_updated_at
--   from public.profiles p join auth.users u on u.id = p.id
--   where lower(u.email) = 'finlaycarsonm@gmail.com';
--
--   -- 2. Revoke (no-op unless they are currently 'lifetime'):
--   update public.profiles p
--   set tier = 'free', tier_updated_at = now()
--   from auth.users u
--   where p.id = u.id
--     and lower(u.email) = 'finlaycarsonm@gmail.com'
--     and p.tier = 'lifetime';
--
--   -- 3. Confirm — expect tier = 'free':
--   select u.email, p.tier, p.tier_updated_at
--   from public.profiles p join auth.users u on u.id = p.id
--   where lower(u.email) = 'finlaycarsonm@gmail.com';
--
-- To reinstate: put the address back in `grantees` and re-run the
-- update at the top of this file. Nothing about the account's data is
-- touched by either direction — tier is a single column.
