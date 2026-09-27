/**
 * Ingredient lines → quantities you can add up.
 *
 * Recipes keep ingredients as the plain lines people type or paste
 * ("600g chicken thigh, diced"). The shopping list needs to know that
 * 600g + 300g of chicken thigh is 900g, so each line is parsed into
 * { qty, unit, item } on read. Nothing about the stored lines changes.
 *
 * Units fold into families so they can be summed: g (kg, oz, lb → g),
 * ml (l → ml), and spoon/cup/count units that stay as they are. A line
 * with no number ("salt and pepper") is kept as-is and listed once.
 *
 * Pure. No DOM, no network.
 */

const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

// token → [family, factor into the family's base unit]
const UNITS = {
  g: ['g', 1], gr: ['g', 1], gram: ['g', 1], grams: ['g', 1],
  kg: ['g', 1000], kilo: ['g', 1000], kilos: ['g', 1000],
  oz: ['g', 28.35], lb: ['g', 453.6], lbs: ['g', 453.6],
  ml: ['ml', 1], l: ['ml', 1000], litre: ['ml', 1000], litres: ['ml', 1000], liter: ['ml', 1000], liters: ['ml', 1000],
  tsp: ['tsp', 1], teaspoon: ['tsp', 1], teaspoons: ['tsp', 1],
  tbsp: ['tbsp', 1], tbs: ['tbsp', 1], tablespoon: ['tbsp', 1], tablespoons: ['tbsp', 1],
  cup: ['cup', 1], cups: ['cup', 1],
  clove: ['clove', 1], cloves: ['clove', 1],
  tin: ['tin', 1], tins: ['tin', 1], can: ['tin', 1], cans: ['tin', 1],
  slice: ['slice', 1], slices: ['slice', 1],
  pack: ['pack', 1], packs: ['pack', 1], packet: ['pack', 1], packets: ['pack', 1],
  x: ['x', 1], pc: ['x', 1], pcs: ['x', 1], piece: ['x', 1], pieces: ['x', 1], whole: ['x', 1],
  scoop: ['scoop', 1], scoops: ['scoop', 1],
};

function num(s) {
  if (!s) return null;
  const t = s.trim();
  let total = 0;
  for (const part of t.split(/\s+/)) {
    if (FRAC[part] != null) { total += FRAC[part]; continue; }
    const m = part.match(/^(\d+)?([½¼¾⅓⅔⅛])$/);
    if (m) { total += (m[1] ? Number(m[1]) : 0) + FRAC[m[2]]; continue; }
    const f = part.match(/^(\d+)\/(\d+)$/);
    if (f) { total += Number(f[1]) / Number(f[2]); continue; }
    const n = Number(part.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    total += n;
  }
  return total;
}

/** The item as a grouping key: lower case, no prep notes, no plural. */
export function itemKey(item) {
  return String(item || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(',')[0]
    .replace(/[^a-z0-9%&' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => (w.length > 3 && /[^s]s$/.test(w) && !/(ss|us|is)$/.test(w) ? w.replace(/(ies)$/, 'y').replace(/(oes)$/, 'o').replace(/s$/, '') : w))
    .join(' ');
}

/**
 * One line → { raw, qty, unit, family, base, item, key }.
 * `base` is qty in the family's base unit (g, ml, or the unit itself);
 * qty is null when the line has no leading amount.
 */
export function parseLine(raw) {
  const line = String(raw || '').replace(/^\s*(?:[-•*·▪]|\d+[.)])\s+/, '').trim();
  if (!line) return null;
  // amount (with fractions, "1 1/2", "½", "600g"), optional range tail, unit, item
  const m = line.match(/^((?:\d+(?:[.,]\d+)?(?:\s+\d+\/\d+|\s*[½¼¾⅓⅔⅛])?|\d+\/\d+|[½¼¾⅓⅔⅛]))\s*(?:[-–]\s*\d+(?:[.,]\d+)?\s*)?([a-zA-Z]+\.?)?\s*(?:of\s+)?(.*)$/);
  if (!m) return { raw: line, qty: null, unit: null, family: null, base: null, item: line, key: itemKey(line) };
  const qty = num(m[1].replace(/(\d)([½¼¾⅓⅔⅛])/, '$1 $2'));
  let unitTok = (m[2] || '').replace(/\.$/, '').toLowerCase();
  let rest = (m[3] || '').trim();
  let u = UNITS[unitTok];
  if (!u && unitTok) { rest = `${m[2]} ${rest}`.trim(); unitTok = ''; }
  const [family, factor] = u || ['x', 1];
  const item = rest || (unitTok ? unitTok : line);
  return {
    raw: line, qty, unit: u ? unitTok : null, family,
    base: qty == null ? null : qty * factor,
    item, key: itemKey(item),
  };
}

const round = (v, step) => Math.round(v / step) * step;
const trim = v => String(Math.round(v * 10) / 10).replace(/\.0$/, '');

/** A summed amount, in the unit you would buy it in. */
export function formatAmount(base, family) {
  if (base == null) return '';
  if (family === 'g') return base >= 1000 ? `${trim(base / 1000)} kg` : `${Math.max(5, round(base, 5))} g`;
  if (family === 'ml') return base >= 1000 ? `${trim(base / 1000)} l` : `${Math.max(5, round(base, 5))} ml`;
  if (family === 'x') return `${Math.ceil(base - 1e-9)}×`;
  if (['clove', 'tin', 'slice', 'pack', 'scoop'].includes(family)) {
    const n = Math.ceil(base - 1e-9);
    return `${n} ${family}${n === 1 ? '' : 's'}`;
  }
  // Spoons and cups: up to the next half — nobody measures 3.8 tbsp.
  return `${trim(Math.ceil(base * 2 - 1e-9) / 2)} ${family}`;
}

/**
 * Add up ingredient lines, each scaled by a factor.
 * @param rows [{ lines: string[], factor: number, from: string }]
 * @returns [{ key (unit family + item), ikey (item), item, family, base, amount, from[] }] by item;
 *          lines without an amount come out with base null, listed once.
 */
export function aggregate(rows) {
  const groups = new Map();
  for (const { lines, factor = 1, from = '' } of rows || []) {
    for (const raw of lines || []) {
      const p = parseLine(raw);
      if (!p || !p.key) continue;
      const k = p.base == null ? `?|${p.key}` : `${p.family}|${p.key}`;
      const g = groups.get(k) || { key: k, ikey: p.key, item: p.item.split(',')[0].trim(), family: p.base == null ? null : p.family, base: p.base == null ? null : 0, from: [] };
      if (p.base != null) g.base += p.base * factor;
      if (from && !g.from.includes(from)) g.from.push(from);
      groups.set(k, g);
    }
  }
  return [...groups.values()]
    .map(g => ({ ...g, amount: formatAmount(g.base, g.family) }))
    .sort((a, b) => (a.base == null) - (b.base == null) || a.item.localeCompare(b.item));
}

/** Structured {qty, unit, item} (as the video reader returns) → a line. */
export function toLine({ qty, unit, item } = {}) {
  const q = qty == null || qty === '' ? '' : String(Math.round(Number(qty) * 100) / 100);
  const u = unit ? String(unit).trim() : '';
  const joiner = q && u && /^(g|kg|ml|l|oz|lb)$/i.test(u) ? '' : ' ';
  return [q && u ? `${q}${joiner}${u}` : q || u, String(item || '').trim()].filter(Boolean).join(' ').trim();
}
