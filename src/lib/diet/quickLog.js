/**
 * Logging a food you have had before, from the hub.
 *
 * The Nutrition card's "+" opens a small menu of recently logged foods;
 * one tap logs one again. Anything else (search, barcode, the camera,
 * editing a serving) stays on the Track diet page, which the menu links
 * to. The hub is for the repeat, the page is for the new.
 *
 * ── What a log has to do ─────────────────────────────────────────────
 * The same three things the diet page does, in the same order:
 *   1. insert the row into nutrition_log (the user's own, RLS-scoped);
 *   2. recompute that day's nutrition_daily_summary from the rows —
 *      the summary is maintained by the client, not a trigger, so an
 *      insert on its own would leave every ring reading the old total;
 *   3. tell every mounted card to refetch (lib/diet/daySummary).
 * The caller also writes today's S.macroHistory entry, which the Track
 * page would otherwise only write the next time it is opened.
 *
 * Inserts only. Nothing here updates or deletes a log row.
 */
import { supabase } from '../supabase';
import { refreshDaySummary } from './daySummary';
import { mealForTime } from './logMath';

const RECENT_TTL = 60_000;
let recentCache = { userId: null, at: 0, items: null };

/** Most recent distinct foods (by name), newest first. */
export function dedupeRecent(rows, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const key = String(r.food_name || '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchRecentFoods(userId, { force = false, limit = 8 } = {}) {
  if (!userId) return [];
  if (!force && recentCache.userId === userId && recentCache.items && Date.now() - recentCache.at < RECENT_TTL) {
    return recentCache.items.slice(0, limit);
  }
  const { data, error } = await supabase
    .from('nutrition_log')
    .select('food_name,brand,serving_g,calories,protein_g,carbs_g,fat_g,fibre_g,sugar_g,sodium_mg,additional_nutrients,log_date,id')
    .eq('user_id', userId)
    .order('log_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(60);
  if (error) throw error;
  // Cache the longest list anyone asks for; shorter callers slice it.
  const items = dedupeRecent(data || [], 15);
  recentCache = { userId, at: Date.now(), items };
  return items.slice(0, limit);
}

/** The meal a log defaults to by the clock — one rule for the hub menu
 *  and the Track page panel (lib/diet/logMath). */
export function mealForHour(h, m = 0) {
  return mealForTime(h, m);
}

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A past log row → a new row for today. Same food, same serving. */
export function rowFor(userId, food, mealType, day = ymd(new Date())) {
  const n = v => Number(v) || 0;
  return {
    user_id: userId,
    log_date: day,
    meal_type: mealType,
    food_name: String(food.food_name || '').trim(),
    brand: food.brand || null,
    serving_g: n(food.serving_g) || 100,
    calories: n(food.calories),
    protein_g: n(food.protein_g),
    carbs_g: n(food.carbs_g),
    fat_g: n(food.fat_g),
    fibre_g: n(food.fibre_g),
    sugar_g: n(food.sugar_g),
    sodium_mg: n(food.sodium_mg),
    additional_nutrients: food.additional_nutrients && food.additional_nutrients.serving_unit === 'ml'
      ? { serving_unit: 'ml' } : {},
    source: 'again',          // what the diet page calls a one-tap re-log
  };
}

/** An error that says what actually happened, for the UI to show as is. */
function failure(res, what) {
  const code = res && res.status ? ` ${res.status}` : '';
  const msg = res && res.error && res.error.message ? ` (${res.error.message})` : '';
  return new Error(`The server returned${code || ' an error'}${msg} while ${what}.`);
}
const withTimeout = (p, ms) => Promise.race([
  p, new Promise((_, reject) => setTimeout(() => reject(new Error(`No answer from the server within ${Math.round(ms / 1000)} seconds.`)), ms)),
]);

/**
 * Insert one log row and bring that day's summary up to date. The one
 * round trip every logging surface makes (hub menu, Track page panel).
 *
 * Resolves to { id, day, summary }; rejects with an Error whose message
 * names the real failure — a status code or a timeout — so the caller
 * can show it and offer a retry with nothing the user typed lost.
 */
export async function logFoodEntry(userId, row, { timeoutMs = 8000 } = {}) {
  const day = row.log_date;
  const ins = await withTimeout(supabase.from('nutrition_log').insert(row).select('id'), timeoutMs);
  if (ins && ins.error) throw failure(ins, 'saving it');
  const id = Array.isArray(ins && ins.data) && ins.data[0] ? ins.data[0].id : null;

  // Recompute the day's summary exactly as the diet page does.
  const sel = await withTimeout(supabase
    .from('nutrition_log')
    .select('calories,protein_g,carbs_g,fat_g,fibre_g,sugar_g,sodium_mg')
    .eq('user_id', userId)
    .eq('log_date', day), timeoutMs);
  if (sel && sel.error) throw failure(sel, 'updating the day total');
  const rows = (sel && sel.data) || [];
  const sum = rows.reduce((a, r) => ({
    calories: a.calories + (r.calories || 0),
    protein_g: a.protein_g + (r.protein_g || 0),
    carbs_g: a.carbs_g + (r.carbs_g || 0),
    fat_g: a.fat_g + (r.fat_g || 0),
    fibre_g: a.fibre_g + (r.fibre_g || 0),
    sugar_g: a.sugar_g + (r.sugar_g || 0),
    sodium_mg: a.sodium_mg + (r.sodium_mg || 0),
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, sugar_g: 0, sodium_mg: 0 });
  const up = await withTimeout(supabase.from('nutrition_daily_summary').upsert({
    user_id: userId, log_date: day, ...sum, entry_count: rows.length, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,log_date' }), timeoutMs);
  if (up && up.error) throw failure(up, 'updating the day total');

  recentCache = { userId: null, at: 0, items: null };
  refreshDaySummary(userId);
  return { id, day, summary: sum };
}

/**
 * Log one food for today, again. Resolves to the fresh day summary.
 * Throws on failure, so the menu can say so and offer a retry.
 */
export async function quickLogFood(userId, food, mealType) {
  const day = ymd(new Date());
  const { summary } = await logFoodEntry(userId, rowFor(userId, food, mealType, day), { timeoutMs: 12000 });
  return { day, summary };
}


/**
 * Today's S.macroHistory entry from a summary and the macro goals — the
 * same % the Track page writes, so the 14-day trend stays true.
 * Returns null when there are no goals to divide by.
 */
export function historyEntry(summary, macros) {
  const spec = { cal: ['Calories', 'calories'], pro: ['Protein', 'protein_g'], carb: ['Carbs', 'carbs_g'], fat: ['Fat', 'fat_g'] };
  const out = {};
  for (const [k, [name, field]] of Object.entries(spec)) {
    const m = (macros || []).find(x => x.name === name);
    if (!m || !m.daily_goal) continue;
    out[k] = Math.min(999, Math.round(((Number(summary[field]) || 0) / m.daily_goal) * 100));
  }
  return Object.keys(out).length ? out : null;
}
