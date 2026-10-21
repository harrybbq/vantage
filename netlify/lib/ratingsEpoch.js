/**
 * Comparing a rating with an older one — shared by the weekly
 * leaderboard (get-leaderboard.js) and the group leagues (leagues.js).
 *
 * ── The formula epoch ────────────────────────────────────────────────
 * A climb is `today's OVR − an older OVR`, which only means anything if
 * both were computed the same way. When the formula changes, every
 * number moves at once, and comparing across that hands everyone a
 * one-off climb (or fall) they did not earn — in a week the leagues pay
 * coins on exactly that number. So snapshots from before the last
 * change are not read: the weekly board shows "—" until a week of
 * comparable ones exists, and a league week measures from the first
 * snapshot after the change. The rows stay in the table; nothing is
 * deleted.
 *
 *   2026-09-14  RATING_SCALE 6 → 8, server vision prices corrected
 *   2026-10-21  OVR from the weighted total instead of the mean, a new
 *               curve, even days across categories (derive.js toRating)
 *
 * Set to the day the change DEPLOYS, not the day it was written.
 *
 * ── Prestige ─────────────────────────────────────────────────────────
 * A prestige takes OVR from 99 back to the floor. Since 2026-10-21 a
 * committed user does that every three months, so a week containing one
 * is common — and `now − then` scored it as no growth at all, losing
 * everything earned before it. A prestige since the older snapshot
 * counts as the climb to 99 plus the climb since. The 7-day prestige
 * cooldown (prestige-up.js) means at most one falls between snapshots
 * a week apart.
 */
const FORMULA_EPOCH_ISO = '2026-10-21T00:00:00.000Z';

/**
 * OVR growth from `then` (taken at `thenAt`) to `now`, across a prestige
 * if `prestigedAt` falls after `thenAt`. Null when either side is
 * missing. Can be negative; callers that must not punish a fall clamp.
 */
function climbSince(now, then, prestigedAt, thenAt) {
  if (now == null || then == null) return null;
  const p = prestigedAt ? Date.parse(prestigedAt) : NaN;
  const t = thenAt ? Date.parse(thenAt) : NaN;
  if (Number.isFinite(p) && Number.isFinite(t) && p > t) return (99 - then) + (now - 1);
  return now - then;
}

/** The later of `from` and the formula epoch, as a Date. */
function sinceEpoch(from) {
  const epoch = new Date(FORMULA_EPOCH_ISO);
  return from && from.getTime() > epoch.getTime() ? from : epoch;
}

module.exports = { FORMULA_EPOCH_ISO, climbSince, sinceEpoch };
