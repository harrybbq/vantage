/**
 * Drives the boot sequence clock.
 *
 * Plays ONCE per app open, and a tap hurries it along.
 *
 * ── Once ─────────────────────────────────────────────────────────────
 * "Once per app open" is not the same as "once per page load", and the
 * difference is the whole bug this hook used to have: the service worker
 * reloads the page two seconds after a new version activates, which is
 * the first open after every deploy, and two seconds is squarely inside
 * the sequence. So the boot played, was cut off, and played again from
 * the top.
 *
 * The old defence was a one-shot marker that the reloading page set and
 * the reloaded page consumed. It could not work reliably, because
 * nothing decided WHICH page consumed it — see lib/boot/run.js, which
 * now owns the decision. What is stored is the instant the run began, so
 * a reload lands back inside a run already in flight and RESUMES it.
 *
 * The run also lives at module scope, because a module lives exactly as
 * long as the loaded page does. Switching sections remounts this
 * component and must not start anything; React's StrictMode remounts it
 * once in development, and holding the START INSTANT rather than a
 * played/not-played flag is what makes both of those resume the same run
 * instead of cutting it off or replaying it.
 *
 * ── The tap ──────────────────────────────────────────────────────────
 * One tap anywhere multiplies the clock from that instant on. It is not
 * a cut to the end: the dials winding up are the part worth watching and
 * a hard cut throws them away. boot.css follows through --vb-k, which
 * carries the same rate to the panel stagger this module never sees.
 *
 * The clock is a wall-clock interval rather than rAF: a frame that is
 * never delivered — backgrounded tab, throttled timer — can't strand the
 * boot part-way, because every tick recomputes from Date.now() and the
 * last one is clamped to the end of the score.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SPEED, CSS_K, scoreFor, fillAt } from '../lib/boot/score.js';
import { setBootFill, primeBootFill } from '../lib/boot/fill.js';
import {
  BOOST, decide, boosted, writeRun, clearRun, elapsedAt, remainingWall,
} from '../lib/boot/run.js';

// undefined = not yet decided · null = this page load does not boot
// object   = the run in flight, shared by every mount on this page
let bootRun;

const session = () => {
  try { return window.sessionStorage; } catch { return null; }
};

/** Test seam — lets a harness replay the boot without a page reload. */
export function resetBootForTests() {
  bootRun = undefined;
  clearRun(session());
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Everything that has to happen when the run's time is up, wherever the
 * component is by then. It belongs to the RUN, not to any mount: a
 * mount's own cleanup fires on every remount and would flash every dial
 * to full and back, and would strip the stagger classes off <html> only
 * to re-add them a frame later — which restarts every CSS animation
 * hanging off them.
 */
let endTimer = null;
function scheduleEnd(ms) {
  clearTimeout(endTimer);
  endTimer = setTimeout(() => {
    setBootFill(1);
    const root = document.documentElement;
    root.classList.remove('vb-boot', 'vb-boot-desktop', 'vb-boot-mobile');
    root.style.removeProperty('--vb-k');
  }, Math.max(0, ms));
}

/**
 * Decide, once for the whole page load, whether this is a boot and where
 * in it we are.
 */
function decideRun(score) {
  if (bootRun !== undefined) return bootRun;
  const total = score.total + 300;
  const { run } = decide(session(), Date.now(), {
    speed: SPEED,
    total,
    allowed: !prefersReducedMotion(),
  });
  bootRun = run;
  if (run) scheduleEnd(remainingWall(run, Date.now(), SPEED, total));
  return bootRun;
}

/**
 * @param {'desktop'|'mobile'} kind
 * @returns {{ t, running, score, boosted, skip }} elapsed score time in
 *   authored ms, whether the sequence is still playing, and the tap.
 */
export function useBootSequence(kind) {
  const score = scoreFor(kind);
  const END = score.total + 300;

  const runRef = useRef(undefined);
  if (runRef.current === undefined) {
    runRef.current = decideRun(score);
    /* Primed during render, not from an effect. Every widget renders
       after this component does — it sits above them in App — so the
       dials are already told to start empty by the time they first
       draw. From an effect they would paint full for one frame and then
       jump back to zero. Primed rather than set, because notifying
       subscribers from inside a render is the one thing React refuses;
       the next tick, 33ms later, carries the value to anyone who has
       subscribed since. */
    primeBootFill(runRef.current
      ? fillAt(elapsedAt(runRef.current, Date.now(), SPEED), score)
      : 1);
  }

  const run = runRef.current;
  const [t, setT] = useState(() => (run ? Math.min(elapsedAt(run, Date.now(), SPEED), END) : END));
  const [hurried, setHurried] = useState(() => !!(run && run.boostAt));
  const running = !!run && t < END;

  /**
   * Hurry it along. Idempotent — a second tap is not twice as fast,
   * which would make the end of the sequence depend on how quickly
   * someone can tap.
   */
  const skip = useCallback(() => {
    if (!bootRun || bootRun.boostAt) return;
    const now = Date.now();
    bootRun = boosted(bootRun, now);
    runRef.current = bootRun;
    writeRun(session(), bootRun);          // survives the reload, like the run
    scheduleEnd(remainingWall(bootRun, now, SPEED, END));
    setHurried(true);
  }, [END]);

  useEffect(() => {
    if (!run) return undefined;
    const id = setInterval(() => {
      const next = Math.min(elapsedAt(runRef.current, Date.now(), SPEED), END);
      setT(next);
      setBootFill(fillAt(next, score));
      if (next >= END) clearInterval(id);
    }, 33);
    return () => clearInterval(id);
    // `run` is fixed for the life of this mount, and END with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * One tap anywhere. Listened for on the window rather than on the
   * overlay: the overlay is pointer-events:none by design — it must
   * never be the thing standing between a user and the app — so a tap
   * that skips is also a tap that lands wherever it landed. That is the
   * right trade at four seconds; swallowing the first press of a button
   * someone deliberately aimed at would not be.
   */
  useEffect(() => {
    if (!run) return undefined;
    const opts = { passive: true };
    window.addEventListener('pointerdown', skip, opts);
    window.addEventListener('keydown', skip, opts);
    return () => {
      window.removeEventListener('pointerdown', skip, opts);
      window.removeEventListener('keydown', skip, opts);
    };
  }, [run, skip]);

  /**
   * The stagger for elements this component never renders — the hub's
   * own panels, the nav, the tab bar — is a class on <html> that
   * boot.css hangs its animations off, and --vb-k is the rate it plays
   * at. Both are put on at mount and taken off by the RUN's own timer,
   * never by this effect's cleanup: removing and re-adding the class on
   * a remount restarts every animation hanging off it.
   */
  useEffect(() => {
    if (!run) return undefined;
    const root = document.documentElement;
    root.classList.add('vb-boot', `vb-boot-${kind}`);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!run) return undefined;
    document.documentElement.style.setProperty('--vb-k', String(hurried ? CSS_K / BOOST : CSS_K));
    return undefined;
  }, [run, hurried]);

  return { t, running, score, boosted: hurried, skip };
}
