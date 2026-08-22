/**
 * Drives the boot sequence clock.
 *
 * Plays ONCE per app boot. Both halves of that — whether this page load
 * boots at all, and when its run began — are decided once and held at
 * module scope, because a module lives exactly as long as the loaded
 * page does. Switching sections remounts the section components and
 * must not start anything; an actual reload always can.
 *
 * Holding the START INSTANT rather than a played/not-played flag is what
 * makes a remount inside the window resume the same run instead of
 * cutting it off or replaying it. React's StrictMode remounts every
 * component once in development, so this is not a hypothetical case —
 * a flag would simply eat the boot on `npm run dev`.
 *
 * For the same reason the decision to SKIP is remembered too. It used to
 * be re-derived per mount, which broke the suppression below: the first
 * mount consumed the one-shot marker, and the second mount, finding it
 * gone, cheerfully booted.
 *
 * The clock is a wall-clock interval rather than rAF: a frame that is
 * never delivered — backgrounded tab, throttled timer — can't strand
 * the boot part-way, because every tick recomputes from Date.now() and
 * the last one is clamped to the end of the score.
 */
import { useEffect, useRef, useState } from 'react';
import { SPEED, scoreFor, durationOf, fillAt } from '../lib/boot/score.js';
import { setBootFill, primeBootFill } from '../lib/boot/fill.js';

// undefined = not yet decided · null = this page load does not boot
// number   = the run started at that timestamp
let bootRun;

/**
 * Set by main.jsx immediately before the service worker's automatic
 * reload. That reload fires two seconds after a new version activates —
 * i.e. in the middle of the boot — so without this the app played the
 * sequence, cut it off, and played it again from the top on every
 * deploy. A reload the app performs on its own is not the user opening
 * the app, so it does not get a boot. A reload the USER asks for still
 * does, which is why this is a one-shot marker and not a timer.
 */
const SUPPRESS_KEY = 'vb_boot_suppress';

function consumeSuppression() {
  try {
    if (sessionStorage.getItem(SUPPRESS_KEY) === null) return false;
    sessionStorage.removeItem(SUPPRESS_KEY);
    return true;
  } catch {
    return false;   // private mode: better a boot than a crash
  }
}

/** Test seam — lets a harness replay the boot without a page reload. */
export function resetBootForTests() { bootRun = undefined; }

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Decide, once for the whole page load, whether this is a boot and when
 * it started. Also arms the one guarantee the dials need: whatever
 * happens to the component — unmounted mid-run, remounted, never
 * remounted — the fill is restored to 1 when the run's time is up. It
 * belongs to the RUN, not to any mount, because a mount's own cleanup
 * fires on every StrictMode remount and would flash every dial to full
 * and back.
 */
function decideRun(score) {
  if (bootRun !== undefined) return bootRun;
  if (prefersReducedMotion() || consumeSuppression()) {
    bootRun = null;
  } else {
    bootRun = Date.now();
    setTimeout(() => setBootFill(1), durationOf(score));
  }
  return bootRun;
}

/**
 * @param {'desktop'|'mobile'} kind
 * @returns {{ t: number, running: boolean, score: object }} elapsed score
 *   time in authored ms, and whether the sequence is still playing.
 */
export function useBootSequence(kind) {
  const score = scoreFor(kind);
  const END = score.total + 300;
  const total = durationOf(score);

  const startedAt = useRef(undefined);
  if (startedAt.current === undefined) {
    const run = decideRun(score);
    startedAt.current = run !== null && Date.now() - run < total ? run : null;
    /* Primed during render, not from an effect. Every widget renders
       after this component does — it sits above them in App — so the
       dials are already told to start empty by the time they first
       draw. From an effect they would paint full for one frame and then
       jump back to zero. Primed rather than set, because notifying
       subscribers from inside a render is the one thing React refuses;
       the next tick, 33ms later, carries the value to anyone who has
       subscribed since. */
    primeBootFill(startedAt.current === null
      ? 1
      : fillAt((Date.now() - startedAt.current) * SPEED, score));
  }

  const from = startedAt.current;
  const [t, setT] = useState(() => (from === null ? END : Math.min((Date.now() - from) * SPEED, END)));
  const running = from !== null && t < END;

  useEffect(() => {
    if (from === null) return undefined;
    const id = setInterval(() => {
      const next = Math.min((Date.now() - from) * SPEED, END);
      setT(next);
      setBootFill(fillAt(next, score));
      if (next >= END) clearInterval(id);
    }, 33);
    return () => clearInterval(id);
    // `from` is fixed for the life of this mount, and END with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The stagger for elements this component never renders — the hub's
   * own panels, the nav, the tab bar — is a class on <html> that
   * boot.css hangs its animations off. It comes off when the run ends,
   * so no rule from that file outlives the sequence.
   */
  useEffect(() => {
    if (from === null) return undefined;
    const root = document.documentElement;
    const clear = () => root.classList.remove('vb-boot', 'vb-boot-desktop', 'vb-boot-mobile');
    root.classList.add('vb-boot', `vb-boot-${kind}`);
    const off = setTimeout(clear, Math.max(0, total - (Date.now() - from)));
    return () => { clearTimeout(off); clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { t, running, score };
}
