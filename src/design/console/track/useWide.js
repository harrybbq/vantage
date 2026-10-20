import { useSyncExternalStore } from 'react';

/** True while the viewport is at least `px` wide (matchMedia, live). */
export default function useWide(px = 900) {
  const q = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    cb => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mq = window.matchMedia(q);
      if (mq.addEventListener) mq.addEventListener('change', cb); else mq.addListener(cb);
      return () => { if (mq.removeEventListener) mq.removeEventListener('change', cb); else mq.removeListener(cb); };
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : true),
    () => true,
  );
}
