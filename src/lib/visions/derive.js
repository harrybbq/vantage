/**
 * Derive Level + XP + which visions are currently met from app state.
 *
 * Pure functions only — these run on every render via useVisions and
 * must be cheap. The most expensive call is consecutiveLogDays inside
 * definitions.js (caps at 365 iterations); everything else is O(n) on
 * habits/achievements/trackers, all of which are tiny lists.
 *
 * XP curve:
 *   level = 1 + floor(sqrt(totalXp / 50))
 *
 * That gives:
 *   Lvl 1   →    0–49 xp
 *   Lvl 2   →   50–199
 *   Lvl 3   →  200–449
 *   Lvl 5   →  800–1249
 *   Lvl 10  → 4050–4999
 *   Lvl 12  → 6050–7199
 *
 * Gentle taper — early levels feel snappy, later ones reward sustained
 * effort. Adjustable here if it ends up too steep or too flat in
 * practice; changing the divisor doesn't migrate (level is derived,
 * not stored).
 */

import { VISIONS, VISIONS_BY_ID } from './definitions.js';
import { shareableView } from '../wearables/strip.js';

const ACH_DRIP_XP = 10; // small per-completion drip from user-created achievements

// ── Pure helpers ──────────────────────────────────────────────────────

/** All vision IDs whose check(S) currently returns true.
 *
 *  Checked against the state WITHOUT WHOOP/Oura-derived values (item
 *  124, owner decision D1): a vision's xp feeds the ratings and the
 *  level that friends and handle search see, so a band syncing your
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

/** Sum of XP across stamped visions + per-completion drip from user
 *  achievements. Anything stamped counts; anything met-but-not-stamped
 *  doesn't. That keeps the displayed level consistent with the toasts. */
export function totalXp(S) {
  const stamped = S.visions || {};
  let xp = 0;
  for (const id of Object.keys(stamped)) {
    const def = VISIONS_BY_ID[id];
    if (def) xp += def.xp;
  }
  const completedAch = (S.achievements || []).filter(a => a.completed).length;
  xp += completedAch * ACH_DRIP_XP;
  return xp;
}

/** XP threshold at which a given level begins. xpForLevel(1) = 0. */
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return (level - 1) * (level - 1) * 50;
}

/** Level number for a given XP total (1-based). */
export function levelForXp(xp) {
  if (xp <= 0) return 1;
  return 1 + Math.floor(Math.sqrt(xp / 50));
}

/** Convenience: derive everything in one call. Memoise upstream if hot. */
export function deriveVisionState(S) {
  const xp = totalXp(S);
  const level = levelForXp(xp);
  const lvlStart = xpForLevel(level);
  const lvlEnd = xpForLevel(level + 1);
  return {
    xp,
    level,
    nextLevelAt: lvlEnd,
    progressInLevel: xp - lvlStart,
    spanThisLevel: lvlEnd - lvlStart,
    pctToNext: lvlEnd > lvlStart ? Math.round(((xp - lvlStart) / (lvlEnd - lvlStart)) * 100) : 100,
    unlockedCount: Object.keys(S.visions || {}).length,
    totalCount: VISIONS.length,
  };
}
