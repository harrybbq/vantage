/**
 * Federated food search.
 *
 * MyFitnessPal's advantage isn't a clever algorithm — it's ~20 years of
 * accumulated data across three categories at once: barcoded grocery
 * items, restaurant menus, and user-submitted foods. No single free API
 * covers all three, so this queries several in parallel and merges them
 * into one ranked list.
 *
 * Each adapter is independent and OPTIONAL. A source with no credentials
 * configured simply contributes nothing, so the app works today on Open
 * Food Facts alone and gets materially better the moment a key is added
 * — no code change, just an env var.
 *
 *   Open Food Facts   no key      ~3M products, barcode-strong,
 *                                 Europe-heavy, weak on restaurants
 *   USDA FDC          FDC_API_KEY ~600k foods incl. ~380k branded.
 *                                 Free (data.gov), 1,000 req/hour/IP
 *   FatSecret         FATSECRET_* ~1.9M items across 56 countries and,
 *                                 crucially, RESTAURANT menus. Free
 *                                 tier is 5,000 calls/day
 *
 * The restaurant gap is the one that matters for "Big Mac Meal": OFF and
 * USDA are both weak there, FatSecret is not. That is the single
 * highest-value key to add.
 */

const UA = 'Vantage/1.0 (https://vantagevision.netlify.app)';
// Must fit inside food-search's 6s fan-out budget, which itself has to
// fit inside Netlify's 10s function limit.
const TIMEOUT_MS = 4500;

function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT_MS);
  return fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    signal: ctrl.signal,
  })
    .then(r => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    })
    .finally(() => clearTimeout(t));
}

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** The shape every adapter must return. Keeps ranking source-agnostic. */
function food({ name, brand, barcode = '', servingG = 100, servingUnit = 'g',
                kcal = 0, protein = 0, carbs = 0, fat = 0, fibre = 0,
                sugar = 0, sodiumMg = 0, image = '', source, isRestaurant = false }) {
  return {
    food_name: String(name || '').trim(),
    brand: String(brand || '').trim(),
    barcode: String(barcode || ''),
    serving_g: servingG || 100,
    serving_unit: servingUnit || 'g',
    calories: Math.round(num(kcal)),
    protein_g: Math.round(num(protein) * 10) / 10,
    carbs_g: Math.round(num(carbs) * 10) / 10,
    fat_g: Math.round(num(fat) * 10) / 10,
    fibre_g: Math.round(num(fibre) * 10) / 10,
    sugar_g: Math.round(num(sugar) * 10) / 10,
    sodium_mg: Math.round(num(sodiumMg)),
    image,
    source,
    isRestaurant,
  };
}

// ── USDA FoodData Central ────────────────────────────────────────────
// Public domain (CC0), free key from data.gov. Branded + survey foods.
async function searchUSDA(q, page, env) {
  const key = env.FDC_API_KEY;
  if (!key) return [];
  const url = 'https://api.nal.usda.gov/fdc/v1/foods/search'
    + `?api_key=${encodeURIComponent(key)}`
    + `&query=${encodeURIComponent(q)}`
    + `&pageSize=25&pageNumber=${page}`
    // Branded first — that's what people actually log. Foundation and
    // SR Legacy cover generic ingredients ("chicken breast, raw").
    + '&dataType=Branded,Foundation,SR%20Legacy,Survey%20(FNDDS)';
  const json = await fetchJson(url);
  return (json.foods || []).map(f => {
    // USDA reports per 100g for Branded, per serving for some others.
    const by = {};
    for (const n of f.foodNutrients || []) {
      by[n.nutrientName || n.nutrientId] = n.value;
    }
    const pick = (...names) => {
      for (const n of names) if (by[n] != null) return by[n];
      return 0;
    };
    return food({
      name: f.description,
      brand: f.brandName || f.brandOwner || '',
      barcode: f.gtinUpc || '',
      servingG: num(f.servingSize) || 100,
      servingUnit: /ml|milliliter/i.test(f.servingSizeUnit || '') ? 'ml' : 'g',
      kcal: pick('Energy', 'Energy (Atwater General Factors)'),
      protein: pick('Protein'),
      carbs: pick('Carbohydrate, by difference'),
      fat: pick('Total lipid (fat)'),
      fibre: pick('Fiber, total dietary'),
      sugar: pick('Sugars, total including NLEA', 'Total Sugars'),
      sodiumMg: pick('Sodium, Na'),
      source: 'usda',
    });
  });
}

// ── FatSecret ────────────────────────────────────────────────────────
// OAuth2 client-credentials. The only one of the three with real
// restaurant menu coverage, which is the gap for fast food.
let fsToken = { value: null, expires: 0 };
async function fatSecretToken(env) {
  if (fsToken.value && Date.now() < fsToken.expires) return fsToken.value;
  const id = env.FATSECRET_CLIENT_ID, secret = env.FATSECRET_CLIENT_SECRET;
  if (!id || !secret) return null;
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: 'basic' });
  const json = await fetchJson('https://oauth.fatsecret.com/connect/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!json.access_token) return null;
  // Refresh a minute early so a request never rides an expiring token.
  fsToken = { value: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
  return fsToken.value;
}

async function searchFatSecret(q, page, env) {
  const token = await fatSecretToken(env).catch(() => null);
  if (!token) return [];
  const params = new URLSearchParams({
    method: 'foods.search', format: 'json',
    search_expression: q, max_results: '25', page_number: String(page - 1),
  });
  const json = await fetchJson(`https://platform.fatsecret.com/rest/server.api?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = json?.foods?.food;
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  return arr.map(f => {
    // food_description looks like:
    // "Per 100g - Calories: 250kcal | Fat: 10.00g | Carbs: 30.00g | Protein: 5.00g"
    const d = f.food_description || '';
    const grab = re => { const m = d.match(re); return m ? parseFloat(m[1]) : 0; };
    const servingM = d.match(/Per\s+([\d.]+)\s*(g|ml)/i);
    return food({
      name: f.food_name,
      brand: f.brand_name || '',
      servingG: servingM ? parseFloat(servingM[1]) : 100,
      servingUnit: servingM && /ml/i.test(servingM[2]) ? 'ml' : 'g',
      kcal: grab(/Calories:\s*([\d.]+)/i),
      fat: grab(/Fat:\s*([\d.]+)/i),
      carbs: grab(/Carbs:\s*([\d.]+)/i),
      protein: grab(/Protein:\s*([\d.]+)/i),
      source: 'fatsecret',
      // FatSecret marks restaurant items as 'Brand' with a restaurant
      // type; treat branded non-barcode hits as menu items so they rank
      // up for chain queries.
      isRestaurant: f.food_type === 'Brand',
    });
  });
}

module.exports = { searchUSDA, searchFatSecret, food, fetchJson };
