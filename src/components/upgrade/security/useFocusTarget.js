/**
 * "Go to source": once a panel's data is in, find the element an alert
 * pointed at, scroll it into view, move keyboard focus to it and pulse
 * an outline round it (a static outline under reduced motion).
 *
 * Targets mark themselves with data-sec-focus="<key>" — e.g. "disk",
 * "advisor:rls_disabled_in_public", "deploy:<id>", "stale",
 * "ticket:<uuid>". When the exact key is not on the page (a deploy older
 * than the ten listed, an advisor since fixed) the hook falls back to the
 * element marked data-sec-focus-group="<prefix>" — the list it would
 * have been in — so the click still lands somewhere meaningful.
 *
 * `focus` is { key, n }: `n` changes on every click, so pressing the same
 * source twice pulses twice. Some targets render a beat after the panel
 * (the report queue loads on its own), so the lookup retries briefly.
 */
import { useEffect, useRef } from 'react';

const TRIES = 30;          // × 120 ms ≈ 3.6 s of looking for the exact element
const FALLBACK_AFTER = 10; // then (≈ 1.2 s in) settle for its group
const PULSE_MS = 2600;

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

const esc = s => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

export function pulseElement(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (!el.matches('a, button, input, textarea, select, [tabindex]')) el.setAttribute('tabindex', '-1');
  try { el.focus({ preventScroll: true }); } catch { /* old browsers */ }
  el.classList.remove('sec-target');
  void el.offsetWidth;                       // restart the animation
  el.classList.add('sec-target');
  el.setAttribute('data-sec-focused', '');
  setTimeout(() => el.classList.remove('sec-target'), PULSE_MS);
}

/**
 * @param {{key:string, n:number}|null} focus
 * @param {boolean} ready  the panel's data has loaded
 * @param {(key:string) => void} [onTarget]  called first, so a panel can
 *        open a drawer / switch an inner tab before the lookup runs
 */
export function useFocusTarget(focus, ready, onTarget) {
  const key = focus && focus.key;
  const n = focus && focus.n;
  const done = useRef(null);          // the click (`n`) already landed — a later refresh must not jump again
  useEffect(() => {
    if (!key || !ready || done.current === `${key}#${n}`) return undefined;
    if (onTarget) onTarget(key);
    let tries = 0;
    let timer = null;
    const root = () => document.querySelector('.upg-pane.sec') || document;
    const find = () => {
      const exact = root().querySelector(`[data-sec-focus="${esc(key)}"]`);
      if (exact) return exact;
      if (tries < FALLBACK_AFTER) return null;
      const group = key.includes(':') ? key.split(':')[0] : key;
      return root().querySelector(`[data-sec-focus-group~="${esc(group)}"]`);
    };
    const step = () => {
      tries++;
      const el = find();
      if (el) { done.current = `${key}#${n}`; pulseElement(el); return; }
      if (tries <= TRIES) timer = setTimeout(step, 120);
    };
    timer = setTimeout(step, 30);
    return () => clearTimeout(timer);
    // onTarget is a fresh closure each render; key/n/ready are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n, ready]);
}
