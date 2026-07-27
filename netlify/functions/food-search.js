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

function fetchJson(url, timeoutMs = 8000) {
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
  const term = (q || '').toLowerCase();
  return out.sort((a, b) => {
    // Exact-ish name matches first, then anything with calories, then
    // the rest. Stable enough to feel predictable while typing.
    const aExact = a.food_name.toLowerCase().startsWith(term) ? 0 : 1;
    const bExact = b.food_name.toLowerCase().startsWith(term) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aHas = a.calories > 0 ? 0 : 1;
    const bHas = b.calories > 0 ? 0 : 1;
    return aHas - bHas;
  });
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

  const settled = await Promise.allSettled([relevance, popularity]);
  const lists = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
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
    const products = mode === 'barcode'
      ? await searchByBarcode(q.trim())
      : await searchByName(q.trim(), pageNum);
    // `hasMore` lets the client offer "Load more" without guessing.
    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ products, page: pageNum, hasMore: mode !== 'barcode' && products.length >= PAGE_SIZE }),
    };
  } catch (err) {
    console.error('food-search error:', err.message);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Food search failed' }) };
  }
};
