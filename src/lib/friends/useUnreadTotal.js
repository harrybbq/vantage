/**
 * Unread direct messages, as one number — for the chrome bar's chip.
 *
 * Same shape and reasoning as usePendingCount: a head-only count (no row
 * bodies) on the partial index messages_recipient_unread_idx, once a
 * minute, failing to zero. While the friends rail is mounted it knows
 * sooner — it holds the live inbox — and says so with a
 * `vantage:dm-unread` event, which this adopts immediately.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

const POLL_MS = 60_000;

async function countUnread(userId) {
  try {
    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .is('read_at', null);
    return error ? 0 : (count || 0);
  } catch {
    return 0;
  }
}

export function useUnreadTotal(userId) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) { setCount(0); return undefined; }
    let cancelled = false;
    const pull = () => countUnread(userId).then(n => { if (!cancelled) setCount(n); });
    pull();
    const id = setInterval(() => { if (document.visibilityState !== 'hidden') pull(); }, POLL_MS);
    const onLive = e => { if (typeof e.detail === 'number' && !cancelled) setCount(e.detail); };
    window.addEventListener('vantage:dm-unread', onLive);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('vantage:dm-unread', onLive); };
  }, [userId]);

  return count;
}
