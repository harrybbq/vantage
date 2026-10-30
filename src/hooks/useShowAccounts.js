import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { OWNER_SURFACES_IN_BUILD } from '../lib/native/ownerSurfaces';
import { useIsOwner } from './useIsOwner';

/**
 * useShowAccounts — may this view show Savings › Accounts?
 *
 * Accounts (`S.savingsAccounts`: balances, rates, drain order, which
 * account pays out a completed pot) are owner-only since 2026-10-29.
 * Everyone else gets pots, contributions and cash flow. This is a UI
 * gate, which is all it needs to be: nothing is private about a
 * user's own accounts, they are simply not part of the product for
 * anyone else. The data is never touched — see lib/savings/visibleAccounts.
 *
 * Native builds: false, folded at build time (OWNER_SURFACES_IN_BUILD),
 * and the Accounts panel itself is a lazy import behind the same flag,
 * so it is absent from the store binary rather than hidden in it.
 *
 * The savings surfaces are rendered from places that are not handed a
 * userId (the Achievements section, hub widget bodies, prime cards), so
 * the signed-in id is read from the auth client here. App's Board has
 * already asked `useIsOwner(userId)` by the time any of them mount, so
 * this is a cache hit, not a second round trip.
 */

let knownUid = null;
const listeners = new Set();

if (OWNER_SURFACES_IN_BUILD) {
  try {
    supabase.auth.onAuthStateChange((_event, session) => {
      const uid = (session && session.user && session.user.id) || null;
      if (uid === knownUid) return;
      knownUid = uid;
      listeners.forEach(fn => fn(uid));
    });
  } catch { /* no auth client: nobody is the owner */ }
}

function useSessionUserId() {
  const [uid, setUid] = useState(knownUid);
  useEffect(() => {
    if (!OWNER_SURFACES_IN_BUILD) return undefined;
    listeners.add(setUid);
    setUid(knownUid);
    return () => { listeners.delete(setUid); };
  }, []);
  return uid;
}

export function useShowAccounts() {
  const uid = useSessionUserId();
  const { isOwner } = useIsOwner(OWNER_SURFACES_IN_BUILD ? uid : null);
  return OWNER_SURFACES_IN_BUILD && isOwner;
}
