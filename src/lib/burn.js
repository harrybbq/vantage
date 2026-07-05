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

/** Standard MET presets for the quick-add row. */
export const ACTIVITIES = [
  { key: 'weights', label: 'Weights',  met: 5.0 },
  { key: 'run',     label: 'Run',      met: 9.8 },
  { key: 'walk',    label: 'Walk',     met: 3.5 },
  { key: 'cycle',   label: 'Cycle',    met: 7.5 },
  { key: 'swim',    label: 'Swim',     met: 8.0 },
  { key: 'sport',   label: 'Sport',    met: 7.0 },
];

/** kcal for `minutes` of an activity at the user's current weight. */
export function activityKcal(met, weightKg, minutes) {
  return Math.round(met * weightKg * (minutes / 60));
}

/** Today's burn breakdown: { bmr, activity, total } (kcal). bmr may
 *  be null when the profile isn't set up yet. */
export function dayBurn(S, date) {
  const bmr = bmrKcal(S);
  const activity = (S.burnLog?.[date] || []).reduce((sum, a) => sum + (a.kcal || 0), 0);
  return { bmr, activity, total: (bmr || 0) + activity };
}
