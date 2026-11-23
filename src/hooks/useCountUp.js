/**
 * A number that counts to its new value instead of jumping (ease-out).
 *
 * Small motion, the training tracker's rules: it plays when the value
 * CHANGES, never on first paint; it is off under reduced motion; and a
 * change too small to read (under `min`) lands at once, so a balance
 * that drifts by pennies of interest is not forever animating.
 *
 *   const shown = useCountUp(total)               // every design
 *   const shown = useCountUp(total, { when: 'console' })   // new design only
 */
import { useEffect, useRef, useState } from 'react';

const still = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const designIs = d => typeof document !== 'undefined' && document.documentElement.dataset.design === d;

export function useCountUp(value, { ms = 650, min = 1, when = null } = {}) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [shown, setShown] = useState(v);
  const prev = useRef(v);
  useEffect(() => {
    const from = prev.current;
    prev.current = v;
    if (from === v || Math.abs(v - from) < min || still() || (when && !designIs(when))) { setShown(v); return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / ms);
      setShown(k === 1 ? v : from + (v - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v, ms, min, when]);
  return shown;
}

/** `<CountUp value={n} fmt={money} />` — the hook as an element, for places that only need the text. */
export function CountUp({ value, fmt = String, ...opts }) {
  return fmt(useCountUp(value, opts));
}
