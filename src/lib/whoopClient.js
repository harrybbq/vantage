import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Client-side WHOOP sync: calls the whoop-sync function and merges the
 * returned vitals/burn into app state via update() — so the write flows
 * through the normal save pipeline + anti-wipe guards (no server/client
 * race). Shared by the manual Sync buttons and the passive auto-sync.
 */
export async function syncWhoop(update, days = 7) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/.netlify/functions/whoop-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ days }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'sync failed');
    err.reconnect = !!body.reconnect;
    // Record the failure so the panel can report it even when the
    // failing sync was the silent background one.
    update(prev => ({ ...prev, whoopLastError: { at: Date.now(), message: err.message, reconnect: err.reconnect } }));
    throw err;
  }

  update(prev => {
    const vitalsLog = { ...(prev.vitalsLog || {}) };
    let changed = false;
    for (const [d, v] of Object.entries(body.vitals || {})) {
      const before = prev.vitalsLog?.[d] || {};
      const merged = { ...before, ...v };
      if (Object.keys(merged).some(k => before[k] !== merged[k])) { vitalsLog[d] = merged; changed = true; }
    }
    const burnLog = { ...(prev.burnLog || {}) };
    for (const [d, entries] of Object.entries(body.burn || {})) {
      const others = (prev.burnLog?.[d] || []).filter(a => !String(a.id || '').startsWith('whoop-'));
      const next = [...others, ...entries];
      const before = prev.burnLog?.[d] || [];
      if (before.length !== next.length || JSON.stringify(before) !== JSON.stringify(next)) {
        burnLog[d] = next; changed = true;
      }
    }
    // Nothing new and nothing to clear → return prev UNCHANGED. This
    // used to build a fresh object every time, so opening or focusing
    // the app queued a save of the whole ~1MB state blob even when
    // WHOOP had returned exactly what we already had.
    if (!changed && prev.whoopConnected && !prev.whoopLastError) return prev;
    const next = { ...prev, vitalsLog, burnLog, whoopConnected: true };
    delete next.whoopLastError;
    return next;
  });

  return {
    vDays: Object.keys(body.vitals || {}).length,
    bDays: Object.keys(body.burn || {}).length,
    warnings: body.warnings || [],
  };
}

/**
 * Passive WHOOP auto-sync at the app level: fires whenever the web app
 * opens or regains focus, so vitals/burn stay fresh without visiting the
 * Track page. Throttled (default 10 min) so rapid tab-switching doesn't
 * hammer the endpoint. No-op unless the user is WHOOP-connected.
 */
export function useWhoopAutoSync(S, update, { throttleMs = 10 * 60 * 1000 } = {}) {
  const connected = !!S?.whoopConnected;
  const updateRef = useRef(update);
  updateRef.current = update;
  const lastRef = useRef(0);

  useEffect(() => {
    if (!connected) return undefined;
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRef.current < throttleMs) return;
      lastRef.current = now;
      // Still no toast — a background sync must not interrupt anyone —
      // but syncWhoop now records the failure in state, so the WHOOP
      // panel can show it instead of the user being left to infer a
      // broken connection from data that simply stopped moving.
      syncWhoop(updateRef.current, 7).catch(() => {});
    };
    run(); // on app open / when the connection becomes known
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [connected, throttleMs]);
}
