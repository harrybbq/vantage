/**
 * Does this state hold anything a user would miss?
 *
 * The anti-wipe guard in useVisionBoardState asks this question twice
 * per suspicious save: of the OUTGOING state ("does this look like the
 * factory seed?") and of the CLOUD row ("is there real data there to
 * lose?"). A write is refused when the first says seed and the second
 * says real.
 *
 * History (2026-09-30, audit item 54): the old predicates listed the
 * stores that counted — logs, savings, visions, coins, habits… — and
 * everything added since was invisible to them. A WHOOP-only user (a
 * year of vitalsLog + burnLog, nothing else) read as "factory default",
 * so on a new device an anomalous load could save the seed over a year
 * of wearable data and the guard would wave it through.
 *
 * So the list is inverted. ANY top-level key holding a non-empty array
 * or object is evidence, unless it is on IGNORE below — the keys that
 * are seeded, derived, or written by the app on load without the user
 * doing anything. A store added next month is protected the day it
 * ships, with nobody having to remember this file.
 *
 * Scalars are the other way round: none count unless listed in
 * `scalarEvidence`, because the app sets plenty on its own
 * (`theme`, `visionsBackfilled`, `whoopConnected`, `tutorialCompleted`,
 * and the per-week `awarded_<tracker>_<week>` booleans).
 *
 * Both predicates come from the ONE evidence function on purpose. If the
 * outgoing check ignored a store the cloud check counted, every save by
 * a user who only has that store would look like a wipe and be refused
 * forever.
 *
 * Mirrored in SQL as `vb_state_meaningful` — keep IGNORE in sync.
 *
 * Pure. No React, no network.
 */

/* Keys that may legitimately be empty, seeded, derived, or auto-written
 * on a fresh account. Never evidence on their own. */
export const MEANINGFUL_IGNORE = [
  // Session-only (TRANSIENT_KEYS in the hook) — ghCache fills with
  // GitHub responses during a session, so it must not count.
  'calYear', 'calMonth', 'ghCache', 'multiSelectedDays', 'multiSelectMode',
  'connectingFrom', 'selectedLogDate', 'shopFilter', '_multiLogOpen',
  // Marker on the slim local backup.
  '__slim',
  // Seeded — judged by the special cases below instead.
  'profile', 'achievements', 'trackers', 'connections',
  // Seeded settings objects.
  'notifications', 'privacy', 'lastfm',
  // Derived or server caches, rewritten on load.
  'ratings', 'prestige', 'streaks', 'coachMemory', 'coachBriefHistory',
  'coachBrief', 'whoopLastError',
  // Auto-stamped: plan posting writes { from } the first time it looks.
  // Posted months are counted below.
  'planLedger',
  // Layout bookkeeping written by the hub on its own.
  'widgetPositions', 'widgetSizes', 'widgetZ', 'widgetLayoutW', 'hubSnap',
  'moduleTransparency', 'bgFx',
];

const IGNORE = new Set(MEANINGFUL_IGNORE);

const SEED_ACHIEVEMENTS = new Set(['a1', 'a2', 'a3', 'a4']);
const SEED_TRACKERS = new Set(['t1', 't2', 't3']);

function nonEmpty(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

/** The scalars and seeded structures that are real user evidence. */
function specialEvidence(state) {
  const out = [];
  if ((Number(state.coins) || 0) > 0) out.push('coins');
  const p = state.profile;
  if (p && typeof p === 'object') {
    if (typeof p.name === 'string' && p.name.trim()) out.push('profile.name');
    if (typeof p.tagline === 'string' && p.tagline.trim()) out.push('profile.tagline');
  }
  for (const k of ['brainScore', 'financeScore', 'fitnessScore', 'socialScore']) {
    if (state[k]) out.push(k);
  }
  const ach = Array.isArray(state.achievements) ? state.achievements : [];
  if (ach.length > SEED_ACHIEVEMENTS.size
    || ach.some(a => a && (a.completed || !SEED_ACHIEVEMENTS.has(a.id)))) {
    out.push('achievements');
  }
  const tr = Array.isArray(state.trackers) ? state.trackers : [];
  if (tr.length > SEED_TRACKERS.size || tr.some(t => t && !SEED_TRACKERS.has(t.id))) {
    out.push('trackers');
  }
  if (state.planLedger && nonEmpty(state.planLedger.months)) out.push('planLedger.months');
  return out;
}

/** Every piece of evidence the state carries, as key names. Useful in
 *  logs ("refused: cloud has vitalsLog, burnLog") and in the tests. */
export function meaningfulEvidence(state) {
  if (!state || typeof state !== 'object') return [];
  const out = specialEvidence(state);
  for (const k of Object.keys(state)) {
    if (IGNORE.has(k)) continue;
    if (nonEmpty(state[k])) out.push(k);
  }
  return out;
}

/** True if the state carries any evidence of real user activity. */
export function hasMeaningfulData(state) {
  return meaningfulEvidence(state).length > 0;
}

/** True if the state is indistinguishable from the out-of-box seed —
 *  the exact shape a wipe-to-defaults produces. Deliberately the exact
 *  negation of hasMeaningfulData (see the header). */
export function looksLikeFactoryDefault(state) {
  if (!state || typeof state !== 'object') return false;
  return !hasMeaningfulData(state);
}
