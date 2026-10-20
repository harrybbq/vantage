import { supabase } from '../supabase';
import { sortNotices } from '../moderation/notices.js';

/**
 * The signed-in account's own safety state (STARTUP_REQUIREMENTS items
 * 110, 111): is it suspended, and what notices are waiting.
 *
 *   my_safety_status()   definer RPC → { suspended, suspended_at }
 *   safety_notices       own rows only (RLS); the app may stamp read_at
 *
 * Both arrive with supabase/safety_2026_10b.sql. Until then every read
 * here answers "not suspended, no notices" — the database still refuses
 * a suspended account's sends once the SQL is in, and nothing here can
 * make the app worse than it was.
 *
 * Cheap on purpose (Micro-level DB rule): one small RPC and one indexed
 * read, cached at module scope for a minute and shared by every caller
 * (the friends rail, an open conversation), refreshed when the tab comes
 * back into view — never polled.
 */
const TTL = 60_000;
const NOTICE_LIMIT = 20;

let cache = { userId: null, at: 0, value: null, inflight: null };
const listeners = new Set();

const EMPTY = Object.freeze({ suspended: false, suspendedAt: null, notices: [] });

async function fetchState(userId) {
  let suspended = false;
  let suspendedAt = null;
  try {
    const { data, error } = await supabase.rpc('my_safety_status');
    if (!error && data && typeof data === 'object') {
      suspended = data.suspended === true;
      suspendedAt = data.suspended_at || null;
    }
  } catch { /* not installed / offline: not suspended */ }

  let notices = [];
  try {
    const { data, error } = await supabase
      .from('safety_notices')
      .select('id, kind, meta, created_at, read_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(NOTICE_LIMIT);
    if (!error) notices = sortNotices(data || []);
  } catch { /* not installed / offline: none */ }

  return { suspended, suspendedAt, notices };
}

function publish(value) {
  for (const fn of listeners) { try { fn(value); } catch { /* listener's problem */ } }
}

/** Current state, from cache when fresh. Never throws. */
export async function loadSafety(userId, { force = false } = {}) {
  if (!userId) return EMPTY;
  const now = Date.now();
  if (cache.userId === userId && cache.value && !force && now - cache.at < TTL) return cache.value;
  if (cache.userId === userId && cache.inflight) return cache.inflight;
  const p = fetchState(userId).then((value) => {
    cache = { userId, at: Date.now(), value, inflight: null };
    publish(value);
    return value;
  }).catch(() => {
    cache = { ...cache, inflight: null };
    return cache.value || EMPTY;
  });
  cache = { userId, at: cache.userId === userId ? cache.at : 0, value: cache.userId === userId ? cache.value : null, inflight: p };
  return p;
}

/** Last known state without a fetch (EMPTY until the first load). */
export function peekSafety(userId) {
  return cache.userId === userId && cache.value ? cache.value : EMPTY;
}

export function onSafety(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The server just told us (a refused send) — show the banner now. */
export function noteSuspended(userId) {
  if (!userId) return;
  const prev = peekSafety(userId);
  if (prev.suspended) return;
  const value = { ...prev, suspended: true, suspendedAt: prev.suspendedAt || new Date().toISOString() };
  cache = { userId, at: Date.now(), value, inflight: null };
  publish(value);
}

/** Stamp notices read. Optimistic; a failure just leaves them unread. */
export async function markNoticesRead(userId, ids) {
  const list = (ids || []).filter(id => id != null);
  if (!userId || !list.length) return;
  const stamp = new Date().toISOString();
  const prev = peekSafety(userId);
  const value = { ...prev, notices: sortNotices(prev.notices.map(n => (list.includes(n.id) && !n.read_at ? { ...n, read_at: stamp } : n))) };
  cache = { ...cache, userId, value };
  publish(value);
  try {
    await supabase.from('safety_notices').update({ read_at: stamp }).in('id', list).is('read_at', null);
  } catch { /* stays unread next load */ }
}
