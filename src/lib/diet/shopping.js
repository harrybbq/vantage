/**
 * The shopping list, as you would actually buy it.
 *
 * Takes the summed ingredients (ingredients.js → aggregate) and:
 *   1. splits off SEASONINGS & CUPBOARD items — spices, sauces, oils,
 *      stock — which you check you have rather than buy by the gram.
 *      Detected from the item's name and how it is measured (tsp,
 *      "pinch", "to taste"…); a tap moves an item either way and the
 *      choice is remembered (S.shopPrefs.cats).
 *   2. rounds everything else into real PACKS, choosing the cheapest
 *      combination that covers what is needed — a bigger pack wins when
 *      it costs less — and, at equal cost, the one with least left over.
 *   3. groups it by aisle.
 *
 * Pack sizes and prices are typical UK supermarket figures, ESTIMATES,
 * and any item's packs can be replaced with your own (S.shopPrefs.packs).
 *
 * Pure. No DOM, no network.
 */

export const AISLES = ['Meat & fish', 'Dairy & eggs', 'Fruit & veg', 'Rice, pasta & bread', 'Tins & jars', 'Other'];

// Order matters: the first match wins, so specific items come first.
// packs are keyed by unit family (g, ml, x = count, tin …); size is in
// that family's base unit; price in £ (typical, estimate).
const P = (size, price, label) => ({ size, price, ...(label ? { label } : {}) });
export const CATALOGUE = [
  // Meat & fish
  { re: /turkey mince/, aisle: 0, packs: { g: [P(500, 3.25), P(1000, 5.75)] } },
  { re: /chicken mince/, aisle: 0, packs: { g: [P(500, 3.5)] } },
  { re: /pork mince/, aisle: 0, packs: { g: [P(500, 3.0), P(750, 4.25)] } },
  { re: /mince/, aisle: 0, packs: { g: [P(500, 3.5), P(750, 4.99), P(1000, 6.25)] } },
  { re: /chicken breast/, aisle: 0, packs: { g: [P(300, 2.75), P(650, 4.75), P(1000, 6.5)], x: [P(2, 2.75), P(4, 4.75)] } },
  { re: /chicken thigh/, aisle: 0, packs: { g: [P(500, 3.2), P(1000, 5.5)] } },
  { re: /salmon/, aisle: 0, packs: { x: [P(2, 3.75), P(4, 6.5)], g: [P(240, 3.75), P(480, 6.5)] } },
  { re: /cod|haddock|white fish/, aisle: 0, packs: { x: [P(2, 3.5), P(4, 6.0)], g: [P(280, 3.5)] } },
  { re: /prawn/, aisle: 0, packs: { g: [P(150, 2.5), P(300, 4.25)] } },
  { re: /tuna/, aisle: 0, packs: { tin: [P(1, 1.1), P(4, 3.75)], x: [P(1, 1.1), P(4, 3.75)] } },
  { re: /steak|sirloin|rump/, aisle: 0, packs: { x: [P(1, 4.5), P(2, 8.0)], g: [P(225, 4.5), P(450, 8.0)] } },
  { re: /bacon/, aisle: 0, packs: { g: [P(300, 2.75)], slice: [P(10, 2.75)], x: [P(10, 2.75)] } },
  { re: /sausage/, aisle: 0, packs: { x: [P(6, 2.5), P(12, 4.5)] } },
  // Dairy & eggs
  { re: /\beggs?\b/, aisle: 1, packs: { x: [P(6, 1.6), P(12, 2.95), P(15, 3.4)] } },
  { re: /milk/, aisle: 1, packs: { ml: [P(568, 0.75, '1 pint'), P(1136, 1.25, '2 pints'), P(2272, 1.65, '4 pints')] } },
  { re: /cottage cheese/, aisle: 1, packs: { g: [P(300, 1.45)] } },
  { re: /yogh?urt|skyr/, aisle: 1, packs: { g: [P(500, 1.6), P(1000, 2.6)] } },
  { re: /cheddar|mozzarella|cheese/, aisle: 1, packs: { g: [P(200, 2.1), P(400, 3.4)] } },
  { re: /butter/, aisle: 1, packs: { g: [P(250, 2.3)] } },
  // Fruit & veg
  { re: /sweet potato/, aisle: 2, packs: { g: [P(1000, 1.5)], x: [P(1, 0.4)] } },
  { re: /potato/, aisle: 2, packs: { g: [P(1000, 1.0), P(2500, 1.65)], x: [P(1, 0.25)] } },
  { re: /onion/, aisle: 2, packs: { x: [P(1, 0.15), P(3, 0.65)], g: [P(1000, 0.95)] } },
  { re: /banana/, aisle: 2, packs: { x: [P(1, 0.18), P(5, 0.85)] } },
  { re: /broccoli/, aisle: 2, packs: { x: [P(1, 0.75)], g: [P(350, 0.75)] } },
  { re: /avocado/, aisle: 2, packs: { x: [P(1, 0.85), P(2, 1.5)] } },
  { re: /(bell )?pepper$/, aisle: 2, packs: { x: [P(1, 0.55), P(3, 1.4)] } },
  { re: /spinach/, aisle: 2, packs: { g: [P(240, 1.3)] } },
  { re: /lettuce/, aisle: 2, packs: { x: [P(1, 0.6)] } },
  { re: /berr/, aisle: 2, packs: { g: [P(150, 2.0), P(300, 3.5)] } },
  { re: /garlic/, aisle: 2, packs: { clove: [P(10, 0.35, '1 bulb')], x: [P(1, 0.35, '1 bulb')] } },
  // Rice, pasta & bread
  { re: /rice/, aisle: 3, packs: { g: [P(500, 0.9), P(1000, 1.6), P(2000, 2.75)] } },
  { re: /pasta|spaghetti|penne|fusilli|noodle/, aisle: 3, packs: { g: [P(500, 0.75), P(1000, 1.3)] } },
  { re: /\boats?\b|porridge/, aisle: 3, packs: { g: [P(1000, 0.95)] } },
  { re: /tortilla|wrap/, aisle: 3, packs: { x: [P(8, 1.2)] } },
  { re: /bagel/, aisle: 3, packs: { x: [P(5, 1.2)] } },
  // Tins & jars
  { re: /chopped tomato|tinned tomato|plum tomato/, aisle: 4, packs: { tin: [P(1, 0.45), P(4, 1.6)], x: [P(1, 0.45), P(4, 1.6)] } },
  { re: /bean|chickpea|lentil/, aisle: 4, packs: { tin: [P(1, 0.55), P(4, 2.0)], x: [P(1, 0.55), P(4, 2.0)], g: [P(400, 0.55)] } },
  { re: /coconut milk/, aisle: 4, packs: { tin: [P(1, 1.1)], ml: [P(400, 1.1)] } },
  { re: /peanut butter/, aisle: 4, packs: { g: [P(340, 2.0)] } },
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
 * Items (from aggregate) → { aisles: [{ name, items }], cupboard: [...],
 *   cost, priced }.
 * prefs: { cats: { [ikey]: 'cupboard'|'shop' }, packs: { [ikey]: { [family]: [{size, price}] } } }
 */
export function shopPlan(items, prefs = {}) {
  const cats = prefs.cats || {};
  const own = prefs.packs || {};
  const cupboard = [];
  const byAisle = AISLES.map(name => ({ name, items: [] }));
  let cost = 0, priced = 0;
  for (const it of items || []) {
    const ikey = it.ikey || it.key;
    const forced = cats[ikey];
    const seasoning = forced ? forced === 'cupboard' : isSeasoning(it.item, it.family, it.raw);
    if (seasoning) { cupboard.push({ ...it, ikey }); continue; }
    const cat = catalogueFor(ikey);
    const packs = (own[ikey] && own[ikey][it.family]) || (cat && cat.packs[it.family]) || null;
    const best = it.base != null && packs ? bestPacks(it.base, packs) : null;
    if (best) { cost += best.cost; priced++; }
    byAisle[cat ? cat.aisle : AISLES.length - 1].items.push({
      ...it, ikey,
      packs: best,
      buy: best ? picksLabel(best.picks, it.family) : it.amount,
      ownPacks: !!(own[ikey] && own[ikey][it.family]),
    });
  }
  return { aisles: byAisle.filter(a => a.items.length), cupboard, cost: Math.round(cost * 100) / 100, priced };
}
