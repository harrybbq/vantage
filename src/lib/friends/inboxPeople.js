import { supabase } from '../supabase';

/**
 * Facts the inbox needs about conversation partners that the friend list
 * does not carry: who I have blocked, who is suspended, and a name for
 * someone who is no longer a friend (profiles RLS still lets you read a
 * row you share a friendship with, and searchable rows; anything else
 * comes back missing and the row says "Former friend").
 *
 * Two small queries, cached at module scope for five minutes so opening
 * and closing the Messages tab does not re-ask. Both fail soft — a
 * missing column (suspended_at arrives with the audit SQL) is retried
 * without it, and any other error simply yields no facts.
 */
const TTL = 5 * 60_000;
const people = new Map();      // id → { at, row }
let blockedCache = null;       // { at, userId, set }

async function fetchProfiles(ids) {
  const run = cols => supabase.from('profiles').select(cols).in('id', ids);
  let { data, error } = await run('id, handle, display_name, avatar_url, suspended_at');
  if (error) ({ data, error } = await run('id, handle, display_name, avatar_url'));
  return error ? [] : (data || []);
}

export async function loadPartnerFacts(userId, ids) {
  const now = Date.now();
  const want = [...new Set(ids || [])].filter(id => id && !(people.get(id)?.at > now - TTL));
  const tasks = [];
  if (want.length) {
    tasks.push(fetchProfiles(want.slice(0, 100)).then(rows => {
      const got = new Set();
      for (const r of rows) { people.set(r.id, { at: now, row: r }); got.add(r.id); }
      // Remember misses too, so an unreadable profile is not re-asked
      // every time the tab opens.
      for (const id of want) if (!got.has(id)) people.set(id, { at: now, row: null });
    }).catch(() => {}));
  }
  if (!blockedCache || blockedCache.userId !== userId || blockedCache.at < now - TTL) {
    tasks.push(Promise.resolve(supabase.from('blocks').select('blocked_id').eq('blocker_id', userId))
      .then(({ data, error }) => {
        blockedCache = { at: now, userId, set: new Set(error ? [] : (data || []).map(r => r.blocked_id)) };
      })
      .catch(() => { blockedCache = { at: now, userId, set: new Set() }; }));
  }
  await Promise.all(tasks);
  const out = {};
  for (const id of ids || []) { const r = people.get(id)?.row; if (r) out[id] = r; }
  return { people: out, blocked: blockedCache?.set || new Set() };
}

/** Forget cached block state — after blocking someone from a thread. */
export function invalidatePartnerFacts() { blockedCache = null; }
