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
 * Moderation (2026-09-30, item 63 — Apple 1.2):
 *   • The floor is FIVE distinct people, not two. At two, a pair of
 *     accounts could put any text on every user's Shop page.
 *   • No links and no image URLs go out — only a name, a price, coins
 *     and a count. A shared board is not a place to publish URLs (the
 *     client never rendered imageUrl, and the link is what made spam
 *     worth doing).
 *   • Names pass lib/nameFilter.js (slurs, explicit terms, links, phone
 *     numbers, emails) or are dropped.
 *   • Suspended users' items are not counted.
 *
 * POST, Bearer Supabase JWT. Returns { items: [{ name, price, coins,
 * count }] }.
 */
const { checkPublicText } = require('../lib/nameFilter');
const { suspendedIds } = require('../lib/suspended');
const { pageByKey } = require('../lib/pgPage');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const MIN_USERS = 5;          // anonymity + anti-spam floor: ≥5 distinct people
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
  //
  // Paged by id (keyset) since 2026-09-30. It used to be one request,
  // and PostgREST answers at most 1000 rows without complaint — so from
  // the 1,001st account on, the board was silently built from a subset.
  // Each page is folded into the aggregate as it arrives, so memory
  // holds the tally, never the whole table.
  const suspended = await suspendedIds({ supabaseUrl: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const map = new Map(); // normalized name → aggregate
  const fold = rows => {
    for (const row of rows) {
      if (row.trending === false) continue;      // explicit opt-out only
      if (suspended.has(row.id)) continue;
      const items = Array.isArray(row.items) ? row.items : [];
      const seen = new Set(); // one vote per user per item
      for (const it of items) {
        if (!it || it.bought || !it.name) continue;
        const key = String(it.name).toLowerCase().replace(/\s+/g, ' ').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const e = map.get(key) || { name: String(it.name).slice(0, 80), price: '', coins: 0, count: 0 };
        e.count++;
        if (!e.price && it.price) e.price = String(it.price).slice(0, 20);
        if (!e.coins && Number.isFinite(Number(it.coinCost))) e.coins = Number(it.coinCost);
        map.set(key, e);
      }
    }
  };
  try {
    await pageByKey((after, limit) => sb(
      'user_data?select=id,items:state->shopItems,trending:state->privacy->shareTrending' +
      `&order=id.asc&limit=${limit}` + (after ? `&id=gt.${after}` : ''), env),
    { onPage: fold, what: 'global-trending user_data' });
  } catch (e) {
    // A failed read — first page or fortieth — is not "nobody wants
    // anything", and half a table is not the board either: serve the
    // last good board if there is one, and never cache the failure.
    if (CACHE.items) return CACHE.items;
    throw e;
  }

  return [...map.values()]
    .filter(e => e.count >= MIN_USERS)         // anonymity floor
    .filter(e => checkPublicText(e.name).ok && checkPublicText(e.price).ok)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_N);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'not configured' }) };
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
    console.error('global-trending:', e?.message);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'failed' }) };
  }
};
