/**
 * shop-price-check — re-read the current price for wishlist items.
 *
 * STATELESS ON PURPOSE. The obvious design is a cron that sweeps every
 * user's wishlist server-side, but that would mean reading and
 * rewriting whole `state` documents (~1 MB each) on a schedule, which
 * is exactly the write amplification the DB can least afford on Micro/
 * Small compute — and it puts a service-role writer near user data for
 * a cosmetic feature.
 *
 * Instead the client asks for prices for the items it already has
 * loaded, when the user opens Shopping, and merges the answer into
 * state through the normal debounced save path. Cost scales with people
 * actually using the page rather than with total signups, this function
 * never touches the database, and a failure here can't corrupt
 * anything — it just means no fresh price this time.
 *
 * Trade-off accepted: no price alerts while the app is closed. Push
 * notifications for that would need the cron, and it should only be
 * built once the state-size work is done.
 *
 * POST { urls: ["https://…", …] }  (max 8 per call)
 * → { results: [{ url, ok, price, priceNum }] }
 *
 * Scraping is best-effort: retailers change markup, some block bots,
 * and a missing price is normal rather than an error.
 */
const { fetchWithTimeout, isBlockedHost, extractProductInfo, priceToNumber } = require('../lib/productPage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const MAX_URLS = 8;
const CONCURRENCY = 3;   // be a polite visitor, not a stampede

// Per-instance throttle. Not a security control (a warm lambda is not a
// reliable counter) — it's a brake so one client can't spray requests
// at retailers on our IP.
const RATE = new Map();
function allowed(key, max = 40) {
  const now = Date.now();
  const e = RATE.get(key) || { n: 0, t: now };
  if (now - e.t > 60_000) { e.n = 0; e.t = now; }
  e.n++;
  RATE.set(key, e);
  return e.n <= max;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function checkOne(url) {
  const base = { url, ok: false, price: '', priceNum: null };
  let parsed;
  try { parsed = new URL(url); } catch { return { ...base, reason: 'bad_url' }; }
  if (!/^https?:$/.test(parsed.protocol)) return { ...base, reason: 'bad_scheme' };
  if (isBlockedHost(parsed.hostname)) return { ...base, reason: 'blocked_host' };

  try {
    const html = await fetchWithTimeout(url);
    const info = extractProductInfo(html, parsed);
    const priceNum = priceToNumber(info.price);
    if (priceNum == null) return { ...base, reason: 'no_price' };
    return { url, ok: true, price: info.price, priceNum };
  } catch (e) {
    return { ...base, reason: 'fetch_failed', detail: (e.message || '').slice(0, 120) };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const ip = (event.headers?.['x-nf-client-connection-ip']
    || (event.headers?.['x-forwarded-for'] || '').split(',')[0] || 'anon').trim();
  if (!allowed(ip)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'slow down' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) }; }

  const urls = Array.isArray(body.urls)
    ? body.urls.filter(u => typeof u === 'string' && u).slice(0, MAX_URLS)
    : [];
  if (!urls.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ results: [] }) };
  }

  const results = await pool(urls, CONCURRENCY, checkOne);
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ results }) };
};
