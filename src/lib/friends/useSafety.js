import { useCallback, useEffect, useState } from 'react';
import { loadSafety, peekSafety, onSafety, markNoticesRead } from './safety';

/**
 * { suspended, suspendedAt, notices, markRead(ids), refresh() } for the
 * signed-in account. Shares one cached read across every component that
 * asks (see ./safety.js); re-reads when the tab becomes visible again.
 */
export function useSafety(userId) {
  const [state, setState] = useState(() => peekSafety(userId));

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    const off = onSafety(v => { if (alive) setState(v); });
    loadSafety(userId).then(v => { if (alive) setState(v); });
    const onVis = () => {
      if (document.visibilityState === 'visible') loadSafety(userId).then(v => { if (alive) setState(v); });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; off(); document.removeEventListener('visibilitychange', onVis); };
  }, [userId]);

  const markRead = useCallback(ids => markNoticesRead(userId, ids), [userId]);
  const refresh = useCallback(() => loadSafety(userId, { force: true }), [userId]);
  return { ...state, markRead, refresh };
}
