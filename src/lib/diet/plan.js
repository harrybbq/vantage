/**
 * The diet plan, and the one number the rest of the app can use from it.
 *
 * Lives in lib rather than in DietTab because the body-goal projection
 * reads it, and a projection importing a component would be the
 * dependency pointing the wrong way.
 */
import { TRAIN_POS, CYCLE } from '../rotation/pattern.js';

/** The plan as it stood on the original static rotation page. */
export const DEFAULT_PLAN = {
  targetKg: 76,
  heightCm: 175,
  proteinPerKg: 2.5,
  trainKcal: 2550, trainCarbs: 290, trainFat: 75,
  restKcal: 2350, restCarbs: 250, restFat: 70,
  build: 'Spider-Man / Invincible — broad shoulders, visible abs, no bulk-phase softness.',
  rateKgPerMonth: 0.25,
};

export const planOf = S => ({ ...DEFAULT_PLAN, ...((S && S.dietPlan) || {}) });

/**
 * The plan's average daily calories, weighted by how the rotation
 * actually falls.
 *
 * The plan has two numbers — a training day and a rest day — and a
 * projection needs one. Averaging them evenly would be wrong: the cycle
 * is 10 training days in 16, not 8. Deriving the weights from TRAIN_POS
 * means the blend follows the split; change the rotation and this
 * follows it rather than going quietly stale.
 *
 *   (2550 x 10 + 2350 x 6) / 16 = 2475
 */
export function blendedDailyKcal(S) {
  const p = planOf(S);
  if (!p.trainKcal && !p.restKcal) return null;
  const train = TRAIN_POS.length;
  const rest = CYCLE - train;
  const train_ = p.trainKcal || p.restKcal;
  const rest_ = p.restKcal || p.trainKcal;
  return Math.round((train_ * train + rest_ * rest) / CYCLE);
}

/** Protein target in grams, from bodyweight (or the goal if unweighed). */
export function planProteinG(S, currentKg) {
  const p = planOf(S);
  return Math.round((currentKg || p.targetKg) * p.proteinPerKg);
}
