/**
 * useInputMode() → { layout: 'phone'|'tablet'|'desktop', coarse, width }.
 *
 * Two independent switches (brief §3.1, fixes A4):
 *   layout  by viewport WIDTH — < 600 phone, 600–1023 tablet, ≥ 1024 desktop
 *   coarse  by `(pointer: coarse)` — the custom number pad and swipe vs.
 *           keyboard entry in the cells
 * A narrow window with a mouse is { layout: 'phone', coarse: false }: the
 * phone row design with keyboard entry, never the desktop table squeezed.
 * Live: follows resizes, rotation and a pointer change (a tablet docking
 * a trackpad).
 */
import { useSyncExternalStore } from 'react';
import { layoutFor } from '../../../../lib/lifts/ui';

const Q = '(pointer: coarse)';
const hasWin = () => typeof window !== 'undefined';
const coarseNow = () => (hasWin() && window.matchMedia ? window.matchMedia(Q).matches : false);
const widthNow = () => (hasWin() ? window.innerWidth : 1024);

let snap = null;
const snapshot = () => {
  const w = widthNow();
  const c = coarseNow();
  const layout = layoutFor(w);
  // Same object while nothing that matters changed (useSyncExternalStore needs a stable snapshot).
  if (!snap || snap.width !== w || snap.coarse !== c) snap = { layout, coarse: c, width: w };
  return snap;
};
const subscribe = cb => {
  if (!hasWin()) return () => {};
  const mq = window.matchMedia ? window.matchMedia(Q) : null;
  window.addEventListener('resize', cb);
  window.addEventListener('orientationchange', cb);
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', cb); else mq.addListener(cb); }
  return () => {
    window.removeEventListener('resize', cb);
    window.removeEventListener('orientationchange', cb);
    if (mq) { if (mq.removeEventListener) mq.removeEventListener('change', cb); else mq.removeListener(cb); }
  };
};
const server = { layout: 'desktop', coarse: false, width: 1024 };

export default function useInputMode() {
  return useSyncExternalStore(subscribe, snapshot, () => server);
}
export { useInputMode };
