/**
 * The one place the client talks to the groups function.
 *
 * Lifted out of useGroups so a caller that only wants to ACT — joining
 * from an invite in a direct message, say — does not have to mount the
 * hook and pull down a whole league board to do it.
 *
 * The cache lives here too, for the same reason: a join made from a
 * message thread has to invalidate the board the leaderboard is holding,
 * and it can only do that if there is one cache rather than two.
 */
import { supabase } from '../supabase';

export const CACHE_TTL_MS = 45_000;

/** division key -> { ts, data }. Shared with useGroups. */
export const boardCache = new Map();

export function clearGroupsCache() { boardCache.clear(); }

export async function callGroups(payload) {
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

/**
 * Join by code, without loading a board first.
 *
 * The server is the only thing that decides whether a code is real,
 * whether the group has a seat left, and whether the joiner is already
 * in a group — so this sends the code and reports back what it says.
 */
export async function joinByCode(code) {
  const out = await callGroups({ action: 'join', code: String(code || '').trim() });
  clearGroupsCache();
  return out;
}

