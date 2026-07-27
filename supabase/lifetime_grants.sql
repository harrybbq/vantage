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
-- Both accounts must have signed in at least once, or there is no
-- auth.users row to match and the update quietly affects 0 rows (the
-- verification query at the bottom will show that).

with grantees(email) as (
  values
    ('harrym3002@outlook.com'),
    ('anotherone650@gmail.com')        
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
where lower(u.email) in ('harrym3002@outlook.com', 'anotherone650@gmail.com');

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
