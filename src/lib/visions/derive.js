/**
 * Which visions (honours) are currently met, and how many are stamped.
 *
 * Pure functions only — these run on every render via useVisions and
 * must be cheap. The most expensive call is consecutiveLogDays inside
 * definitions.js (caps at 365 iterations); everything else is O(n) on
 * habits/achievements/trackers, all of which are tiny lists.
 *
 * Level/XP was retired in 2026-10: honours stay, and their `xp` values
 * still weight the ratings (lib/ratings/derive.js, netlify/lib/
 * visionXp.js), but there is no level to derive or show any more.
 * Prestige is the long-term goal (lib/ratings/prestigeRewards.js).
 */

import { VISIONS } from './definitions.js';
import { shareableView } from '../wearables/strip.js';

// ── Pure helpers ──────────────────────────────────────────────────────

/** All vision IDs whose check(S) currently returns true.
 *
 *  Checked against the state WITHOUT WHOOP/Oura-derived values (item
 *  124, owner decision D1): a vision's xp feeds the ratings that
 *  friends and leagues see, so a band syncing your
 *  sleep must not unlock "vitals-7" or carry a logging streak. Stamps
 *  already in S.visions are never removed. Memoised per S. */
export function metVisionIds(rawS) {
  const S = shareableView(rawS);
  const ids = [];
  for (const v of VISIONS) {
    try {
      if (v.check(S)) ids.push(v.id);
    } catch {
      // A misbehaving check shouldn't crash the whole derivation —
      // skip it. (Wrapped in try so a bad rule can't take down the UI.)
    }
  }
  return ids;
}

/** Vision IDs that are met now AND not yet stamped in S.visions. */
export function newlyUnlockedIds(S) {
  const stamped = S.visions || {};
  return metVisionIds(S).filter(id => !stamped[id]);
}

/** Honours earned so far, for the hub and the catalogue. Memoise
 *  upstream if hot. (Returned as `visionState`, a section-props key.) */
export function deriveVisionState(S) {
  return {
    unlockedCount: Object.keys(S.visions || {}).length,
    totalCount: VISIONS.length,
  };
}
