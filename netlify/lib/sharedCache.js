/**
 * A short shared cache for answers that are the same for everyone
 * (item 91 — the global leaderboard first).
 *
 * Two layers, cheapest first:
 *
 *   1. Module scope (per warm function instance). Free. The CLAUDE.md
 *      pattern: a warm instance answers repeat views without the DB.
 *   2. One row in public.function_cache (supabase/retention_2026_10b.sql),
 *      so a COLD instance — or the fifth instance Netlify spun up under
 *      load — reads one small row instead of rebuilding the answer. The
 *      rebuild then happens at most about once per TTL across every
 *      instance, not once per instance.
 *
 * Layer 2 is optional and fails soft: until the SQL is run, the table is
 * missing, reads answer 404/400, and the cache quietly runs on layer 1
 * alone (a missing table is remembered for ten minutes so it costs one
 * request per instance per ten minutes, not one per view).
 *
 * Concurrent misses on one instance share a single build (in-flight
 * promise). Across instances two builds can overlap at the TTL edge;
 * that's a couple of extra reads, which is fine.
 *
 * A failed build serves the last good copy if it is under `maxStaleMs`
 * old, otherwise the error propagates — the caller decides what an
 * empty board looks like. Nothing here ever writes user data: the only
 * table touched is function_cache, keyed by a fixed string.
 *
 * Pure apart from the injected `store` and `now`, so efficiency.test.mjs
 * drives it offline.
 */

const sbKeys = require('./sbKeys');

function createSharedCache({ ttlMs, maxStaleMs = 30 * 60_000, now = () => Date.now() } = {}) {
  if (!(ttlMs > 0)) throw new Error('ttlMs required');
  const memo = new Map();      // key → { at, data }
  const inflight = new Map();  // key → Promise<{ data, at, source }>

  async function get(key, build, { store } = {}) {
    const t = now();
    const hit = memo.get(key);
    if (hit && t - hit.at < ttlMs) return { data: hit.data, at: hit.at, source: 'memory' };
    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
      if (store) {
        const row = await store.read(key).catch(() => null);
        if (row && row.data != null && now() - row.at < ttlMs && row.at <= now() + 60_000) {
          memo.set(key, { at: row.at, data: row.data });
          return { data: row.data, at: row.at, source: 'shared' };
        }
      }
      try {
        const data = await build();
        const at = now();
        memo.set(key, { at, data });
        if (store) await store.write(key, data, at).catch(() => null);
        return { data, at, source: 'built' };
      } catch (e) {
        const stale = memo.get(key);
        if (stale && now() - stale.at < maxStaleMs) return { data: stale.data, at: stale.at, source: 'stale' };
        throw e;
      }
    })();
    inflight.set(key, p);
    try { return await p; } finally { inflight.delete(key); }
  }

  /** Forget one key (or everything) on this instance. */
  function clear(key) { if (key == null) memo.clear(); else memo.delete(key); }

  return { get, clear, _memo: memo };
}

/**
 * Layer 2: public.function_cache through PostgREST with the service key.
 *   read(key)  → { at, data } | null
 *   write(key, data, at)
 * Never throws (both resolve null on any failure).
 */
const MISSING_BACKOFF_MS = 10 * 60_000;
function pgCacheStore({ supabaseUrl, serviceKey, table = 'function_cache', fetchImpl, now = () => Date.now() }) {
  const f = fetchImpl || ((...a) => fetch(...a));
  let missingUntil = 0;
  const base = `${supabaseUrl}/rest/v1/${table}`;
  const headers = (extra = {}) => sbKeys.serviceKeyHeaders(serviceKey, { 'Content-Type': 'application/json', ...extra });
  const missing = (status) => status === 404 || status === 400;

  return {
    async read(key) {
      if (now() < missingUntil) return null;
      try {
        const res = await f(`${base}?key=eq.${encodeURIComponent(key)}&select=payload,built_at&limit=1`, { headers: headers() });
        if (!res.ok) { if (missing(res.status)) missingUntil = now() + MISSING_BACKOFF_MS; return null; }
        const rows = await res.json();
        const r = Array.isArray(rows) ? rows[0] : null;
        if (!r || r.payload == null) return null;
        const at = Date.parse(r.built_at);
        return Number.isFinite(at) ? { at, data: r.payload } : null;
      } catch { return null; }
    },
    async write(key, data, at) {
      if (now() < missingUntil) return null;
      try {
        const res = await f(`${base}?on_conflict=key`, {
          method: 'POST',
          headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify({ key, payload: data, built_at: new Date(at).toISOString() }),
        });
        if (!res.ok && missing(res.status)) missingUntil = now() + MISSING_BACKOFF_MS;
        return null;
      } catch { return null; }
    },
  };
}

module.exports = { createSharedCache, pgCacheStore };
