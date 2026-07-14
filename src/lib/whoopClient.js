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
  if (!res.ok) throw new Error(body.error || 'sync failed');
  update(prev => {
    const vitalsLog = { ...(prev.vitalsLog || {}) };
    for (const [d, v] of Object.entries(body.vitals || {})) vitalsLog[d] = { ...(vitalsLog[d] || {}), ...v };
    const burnLog = { ...(prev.burnLog || {}) };
    for (const [d, entries] of Object.entries(body.burn || {})) {
      const others = (burnLog[d] || []).filter(a => !String(a.id || '').startsWith('whoop-'));
      burnLog[d] = [...others, ...entries];
    }
    return { ...prev, vitalsLog, burnLog, whoopConnected: true };
  });
  return {
    vDays: Object.keys(body.vitals || {}).length,
    bDays: Object.keys(body.burn || {}).length,
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
