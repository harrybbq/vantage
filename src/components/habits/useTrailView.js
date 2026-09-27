/**
 * Runner or trail, per habit card. A view preference, so it lives in
 * this browser (localStorage) rather than in the synced state — flipping
 * it must never cost a save of the whole state blob.
 */
import { useCallback, useState } from 'react';

const key = id => `vb_habit_view_${id}`;

export default function useTrailView(id) {
  const [trail, setTrail] = useState(() => {
    try { return localStorage.getItem(key(id)) === 'trail'; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setTrail(t => {
      const next = !t;
      try { if (next) localStorage.setItem(key(id), 'trail'); else localStorage.removeItem(key(id)); } catch { /* private mode */ }
      return next;
    });
  }, [id]);
  return [trail, toggle];
}
