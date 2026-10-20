/**
 * Saved-state keys the owner has retired for good, removed once after
 * the cloud copy has loaded.
 *
 * This is deliberately NOT a general cleanup. CLAUDE.md's first rule is
 * that a build must never rewrite or reset saved state on load, and the
 * 2026-05-03 wipe is why. A key goes on this list only when the owner
 * has decided, in writing, that its data is never coming back:
 *
 *   moodLog — the Mood feature was removed in 2026-08 and nothing has
 *             read or written it since. Owner's decision 2026-10-20:
 *             delete the old entries; they will never return. (DPIA G12,
 *             STARTUP_REQUIREMENTS item 107.)
 *
 * It only ever removes the listed keys, returns the state it was given
 * when there is nothing to remove (so no save is queued), and runs after
 * hydration — never against DEFAULT_STATE. The three-way merge
 * (lib/state/merge.js) keeps the deletion: a deletion survives when the
 * other device left the key untouched, which is the case for a key
 * nothing writes. Copies in user_data_history snapshots and Supabase
 * backups age out on their own schedules.
 *
 * Pure. No React, no network.
 */
export const RETIRED_STATE_KEYS = Object.freeze(['moodLog']);

/** State without the retired keys — or the same object when none are present. */
export function dropRetiredKeys(state) {
  if (!state || typeof state !== 'object') return state;
  const present = RETIRED_STATE_KEYS.filter(k => Object.prototype.hasOwnProperty.call(state, k));
  if (!present.length) return state;
  const next = { ...state };
  for (const k of present) delete next[k];
  return next;
}
