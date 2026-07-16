/**
 * global-trending — "what everyone is saving for".
 *
 * Aggregates wishlist items across ALL opted-in users and returns the
 * most-wanted ones. This is the app-wide discovery surface (distinct from
 * friends-trending, which is scoped to your accepted friends).
 *
 * Privacy:
 *   • Only users who have NOT opted out are included
 *     (state->privacy->shareTrending — same opt-in as friends-trending;
 *     default on). Opting out of one opts out of both.
 *   • Anonymous: returns item name + a count only, never who wants what.
 *   • A minimum-count floor (MIN_USERS) means an item must be wanted by
 *     at least that many distinct people before it can surface, so no
 *     entry is traceable to one individual.
 *   • Bought items are excluded.
 *
 * DB load: Supabase Micro is resource-constrained, so the full aggregate
 * is computed at most once per CACHE_TTL_MS and held in module scope.
 * Warm function instances then serve every shop-open from memory instead
 * of re-scanning user_data. Cold instances recompute once.
 *
 * POST, Bearer Supabase JWT. Returns { items: [{ name, price, url,
 * imageUrl, coins, count }] }.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const MIN_USERS = 2;          // anonymity floor: item must span ≥2 people
const TOP_N = 20;             // most-wanted items returned
const CACHE_TTL_MS = 15 * 60 * 1000;

// Module-scope cache — persists across invocations on a warm instance.
let CACHE = { at: 0, items: null };

function sb(path, env) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
}

async function computeTrending(env) {
  // JSON-path projection keeps this to just each user's shopItems + their
  // opt-in flag — no full state blobs transferred. The opt-out filter is
  // applied in JS (not the DB) because a null/absent flag is default-on,
  // and PostgREST's `not.eq.false` would drop nulls too. Opted-out items
  // reach only this trusted service-role function and are discarded here.
  const uRes = await sb(`user_data?select=items:state->shopItems,trending:state->privacy->shareTrending`, env);
  const all = uRes.ok ? await uRes.json() : [];

  const map = new Map(); // normalized name → aggregate
  for (const row of all) {
    if (row.trending === false) continue;      // explicit opt-out only
    const items = Array.isArray(row.items) ? row.items : [];
    const seen = new Set(); // one vote per user per item
    for (const it of items) {
      if (!it || it.bought || !it.name) continue;
      const key = String(it.name).toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const e = map.get(key) || { name: String(it.name).slice(0, 80), price: '', url: '', imageUrl: '', coins: 0, count: 0 };
      e.count++;
      if (!e.price && it.price) e.price = String(it.price).slice(0, 20);
      if (!e.url && typeof it.url === 'string' && it.url.startsWith('http')) e.url = it.url;
      if (!e.imageUrl && typeof it.imageUrl === 'string' && it.imageUrl.startsWith('http')) e.imageUrl = it.imageUrl;
      if (!e.coins && it.coinCost) e.coins = it.coinCost;
      map.set(key, e);
    }
  }

  return [...map.values()]
    .filter(e => e.count >= MIN_USERS)         // anonymity floor
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_N);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'supabase env missing' }) };
  }

  // Require a valid session (prevents anonymous scraping of the board).
  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };

  try {
    const now = Date.now();
    if (!CACHE.items || now - CACHE.at > CACHE_TTL_MS) {
      CACHE = { at: now, items: await computeTrending(env) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ items: CACHE.items }) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message || 'failed' }) };
  }
};
