/**
 * Caller identity for functions that cost money or fetch on your behalf.
 *
 * Several endpoints were reachable by anyone: the AI ones spend
 * ANTHROPIC_API_KEY per request, and the scrapers will fetch an
 * arbitrary URL using our egress and our IP reputation. The only guard
 * was an in-memory per-IP counter, which is not a control — it is
 * per-lambda-instance, so concurrency multiplies it, and an IP is the
 * one thing an abuser can trivially rotate.
 *
 * This verifies a Supabase session JWT and hands back the user id, so
 * limits can key on an ACCOUNT instead. Creating accounts is at least
 * rate-limited and revocable; rotating IPs is free.
 *
 * Honest about what this is NOT: the per-user counter below is still
 * in-memory, so it is a brake rather than a guarantee. A hard cap needs
 * a durable counter (a Postgres table, or Netlify's rate limiting).
 * Keying on the user id is what makes that upgrade a one-line change
 * later, and it makes abuse attributable in the meantime.
 */

/**
 * → { userId } on success, or { error } holding a ready-to-return
 * response. Verification goes through Supabase's own /auth/v1/user, so
 * expiry and revocation are honoured rather than re-implemented.
 */
async function requireUser(event, CORS) {
  const env = process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  // The anon key is the right credential for reading /auth/v1/user; the
  // service key is only a fallback for sites that don't expose it.
  const apikey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  const fail = (code, msg) => ({
    error: { statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) },
  });

  if (!url || !apikey) return fail(500, 'auth not configured on this site');

  const raw = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt = raw.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return fail(401, 'sign in to use this feature');

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey, Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return fail(401, 'session expired — sign in again');
    const userId = (await res.json())?.id;
    if (!userId) return fail(401, 'session expired — sign in again');
    return { userId };
  } catch {
    return fail(503, 'could not verify session');
  }
}

// Per-user, per-instance counters. Keyed by user id so the limit tracks
// an account rather than a rotatable address.
const BUCKETS = new Map();

/**
 * Returns true while the caller is under `max` calls per `windowMs`.
 * `bucket` separates limits per feature so a burst of one doesn't lock
 * a user out of another.
 */
function underLimit(bucket, userId, max, windowMs = 60_000) {
  const key = `${bucket}:${userId}`;
  const now = Date.now();
  const e = BUCKETS.get(key) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++;
  BUCKETS.set(key, e);
  // Keep the map from growing without bound on a long-lived instance.
  if (BUCKETS.size > 5000) {
    for (const [k, v] of BUCKETS) if (now - v.t > windowMs) BUCKETS.delete(k);
  }
  return e.n <= max;
}

const tooMany = CORS => ({
  statusCode: 429,
  headers: CORS,
  body: JSON.stringify({ error: 'Too many requests — give it a minute.' }),
});

module.exports = { requireUser, underLimit, tooMany };
