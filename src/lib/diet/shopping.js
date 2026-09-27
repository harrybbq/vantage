/**
 * The shopping list, as you would actually buy it — at a chosen shop.
 *
 * Takes the summed ingredients (ingredients.js → aggregate) and:
 *   1. splits off SEASONINGS & CUPBOARD items — spices, sauces, oils,
 *      stock — which you check you have rather than buy by the gram.
 *      Detected from the item's name and how it is measured (tsp,
 *      "pinch", "to taste"…); a tap moves an item either way and the
 *      choice is remembered (S.shopPrefs.cats).
 *   2. prices everything else at the chosen SHOP (Tesco, Morrisons,
 *      Aldi, Lidl), rounding each item into that shop's packs — the
 *      cheapest mix that covers what is needed; a bigger pack wins when
 *      it costs less, and at equal cost the one with least left over.
 *   3. finds what that shop doesn't have, offers a swap in the same shop
 *      or the cheapest shop that does, and — when two or more things are
 *      missing — the ONE second shop that covers the gaps, so a shop is
 *      two stops rather than five.
 *   4. groups it by aisle and keeps a running total.
 *
 * Prices are HARD-CODED ESTIMATES (PRICES_AS_OF), refreshed by hand every
 * few months — there is no live price feed. Anything can be corrected per
 * shop: its packs and prices (S.shopPrefs.storePacks) or "not stocked
 * here" (S.shopPrefs.out), and the corrections win over the table.
 *
 * Pure. No DOM, no network.
 */

export const PRICES_AS_OF = 'Sep 2026';
export const STORES = [
  { id: 'tesco', name: 'Tesco' },
  { id: 'morrisons', name: 'Morrisons' },
  { id: 'aldi', name: 'Aldi' },
  { id: 'lidl', name: 'Lidl' },
];
const STORE_IDS = STORES.map(s => s.id);
export const storeName = id => (STORES.find(s => s.id === id) || STORES[0]).name;

export const AISLES = ['Meat & fish', 'Dairy & eggs', 'Fruit & veg', 'Rice, pasta & bread', 'Tins & jars', 'Other'];

// One pack size, priced at each shop: SP(size, tesco, morrisons, aldi,
// lidl). null = that shop doesn't sell that size. Order matters in
// CATALOGUE: the first match wins, so specific items come first.
const SP = (size, t, m, a, l, label) => ({ size, prices: { tesco: t, morrisons: m, aldi: a, lidl: l }, ...(label ? { label } : {}) });
export const CATALOGUE = [
  // Meat & fish
  { re: /turkey mince/, aisle: 0, packs: { g: [SP(500, 3.5, 3.6, 2.89, 2.89), SP(1000, 6.25, 6.5, null, null)] } },
  { re: /chicken mince/, aisle: 0, packs: { g: [SP(500, 3.75, 3.85, 3.19, 3.19)] } },
  { re: /pork mince/, aisle: 0, packs: { g: [SP(500, 3.0, 3.1, 2.49, 2.49), SP(750, 4.25, null, null, null)] } },
  { re: /mince/, aisle: 0, packs: { g: [SP(500, 3.6, 3.7, 2.99, 2.99), SP(750, 5.0, 5.25, 4.29, null), SP(1000, 6.25, 6.5, 5.49, 5.49)] } },
  { re: /chicken breast/, aisle: 0, packs: {
    g: [SP(300, 2.85, 2.95, 2.39, 2.39), SP(650, 4.85, 5.0, 3.99, 3.99), SP(1000, 6.75, 7.0, 5.79, 5.79)],
    x: [SP(2, 2.85, 2.95, 2.39, 2.39), SP(4, 4.85, 5.0, 3.99, 3.99)] } },
  { re: /chicken thigh/, aisle: 0, packs: { g: [SP(500, 3.25, 3.35, 2.69, 2.69), SP(1000, 5.5, 5.75, 4.49, 4.49)] } },
  { re: /salmon/, aisle: 0, packs: {
    x: [SP(2, 4.0, 4.1, 3.29, 3.29), SP(4, 6.75, 7.0, 5.99, 5.99)],
    g: [SP(240, 4.0, 4.1, 3.29, 3.29), SP(480, 6.75, 7.0, 5.99, 5.99)] } },
  { re: /\bcod\b|haddock|white fish/, aisle: 0, packs: { x: [SP(2, 3.75, 3.85, 3.19, 3.19), SP(4, 6.25, 6.5, null, null)], g: [SP(280, 3.75, 3.85, 3.19, 3.19)] } },
  { re: /prawn/, aisle: 0, packs: { g: [SP(150, 2.75, 2.85, 2.29, 2.29), SP(300, 4.5, 4.65, 3.79, 3.79)] } },
  { re: /tuna/, aisle: 0, packs: { tin: [SP(1, 1.15, 1.2, 0.89, 0.89), SP(4, 3.9, 4.0, 3.19, 3.19)], x: [SP(1, 1.15, 1.2, 0.89, 0.89), SP(4, 3.9, 4.0, 3.19, 3.19)] } },
  { re: /steak|sirloin|rump/, aisle: 0, packs: { x: [SP(1, 4.75, 4.9, 3.99, 3.99), SP(2, 8.25, 8.5, 6.99, 6.99)], g: [SP(225, 4.75, 4.9, 3.99, 3.99), SP(450, 8.25, 8.5, 6.99, 6.99)] } },
  { re: /bacon/, aisle: 0, packs: { g: [SP(300, 2.85, 2.95, 2.29, 2.29)], slice: [SP(10, 2.85, 2.95, 2.29, 2.29)], x: [SP(10, 2.85, 2.95, 2.29, 2.29)] } },
  { re: /sausage/, aisle: 0, packs: { x: [SP(6, 2.6, 2.7, 1.99, 1.99), SP(12, 4.5, 4.6, 3.69, null)] } },
  // Dairy & eggs
  { re: /\beggs?\b/, aisle: 1, packs: { x: [SP(6, 1.75, 1.8, 1.45, 1.45), SP(12, 3.1, 3.2, 2.59, 2.59), SP(15, 3.5, 3.6, 2.99, null)] } },
  { re: /milk/, aisle: 1, packs: { ml: [SP(568, 0.8, 0.8, 0.7, 0.7, '1 pint'), SP(1136, 1.35, 1.35, 1.15, 1.15, '2 pints'), SP(2272, 1.75, 1.75, 1.55, 1.55, '4 pints')] } },
  { re: /cottage cheese/, aisle: 1, packs: { g: [SP(300, 1.5, 1.55, 1.19, 1.19)] } },
  { re: /yogh?urt|skyr/, aisle: 1, packs: { g: [SP(500, 1.65, 1.7, 1.35, 1.35), SP(1000, 2.75, 2.85, 2.25, 2.25)] } },
  { re: /cheddar|mozzarella|cheese/, aisle: 1, packs: { g: [SP(200, 2.25, 2.3, 1.85, 1.85), SP(400, 3.6, 3.7, 2.99, 2.99)] } },
  { re: /butter/, aisle: 1, packs: { g: [SP(250, 2.4, 2.45, 1.99, 1.99)] } },
  // Fruit & veg
  { re: /sweet potato/, aisle: 2, packs: { g: [SP(1000, 1.6, 1.65, 1.29, 1.29)], x: [SP(1, 0.45, 0.45, null, null)] } },
  { re: /potato/, aisle: 2, packs: { g: [SP(1000, 1.05, 1.1, 0.85, 0.85), SP(2500, 1.75, 1.8, 1.39, 1.39)], x: [SP(1, 0.28, 0.3, null, null)] } },
  { re: /onion/, aisle: 2, packs: { x: [SP(1, 0.16, 0.17, null, null), SP(3, 0.69, 0.72, 0.55, 0.55)], g: [SP(1000, 1.0, 1.05, 0.85, 0.85)] } },
  { re: /banana/, aisle: 2, packs: { x: [SP(1, 0.18, 0.18, 0.15, 0.15), SP(5, 0.89, 0.92, 0.75, 0.75)] } },
  { re: /broccoli/, aisle: 2, packs: { x: [SP(1, 0.79, 0.82, 0.62, 0.62)], g: [SP(350, 0.79, 0.82, 0.62, 0.62)] } },
  { re: /avocado/, aisle: 2, packs: { x: [SP(1, 0.89, 0.95, 0.69, 0.69), SP(2, 1.6, 1.65, 1.29, 1.29)] } },
  { re: /(bell )?pepper$/, aisle: 2, packs: { x: [SP(1, 0.6, 0.62, null, null), SP(3, 1.5, 1.55, 1.19, 1.19)] } },
  { re: /spinach/, aisle: 2, packs: { g: [SP(240, 1.35, 1.4, 1.09, 1.09)] } },
  { re: /lettuce/, aisle: 2, packs: { x: [SP(1, 0.65, 0.68, 0.55, 0.55)] } },
  { re: /berr/, aisle: 2, packs: { g: [SP(150, 2.1, 2.2, 1.69, 1.69), SP(300, 3.6, 3.75, 2.99, 2.99)] } },
  { re: /garlic/, aisle: 2, packs: { clove: [SP(10, 0.37, 0.38, 0.29, 0.29, '1 bulb')], x: [SP(1, 0.37, 0.38, 0.29, 0.29, '1 bulb')] } },
  // Rice, pasta & bread
  { re: /rice/, aisle: 3, packs: { g: [SP(500, 0.95, 1.0, 0.79, 0.79), SP(1000, 1.7, 1.75, 1.39, 1.39), SP(2000, 2.9, 3.0, 2.39, null)] } },
  { re: /pasta|spaghetti|penne|fusilli|noodle/, aisle: 3, packs: { g: [SP(500, 0.8, 0.85, 0.65, 0.65), SP(1000, 1.35, 1.4, 1.1, 1.1)] } },
  { re: /\boats?\b|porridge/, aisle: 3, packs: { g: [SP(1000, 1.0, 1.05, 0.85, 0.85)] } },
  { re: /tortilla|wrap/, aisle: 3, packs: { x: [SP(8, 1.25, 1.3, 0.99, 0.99)] } },
  { re: /bagel/, aisle: 3, packs: { x: [SP(5, 1.25, 1.3, 0.99, 0.99)] } },
  // Tins & jars
  { re: /chopped tomato|tinned tomato|plum tomato/, aisle: 4, packs: { tin: [SP(1, 0.47, 0.49, 0.38, 0.38), SP(4, 1.65, 1.7, 1.35, 1.35)], x: [SP(1, 0.47, 0.49, 0.38, 0.38), SP(4, 1.65, 1.7, 1.35, 1.35)] } },
  { re: /bean|chickpea|lentil/, aisle: 4, packs: { tin: [SP(1, 0.58, 0.6, 0.45, 0.45), SP(4, 2.05, 2.1, 1.65, 1.65)], x: [SP(1, 0.58, 0.6, 0.45, 0.45), SP(4, 2.05, 2.1, 1.65, 1.65)], g: [SP(400, 0.58, 0.6, 0.45, 0.45)] } },
  { re: /coconut milk/, aisle: 4, packs: { tin: [SP(1, 1.15, 1.2, 0.89, 0.89)], ml: [SP(400, 1.15, 1.2, 0.89, 0.89)] } },
  { re: /peanut butter/, aisle: 4, packs: { g: [SP(340, 2.1, 2.15, 1.69, 1.69)] } },
];

// Same-shop swaps worth offering when an item isn't stocked: close
// enough in use and protein that the recipe still works.
const SWAPS = [
  [/turkey mince/, ['chicken mince', '5% beef mince']],
  [/chicken mince/, ['turkey mince', '5% beef mince']],
  [/pork mince/, ['5% beef mince', 'turkey mince']],
  [/mince/, ['turkey mince']],
  [/chicken thigh/, ['chicken breast']],
  [/chicken breast/, ['chicken thigh']],
  [/salmon/, ['cod']],
  [/\bcod\b|haddock|white fish/, ['salmon']],
  [/prawn/, ['cod']],
  [/cottage cheese/, ['greek yoghurt']],
  [/yogh?urt|skyr/, ['cottage cheese']],
  [/sweet potato/, ['potato']],
  [/potato/, ['sweet potato']],
];

// Seasonings & cupboard: checked, not bought by weight.
const SEASONING_WORDS = /\b(salt|black pepper|white pepper|peppercorn|paprika|cumin|coriander seed|ground coriander|chilli (powder|flake)|chili (powder|flake)|cayenne|garlic (powder|granule|salt|paste)|onion (powder|granule)|oregano|dried basil|thyme|rosemary|dried parsley|mixed herb|italian (herb|seasoning)|cinnamon|nutmeg|turmeric|ground ginger|ginger paste|garam masala|curry (powder|paste)|five spice|cajun|fajita|taco seasoning|bay lea|stock|bouillon|oxo|gravy|soy sauce|fish sauce|oyster sauce|hoisin|worcestershire|sriracha|hot sauce|gochujang|sweet chilli|ketchup|mustard|mayo|mayonnaise|bbq sauce|barbecue sauce|vinegar|olive oil|vegetable oil|sesame oil|rapeseed oil|sunflower oil|coconut oil|spray oil|fry light|honey|maple syrup|sugar|cornflour|flour|baking powder|bicarbonate|vanilla|lemon juice|lime juice|tomato pur[eé]e|tomato paste|seasoning|spice)\b/;
const SEASONING_HINTS = /\b(dried|ground|powder|flakes?)\b/;

/** Is this a seasoning/cupboard item? `line` is the raw text, for "to taste" etc. */
export function isSeasoning(item, family, raw = '') {
  const s = String(item || '').toLowerCase();
  if (/\b(to taste|pinch|dash|sprinkle|drizzle|splash)\b/.test(String(raw).toLowerCase())) return true;
  if (family === 'tsp') return true;
  if (/\boil\b/.test(s)) return true;
  if (SEASONING_WORDS.test(s)) return true;
  if (SEASONING_HINTS.test(s) && family !== 'clove') return true;
  return false;
}

/** The catalogue entry for an item, or null. */
export function catalogueFor(ikey) {
  const s = String(ikey || '').toLowerCase();
  return CATALOGUE.find(c => c.re.test(s)) || null;
}

/** A catalogue entry's packs at one shop → [{ size, price, label }] (sizes it sells). */
export function packsAt(entry, family, store) {
  return ((entry && entry.packs[family]) || [])
    .filter(p => p.prices[store] != null)
    .map(p => ({ size: p.size, price: p.prices[store], ...(p.label ? { label: p.label } : {}) }));
}

/**
 * The cheapest set of packs covering `need`; at equal cost, least left
 * over, then fewest packs. → { picks: [{ size, count, price, label }],
 *   bought, leftover, cost } or null when there are no packs.
 */
export function bestPacks(need, packs) {
  const opts = (packs || []).filter(p => p.size > 0 && Number.isFinite(p.price));
  if (!opts.length || !(need > 0)) return null;
  const caps = opts.map(p => Math.min(20, Math.ceil(need / p.size) + 1));
  let best = null;
  const counts = new Array(opts.length).fill(0);
  const visit = i => {
    if (i === opts.length) {
      const bought = counts.reduce((a, c, k) => a + c * opts[k].size, 0);
      if (bought + 1e-9 < need) return;
      const cost = Math.round(counts.reduce((a, c, k) => a + c * opts[k].price, 0) * 100) / 100;
      const n = counts.reduce((a, c) => a + c, 0);
      const cand = { counts: counts.slice(), bought, cost, leftover: bought - need, n };
      if (!best || cand.cost < best.cost - 1e-9
        || (Math.abs(cand.cost - best.cost) < 1e-9 && (cand.leftover < best.leftover - 1e-9
          || (Math.abs(cand.leftover - best.leftover) < 1e-9 && cand.n < best.n)))) best = cand;
      return;
    }
    for (let c = 0; c <= caps[i]; c++) { counts[i] = c; visit(i + 1); }
    counts[i] = 0;
  };
  visit(0);
  if (!best) return null;
  return {
    picks: opts.map((p, k) => ({ ...p, count: best.counts[k] })).filter(p => p.count > 0).sort((a, b) => b.size - a.size),
    bought: best.bought,
    leftover: Math.round(best.leftover * 10) / 10,
    cost: best.cost,
  };
}

const kg = (v, unit) => (v >= 1000 ? `${String(Math.round(v / 100) / 10).replace(/\.0$/, '')} ${unit === 'g' ? 'kg' : 'l'}` : `${Math.round(v)} ${unit}`);
/** "750 g", "1 kg", "4 pints", "12", "4 tins". */
export function packLabel(p, family) {
  if (p.label) return p.label;
  if (family === 'g' || family === 'ml') return kg(p.size, family);
  if (family === 'x') return `${p.size}`;
  return `${p.size} ${family}${p.size === 1 ? '' : 's'}`;
}
export function picksLabel(picks, family) {
  return picks.map(p => {
    if (p.label) return `${p.count}× ${p.label}`;
    // Single items read as a count: "2 loose", "3 tins", not "2× 1-pack".
    if (p.size === 1 && family === 'x') return `${p.count} loose`;
    if (p.size === 1 && family !== 'g' && family !== 'ml') return `${p.count} ${family}${p.count === 1 ? '' : 's'}`;
    if (family === 'x' || family === 'tin') return `${p.count}× ${p.size}-pack`;
    return `${p.count}× ${packLabel(p, family)}`;
  }).join(' + ');
}

/**
 * One item at one shop, with your corrections applied.
 * → { status: 'ok'|'out'|'unpriced', best, own, why }
 *   out       the shop doesn't have it: you said so, or it sells none of
 *             the item's pack sizes in the table
 *   unpriced  not in the table and no price of yours — counted as
 *             available, just without a price
 */
export function itemAt(it, store, prefs = {}) {
  const ikey = it.ikey || it.key;
  if ((((prefs.out || {})[store]) || {})[ikey]) return { status: 'out', best: null, own: false, why: 'marked' };
  const mine = ((((prefs.storePacks || {})[store]) || {})[ikey] || {})[it.family]
    || ((prefs.packs || {})[ikey] || {})[it.family];
  const entry = catalogueFor(ikey);
  const packs = mine || (entry ? packsAt(entry, it.family, store) : null);
  if (mine && it.base != null) return { status: 'ok', best: bestPacks(it.base, mine), own: true };
  if (!entry || !entry.packs[it.family] || it.base == null) return { status: 'unpriced', best: null, own: false };
  if (!packs.length) return { status: 'out', best: null, own: false, why: 'range' };
  return { status: 'ok', best: bestPacks(it.base, packs), own: false };
}

/** A same-shop swap for an item the shop doesn't have, or null. */
export function swapAt(it, store, prefs = {}) {
  const ikey = it.ikey || it.key;
  const row = SWAPS.find(([re]) => re.test(ikey));
  if (!row || it.base == null) return null;
  for (const name of row[1]) {
    if (name === ikey) continue;
    const alt = itemAt({ ...it, ikey: name, key: name, item: name }, store, prefs);
    if (alt.status === 'ok' && alt.best) return { item: name, best: alt.best, buy: picksLabel(alt.best.picks, it.family) };
  }
  return null;
}

/** The cheapest OTHER shop that has an item → { store, best, buy } or null. */
export function elsewhere(it, store, prefs = {}) {
  let found = null;
  for (const s of STORE_IDS) {
    if (s === store) continue;
    const at = itemAt(it, s, prefs);
    if (at.status === 'ok' && at.best && (!found || at.best.cost < found.best.cost)) {
      found = { store: s, best: at.best, buy: picksLabel(at.best.picks, it.family) };
    }
  }
  return found;
}

/**
 * Items (from aggregate) → the list at the chosen shop:
 *   { store, aisles: [{ name, items }], cupboard, cost, priced,
 *     missing: [ikey], second: { store, keys, cost } | null, stores }
 * Each shop item carries { at, swap, alt, via }: `via` names the second
 * shop when the item is bought there instead.
 * prefs: { store, cats, packs, storePacks, out } (all optional).
 */
export function shopPlan(items, prefs = {}) {
  const store = STORE_IDS.includes(prefs.store) ? prefs.store : 'tesco';
  const cats = prefs.cats || {};
  const cupboard = [];
  const shop = [];
  for (const it of items || []) {
    const ikey = it.ikey || it.key;
    const forced = cats[ikey];
    const seasoning = forced ? forced === 'cupboard' : isSeasoning(it.item, it.family, it.raw);
    if (seasoning) cupboard.push({ ...it, ikey });
    else shop.push({ ...it, ikey });
  }

  // How every shop does on this list — for the store chips and for
  // choosing a second shop.
  const stores = STORES.map(s => {
    let cost = 0; const missing = [];
    for (const it of shop) {
      const at = itemAt(it, s.id, prefs);
      if (at.status === 'out') missing.push(it.ikey);
      else if (at.best) cost += at.best.cost;
    }
    return { id: s.id, name: s.name, cost: Math.round(cost * 100) / 100, missing };
  });
  const here = stores.find(s => s.id === store);

  // Two or more gaps: the one other shop covering the most of them, then
  // the cheapest for those. One gap is handled item by item instead.
  let second = null;
  if (here.missing.length >= 2) {
    for (const s of STORE_IDS) {
      if (s === store) continue;
      let cost = 0; const keys = [];
      for (const k of here.missing) {
        const it = shop.find(x => x.ikey === k);
        const at = itemAt(it, s, prefs);
        if (at.status === 'ok') { keys.push(k); cost += at.best ? at.best.cost : 0; }
      }
      if (keys.length && (!second || keys.length > second.keys.length
        || (keys.length === second.keys.length && cost < second.cost))) second = { store: s, keys, cost: Math.round(cost * 100) / 100 };
    }
  }

  const byAisle = AISLES.map(name => ({ name, items: [] }));
  let cost = 0, priced = 0;
  for (const it of shop) {
    const cat = catalogueFor(it.ikey);
    let at = itemAt(it, store, prefs);
    let via = null;
    if (at.status === 'out' && second && second.keys.includes(it.ikey)) {
      via = second.store;
      at = itemAt(it, via, prefs);
    }
    const out = at.status === 'out';
    const swap = out ? swapAt(it, store, prefs) : null;
    const alt = out ? elsewhere(it, store, prefs) : null;
    if (at.best) { cost += at.best.cost; priced++; }
    byAisle[cat ? cat.aisle : AISLES.length - 1].items.push({
      ...it,
      at, via, swap, alt,
      packs: at.best,
      buy: at.best ? picksLabel(at.best.picks, it.family) : out ? '' : it.amount,
      ownPacks: !!at.own,
    });
  }
  return {
    store, aisles: byAisle.filter(a => a.items.length), cupboard,
    cost: Math.round(cost * 100) / 100, priced,
    missing: here.missing, second, stores,
  };
}
