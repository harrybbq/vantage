/**
 * Who is suspended — the set every public surface filters out.
 *
 * profiles.suspended_at is server-owned (set only by the moderation
 * function) and lands with supabase/audit_schema_2026_10.sql. A
 * suspended user disappears from the leaderboards, trending and group
 * boards; their own data is untouched.
 *
 * Read as ONE small query for the whole set rather than a filter on
 * each board's own query: a `suspended_at=is.null` in those would turn
 * every board into a 400 until the column exists. Here a 400/404 just
 * means "nobody is suspended". Cached for a few minutes in module scope
 * — the list is tiny and changes rarely, and Micro pays for every read.
 */
const TTL_MS = 5 * 60_000;
let cache = { at: 0, ids: new Set() };

async function suspendedIds({ supabaseUrl, serviceKey }) {
  if (Date.now() - cache.at < TTL_MS) return cache.ids;
  let ids = new Set();
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/profiles?suspended_at=not.is.null&select=id&limit=5000`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (res.ok) ids = new Set((await res.json()).map(r => r.id));
    // 400/404 = column not there yet: nobody is suspended. Anything else
    // is transient — keep serving the last good set rather than none.
    else if (res.status !== 400 && res.status !== 404) return cache.ids;
  } catch {
    return cache.ids;
  }
  cache = { at: Date.now(), ids };
  return ids;
}

/** For the moderation function: forget the cache after a suspension. */
function invalidateSuspended() { cache = { at: 0, ids: cache.ids }; }

module.exports = { suspendedIds, invalidateSuspended };
