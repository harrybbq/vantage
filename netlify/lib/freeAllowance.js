/**
 * Weekly free allowances for paid AI features — "3 free AI food scans a
 * week, unlimited on Pro".
 *
 * The count comes from the same `ai_usage` rows the daily cap writes
 * (aiQuota.js: one row per user, bucket and UTC day), summed over the
 * current week. So there is no new table and no second counter to keep
 * in step: a scan is counted once, by `withinDailyAiCap`, and this only
 * reads.
 *
 * The week is Monday 00:00 to Sunday 23:59 UTC — fixed, so "resets on
 * Monday" is a promise the UI can print, rather than a rolling 7 days
 * whose reset moves with every scan.
 *
 * Tier comes from the server-owned `profiles.tier` (never the client),
 * the same column ai-coach-daily trusts.
 *
 * ── Fail soft ────────────────────────────────────────────────────────
 * If the usage rows can't be read (SQL not run, Supabase blip), the
 * count falls back to a per-instance weekly counter — exactly the
 * pattern aiQuota uses. Never "unlimited", never an outage of the scan.
 * A tier lookup that fails counts as free: the free path still works,
 * it just has the allowance.
 */

const FREE_WEEKLY = {
  'food-detect': 3,
};

const DAY_MS = 86400000;

/** 'YYYY-MM-DD' of the Monday (UTC) starting the week `now` is in. */
function weekStartIso(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7;               // Monday → 0 … Sunday → 6
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' of the next Monday (UTC) — when the allowance refills. */
function resetsOnIso(now = new Date()) {
  const start = Date.parse(weekStartIso(now) + 'T00:00:00Z');
  return new Date(start + 7 * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The decision, pure. `used` may be null (count unknown) — then the
 * caller has already substituted the fallback count, so null here only
 * happens in tests and is treated as zero used.
 * → { allowed, left, limit }
 */
function decide({ paid, used, limit }) {
  if (paid) return { allowed: true, left: null, limit: null };
  const n = Math.max(0, Number(used) || 0);
  const left = Math.max(0, limit - n);
  return { allowed: left > 0, left, limit };
}

// Fallback: per-instance weekly counters, keyed bucket:user.
const LOCAL = new Map();
function localUsed(bucket, userId, week) {
  const e = LOCAL.get(`${bucket}:${userId}`);
  return e && e.week === week ? e.n : 0;
}
function localAdd(bucket, userId, week) {
  const key = `${bucket}:${userId}`;
  const e = LOCAL.get(key);
  LOCAL.set(key, e && e.week === week ? { week, n: e.n + 1 } : { week, n: 1 });
  if (LOCAL.size > 5000) {
    for (const [k, v] of LOCAL) if (v.week !== week) LOCAL.delete(k);
  }
}

/**
 * How many times `userId` used `bucket` this week, from ai_usage.
 * → { used, source: 'db' | 'local' }
 */
async function usedThisWeek(bucket, userId, now = new Date(), fetchImpl = fetch) {
  const week = weekStartIso(now);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { used: localUsed(bucket, userId, week), source: 'local' };
  try {
    const q = `${url}/rest/v1/ai_usage?select=n&user_id=eq.${encodeURIComponent(userId)}`
      + `&bucket=eq.${encodeURIComponent(bucket)}&day=gte.${week}`;
    const res = await fetchImpl(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) return { used: localUsed(bucket, userId, week), source: 'local' };
    const rows = await res.json();
    const used = Array.isArray(rows) ? rows.reduce((s, r) => s + (Number(r && r.n) || 0), 0) : 0;
    return { used, source: 'db' };
  } catch {
    return { used: localUsed(bucket, userId, week), source: 'local' };
  }
}

/** Record one use in the fallback counter (the DB row is bumped by aiQuota). */
function noteLocalUse(bucket, userId, now = new Date()) {
  localAdd(bucket, userId, weekStartIso(now));
}

/** Pro/lifetime from the server-owned profiles.tier. Fails to "free". */
async function isPaidUser(userId, fetchImpl = fetch) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !userId) return false;
  try {
    const res = await fetchImpl(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=tier`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return false;
    const tier = (await res.json())[0]?.tier;
    return tier === 'pro' || tier === 'lifetime';
  } catch {
    return false;
  }
}

module.exports = {
  FREE_WEEKLY, weekStartIso, resetsOnIso, decide, usedThisWeek, noteLocalUse, isPaidUser,
  _resetLocal: () => LOCAL.clear(),
};
