// node src/lib/diet/mealOffers.test.mjs — one-tap meals into S.savedMeals (Nov 2026).
import assert from 'node:assert/strict';
import { OFFERED_MEALS, pendingMealOffers, addOfferedMeal, dismissMealOffer } from './mealOffers.js';
import { mealAsFood, NUTRIENTS } from './logMath.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const shake = OFFERED_MEALS[0];

t('the shake is a well-formed saved meal: one 330 ml serving', () => {
  assert.equal(shake.serving_unit, 'ml');
  const f = mealAsFood(shake);
  assert.equal(f.serving_g, 330);
  assert.deepEqual([f.calories, f.protein_g, f.carbs_g, f.fat_g], [267, 35, 17, 7]);
  for (const k of NUTRIENTS) assert.ok(Number.isFinite(f[k]), k);
});

t('offered until added, then never again — even after the meal is deleted', () => {
  const S = { savedMeals: [{ id: 'm1', name: 'Porridge' }], coins: 5 };
  assert.deepEqual(pendingMealOffers(S).map(o => o.id), ['offer-protein-shake']);
  const added = addOfferedMeal(S, shake);
  assert.deepEqual(added.savedMeals.map(m => m.name), ['Porridge', shake.name]);
  assert.deepEqual(added.mealOffersAdded, ['offer-protein-shake']);
  assert.equal(added.coins, 5, 'nothing else touched');
  assert.deepEqual(pendingMealOffers(added), []);
  const deleted = { ...added, savedMeals: added.savedMeals.filter(m => m.name !== shake.name) };
  assert.deepEqual(pendingMealOffers(deleted), [], 'a deleted meal is not offered back');
});

t('not now: remembered, nothing saved', () => {
  const S = { savedMeals: [] };
  const d = dismissMealOffer(S, shake.id);
  assert.deepEqual(d.savedMeals, []);
  assert.deepEqual(pendingMealOffers(d), []);
  assert.equal(dismissMealOffer(d, shake.id), d, 'twice changes nothing');
});

t('already saved under that name (any case): not offered; adding replaces it', () => {
  const S = { savedMeals: [{ id: 'x', name: ' protein shake (1 scoop + SEMI-SKIMMED) ' }] };
  assert.deepEqual(pendingMealOffers(S), []);
  const a = addOfferedMeal(S, shake);
  assert.equal(a.savedMeals.length, 1);
  assert.equal(a.savedMeals[0].id, 'offer-protein-shake');
});

console.log(`meal offers: ${n} tests passed`);
