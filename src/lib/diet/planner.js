/**
 * The meal planner — recipes laid over a run of days, checked against
 * the day's targets, and turned into a shopping list.
 *
 * Stored as one new key, S.mealPlan:
 *   { start: 'YYYY-MM-DD', days: 4,
 *     entries: [{ id, day: 0..days-1, recipeId, servings }            a recipe
 *              | { id, day, food: { name, brand, amount, unit, portion,
 *                  kcal, protein, carbs, fat }, servings }],        a single food
 *     bought:  [shopping-list keys ticked off] }
 * A food entry carries its own figures for ONE portion (`amount` g/ml,
 * or one of the food's own servings when portion is 'serving'), so the
 * plan never depends on a food database answering again.
 *
 * Targets are READ from the Diet plan exactly as the Plan panel shows
 * them — training-day or rest-day calories/carbs/fat by the rotation,
 * protein from bodyweight — and never written from here.
 *
 * Pure. No DOM, no network.
 */
import { resolveDay, patternDay, DEFAULT_SCHEDULE } from '../rotation/pattern.js';
import { aggregate } from './ingredients.js';

const isoAdd = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};

/**
 * The days of the plan, with shift and whether it is a training day.
 * `train` follows the PATTERN's session (as TRAIN_POS did), not a
 * swapped one, so the targets stay the plan's.
 */
export function planDays(start, n, overrides = {}, schedule = DEFAULT_SCHEDULE) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const iso = isoAdd(start, i);
    const [y, m, d] = iso.split('-').map(Number);
    const r = resolveDay(y, m - 1, d, overrides, schedule);
    out.push({
      i, iso,
      shift: r.inPattern ? r.shift : 'unknown',
      shiftNum: r.shiftNum || null,
      session: r.session || 'Rest',
      train: r.inPattern && patternDay(y, m - 1, d, schedule).session !== 'Rest',
    });
  }
  return out;
}

/**
 * The shift block to prep for: the one you're in (from today), or the
 * next one to start. → { start, days } — a block is its run of
 * consecutive day or night shifts; leave breaks it.
 */
export function nextShiftBlock(todayIso, overrides = {}, schedule = DEFAULT_SCHEDULE) {
  const look = planDays(todayIso, 20, overrides, schedule);
  const isShift = d => d.shift === 'day' || d.shift === 'night';
  const first = look.findIndex(isShift);
  if (first < 0) return { start: todayIso, days: 4 };
  let n = 0;
  while (first + n < look.length && isShift(look[first + n]) && look[first + n].shift === look[first].shift) n++;
  return { start: look[first].iso, days: Math.max(1, n) };
}

/** The day's targets from the plan (train vs rest), protein fixed. */
export function targetsFor(day, plan, proteinG) {
  const t = day.train;
  return {
    kcal: t ? plan.trainKcal : plan.restKcal,
    protein: proteinG,
    carbs: t ? plan.trainCarbs : plan.restCarbs,
    fat: t ? plan.trainFat : plan.restFat,
  };
}

const MACROS = ['kcal', 'protein', 'carbs', 'fat'];

/** Totals for a set of entries (servings × per-serving figures). */
export function totalsOf(entries, recipes) {
  const out = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries || []) {
    const r = e.food || (recipes || []).find(x => x.id === e.recipeId);
    if (!r) continue;
    const n = Math.max(0, Number(e.servings) || 0);
    for (const k of MACROS) out[k] += (Number(r[k]) || 0) * n;
  }
  for (const k of MACROS) out[k] = Math.round(out[k]);
  return out;
}

/**
 * How a day stands. Protein counts as met within 5 g; calories within
 * 5% either way.
 * → { total, target, protein: gap g (−short / +over), kcal: gap,
 *     status: 'empty'|'short'|'over'|'ok' }
 */
export function dayStatus(entries, recipes, target) {
  const total = totalsOf(entries, recipes);
  const protein = total.protein - target.protein;
  const kcal = total.kcal - target.kcal;
  let status = 'ok';
  if (!entries.length) status = 'empty';
  else if (protein < -5) status = 'short';
  else if (kcal > target.kcal * 0.05) status = 'over';
  else if (kcal < -target.kcal * 0.05) status = 'short';
  return { total, target, protein, kcal, status };
}

/**
 * What to add to close a protein gap without blowing the calories:
 * recipes by protein per 100 kcal, whose serving fits the kcal left
 * (with a little slack), best first.
 */
export function suggest(st, recipes, { limit = 3, slack = 150 } = {}) {
  if (st.protein >= -5) return [];
  const room = st.target.kcal - st.total.kcal + slack;
  return (recipes || [])
    .filter(r => (Number(r.protein) || 0) > 0 && (Number(r.kcal) || 0) > 0 && r.kcal <= room)
    .map(r => ({ recipe: r, density: r.protein / r.kcal, closes: Math.min(r.protein, -st.protein) }))
    .sort((a, b) => b.density - a.density || b.recipe.protein - a.recipe.protein)
    .slice(0, limit);
}

/**
 * Servings planned per recipe, and how many batches that is.
 * → [{ recipe, servings, batches }] most-used first
 */
export function batchesOf(entries, recipes) {
  const by = new Map();
  for (const e of entries || []) if (!e.food) by.set(e.recipeId, (by.get(e.recipeId) || 0) + (Number(e.servings) || 0));
  return [...by.entries()]
    .map(([id, servings]) => {
      const recipe = (recipes || []).find(r => r.id === id);
      return recipe ? { recipe, servings, batches: servings / Math.max(1, Number(recipe.servings) || 1) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.servings - a.servings);
}

/**
 * The shopping list: every planned recipe's ingredients scaled by the
 * servings planned over the servings it makes, then added up.
 * Also names the planned recipes that have no ingredients yet.
 */
export function shoppingList(entries, recipes) {
  const b = batchesOf(entries, recipes);
  const items = aggregate([
    ...b.map(x => ({
      lines: (x.recipe.ingredients || []).filter(l => String(l).trim()),
      factor: x.batches,
      from: x.recipe.title || 'Untitled recipe',
    })),
    ...foodLines(entries),
  ]);
  const missing = b.filter(x => !(x.recipe.ingredients || []).some(l => String(l).trim())).map(x => x.recipe);
  return { items, missing };
}

/**
 * Single foods as shopping lines: counted when planned by the food's own
 * serving ("7 banana"), weighed otherwise ("1050g greek yoghurt").
 */
export function foodLines(entries) {
  const by = new Map();
  for (const e of entries || []) {
    if (!e.food || !e.food.name) continue;
    const f = e.food;
    const k = `${f.portion === 'serving' ? 'n' : f.unit || 'g'}|${f.name.toLowerCase()}`;
    const cur = by.get(k) || { f, total: 0 };
    cur.total += (Number(e.servings) || 0) * (f.portion === 'serving' ? 1 : Number(f.amount) || 0);
    by.set(k, cur);
  }
  return [...by.values()].map(({ f, total }) => ({
    lines: [f.portion === 'serving' ? `${Math.ceil(total - 1e-9)} ${f.name}` : `${Math.round(total)}${f.unit === 'ml' ? 'ml' : 'g'} ${f.name}`],
    factor: 1,
    from: 'Foods',
  }));
}

/** Average protein per day against target, over the days that have food. */
export function planSummary(days, entries, recipes, plan, proteinG) {
  const st = days.map(d => dayStatus(entries.filter(e => e.day === d.i), recipes, targetsFor(d, plan, proteinG)));
  const filled = st.filter(s => s.status !== 'empty');
  const avg = k => (filled.length ? Math.round(filled.reduce((a, s) => a + s.total[k], 0) / filled.length) : 0);
  return {
    st,
    filled: filled.length,
    short: st.filter(s => s.status === 'short' || (s.status !== 'empty' && s.protein < -5)).length,
    avgProtein: avg('protein'),
    avgKcal: avg('kcal'),
    proteinTarget: proteinG,
  };
}

export const EMPTY_PLAN = () => ({ start: null, days: 4, entries: [], bought: [] });

/* ── Single foods from the food search ─────────────────────────────── */

const n0 = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Portion choices for a search result. Its nutrient values are FOR
 * serving_g (the food-search contract), so a food with its own serving
 * offers that first; 100 g is always there; any amount can be typed.
 */
export function portionOptions(food) {
  const base = n0(food && food.serving_g) || 100;
  const unit = food && food.serving_unit === 'ml' ? 'ml' : 'g';
  const out = [];
  if (base !== 100) out.push({ portion: 'serving', amount: base, label: `1 serving (${Math.round(base)} ${unit})` });
  out.push({ portion: 'amount', amount: 100, label: `100 ${unit}` });
  return out;
}

/** A search result + a portion → the food a plan entry carries. */
export function planFood(food, { portion = 'amount', amount = 100 } = {}) {
  const base = n0(food && food.serving_g) || 100;
  const k = n0(amount) / base;
  const r1 = v => Math.round(n0(v) * k * 10) / 10;
  return {
    name: String((food && food.food_name) || (food && food.name) || 'Food').trim(),
    brand: String((food && food.brand) || '').trim(),
    amount: Math.round(n0(amount) * 10) / 10,
    unit: food && food.serving_unit === 'ml' ? 'ml' : 'g',
    portion,
    kcal: Math.round(n0(food && food.calories) * k),
    protein: r1(food && food.protein_g),
    carbs: r1(food && food.carbs_g),
    fat: r1(food && food.fat_g),
  };
}

/** Remember a planned food as a one-tap pick (newest first, 12 kept). */
export function rememberFood(list, f) {
  const same = x => x.name.toLowerCase() === f.name.toLowerCase() && x.amount === f.amount && x.portion === f.portion;
  return [f, ...(list || []).filter(x => !same(x))].slice(0, 12);
}
