/**
 * The live workout's two cross-screen signals — no state writes, nothing
 * persisted (navigation must never touch S):
 *
 *   live open    WorkoutLive is on screen (setLiftsLive). The app-wide
 *                mini-bar hides while it is, and shows on every other
 *                screen while S.lifts.active exists ("minimised").
 *   resume       the mini-bar's Resume (requestLiftsResume). Upgrade opens
 *                its Lifts tab and Lifts opens the workout. A pending flag
 *                as well as an event, because Upgrade (and Lifts inside it)
 *                may not be mounted yet when the bar is tapped from Hub —
 *                they read it on mount (peekLiftsResume / takeLiftsResume).
 */

const EVT = 'vantage:lifts-resume';
let live = false;
let pending = false;
const subs = new Set();

/** Mark the live workout as on screen (true) or not (false). */
export function setLiftsLive(on) {
  const v = !!on;
  if (v === live) return;
  live = v;
  for (const fn of subs) fn();
}
export const isLiftsLive = () => live;
/** useSyncExternalStore-style subscription to the live flag. */
export function subscribeLiftsLive(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** The mini-bar's Resume: ask Upgrade → Lifts to open the workout. */
export function requestLiftsResume() {
  pending = true;
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* old browser */ }
  }
}
/** Is a resume waiting? (Upgrade opens its Lifts tab; it doesn't consume.) */
export const peekLiftsResume = () => pending;
/** Consume a waiting resume (Lifts opens the workout). */
export function takeLiftsResume() {
  const p = pending;
  pending = false;
  return p;
}
/** Listen for resume requests while mounted. → unsubscribe. */
export function onLiftsResume(fn) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
}
