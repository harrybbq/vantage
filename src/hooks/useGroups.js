/**
 * useGroups — the group league board, and the actions that change it.
 *
 * Same shape and the same trust boundary as useLeaderboard: the server
 * assembles the table from profiles it reads itself, and the client
 * renders what it is given. Nothing here derives a score.
 *
 * `setup: false` in the response means groups_schema.sql has not been
 * run on this project yet. That is a state, not an error — the tab says
 * so and the rest of the leaderboard carries on.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const CACHE_TTL_MS = 45_000;
const cache = new Map(); // division -> { ts, data }

async function call(payload) {
  const session = (await supabase.auth.getSession()).data?.session;
  const token = session?.access_token;
  if (!token) throw new Error('Not signed in.');
  const res = await fetch('/.netlify/functions/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

export function useGroups(division = null) {
  const key = String(division ?? 'mine');
  const cached = cache.get(key);
  const fresh = cached && (Date.now() - cached.ts) < CACHE_TTL_MS;
  const [data, setData] = useState(fresh ? cached.data : null);
  const [loading, setLoading] = useState(!fresh);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async (force) => {
    if (!force) {
      const c = cache.get(key);
      if (c && (Date.now() - c.ts) < CACHE_TTL_MS) { setData(c.data); setLoading(false); return; }
    }
    setLoading(true); setError(null);
    try {
      const body = await call(division ? { action: 'board', division } : { action: 'board' });
      cache.set(key, { ts: Date.now(), data: body });
      setData(body);
    } catch (e) {
      setError(e.message || 'Could not load your group.');
    } finally {
      setLoading(false);
    }
  }, [key, division]);

  useEffect(() => { load(false); }, [load, tick]);

  /** Any write invalidates every cached division — a join changes a
   *  member count in one table and a score in another. */
  const act = useCallback(async (payload) => {
    const out = await call(payload);
    cache.clear();
    setTick(t => t + 1);
    return out;
  }, []);

  return {
    data, loading, error,
    refresh: () => { cache.clear(); setTick(t => t + 1); },
    createGroup: (name, crestColor) => act({ action: 'create', name, crestColor }),
    joinGroup: code => act({ action: 'join', code }),
    leaveGroup: () => act({ action: 'leave' }),
    renameGroup: (name, crestColor) => act({ action: 'rename', name, crestColor }),
    rotateCode: () => act({ action: 'rotateCode' }),
    kickMember: userId => act({ action: 'kick', userId }),
  };
}
