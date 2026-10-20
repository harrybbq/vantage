/**
 * Optional session check, cached — for endpoints where signing in is
 * NOT required but changes what you get (item 95): weather (signed-in
 * callers get a higher per-IP cap) and client-error (a valid session
 * attaches user_id to the crash row).
 *
 * Verification is Supabase's own /auth/v1/user (expiry and revocation
 * honoured, as in lib/requireUser.js). The answer is cached in module
 * scope by a SHA-256 of the token — never the token itself — for at
 * most CACHE_MS, and never past the token's own `exp`, so a crash loop
 * or a page that polls doesn't turn into one Auth round trip per hit.
 * Rejections are cached too (shorter), so a junk token can't be used to
 * hammer Auth through us.
 *
 * → the user id, or null for no / bad / unverifiable token. Never throws.
 */
const crypto = require('node:crypto');
const { userApiKey, userHeaders } = require('./sbKeys');

const CACHE_MS = 5 * 60_000;
const NEG_CACHE_MS = 60_000;
const MAX_KEYS = 2000;
const cache = new Map(); // sha256(jwt) → { id|null, until }

function bearer(event) {
  const h = (event && event.headers) || {};
  const raw = h.authorization || h.Authorization || '';
  const jwt = String(raw).replace(/^Bearer\s+/i, '').trim();
  // A Supabase session JWT is three base64url parts; anything else is junk.
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt) && jwt.length < 4096 ? jwt : '';
}

/** The token's own expiry (ms), read only to bound the cache. */
function expMs(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return typeof p.exp === 'number' ? p.exp * 1000 : null;
  } catch { return null; }
}

async function sessionUserId(event, { env = process.env, fetchImpl, now = () => Date.now() } = {}) {
  const jwt = bearer(event);
  if (!jwt) return null;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (!url || !userApiKey(env)) return null;

  const key = crypto.createHash('sha256').update(jwt).digest('hex');
  const t = now();
  const hit = cache.get(key);
  if (hit && t < hit.until) return hit.id;

  const exp = expMs(jwt);
  if (exp != null && exp <= t) { remember(key, null, t + NEG_CACHE_MS, t); return null; }

  let id = null;
  let transient = false;
  try {
    const f = fetchImpl || fetch;
    const res = await f(`${url}/auth/v1/user`, { headers: userHeaders(env, jwt) });
    if (res.ok) id = (await res.json())?.id || null;
    else transient = res.status >= 500;
  } catch { transient = true; }
  // A network blip isn't a verdict: don't cache it.
  if (!transient) {
    const until = id ? Math.min(t + CACHE_MS, exp || Infinity) : t + NEG_CACHE_MS;
    remember(key, id, until, t);
  }
  return id;
}

function remember(key, id, until, t) {
  cache.set(key, { id, until });
  if (cache.size > MAX_KEYS) {
    for (const [k, v] of cache) if (t >= v.until) cache.delete(k);
    while (cache.size > MAX_KEYS) cache.delete(cache.keys().next().value);
  }
}

module.exports = { sessionUserId, bearer, _cache: cache };
