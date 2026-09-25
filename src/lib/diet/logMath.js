/**
 * The arithmetic behind logging a food: which meal it is by the clock,
 * what a serving works out to, and the shapes a log row and a saved meal
 * are stored in. No I/O — the desktop Log food panel and its tests both
 * read it, and the numbers it produces are the numbers that get stored.
 *
 * A food here is whatever the search function, the recent list or a
 * saved meal hands over: nutrient fields in the log table's own names
 * (calories, protein_g, …) for `serving_g` of it.
 */

export const NUTRIENTS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g', 'sugar_g', 'sodium_mg'];

/** Breakfast before 11, lunch to 3, a snack to 5, dinner to 9, then a
 *  snack again. Always one tap to change; this is only the guess. */
export function mealForTime(h, m = 0) {
  const t = h + m / 60;
  if (t < 11) return 'breakfast';
  if (t < 15) return 'lunch';
  if (t < 17) return 'snack';
  if (t < 21) return 'dinner';
  return 'snack';
}

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** g or ml — ml rides in additional_nutrients on stored rows. */
export function unitOf(food) {
  if (!food) return 'g';
  if (food.serving_unit === 'ml') return 'ml';
  if (food.additional_nutrients && food.additional_nutrients.serving_unit === 'ml') return 'ml';
  return 'g';
}

/** How much of the food its nutrient values describe. */
export const baseOf = food => num(food && food.serving_g) || 100;

/** Calories and sodium are whole numbers; grams keep one decimal. */
export function roundNutrient(key, v) {
  return key === 'calories' || key === 'sodium_mg' ? Math.round(v) : Math.round(v * 10) / 10;
}

/** The food's nutrients for `amount` (g or ml) of it. */
export function scaled(food, amount) {
  const k = num(amount) / baseOf(food);
  const out = {};
  for (const key of NUTRIENTS) out[key] = roundNutrient(key, num(food && food[key]) * k);
  return out;
}

/** Manual entry is typed per 100 g/ml (as it is printed on a pack). */
export function fromPer100(per100, amount) {
  const k = num(amount) / 100;
  const out = {};
  for (const key of NUTRIENTS) out[key] = roundNutrient(key, num(per100 && per100[key]) * k);
  return out;
}

/** Quick serving chips: 100/150/200 for per-100 foods, else ½, 1, 1½ of the food's own serving. */
export function presetsFor(food) {
  const base = baseOf(food);
  if (base === 100) return [100, 150, 200].map(g => ({ amount: g, label: null }));
  return [
    { amount: Math.round(base / 2), label: '½ serving' },
    { amount: base, label: '1 serving' },
    { amount: Math.round(base * 1.5), label: '1½ servings' },
  ];
}

/** Share of energy from protein / carbs / fat, as percentages (4/4/9 kcal per g). */
export function energySplit(food) {
  const p = num(food && food.protein_g) * 4;
  const c = num(food && food.carbs_g) * 4;
  const f = num(food && food.fat_g) * 9;
  const t = p + c + f;
  if (t <= 0) return { p: 0, c: 0, f: 0 };
  return { p: (p / t) * 100, c: (c / t) * 100, f: (f / t) * 100 };
}

/** A nutrition_log row. `values` are the nutrients for `amount`. */
export function logRow({ userId, day, meal, name, brand, amount, unit, values, source }) {
  const row = {
    user_id: userId,
    log_date: day,
    meal_type: meal,
    food_name: String(name || '').trim(),
    brand: brand ? String(brand).trim() || null : null,
    serving_g: num(amount) || 100,
    additional_nutrients: unit === 'ml' ? { serving_unit: 'ml' } : {},
    source: source || 'manual',
  };
  for (const key of NUTRIENTS) row[key] = num(values && values[key]);
  return row;
}

/** The saved-meal shape the rest of the app reads (see FoodLogSheet). */
export function savedMeal({ id, name, brand, meal, amount, unit, values }) {
  const m = {
    id,
    name: String(name || '').trim(),
    food_name: String(name || '').trim(),
    brand: String(brand || '').trim(),
    meal_type: meal,
    serving_g: String(num(amount) || 100),
    serving_unit: unit === 'ml' ? 'ml' : 'g',
  };
  for (const key of NUTRIENTS) m[key] = String(num(values && values[key]));
  return m;
}

/** A saved meal read back as a food (its fields are strings). */
export function mealAsFood(m) {
  const f = { ...m, food_name: m.food_name || m.name, serving_g: num(m.serving_g) || 100 };
  for (const key of NUTRIENTS) f[key] = num(m[key]);
  if (m.serving_unit === 'ml') f.serving_unit = 'ml';
  return f;
}
