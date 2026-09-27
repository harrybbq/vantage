/**
 * The meal planner — recipes laid over a run of days, checked against
 * the day's targets, and turned into a shopping list.
 *
 * Stored as one new key, S.mealPlan:
 *   { start: 'YYYY-MM-DD', days: 4,
 *     entries: [{ id, day: 0..days-1, recipeId, servings }],
 *     bought:  [shopping-list keys ticked off] }
 *
 * Targets are READ from the Diet plan exactly as the Plan panel shows
 * them — training-day or rest-day calories/carbs/fat by the rotation,
 * protein from bodyweight — and never written from here.
 *
 * Pure. No DOM, no network.
 */
import { resolveDay, TRAIN_POS } from '../rotation/pattern.js';
import { aggregate } from './ingredients.js';

const isoAdd = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};

/** The days of the plan, with shift and whether it is a training day. */
export function planDays(start, n, overrides = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const iso = isoAdd(start, i);
    const [y, m, d] = iso.split('-').map(Number);
    const r = resolveDay(y, m - 1, d, overrides);
    out.push({
      i, iso,
      shift: r.inPattern ? r.shift : 'unknown',
      shiftNum: r.shiftNum || null,
      session: r.session || 'Rest',
      train: r.inPattern && TRAIN_POS.includes(r.pos),
    });
  }
  return out;
}

/**
 * The shift block to prep for: the one you're in (from today), or the
 * next one to start. → { start, days } — a block is its run of
 * consecutive day or night shifts; leave breaks it.
 */
export function nextShiftBlock(todayIso, overrides = {}) {
  const look = planDays(todayIso, 20, overrides);
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
    const r = (recipes || []).find(x => x.id === e.recipeId);
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
  for (const e of entries || []) by.set(e.recipeId, (by.get(e.recipeId) || 0) + (Number(e.servings) || 0));
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
  const items = aggregate(b.map(x => ({
    lines: (x.recipe.ingredients || []).filter(l => String(l).trim()),
    factor: x.batches,
    from: x.recipe.title || 'Untitled recipe',
  })));
  const missing = b.filter(x => !(x.recipe.ingredients || []).some(l => String(l).trim())).map(x => x.recipe);
  return { items, missing };
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
