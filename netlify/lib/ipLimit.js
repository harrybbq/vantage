/**
 * Per-IP limits for the open endpoints (item 95): weather, client-error,
 * vitals-beacon.
 *
 * Module scope, so per warm function instance — a brake, not a wall
 * (concurrency multiplies it; item 86's Netlify rate-limit rule is the
 * wall). Each limiter is a set of fixed windows, e.g. 30 a minute AND
 * 200 an hour; a hit counts against every window and is refused if any
 * is full. Refused hits still count, so a flood stays refused until its
 * window rolls over.
 *
 * Memory is bounded: past `maxKeys` entries, expired ones are swept, and
 * if that isn't enough the oldest are dropped (a dropped key starts
 * again from zero — fail open, never fail the caller).
 *
 * Pure apart from `now`, so efficiency.test.mjs drives it with a fake clock.
 */

function createIpLimiter(windows, { maxKeys = 5000, now = () => Date.now() } = {}) {
  const wins = (Array.isArray(windows) ? windows : [windows])
    .map(w => ({ ms: Number(w.ms), max: Number(w.max) }))
    .filter(w => w.ms > 0 && w.max > 0);
  if (!wins.length) throw new Error('createIpLimiter: at least one { ms, max } window');
  const longest = Math.max(...wins.map(w => w.ms));
  const hits = new Map(); // key → { seen, slots: [{ t, n }] }

  function sweep(t) {
    for (const [k, v] of hits) if (t - v.seen > longest) hits.delete(k);
    if (hits.size > maxKeys) {
      const drop = hits.size - maxKeys;
      let i = 0;
      for (const k of hits.keys()) { if (i++ >= drop) break; hits.delete(k); }
    }
  }

  /** Count one hit for `key`. → { allowed, counts } */
  function hit(key) {
    const t = now();
    const k = String(key || 'unknown');
    let e = hits.get(k);
    if (!e) {
      e = { seen: t, slots: wins.map(() => ({ t, n: 0 })) };
      hits.set(k, e);
      if (hits.size > maxKeys) sweep(t);
    }
    e.seen = t;
    let allowed = true;
    const counts = wins.map((w, i) => {
      const s = e.slots[i];
      if (t - s.t >= w.ms) { s.t = t; s.n = 0; }
      s.n++;
      if (s.n > w.max) allowed = false;
      return s.n;
    });
    return { allowed, counts };
  }

  /** Current count in window `i` without counting a hit (0 if unseen/expired). */
  function peek(key, i = 0) {
    const e = hits.get(String(key || 'unknown'));
    if (!e) return 0;
    const s = e.slots[i];
    return now() - s.t >= wins[i].ms ? 0 : s.n;
  }

  return { hit, peek, size: () => hits.size };
}

/**
 * The caller's IP as Netlify reports it. `x-nf-client-connection-ip` is
 * set by Netlify's edge and is the one to trust; x-forwarded-for's first
 * entry is the fallback (it can be client-supplied, so it only ever
 * feeds a rate limit, never an access decision).
 */
function clientIp(event) {
  const h = (event && event.headers) || {};
  const ip = h['x-nf-client-connection-ip']
    || String(h['x-forwarded-for'] || '').split(',')[0];
  return String(ip || '').trim().slice(0, 64) || 'unknown';
}

module.exports = { createIpLimiter, clientIp };
