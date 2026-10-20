/**
 * Where the on-screen keyboard is, for bottom sheets.
 *
 * iOS Safari does not shrink the layout viewport when the keyboard opens:
 * it slides over the bottom of the page, so anything pinned to `bottom: 0`
 * ends up underneath it. A sheet whose content shrinks while you type (the
 * exercise picker filtering down to nothing) sank behind the keyboard until
 * only its handle showed (seen 2026-10-20).
 *
 * The visual viewport says what is actually visible. Returns
 *   kb   px of the layout viewport hidden below the visible area (0 when
 *        no keyboard, or where the browser already resizes the page)
 *   vvh  the visible height in px, or null where visualViewport is missing
 * Re-renders at most once a frame, and only when either number changes.
 */
import { useEffect, useState } from 'react';

const read = () => {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return { kb: 0, vvh: null };
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  return { kb, vvh: Math.round(vv.height) };
};

export default function useKeyboardInset(on = true) {
  const [v, setV] = useState(() => (on ? read() : { kb: 0, vvh: null }));
  useEffect(() => {
    const vv = on && typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    let raf = 0;
    const tick = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setV(prev => {
        const next = read();
        return next.kb === prev.kb && next.vvh === prev.vvh ? prev : next;
      }));
    };
    tick();
    vv.addEventListener('resize', tick);
    vv.addEventListener('scroll', tick);
    return () => { cancelAnimationFrame(raf); vv.removeEventListener('resize', tick); vv.removeEventListener('scroll', tick); };
  }, [on]);
  return v;
}
