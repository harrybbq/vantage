import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { OWNER_SURFACES_IN_BUILD } from '../lib/native/ownerSurfaces';
import { isNativeApp } from '../lib/native/platform';

/**
 * useIsOwner
 *
 * Owner-only gate for features reserved to the app owner's account
 * (the Upgrade section, the Apple Health Shortcut panel, the admin
 * rating/coin editors).
 *
 * Asks the database: `is_app_owner()` is a SECURITY DEFINER function
 * that checks auth.uid() against `private.app_owner`, a table no client
 * can read (supabase/owner_content.sql). This used to compare the login
 * email with VITE_OWNER_EMAIL, which put the owner's address in the
 * public JS bundle for anyone to read.
 *
 * Usage:
 *   const { isOwner } = useIsOwner(userId);
 *
 * Still a UI gate and nothing more — anything that touches private
 * data or credentials must check the session server-side (see
 * netlify/functions/admin-set-rating.js). Any error, no session, or the
 * function missing → false, which hides the owner surfaces and changes
 * nothing for anyone else.
 *
 * Native never has an owner: flagged builds compile the surfaces out
 * (lib/native/ownerSurfaces.js), and an unflagged build running inside
 * the shell is caught by the runtime check. Either way nothing is
 * asked and no round trip is spent.
 */

// One answer per signed-in user per page load. The rpc is a single
// indexed lookup, but App mounts this on every boot and there is no
// reason to ask twice.
const cache = new Map();          // userId → boolean
const inflight = new Map();       // userId → Promise<boolean>

// Survives a reload within the tab, so the owner's nav doesn't flash
// without its Upgrade entry while the rpc is in flight. Per session
// only — a stale `true` can't outlive the tab, and it gates UI alone.
const SESSION_KEY = 'vb_is_owner';

function readSession(userId) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { u, v } = JSON.parse(raw);
    return u === userId ? !!v : null;
  } catch { return null; }
}

function writeSession(userId, v) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ u: userId, v: !!v })); } catch { /* private mode */ }
}

function askServer(userId) {
  if (inflight.has(userId)) return inflight.get(userId);
  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc('is_app_owner');
      return !error && data === true;
    } catch {
      return false;
    }
  })().then(v => {
    cache.set(userId, v);
    inflight.delete(userId);
    writeSession(userId, v);
    return v;
  });
  inflight.set(userId, p);
  return p;
}

export function useIsOwner(userId) {
  const allowed = OWNER_SURFACES_IN_BUILD && !isNativeApp();
  const [isOwner, setIsOwner] = useState(() => {
    if (!allowed || !userId) return false;
    if (cache.has(userId)) return cache.get(userId);
    return readSession(userId) || false;
  });

  useEffect(() => {
    if (!allowed || !userId) { setIsOwner(false); return undefined; }
    if (cache.has(userId)) { setIsOwner(cache.get(userId)); return undefined; }
    let live = true;
    askServer(userId).then(v => { if (live) setIsOwner(v); });
    return () => { live = false; };
  }, [userId, allowed]);

  return { isOwner: allowed && isOwner };
}
