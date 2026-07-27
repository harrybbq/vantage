import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  initRevenueCat,
  loginRevenueCat,
  getCustomerInfo,
  deriveTierFromEntitlements,
  derivePlanFromEntitlements,
  isAvailable as rcIsAvailable,
} from '../lib/billing/revenuecat';

/**
 * Reads tier from `profiles.tier` (Supabase) as the canonical source
 * of truth. On native platforms with RevenueCat configured, ALSO reads
 * the platform's CustomerInfo and reconciles upward — if the user
 * paid on iOS / Android but the webhook hasn't yet synced into
 * profiles.tier, we still know they're Pro on this device.
 *
 * The reconciliation is one-way: RC can upgrade us in-memory, but we
 * never demote a user whose profiles.tier says they're Pro. That keeps
 * lifetime / promo grants safe even if RC entitlements briefly fail.
 */
export function useSubscription(userId) {
  const [tier, setTier] = useState('free');
  // proPlan = 'monthly' | 'annual' | 'lifetime' | null. Independent of
  // `tier` so a free user is null but a pro user can be either monthly
  // or annual (drives the migration banner + plan label in Settings).
  const [proPlan, setProPlan] = useState(null);
  const [proIsLive, setProIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      // Fetch both Supabase reads in parallel
      const [profileResult, configResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('tier')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('config')
          .select('value')
          .eq('key', 'pro_live')
          .maybeSingle(),
      ]);
      if (cancelled) return;

      let dbTier = 'free';
      if (!profileResult.data) {
        // Insert the id ONLY. `tier` is server-owned — the column grant
        // in supabase/profiles_column_lockdown.sql withholds it from
        // the client, so naming it here would make first login fail
        // with "permission denied for column tier". The column default
        // is 'free', which is what we wanted anyway.
        await supabase
          .from('profiles')
          .insert({ id: userId })
          .single();
      } else {
        dbTier = profileResult.data.tier || 'free';
      }
      setTier(dbTier);

      if (configResult.data) {
        setProIsLive(configResult.data.value === 'true');
      }

      setLoading(false);

      // ── RevenueCat reconcile (native only, no-op on web) ──
      // Fire-and-forget. Init the SDK with our userId so RC can
      // attribute purchases on this device. If their CustomerInfo
      // shows a Pro entitlement we don't yet know about (e.g. they
      // bought on phone, signed in on web), upgrade in-memory.
      try {
        await initRevenueCat({ userId });
        if (!(await rcIsAvailable())) return;
        // Attribute future purchases to this Supabase user so a device
        // signed into multiple accounts doesn't cross-contaminate.
        // Returns the post-login CustomerInfo, saving us a separate
        // getCustomerInfo round-trip.
        const loginInfo = await loginRevenueCat(userId);
        const info = loginInfo || await getCustomerInfo();
        if (cancelled || !info) return;
        const rcTier = deriveTierFromEntitlements(info.entitlements?.active);
        if (rcTier !== 'free' && dbTier === 'free') {
          // RC says Pro but DB says free — trust RC for this session.
          // The webhook → profiles.tier sync will catch up server-side
          // (or we surface a "Restore purchases" prompt if not).
          setTier(rcTier);
        }
        // Plan is always derived from RC (DB only stores tier, not plan)
        // so this runs regardless of which side wins on tier itself.
        const rcPlan = derivePlanFromEntitlements(info.entitlements?.active);
        if (rcPlan) setProPlan(rcPlan);
      } catch {
        // Silent — RC is an enhancement, never a blocker
      }
    }

    load();
    return () => { cancelled = true; };
  }, [userId]);

  const isPro = tier === 'pro';
  const isLifetime = tier === 'lifetime';

  // Lifetime users get proPlan='lifetime' even if RC didn't surface
  // it explicitly — keeps the Settings label honest.
  const effectivePlan = proPlan || (isLifetime ? 'lifetime' : null);

  return {
    tier,
    isPro,
    isLifetime,
    isFree: tier === 'free',
    // hasPro = "has Pro-level entitlements regardless of how they got
    // them (active sub OR lifetime purchase)". Prefer this for any new
    // gate so lifetime users never get silently locked out.
    hasPro: isPro || isLifetime,
    // proPlan distinguishes monthly vs annual within the pro tier.
    // null = free user OR pro user whose plan can't be determined yet.
    // Drives the migration banner and the plan label in Settings.
    proPlan: effectivePlan,
    isMonthly: effectivePlan === 'monthly',
    isAnnual:  effectivePlan === 'annual',
    proIsLive,
    loading,
  };
}
