/**
 * Meals offered for one tap into the user's own saved meals (Track →
 * Diet → Log food → Meals), the owner's request of Nov 2026.
 *
 * Shipped as data, not written into anyone's saved state: the add goes
 * through the app's own update(), appends to S.savedMeals (replacing a
 * meal of the same name, as "Save as meal" does), and is remembered in
 * S.mealOffersAdded (new key, additive) so an offer that was added,
 * deleted later, or turned down is never offered again. Same pattern as
 * the recipe log (lib/diet/meals.js pendingRecipes).
 *
 * Pure: no React, no network.
 */
import { savedMeal } from './logMath.js';

/**
 * 1 scoop whey (~30 g: ~120 kcal, 24 g protein) + 300 ml semi-skimmed
 * ("green lid": 147 kcal, 10.8 g protein, 14.4 g carbs, 5.4 g fat, ~130
 * mg sodium). One 330 ml serving; editable like any saved meal.
 */
export const OFFERED_MEALS = Object.freeze([
  savedMeal({
    id: 'offer-protein-shake',
    name: 'Protein Shake (1 scoop + semi-skimmed)',
    brand: '',
    meal: 'snack',
    amount: 330,
    unit: 'ml',
    values: { calories: 267, protein_g: 35, carbs_g: 17, fat_g: 7, fibre_g: 0.5, sugar_g: 16, sodium_mg: 190 },
  }),
]);

const handled = S => new Set(Array.isArray(S && S.mealOffersAdded) ? S.mealOffersAdded : []);
const nameKey = m => String((m && m.name) || '').trim().toLowerCase();

/** Offers not yet added or turned down, and not already saved under that name. */
export function pendingMealOffers(S, offers = OFFERED_MEALS) {
  const done = handled(S);
  const names = new Set((Array.isArray(S && S.savedMeals) ? S.savedMeals : []).map(nameKey));
  return offers.filter(o => !done.has(o.id) && !names.has(nameKey(o)));
}

const remember = (prev, id) => {
  const list = Array.isArray(prev && prev.mealOffersAdded) ? prev.mealOffersAdded : [];
  return list.includes(id) ? list : [...list, id];
};

/** "Add": into S.savedMeals (same-name meal replaced), and remembered. */
export function addOfferedMeal(prev, offer) {
  if (!offer || !offer.id) return prev;
  const others = (Array.isArray(prev && prev.savedMeals) ? prev.savedMeals : []).filter(m => nameKey(m) !== nameKey(offer));
  return { ...prev, savedMeals: [...others, { ...offer }], mealOffersAdded: remember(prev, offer.id) };
}

/** "Not now": remembered, nothing saved. */
export function dismissMealOffer(prev, id) {
  if (!id) return prev;
  const next = remember(prev, id);
  return next === (prev && prev.mealOffersAdded) ? prev : { ...prev, mealOffersAdded: next };
}
