/**
 * Netlify function: news-today
 *
 * Today's headlines for the News widget, optionally filtered by a search
 * term (Pro).
 *
 * HEADLINES AND LINKS ONLY. News APIs licence the headline, a short
 * snippet and a link to the source — not the article body. So this
 * returns exactly that and the widget opens the publisher's page. Do
 * not add full-text fetching or in-app article rendering here; that is
 * a licensing question, not a feature request.
 *
 * Fail-soft with no key, like the food-search sources — answers
 * `{ configured: false }` so the widget shows a setup hint rather than
 * an error, and adding the key later needs no code change.
 *
 * Env:
 *   GNEWS_API_KEY — free tier, headlines + links
 *
 * Cost control: the free tiers here are small (order of 100 calls/day),
 * so the module-scope cache is doing real work, not micro-optimising.
 * Cache is keyed by query so one user's "cars" search can't serve
 * another user the wrong headlines.
 */

const { requireUser, underLimit, tooMany } = require('../lib/requireUser');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const CACHE_MS = 10 * 60_000;    // headlines don't change minute to minute
const MAX_ITEMS = 12;
const cache = new Map();         // queryKey -> { at, items }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!underLimit('news', auth.userId, 20)) return tooMany(CORS);

  const key = process.env.GNEWS_API_KEY;
  if (!key) {
    // Name the variable, never its value. This is the difference
    // between "you haven't set it" and "you set it but scoped it to
    // Builds, so the function can't see it" — indistinguishable from
    // the outside otherwise.
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ configured: false, missing: 'GNEWS_API_KEY' }) };
  }

  // Trimmed and length-capped: it goes into a URL, and an unbounded
  // string from the client is how you end up proxying someone else's
  // query string into an upstream request.
  const q = String(event.queryStringParameters?.q || '').trim().slice(0, 60);
  const lang = 'en';
  const cacheKey = `${lang}:${q.toLowerCase()}`;

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Cache-Control': 'no-store' },
      body: JSON.stringify({ configured: true, cached: true, query: q, items: hit.items }),
    };
  }

  const base = q
    ? `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&sortby=publishedAt`
    : 'https://gnews.io/api/v4/top-headlines?category=general';
  const url = `${base}&lang=${lang}&max=${MAX_ITEMS}&apikey=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 403/429 here usually means the daily quota is spent. Say so
      // rather than rendering an empty, healthy-looking list.
      return {
        statusCode: 502, headers: CORS,
        body: JSON.stringify({ error: res.status === 429 || res.status === 403 ? 'quota' : 'upstream', status: res.status }),
      };
    }
    const data = await res.json();
    const items = (Array.isArray(data?.articles) ? data.articles : [])
      .map(a => ({
        title: a?.title || '',
        url: /^https?:\/\//i.test(a?.url || '') ? a.url : null,   // only ever emit http(s)
        source: a?.source?.name || '',
        publishedAt: a?.publishedAt || null,
        image: /^https:\/\//i.test(a?.image || '') ? a.image : null,
      }))
      .filter(a => a.title && a.url)
      .slice(0, MAX_ITEMS);

    cache.set(cacheKey, { at: Date.now(), items });
    if (cache.size > 100) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Cache-Control': 'no-store' },
      body: JSON.stringify({ configured: true, query: q, items }),
    };
  } catch (e) {
    return { statusCode: 504, headers: CORS, body: JSON.stringify({ error: 'unreachable', detail: e.message }) };
  }
};
