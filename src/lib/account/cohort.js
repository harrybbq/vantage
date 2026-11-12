/**
 * Which accounts get the smaller app (owner, Nov 2026).
 *
 * Accounts created from SMALLER_APP_FROM on:
 *   · open in the new design by default (lib/design/design.js
 *     defaultDesignFor) — an explicit S.design still wins;
 *   · have their navigation follow what they picked in the onboarding
 *     (lib/onboarding/areas.js), once they have picked.
 *
 * Every account created before it is left exactly as it was: classic by
 * default, the new design an owner preview, every area in the
 * navigation. The date is the account's own creation time (the session's
 * `user.created_at`), so nothing is written to decide this.
 *
 * Pure. cohort.test.mjs pins it.
 */
export const SMALLER_APP_FROM = '2026-11-13T00:00:00Z';

const ms = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string' || !v) return NaN;
  return Date.parse(v);
};

/** Was this account created on or after the cut-over? Unknown → false (as before). */
export function isNewCohort(createdAt, from = SMALLER_APP_FROM) {
  const t = ms(createdAt), f = ms(from);
  return Number.isFinite(t) && Number.isFinite(f) && t >= f;
}
