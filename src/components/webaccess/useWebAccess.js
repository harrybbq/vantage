import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativeApp } from '../../lib/native/platform';
import { useIsOwner } from '../../hooks/useIsOwner';
import { decideWebAccess, latchDecision } from '../../lib/webAccess';
import {
  loadWebAccessMode, peekWebAccessMode, onWebAccessMode, checkWebAccessAllowed,
} from '../../lib/webAccessClient';

/**
 * App's view of the web gate (item 131): which screen this visitor gets.
 * See lib/webAccess.js for the rules. Native: always 'full', no requests.
 *
 * Returns { decision, mode, retry } — `retry` re-asks web_access_allowed()
 * (the gate page's "Check again", e.g. right after the owner adds you).
 */
export function useWebAccess({ session, publicRoute = false }) {
  const native = isNativeApp();
  const userId = session?.user?.id || null;
  const signedIn = !!session;
  const [mode, setMode] = useState(() => (native ? 'open' : peekWebAccessMode()));
  const [allowed, setAllowed] = useState(undefined);
  const [nonce, setNonce] = useState(0);
  const { isOwner } = useIsOwner(native ? null : userId);

  useEffect(() => {
    if (native) return undefined;
    const off = onWebAccessMode(setMode);
    loadWebAccessMode().then(setMode);
    return off;
  }, [native]);

  useEffect(() => {
    if (native || !userId || mode !== 'allowlist') { setAllowed(undefined); return undefined; }
    let live = true;
    setAllowed(undefined);
    checkWebAccessAllowed(userId, { force: nonce > 0 }).then(v => { if (live) setAllowed(v); });
    return () => { live = false; };
  }, [native, userId, mode, nonce]);

  const raw = decideWebAccess({ native, publicRoute, mode, signedIn, owner: isOwner, allowed });

  // Once the app has mounted for this user it stays mounted this page
  // load (latchDecision). Recorded in an effect, read on the next render.
  const latched = useRef(null);
  const decision = latchDecision(raw, { signedIn, userId, latchedUser: latched.current });
  useEffect(() => {
    if (decision === 'full' && signedIn && userId) latched.current = userId;
  }, [decision, signedIn, userId]);

  const retry = useCallback(() => setNonce(n => n + 1), []);
  return { decision, mode, retry };
}
