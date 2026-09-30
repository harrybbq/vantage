/**
 * What a friend-card privacy toggle currently means.
 *
 * Every toggle defaults ON except the habit streak. A streak publishes
 * the habit's NAME — "12d Alcohol", "30d Self-harm" — to every friend,
 * and for a 13–17 year old or anyone quitting something private that is
 * not a safe thing to share without asking (audit items 68 / client 11).
 *
 * Why a separate `shareStreakSet` marker rather than just reading
 * `shareStreak === true`: DEFAULT_STATE has seeded `shareStreak: true`
 * since the feature shipped, and every account's first save persisted
 * it. A stored `true` therefore can't tell "chose to share" from "never
 * looked". Only the toggle writes the marker, so the streak is shared
 * only by people who switched it on themselves. Nothing is rewritten —
 * existing values are simply read differently.
 *
 * Pure.
 */
export function privacyOn(privacy, id) {
  const p = privacy || {};
  if (id === 'shareStreak') return p.shareStreakSet === true && p.shareStreak === true;
  return p[id] !== false;
}

/** The patch a toggle writes: the new value, plus the marker for the
 *  streak so the choice is recorded as the user's own. */
export function privacyToggle(privacy, id) {
  const next = !privacyOn(privacy, id);
  return id === 'shareStreak'
    ? { ...(privacy || {}), shareStreak: next, shareStreakSet: true }
    : { ...(privacy || {}), [id]: next };
}
