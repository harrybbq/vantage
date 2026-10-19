/**
 * The live workout's side effects on the device — none of them write S.
 *
 *   useFocusMode(on)   html[data-lifts-focus] while the live workout is on
 *                      a phone / tablet layout: workout.css hides the app's
 *                      top bar, bottom nav and Upgrade's back bar under it.
 *                      Removed on unmount (or when `on` turns false).
 *   useWakeLock(on)    Screen Wake Lock while resting, re-requested when
 *                      the page becomes visible again (the browser drops
 *                      it on every hide). Silently absent where unsupported.
 *   primeTone()        unlock WebAudio inside a user gesture (the ✓ tap),
 *                      so the end-of-rest tone can play later.
 *   playTone()         one short soft tone (off by default — a pref).
 *   buzz()             navigator.vibrate([200, 100, 200]) where it exists.
 *
 * There are no lock-screen alerts: push isn't configured, so the rest
 * dock shows a one-time hint instead (S.lifts.prefs.restHintSeen).
 */
import { useEffect } from 'react';

export function useFocusMode(on) {
  useEffect(() => {
    if (!on || typeof document === 'undefined') return undefined;
    const r = document.documentElement;
    r.setAttribute('data-lifts-focus', '');
    return () => r.removeAttribute('data-lifts-focus');
  }, [on]);
}

export function useWakeLock(on) {
  useEffect(() => {
    if (!on || typeof navigator === 'undefined' || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return undefined;
    let lock = null;
    let dead = false;
    const release = () => { try { if (lock) lock.release(); } catch { /* already gone */ } lock = null; };
    const req = async () => {
      if (dead || document.visibilityState !== 'visible') return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (dead) { try { l.release(); } catch { /* gone */ } return; }
        release();
        lock = l;
      } catch { /* denied, battery saver, or not allowed in this frame */ }
    };
    req();
    const vis = () => { if (document.visibilityState === 'visible') req(); };
    document.addEventListener('visibilitychange', vis);
    return () => { dead = true; document.removeEventListener('visibilitychange', vis); release(); };
  }, [on]);
}

let ctx = null;
export function primeTone() {
  if (typeof window === 'undefined') return null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}
export function playTone() {
  const c = primeTone();
  if (!c) return;
  try {
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + 0.4);
  } catch { /* audio unavailable */ }
}
export function buzz() {
  try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate([200, 100, 200]); } catch { /* not allowed */ }
}

/** prefers-reduced-motion, read once per call (for JS-driven exits). */
export const reducedMotion = () => {
  try { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
