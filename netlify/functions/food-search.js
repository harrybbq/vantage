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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
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

function mapProduct(p) {
  const n = p.nutriments || {};
  const per100 = k => parseFloat(n[k + '_100g'] ?? n[k] ?? 0) || 0;
  return {
    food_name: p.product_name || p.abbreviated_product_name || '',
    brand:     p.brands || '',
    barcode:   p.code || p._id || '',
    serving_g: parseFloat(p.serving_quantity) || 100,
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

// Drop entries with no name or no energy value — a result card that
// reads "0 kcal P 0g C 0g F 0g" is worse than fewer results.
function usable(prod) {
  return prod.food_name && prod.calories > 0;
}

const FIELDS = 'product_name,brands,code,nutriments,serving_quantity';

async function searchByName(q) {
  // Primary: Search-a-licious (relevance-ranked, fast).
  try {
    const params = new URLSearchParams({ q, page_size: '15', fields: FIELDS });
    const json = await fetchJson(`${OFF_SEARCH}/search?${params}`);
    const hits = (json.hits || []).map(mapProduct).filter(usable);
    if (hits.length) return hits;
  } catch { /* fall through to legacy */ }

  // Fallback: legacy CGI search, popularity-sorted so household brands
  // beat obscure entries.
  const params = new URLSearchParams({
    action: 'process', json: '1',
    search_terms: q,
    page_size: '15',
    sort_by: 'unique_scans_n',
    fields: FIELDS,
  });
  const json = await fetchJson(`${OFF}/cgi/search.pl?${params}`);
  return (json.products || []).map(mapProduct).filter(usable);
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

  const ip = event.headers['x-forwarded-for'] || 'unknown';
  if (!checkRate(ip)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'Too many requests' }) };
  }

  const { mode = 'name', q = '' } = event.queryStringParameters || {};
  if (!q.trim()) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'q is required' }) };
  }

  try {
    const products = mode === 'barcode'
      ? await searchByBarcode(q.trim())
      : await searchByName(q.trim());
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ products }) };
  } catch (err) {
    console.error('food-search error:', err.message);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Food search failed' }) };
  }
};
