import { useIsOwner } from '../../hooks/useIsOwner';
import { OFFERED_MEALS, pendingMealOffers, addOfferedMeal, dismissMealOffer } from '../../lib/diet/mealOffers';
import './MealOfferCard.css';

const n = v => Math.round(Number(v) || 0);

/**
 * Track → Diet: "Add … to your meals" for a meal shipped as data
 * (lib/diet/mealOffers). Owner only for now; one tap saves it through the
 * app's own update into S.savedMeals, then it appears under Log food →
 * Meals. Renders nothing once each offer is added or turned down.
 */
export default function MealOfferCard({ S, update, userId }) {
  const { isOwner } = useIsOwner(userId);
  if (!isOwner || !update) return null;
  const offers = pendingMealOffers(S, OFFERED_MEALS);
  if (!offers.length) return null;
  return (
    <div className="meal-offers">
      {offers.map(o => (
        <section key={o.id} className="meal-offer" aria-label={`Add ${o.name} to your meals`}>
          <div className="meal-offer-text">
            <span className="meal-offer-t">Add “{o.name}” to your meals?</span>
            <span className="meal-offer-s">
              {n(o.calories)} kcal · {n(o.protein_g)} g protein · {n(o.carbs_g)} g carbs · {n(o.fat_g)} g fat · {n(o.serving_g)} {o.serving_unit || 'g'}
            </span>
          </div>
          <div className="meal-offer-actions">
            <button type="button" className="meal-offer-btn is-ghost" onClick={() => update(prev => dismissMealOffer(prev, o.id))}>Not now</button>
            <button type="button" className="meal-offer-btn" onClick={() => update(prev => addOfferedMeal(prev, o))}>Add to meals</button>
          </div>
        </section>
      ))}
    </div>
  );
}
