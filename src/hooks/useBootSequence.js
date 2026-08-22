/**
 * Drives the boot sequence clock.
 *
 * Plays ONCE per app boot. What "once" means is recorded at module
 * scope, not in state and not in storage: a module lives exactly as
 * long as the loaded page does, so switching sections — which unmounts
 * and remounts the section components — cannot start it again, while an
 * actual reload always can. That is the distinction the feature is
 * asked for.
 *
 * What is remembered is the moment it STARTED, not a played/not-played
 * flag. A flag would be wrong twice over: React's StrictMode remounts
 * every component once in development, which would eat the boot on
 * `npm run dev`, and switching section mid-boot would cut the sequence
 * off half-drawn. Remembering the start instant means a remount inside
 * the window resumes the same run at the point it had reached, and a
 * mount after the window does nothing at all.
 *
 * The clock is a wall-clock interval rather than rAF: a frame that is
 * never delivered — backgrounded tab, throttled timer — can't strand
 * the boot part-way, because every tick recomputes from Date.now() and
 * the last one is clamped to the end of the score.
 */
import { useEffect, useRef, useState } from 'react';
import { SPEED, scoreFor, durationOf } from '../lib/boot/score.js';

let bootStartedAt = null;

/** Test seam — lets a harness replay the boot without a page reload. */
export function resetBootForTests() { bootStartedAt = null; }

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
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

  // Resolved once per mount, on the first render: either this mount owns
  // (or joins) a run, or there is nothing left to play.
  const startedAt = useRef(undefined);
  if (startedAt.current === undefined) {
    const now = Date.now();
    if (prefersReducedMotion()) {
      startedAt.current = null;
    } else if (bootStartedAt === null) {
      bootStartedAt = now;
      startedAt.current = now;
    } else if (now - bootStartedAt < total) {
      startedAt.current = bootStartedAt;   // a remount inside the window resumes
    } else {
      startedAt.current = null;            // the boot has been and gone
    }
  }

  const from = startedAt.current;
  const [t, setT] = useState(() => (from === null ? END : Math.min((Date.now() - from) * SPEED, END)));
  const running = from !== null && t < END;

  useEffect(() => {
    if (from === null) return undefined;
    const id = setInterval(() => {
      const next = Math.min((Date.now() - from) * SPEED, END);
      setT(next);
      if (next >= END) clearInterval(id);
    }, 33);
    return () => clearInterval(id);
    // `from` is fixed for the life of this mount, and END with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The stagger for elements this component never renders — the hub's
   * own panels, the nav, the tab bar — is a class on <html> that
   * boot.css hangs its animations off. It comes off the moment the run
   * ends, so no rule from that file outlives the sequence.
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
