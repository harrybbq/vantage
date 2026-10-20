/**
 * A durable per-user, per-day cap for a non-AI bucket.
 *
 * Same mechanism as aiQuota.js (the `ai_usage_bump` RPC from
 * supabase/audit_schema_2026_10.sql: atomic increment of today's row for
 * (user, bucket), service role only) — that table is keyed by a free-text
 * bucket, so it carries any daily counter, not only AI spend. Kept apart
 * from aiQuota's DAILY_CAPS because the security sweep reads those as AI
 * caps; an unknown bucket is ignored there.
 *
 * Fail soft exactly like aiQuota: RPC missing or unreachable → a
 * per-instance daily counter with the same cap (never weaker than the
 * in-memory brakes that came before, never an outage). A missing RPC is
 * remembered for ten minutes.
 */
const { serviceKey, serviceKeyHeaders } = require('./sbKeys');

const MISSING_RETRY_MS = 10 * 60_000;
let rpcMissingUntil = 0;
const LOCAL = new Map();

function localBump(bucket, userId, cap) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${bucket}:${userId}`;
  const e = LOCAL.get(key);
  const next = e && e.day === day ? { day, n: e.n + 1 } : { day, n: 1 };
  LOCAL.set(key, next);
  if (LOCAL.size > 5000) {
    for (const [k, v] of LOCAL) if (v.day !== day) LOCAL.delete(k);
  }
  return next.n <= cap;
}

/** → true while `userId` is within today's `cap` for `bucket`. */
async function withinDailyCap(bucket, userId, cap, env = process.env, fetchImpl = fetch) {
  if (!bucket || !userId || !(cap > 0)) return false;
  const url = env.SUPABASE_URL;
  const key = serviceKey(env);
  if (!url || !key || Date.now() < rpcMissingUntil) return localBump(bucket, userId, cap);
  try {
    const res = await fetchImpl(`${url}/rest/v1/rpc/ai_usage_bump`, {
      method: 'POST',
      headers: serviceKeyHeaders(key, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_user: userId, p_bucket: bucket, p_limit: cap }),
    });
    if (res.status === 404 || res.status === 400) {
      rpcMissingUntil = Date.now() + MISSING_RETRY_MS;
      return localBump(bucket, userId, cap);
    }
    if (!res.ok) {
      console.error('dailyCap: rpc failed', res.status);
      return localBump(bucket, userId, cap);
    }
    return (await res.json()) === true;
  } catch (e) {
    console.error('dailyCap: rpc unreachable', e?.message);
    return localBump(bucket, userId, cap);
  }
}

module.exports = { withinDailyCap };
