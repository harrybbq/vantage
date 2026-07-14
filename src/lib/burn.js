/**
 * Calories-burned Phase 1 (see docs/FEATURES.md) — estimate + manual
 * activity log. No health-platform permissions; Health Connect /
 * HealthKit later overwrite these estimates with sensor truth.
 *
 * State shape (synced in S like everything else):
 *   S.burnProfile = { heightCm, age, sex: 'male'|'female', weightKg? }
 *     weightKg is a fallback captured at setup — the live weight is
 *     always the latest entry in S.vitalsLog when present.
 *   S.burnLog = { 'YYYY-MM-DD': [ { id, label, kcal } ] }
 */

/** Latest logged weight (kg) from the Vitals store, else the setup
 *  fallback, else null. */
export function currentWeightKg(S) {
  const log = S.vitalsLog || {};
  const dates = Object.keys(log).sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    const w = log[dates[i]]?.weight;
    if (w != null) return w;
  }
  return S.burnProfile?.weightKg ?? null;
}

/** Mifflin-St Jeor resting burn per full day. Null until profile +
 *  weight exist. */
export function bmrKcal(S) {
  const p = S.burnProfile;
  const w = currentWeightKg(S);
  if (!p?.heightCm || !p?.age || !p?.sex || !w) return null;
  const base = 10 * w + 6.25 * p.heightCm - 5 * p.age;
  return Math.round(p.sex === 'female' ? base - 161 : base + 5);
}

/** Standard MET presets for the quick-add row. `steps` is the odd one
 *  out: the input is a step count, not minutes (~0.0005 kcal per step
 *  per kg — ≈35 kcal per 1,000 steps at 70 kg). */
export const ACTIVITIES = [
  { key: 'weights', label: 'Weights',  met: 5.0 },
  { key: 'run',     label: 'Run',      met: 9.8 },
  { key: 'walk',    label: 'Walk',     met: 3.5 },
  { key: 'cycle',   label: 'Cycle',    met: 7.5 },
  { key: 'swim',    label: 'Swim',     met: 8.0 },
  { key: 'sport',   label: 'Sport',    met: 7.0 },
  { key: 'steps',   label: 'Steps',    met: null, perStepKg: 0.0005 },
];

/** kcal for `minutes` of an activity at the user's current weight. */
export function activityKcal(met, weightKg, minutes) {
  return Math.round(met * weightKg * (minutes / 60));
}

/** kcal for a raw step count at the user's current weight. */
export function stepsKcal(steps, weightKg) {
  return Math.round(steps * weightKg * 0.0005);
}

/** Today's burn breakdown: { bmr, activity, manual, whoopTotal, total } (kcal).
 *
 *  IMPORTANT: net-intake maths (deficit/surplus, the macros ring's
 *  burned arc) uses `activity` ONLY — resting burn (bmr) is deliberately
 *  excluded because counting it made the calorie donut read negative all
 *  day (owner call, 2026-07-05). bmr may be null when the profile isn't
 *  set up.
 *
 *  WHOOP integration: when WHOOP has synced a measured all-day burn for
 *  the date (vitalsLog[date].burnKcal, whole-day incl. resting), we
 *  derive `whoopActive = whoopTotal − bmr` and let it SUPERSEDE the
 *  manual/step log as the day's activity — it's a full-body measurement,
 *  so it's both more accurate and avoids double-counting WHOOP workouts
 *  that were also written into burnLog. `whoopTotal` is exposed so the
 *  Calories Burned widget can show WHOOP's headline all-day number. */
export function dayBurn(S, date) {
  const bmr = bmrKcal(S);
  const manual = (S.burnLog?.[date] || []).reduce((sum, a) => sum + (a.kcal || 0), 0);
  const whoopTotal = S.vitalsLog?.[date]?.burnKcal ?? null;
  const whoopActive = (whoopTotal != null && bmr != null) ? Math.max(0, Math.round(whoopTotal - bmr)) : null;
  // Translate WHOOP burn to the macros net even without a burn profile:
  // prefer active energy (total − resting), fall back to the measured
  // all-day total when we can't derive resting, and only then to the
  // manual activity log.
  const activity = whoopActive != null ? whoopActive
    : whoopTotal != null ? whoopTotal
    : manual;
  return {
    bmr,
    activity,
    manual,
    whoopTotal,
    whoopActive,
    total: whoopTotal != null ? whoopTotal : (bmr || 0) + activity,
  };
}
