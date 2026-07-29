import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Client-side Oura sync, mirroring whoopClient. Calls the oura-sync
 * function and merges the returned vitals/burn into app state via
 * update() — so the write flows through the normal save pipeline +
 * anti-wipe guards (no server/client race). Shared by the manual Sync
 * buttons and the passive auto-sync.
 */
export async function syncOura(update, days = 7) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/.netlify/functions/oura-sync', {
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
      // Only ever replaces this device's own entries — a user with both
      // an Oura and a WHOOP keeps both sets of workouts.
      const others = (burnLog[d] || []).filter(a => !String(a.id || '').startsWith('oura-'));
      burnLog[d] = [...others, ...entries];
    }
    return { ...prev, vitalsLog, burnLog, ouraConnected: true };
  });
  return {
    vDays: Object.keys(body.vitals || {}).length,
    bDays: Object.keys(body.burn || {}).length,
  };
}

/**
 * Passive Oura auto-sync at the app level: fires whenever the web app
 * opens or regains focus, so vitals/burn stay fresh without visiting the
 * Track page. Throttled (default 10 min) so rapid tab-switching doesn't
 * hammer the endpoint. No-op unless the user is Oura-connected.
 */
export function useOuraAutoSync(S, update, { throttleMs = 10 * 60 * 1000 } = {}) {
  const connected = !!S?.ouraConnected;
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
      syncOura(updateRef.current, 7).catch(() => {});
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

/**
 * Withdraw consent for a wearable: deletes the stored OAuth tokens
 * server-side and clears the connected flag locally. Synced vitals stay
 * — disconnecting stops future syncing, it doesn't retract history.
 * Shared by both the Oura and WHOOP panels.
 */
export async function disconnectWearable(update, provider) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/.netlify/functions/wearable-disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ provider }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'disconnect failed');
  const flag = provider === 'oura' ? 'ouraConnected' : 'whoopConnected';
  update(prev => ({ ...prev, [flag]: false }));
}
