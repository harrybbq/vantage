/**
 * Netlify serverless function: food-search
 *
 * Proxies Open Food Facts requests server-side to avoid browser CORS /
 * connectivity issues from the Netlify edge.
 *
 * No API key required — Open Food Facts is free and open. BUT it
 * 403-blocks any request without an identifying User-Agent (their
 * API terms require app name + contact), which is why UA-less
 * fetches silently die. Every request below sends UA.
 *
 * Text search uses the new Search-a-licious API
 * (search.openfoodfacts.org) — fast, relevance-ranked — with the
 * legacy cgi/search.pl (popularity-sorted) as fallback. Both are
 * capped at 8s via AbortController so we never blow Netlify's 10s
 * function limit; a slow upstream returns a clean error instead of
 * a gateway timeout.
 *
 * Routes (via ?mode=):
 *   ?mode=name&q=chicken+breast   — text search
 *   ?mode=barcode&q=5000159407236 — barcode lookup
 */

const OFF = 'https://world.openfoodfacts.org';
const OFF_SEARCH = 'https://search.openfoodfacts.org';
const UA = 'Vantage/1.0 (https://soft-phoenix-b512b8.netlify.app)';

const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { searchUSDA, searchFatSecret } = require('../lib/foodSources');

// Warm-instance cache. Repeat searches (typing, back-and-forth) hit
// memory instead of three upstreams. Short TTL — food data barely
// moves, but a stale-feeling search is worse than one extra call.
const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
function cacheGet(k) {
  const hit = SEARCH_CACHE.get(k);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.v;
}
function cacheSet(k, v) {
  if (SEARCH_CACHE.size > 300) SEARCH_CACHE.clear();   // crude, bounded
  SEARCH_CACHE.set(k, { at: Date.now(), v });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// Rate limit: 30 searches / IP / minute
const rateLimits = new Map();
function checkRate(ip) {
  const now = Date.now();
  const e = rateLimits.get(ip) || { count: 0, start: now };
  if (now - e.start > 60_000) { e.count = 0; e.start = now; }
  e.count++;
  rateLimits.set(ip, e);
  return e.count <= 30;
}

function fetchJson(url, timeoutMs = 4500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
    .then(res => {
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      return res.json();
    })
    .finally(() => clearTimeout(t));
}

// Liquids should default to ml, not g. Three signals, best first:
// OFF's serving unit field, the package quantity string ("330 ml"),
// then a name/category keyword fallback.
const LIQUID_WORDS = /\b(milk|juice|water|cola|soda|lemonade|drink|smoothie|shake|coffee|latte|tea|beer|lager|cider|wine|spirits?|vodka|gin|rum|whisky|kombucha|squash|cordial|broth|beverage)\b/i;
function servingUnit(p) {
  const u = String(p.serving_quantity_unit || '').toLowerCase();
  if (u === 'ml' || u === 'l' || u === 'cl') return 'ml';
  if (u === 'g' || u === 'kg' || u === 'mg') return 'g';
  if (/\b\d+(\.\d+)?\s*(ml|cl|l|litre|liter)s?\b/i.test(p.quantity || '')) return 'ml';
  const hay = `${p.product_name || ''} ${p.categories || ''} ${p.pnns_groups_2 || ''}`;
  if (LIQUID_WORDS.test(hay) || /beverage|drinks?/i.test(p.categories || '')) return 'ml';
  return 'g';
}

function mapProduct(p) {
  const n = p.nutriments || {};
  const per100 = k => parseFloat(n[k + '_100g'] ?? n[k] ?? 0) || 0;
  return {
    food_name: p.product_name || p.abbreviated_product_name || '',
    brand:     p.brands || '',
    barcode:   p.code || p._id || '',
    image:     p.image_front_small_url || p.image_small_url || '',
    serving_g: parseFloat(p.serving_quantity) || 100,
    serving_unit: servingUnit(p),
    calories:  per100('energy-kcal'),
    protein_g: per100('proteins'),
    carbs_g:   per100('carbohydrates'),
    fat_g:     per100('fat'),
    fibre_g:   per100('fiber'),
    sugar_g:   per100('sugars'),
    sodium_mg: Math.round(per100('sodium') * 1000),
    source:    'openfoodfacts',
  };
}

// A result needs a name to be worth showing. Zero-calorie entries used
// to be dropped entirely, which quietly made water, diet drinks and
// black coffee unsearchable — they're real foods people log. They're
// kept now and simply ranked last, so they never crowd out real hits.
function usable(prod) {
  return !!prod.food_name;
}

/** Merge sources, drop duplicates, put substantive results first. */
function mergeResults(lists, q) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const p of list) {
      // Barcode is the real identity; fall back to name+brand for
      // entries that don't carry one.
      const key = (p.barcode || `${p.food_name}|${p.brand}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  const term = (q || '').toLowerCase().trim();
  const words = term.split(/\s+/).filter(Boolean);

  // Score rather than sort on one key: with several sources merged, a
  // single tiebreak leaves obviously-right answers buried.
  const score = p => {
    const name = (p.food_name || '').toLowerCase();
    const brand = (p.brand || '').toLowerCase();
    const hay = `${name} ${brand}`;
    let s = 0;
    if (name === term) s -= 100;                       // exact title
    else if (name.startsWith(term)) s -= 60;           // prefix
    else if (hay.includes(term)) s -= 30;              // phrase anywhere
    const hits = words.filter(w => hay.includes(w)).length;
    s -= hits * 8;                                     // per-word overlap
    // When the query clearly names the dish, prefer the actual menu
    // item over a lookalike supermarket product. Gated on a strong NAME
    // match rather than the brand — searching "big mac" shouldn't have
    // to also say "McDonald's", but searching "milk" shouldn't drag
    // every restaurant item to the top either.
    if (p.isRestaurant && (name === term || name.startsWith(term) || name.includes(term))) s -= 20;
    if (p.calories <= 0) s += 40;                      // sink empties
    if (!p.brand) s += 4;                              // brandless is vaguer
    return s;
  };
  return out.sort((a, b) => score(a) - score(b));
}

// image_small_url gives the packaging shot, which is the closest thing
// to a brand mark that Open Food Facts actually holds.
const FIELDS = 'product_name,brands,code,nutriments,serving_quantity,serving_quantity_unit,quantity,categories,image_small_url,image_front_small_url';
const PAGE_SIZE = 40;

async function searchByName(q, page = 1) {
  // Both endpoints, in parallel, merged. They rank differently —
  // Search-a-licious by relevance, the legacy CGI by scan popularity —
  // so running only one (the old fallback-on-failure behaviour) meant
  // whole classes of result were never reachable. Whichever fails just
  // contributes nothing.
  const relevance = (async () => {
    const params = new URLSearchParams({
      q, page_size: String(PAGE_SIZE), page: String(page), fields: FIELDS,
    });
    const json = await fetchJson(`${OFF_SEARCH}/search?${params}`);
    return (json.hits || []).map(mapProduct).filter(usable);
  })();

  const popularity = (async () => {
    const params = new URLSearchParams({
      action: 'process', json: '1',
      search_terms: q,
      page_size: String(PAGE_SIZE),
      page: String(page),
      sort_by: 'unique_scans_n',
      fields: FIELDS,
    });
    const json = await fetchJson(`${OFF}/cgi/search.pl?${params}`);
    return (json.products || []).map(mapProduct).filter(usable);
  })();

  // Every other source is optional and keyed by env — an unconfigured
  // one contributes an empty list rather than failing the search.
  const env = process.env;
  const usda = searchUSDA(q, page, env).catch(() => []);
  const fatsecret = searchFatSecret(q, page, env).catch(() => []);

  // Return whatever has arrived by the deadline rather than waiting for
  // the slowest source. Netlify's synchronous function limit is 10s, and
  // blowing it returns a 502 that the client can only report as a
  // connection failure — so a slow upstream must degrade to fewer
  // results, never to a failed search.
  const BUDGET_MS = 6000;
  const settle = pr => pr.then(v => ({ ok: true, v })).catch(() => ({ ok: false }));
  const deadline = new Promise(resolve =>
    setTimeout(() => resolve('deadline'), BUDGET_MS));

  const tracked = [relevance, popularity, usda, fatsecret].map(settle);
  const done = [];
  await Promise.race([
    Promise.all(tracked.map(async (p, i) => { done[i] = await p; })),
    deadline,
  ]);

  const lists = done.filter(r => r && r.ok).map(r => r.v);
  return mergeResults(lists, q);
}

async function searchByBarcode(code) {
  const json = await fetchJson(`${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (json.status === 1 && json.product) {
    const prod = mapProduct({ ...json.product, code });
    // Barcode hits keep zero-calorie products (water etc.) — the user
    // scanned this exact item, so returning it beats "not found".
    if (prod.food_name) return [prod];
  }
  return [];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // Type-ahead against a third-party food API — gated so the quota
  // can't be drained by anyone who finds the URL. Limit keys on the
  // account, since an IP is the one thing an abuser can rotate freely.
  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!underLimit('food', auth.userId, 40)) return tooMany(CORS);


  const { mode = 'name', q = '', page = '1' } = event.queryStringParameters || {};
  const pageNum = Math.min(10, Math.max(1, parseInt(page, 10) || 1));
  if (!q.trim()) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'q is required' }) };
  }

  try {
    const key = `${mode}:${q.trim().toLowerCase()}:${pageNum}`;
    let products = cacheGet(key);
    if (!products) {
      products = mode === 'barcode'
        ? await searchByBarcode(q.trim())
        : await searchByName(q.trim(), pageNum);
      cacheSet(key, products);
    }
    // `hasMore` lets the client offer "Load more" without guessing.
    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ products, page: pageNum, hasMore: mode !== 'barcode' && products.length >= PAGE_SIZE }),
    };
  } catch (err) {
    // Every upstream failure is already swallowed into an empty list by
    // the fan-out, so reaching here means a genuine bug in our own code
    // — exactly the case where a generic message costs a whole
    // round-trip to diagnose. Send the real reason back.
    //
    // Redacted: a fetch error can carry the full URL, and the USDA one
    // has the API key in its query string.
    const detail = String(err && err.message || err || 'unknown')
      .replace(/api_key=[^&\s]+/gi, 'api_key=REDACTED')
      .slice(0, 200);
    console.error('food-search error:', detail, err && err.stack);
    return {
      statusCode: 502, headers: CORS,
      body: JSON.stringify({ error: `Food search failed: ${detail}` }),
    };
  }
};
