/**
 * A durable daily cap on AI spend, per user and per feature.
 *
 * requireUser's `underLimit` is per-minute and per-lambda-instance: a
 * brake, not a cap. Concurrency multiplies it and nothing survives a
 * cold start, so one account could still run up the Anthropic bill all
 * day at a few calls a minute. This asks Postgres instead —
 * `ai_usage_bump(p_user, p_bucket, p_limit)` atomically increments
 * today's row and says whether the count is still within the limit
 * (supabase/audit_schema_2026_10.sql). Service role only.
 *
 * ── Fail soft ────────────────────────────────────────────────────────
 * Until that SQL has been run the RPC 404s (or 400s). Then — and on any
 * other failure to reach it — we fall back to a per-instance daily
 * counter with the same caps: exactly as strong as before this existed,
 * never weaker, and never an outage of the feature. A missing function
 * is remembered for ten minutes so every call is not a wasted round
 * trip on a Micro instance.
 */

// Per user, per UTC day. Generous for real use (the coach caches one
// brief a day; food-detect is a camera scan), tight enough that a
// scripted account costs pennies rather than pounds.
const DAILY_CAPS = {
  coach: 20,
  'food-detect': 40,
  recipe: 15,
  crest: 10,
};

const MISSING_RETRY_MS = 10 * 60_000;
let rpcMissingUntil = 0;

// Fallback: per-instance daily counters.
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

/**
 * → true while `userId` is within today's cap for `bucket`.
 * Unknown buckets are refused: a typo must not mean "unlimited".
 */
async function withinDailyAiCap(bucket, userId) {
  const cap = DAILY_CAPS[bucket];
  if (!cap || !userId) return false;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || Date.now() < rpcMissingUntil) return localBump(bucket, userId, cap);

  try {
    const res = await fetch(`${url}/rest/v1/rpc/ai_usage_bump`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: userId, p_bucket: bucket, p_limit: cap }),
    });
    if (res.status === 404 || res.status === 400) {
      rpcMissingUntil = Date.now() + MISSING_RETRY_MS;
      return localBump(bucket, userId, cap);
    }
    if (!res.ok) {
      console.error('aiQuota: rpc failed', res.status);
      return localBump(bucket, userId, cap);
    }
    return (await res.json()) === true;
  } catch (e) {
    console.error('aiQuota: rpc unreachable', e?.message);
    return localBump(bucket, userId, cap);
  }
}

const overDailyCap = CORS => ({
  statusCode: 429,
  headers: CORS,
  body: JSON.stringify({ error: 'Daily limit reached for this feature — it resets tomorrow.' }),
});

module.exports = { withinDailyAiCap, overDailyCap, DAILY_CAPS };
