/**
 * useLeaderboard — POSTs to /.netlify/functions/get-leaderboard with
 * the caller's Supabase JWT and returns the resulting board.
 *
 * Caches per `${scope}|${timeframe}` key for 60s in a module-scoped Map
 * (survives mounts/unmounts but resets on tab reload). `refresh()`
 * bypasses the cache. See docs/RANKING_SYSTEM.md for the trust note —
 * everything here reads server-derived profiles + snapshots; no local
 * derivation.
 */
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // key -> { ts, data }

export function useLeaderboard({ scope = 'friends', timeframe = 'alltime' } = {}) {
  const key = `${scope}|${timeframe}`;
  const cached = cache.get(key);
  const fresh = cached && (Date.now() - cached.ts) < CACHE_TTL_MS;
  const [data, setData] = useState(fresh ? cached.data : null);
  const [loading, setLoading] = useState(!fresh);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  const fetcher = useCallback(async (force) => {
    if (!force) {
      const c = cache.get(key);
      if (c && (Date.now() - c.ts) < CACHE_TTL_MS) {
        setData(c.data); setLoading(false); setError(null);
        return;
      }
    }
    setLoading(true); setError(null);
    try {
      const session = (await supabase.auth.getSession()).data?.session;
      const token = session?.access_token;
      if (!token) throw new Error('Not signed in.');
      const res = await fetch('/.netlify/functions/get-leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope, timeframe }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Leaderboard load failed.');
      const body = await res.json();
      cache.set(key, { ts: Date.now(), data: body });
      setData(body);
    } catch (e) {
      setError(e.message || 'Leaderboard load failed.');
    } finally {
      setLoading(false);
    }
  }, [key, scope, timeframe]);

  useEffect(() => { fetcher(false); }, [fetcher, tick]);

  const refresh = useCallback(() => setTick(t => t + 1), []);
  return { data, loading, error, refresh };
}
