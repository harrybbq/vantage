import { supabase } from '../supabase';
import { LEGACY_OWN_PROFILE_SELECT, LEGACY_PRESENCE_SELECT } from './profileColumns.js';

/**
 * Reads of profile fields that are NOT public (item 83).
 *
 * Your own row's private fields (tier, last_active_at, is_searchable,
 * leaderboard_optin, leaderboard_color, …) come from the `my_profile()`
 * RPC, and friends' last_active_at from `friend_presence()` — both
 * SECURITY DEFINER, both scoped to auth.uid() inside the database
 * (supabase/privacy_lockdown_2026_10b.sql).
 *
 * Fail soft, in both directions:
 *   · SQL not run yet → the RPC is missing → today's direct select,
 *     which works under today's table-wide grant. Remembered for the
 *     session so every call is not a wasted 404.
 *   · SQL run → the RPC answers and the direct select (which would now
 *     be refused) is never made.
 */

let ownRpcMissing = false;
let presenceRpcMissing = false;

/** PostgREST / Postgres "no such function". */
export function isMissingRpc(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === 'PGRST202' || code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(String(error.message || ''));
}

// One in-flight read shared by every surface that asks at mount
// (subscription, friends rail, settings, handle chip), then a short
// cache. Writes patch it (patchOwnProfileCache) so a save is visible
// without another round trip.
const OWN_TTL_MS = 30_000;
let ownCache = null; // { userId, at, row, promise }

async function fetchOwnRow(userId) {
  if (!ownRpcMissing) {
    const { data, error } = await supabase.rpc('my_profile');
    if (!error) return (data && typeof data === 'object') ? data : null;
    if (!isMissingRpc(error)) throw error;
    ownRpcMissing = true;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select(LEGACY_OWN_PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Your own profile row, every column, or null when no row exists yet.
 * Throws on a real error (callers already handle that as "unavailable").
 */
export async function loadOwnProfile(userId, { fresh = false } = {}) {
  if (!userId) return null;
  const now = Date.now();
  if (!fresh && ownCache && ownCache.userId === userId) {
    if (ownCache.promise) return ownCache.promise;
    if (now - ownCache.at < OWN_TTL_MS) return ownCache.row;
  }
  const promise = fetchOwnRow(userId);
  ownCache = { userId, at: now, row: null, promise };
  try {
    const row = await promise;
    if (ownCache?.promise === promise) ownCache = { userId, at: Date.now(), row, promise: null };
    return row;
  } catch (e) {
    if (ownCache?.promise === promise) ownCache = null;
    throw e;
  }
}

/** Merge a successful write into the cache (no-op when nothing cached). */
export function patchOwnProfileCache(userId, patch) {
  if (!ownCache || ownCache.userId !== userId || ownCache.promise || !patch) return;
  ownCache = { ...ownCache, row: { ...(ownCache.row || { id: userId }), ...patch } };
}

/**
 * Map of friend id → last_active_at for the given ids. Only accepted
 * friends come back from the RPC (strangers' presence is not readable);
 * anything missing is simply "no presence" — the rail shows offline.
 * Never throws: presence is decoration.
 */
export async function loadFriendPresence(ids) {
  const out = new Map();
  if (!ids || ids.length === 0) return out;
  try {
    if (!presenceRpcMissing) {
      const { data, error } = await supabase.rpc('friend_presence');
      if (!error) {
        const want = new Set(ids);
        for (const r of data || []) if (want.has(r.id)) out.set(r.id, r.last_active_at || null);
        return out;
      }
      if (!isMissingRpc(error)) return out;
      presenceRpcMissing = true;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select(LEGACY_PRESENCE_SELECT)
      .in('id', ids);
    if (error) return out;
    for (const r of data || []) out.set(r.id, r.last_active_at || null);
  } catch { /* offline: no presence */ }
  return out;
}

/** Tests only. */
export function _resetProfileReads() {
  ownRpcMissing = false;
  presenceRpcMissing = false;
  ownCache = null;
}
