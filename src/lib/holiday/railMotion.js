/**
 * How the trip timeline moves: which input means pan and which means
 * zoom, how a fling carries on after the pointer lets go, and how a zoom
 * glides to its target instead of stepping.
 *
 * Pure numbers, no DOM, so the rules can be tested without a browser.
 *
 * ── Input map (desktop) ─────────────────────────────────────────────
 *   trackpad two-finger swipe sideways   → pan
 *   Shift + wheel                        → pan
 *   trackpad pinch (a wheel with ctrlKey) → zoom
 *   plain wheel                          → zoom (as asked), EXCEPT at the
 *     zoom limit in that direction, where it is handed back to the page
 *     so the rail — which spans the whole page — never traps a scroll.
 */
import { MIN_PX_DAY, MAX_PX_DAY } from './timeline.js';

/** Line/page deltas (Firefox, some mice) → pixels. */
export function wheelPixels(e) {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  return { dx: (e.deltaX || 0) * k, dy: (e.deltaY || 0) * k };
}

/**
 * What a wheel event is asking for.
 * @returns { kind: 'pan'|'zoom'|'pinch'|null, delta, notched }
 *   notched — a mouse wheel click (big, discrete) rather than a trackpad
 *   stream; notches are eased, streams are applied as they come.
 */
export function classifyWheel(e) {
  const { dx, dy } = wheelPixels(e);
  if (e.ctrlKey) return { kind: 'pinch', delta: dy, notched: false };
  if (e.shiftKey) {
    const d = dx || dy;
    return d ? { kind: 'pan', delta: d, notched: isNotch(d, e) } : { kind: null, delta: 0, notched: false };
  }
  if (Math.abs(dx) > Math.abs(dy)) return { kind: 'pan', delta: dx, notched: isNotch(dx, e) };
  if (dy) return { kind: 'zoom', delta: dy, notched: isNotch(dy, e) };
  return { kind: null, delta: 0, notched: false };
}
function isNotch(d, e) {
  if (e.deltaMode === 1 || e.deltaMode === 2) return true;
  // Mouse wheels report whole clicks of ~100 (Chrome/Edge 100–120, Safari 4-ish × 30).
  return Math.abs(d) >= 50 && Number.isInteger(d);
}

/** The scale a zoom delta asks for. Pinch deltas are small and many, so
 *  they are scaled up to feel like the same gesture as a wheel click. */
export function zoomTarget(pxPerDay, delta, pinch = false) {
  const k = pinch ? 0.011 : 0.0016;
  const v = pxPerDay * Math.exp(-delta * k);
  return Math.min(MAX_PX_DAY, Math.max(MIN_PX_DAY, v));
}

/** True when a zoom in this direction would do nothing, so the wheel
 *  should go back to the page. delta > 0 zooms out. */
export function atZoomLimit(pxPerDay, delta) {
  if (delta > 0) return pxPerDay <= MIN_PX_DAY * 1.0005;
  if (delta < 0) return pxPerDay >= MAX_PX_DAY * 0.9995;
  return false;
}

/**
 * One step of an eased approach, in log space (a zoom from 1 to 4 feels
 * the same as 4 to 16). `tau` is the time constant: ~63% of the way per
 * tau. Snaps home when within 0.2%.
 */
export function approachZoom(current, target, dtMs, tau = 60) {
  const a = Math.log(current), b = Math.log(target);
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  const next = Math.exp(a + (b - a) * k);
  return Math.abs(next / target - 1) < 0.002 ? target : next;
}

/** The same, for a scroll position (linear), snapping within half a pixel. */
export function approach(current, target, dtMs, tau = 90) {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.5 ? target : next;
}

/**
 * Release velocity from the last pointer samples [{ t, x }], px/ms along
 * the axis, measured over the last ~100ms of movement. If the pointer
 * sat still for more than 60ms before letting go, it is a placement,
 * not a fling, and the answer is 0. Positive = pointer moving toward
 * larger x.
 */
export function releaseVelocity(samples, releaseT) {
  if (!samples || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (releaseT != null && releaseT - last.t > 60) return 0;
  const recent = samples.filter(s => last.t - s.t <= 100);
  if (recent.length < 2) return 0;
  const a = recent[0];
  const dt = last.t - a.t;
  if (dt <= 0) return 0;
  const v = (last.x - a.x) / dt;
  return Math.max(-6, Math.min(6, v));      // a sane cap: 6000 px/s
}

/**
 * Momentum after release: velocity decays with time constant `tau`, the
 * way a phone list does. Returns the distance to move this frame and the
 * velocity left. Stops (v = 0) below 0.02 px/ms.
 */
export function glideStep(v, dtMs, tau = 325) {
  if (!v) return { dist: 0, v: 0 };
  // A frame timestamp can land a hair before the release was recorded;
  // a negative step would run the glide backwards.
  if (!(dtMs > 0)) return { dist: 0, v };
  const decay = Math.exp(-dtMs / tau);
  // Exact integral of v·e^(−t/τ) over the frame.
  const dist = v * tau * (1 - decay);
  const nv = v * decay;
  return { dist, v: Math.abs(nv) < 0.02 ? 0 : nv };
}

/** Total distance a fling will travel — handy for tests and for aiming. */
export const glideDistance = (v, tau = 325) => v * tau;
