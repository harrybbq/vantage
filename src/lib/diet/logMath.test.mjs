/**
 * Logging arithmetic. Run: node src/lib/diet/logMath.test.mjs
 */
import assert from 'node:assert/strict';
import { mealForTime, scaled, fromPer100, presetsFor, energySplit, logRow, savedMeal, mealAsFood, unitOf, baseOf } from './logMath.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ── Meal from the clock ──
eq(mealForTime(7), 'breakfast', '07:00 → breakfast');
eq(mealForTime(10, 59), 'breakfast', '10:59 → breakfast');
eq(mealForTime(11), 'lunch', '11:00 → lunch');
eq(mealForTime(15, 30), 'snack', '15:30 → snack');
eq(mealForTime(18), 'dinner', '18:00 → dinner');
eq(mealForTime(21, 30), 'snack', '21:30 → snack');
eq(mealForTime(2), 'breakfast', 'the small hours count as breakfast');

// ── Scaling ──
const chicken = { food_name: 'Chicken breast', serving_g: 100, calories: 106, protein_g: 24, carbs_g: 0, fat_g: 1.1, fibre_g: 0, sugar_g: 0, sodium_mg: 150 };
eq(scaled(chicken, 150), { calories: 159, protein_g: 36, carbs_g: 0, fat_g: 1.7, fibre_g: 0, sugar_g: 0, sodium_mg: 225 }, '150 g of a per-100 food');
eq(scaled(chicken, 0).calories, 0, 'nothing is nothing');
eq(scaled({ serving_g: '260', calories: '638', protein_g: '23' }, 130).calories, 319, 'string fields (saved meals) scale too');
eq(scaled({ calories: 90 }, 100).calories, 90, 'no serving_g means the values are per 100');
eq(fromPer100({ calories: 214, protein_g: 11 }, 120), { calories: 257, protein_g: 13.2, carbs_g: 0, fat_g: 0, fibre_g: 0, sugar_g: 0, sodium_mg: 0 }, 'manual per-100 values scale to the serving');

// ── Presets ──
eq(presetsFor(chicken).map(p => p.amount), [100, 150, 200], 'per-100 foods offer 100/150/200');
eq(presetsFor({ serving_g: 260 }).map(p => p.amount), [130, 260, 390], 'a serving offers half, one, one and a half');

// ── Units ──
eq(unitOf({ additional_nutrients: { serving_unit: 'ml' } }), 'ml', 'ml from a stored row');
eq(unitOf({ serving_unit: 'ml' }), 'ml', 'ml from a saved meal or search result');
eq(unitOf({}), 'g', 'grams by default');
eq(baseOf({ serving_g: '' }), 100, 'blank serving is 100');

// ── Energy split ──
{
  const s = energySplit({ protein_g: 25, carbs_g: 50, fat_g: 10 });
  ok(Math.abs(s.p + s.c + s.f - 100) < 1e-9, 'the split adds to 100');
  eq(Math.round(s.c), 51, 'carbs 200 of 390 kcal');
  eq(energySplit({}), { p: 0, c: 0, f: 0 }, 'nothing to split');
}

// ── Stored shapes ──
{
  const row = logRow({ userId: 'u', day: '2026-09-25', meal: 'lunch', name: '  Chicken breast ', brand: '', amount: 150, unit: 'g', values: scaled(chicken, 150), source: 'search' });
  eq([row.food_name, row.brand, row.serving_g, row.calories, row.log_date, row.meal_type, row.source], ['Chicken breast', null, 150, 159, '2026-09-25', 'lunch', 'search'], 'a log row');
  eq(row.additional_nutrients, {}, 'grams carry no unit flag');
  eq(logRow({ amount: 330, unit: 'ml', values: {} }).additional_nutrients, { serving_unit: 'ml' }, 'ml rides in additional_nutrients');
  const m = savedMeal({ id: 'meal1', name: 'Wrap', brand: 'Pret', meal: 'lunch', amount: 210, unit: 'g', values: { calories: 420, protein_g: 34 } });
  eq([m.name, m.food_name, m.serving_g, m.calories, m.protein_g, m.serving_unit], ['Wrap', 'Wrap', '210', '420', '34', 'g'], 'a saved meal, in its string form');
  const back = mealAsFood(m);
  eq([back.serving_g, back.calories, back.food_name], [210, 420, 'Wrap'], 'and back to a food');
}

console.log(`log maths: ${n} assertions passed`);
