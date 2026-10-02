/**
 * Load one console panel, keep the last good answer while a refresh is
 * in flight (a refresh never blanks the screen), and optionally poll —
 * only while the document is visible, and immediately on coming back.
 *
 * Polling is a timeout re-armed after every load (manual or automatic),
 * so `updatedAt + pollMs` is exactly when the next one happens — which
 * is what the Overview's "next in 54s" countdown shows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPanel } from '../../../lib/security/api';

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export function usePanel(panel, { params, pollMs = 0 } = {}) {
  const [res, setRes] = useState(null);          // readPanel result
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const key = JSON.stringify(params || {});
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const out = await fetchPanel(panel, JSON.parse(key));
    if (mine !== seq.current) return;              // a newer load superseded this one
    setRes(prev => (out.state === 'error' && prev && prev.state === 'ok') ? { ...prev, staleError: out.error } : out);
    setUpdatedAt(Date.now());
    setLoading(false);
  }, [panel, key]);

  useEffect(() => { load(); }, [load]);

  // Re-arm after each load.
  useEffect(() => {
    if (!pollMs || !updatedAt || !visible()) return undefined;
    const t = setTimeout(() => { if (visible()) load(); }, Math.max(0, updatedAt + pollMs - Date.now()));
    return () => clearTimeout(t);
  }, [load, pollMs, updatedAt]);

  // Hidden → the timeout above is simply not re-armed; back → load now.
  useEffect(() => {
    if (!pollMs) return undefined;
    const onVis = () => { if (visible()) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load, pollMs]);

  /** Patch the loaded data in place (optimistic updates after an action). */
  const patch = useCallback(fn => {
    setRes(prev => (prev && prev.state === 'ok' ? { ...prev, data: fn(prev.data) } : prev));
  }, []);

  return { res, loading, updatedAt, reload: load, patch };
}
