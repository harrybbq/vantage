/**
 * Remove this device's copies of a user's data. Explicit sign-out and
 * confirmed account deletion ONLY.
 *
 * History (2026-09-30, audit item 56): signing out left the whole state
 * in localStorage — the last-known-good backup (weight, sleep, meals,
 * money), the pictures cache, the pending-edit snapshot — plus function
 * responses in the service-worker cache. On a shared or handed-down
 * device the next person could read all of it.
 *
 * NEVER call this on a session that merely went away (expiry, a refresh
 * failure, another tab signing out, the remember-me=0 sign-out on load):
 * those are not the user choosing to leave, and the backup and the
 * pending snapshot are exactly what recovers them afterwards. The
 * caller must flush unsaved edits first (useVisionBoardState.flushNow)
 * because `vb4_pending:` can be the only copy of the last few seconds.
 *
 * Kept on purpose:
 *   · `vb4_seen_user:<id>` on sign-out — the anti-wipe breadcrumb. It
 *     holds a timestamp and nothing else, and it is what stops a later
 *     anomalous "no row" on this device from seeding defaults over the
 *     account (see the history note in useVisionBoardState). Removed on
 *     deletion, where there is no account left to protect.
 *   · the legacy pre-cloud copies (`vb4_state`, `vb4_photo`, `vb4_bg`).
 *     They are migration SOURCES: on an account whose cloud row already
 *     existed they may never have been merged, which makes them the only
 *     copy of that data. The app's own "Clear localStorage" banner is
 *     the explicit way to drop them.
 *   · device preferences with no personal content: cookie consent,
 *     remember-me, install/push prompt dismissals, the SW reload marker.
 */

/* Exact keys holding per-user data. */
const KEYS = [
  'vb4_streak_dismissed', 'vb4_coach_heuristic_dismissed',
  'vb4_weather_cache',                               // carries the user's location
  'vb4_food_community', 'vb4_logfood_tab', 'vb_habits_selected',
  'vb4_more_pro_chip_dismissed',
];
/* Per-user stores, suffixed with the user id: the state, the pictures,
 * the unsaved edit. Only the signing-out user's are removed — another
 * account on this device keeps its own recovery copies. */
const USER_PREFIXES = ['vb4_backup:', 'vb4_visuals:', 'vb4_pending:'];
/* Per-item caches that aren't keyed by user. */
const PREFIXES = [
  'vb4_appPreview:',                                 // scraped previews of the user's links
  'vb_habit_view_',                                  // per-habit view choice (habit ids)
];
const SESSION_KEYS = ['vb_quicklog_food', 'vb_whoop_redirect'];

/** Which localStorage keys would be removed. Pure — for the tests. */
export function keysToClear(allKeys, { userId, deleted = false } = {}) {
  return allKeys.filter(k =>
    typeof k === 'string' && (
      KEYS.includes(k)
      || PREFIXES.some(p => k.startsWith(p))
      || (!!userId && USER_PREFIXES.some(p => k === p + userId))
      || (!!userId && deleted && k === 'vb4_seen_user:' + userId)));
}

/**
 * Clear local copies. Resolves once the storage is clean and the
 * service-worker caches are gone; never throws.
 */
export async function clearLocalUserData(userId, { deleted = false } = {}) {
  try {
    const all = [];
    for (let i = 0; i < localStorage.length; i++) all.push(localStorage.key(i));
    for (const k of keysToClear(all, { userId, deleted })) {
      try { localStorage.removeItem(k); } catch { /* keep going */ }
    }
  } catch { /* storage unavailable — nothing stored either */ }
  try {
    for (const k of SESSION_KEYS) sessionStorage.removeItem(k);
  } catch { /* private mode */ }
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } catch { /* no Cache API (http, old WebView) */ }
}
