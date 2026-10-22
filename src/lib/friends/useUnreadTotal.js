/**
 * Unread direct messages, as one number — for the chrome bar's chip.
 *
 * Same shape and reasoning as usePendingCount: a head-only count (no row
 * bodies) on the partial index messages_recipient_unread_idx, once a
 * minute, failing to zero. While the friends rail is mounted it knows
 * sooner — it holds the live inbox — and says so with a
 * `vantage:dm-unread` event, which this adopts immediately.
 *
 * Messages from people this account has muted (item 113) are left out of
 * the count — still a head-only count, with a `sender_id not in (…)`
 * filter of the muted ids (uuid characters only, from mutes.js). The
 * rail's event already leaves them out (mutes.audibleUnread).
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { useMutes } from './useMutes';
import { mutedIds } from './mutes';

const POLL_MS = 60_000;

async function countUnread(userId, muted) {
  try {
    let q = supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .is('read_at', null);
    if (muted) q = q.not('sender_id', 'in', `(${muted})`);
    const { count, error } = await q;
    return error ? 0 : (count || 0);
  } catch {
    return 0;
  }
}

export function useUnreadTotal(userId) {
  const [count, setCount] = useState(0);
  const muted = mutedIds(useMutes().map).join(',');

  useEffect(() => {
    if (!userId) { setCount(0); return undefined; }
    let cancelled = false;
    const pull = () => countUnread(userId, muted).then(n => { if (!cancelled) setCount(n); });
    pull();
    const id = setInterval(() => { if (document.visibilityState !== 'hidden') pull(); }, POLL_MS);
    const onLive = e => { if (typeof e.detail === 'number' && !cancelled) setCount(e.detail); };
    window.addEventListener('vantage:dm-unread', onLive);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('vantage:dm-unread', onLive); };
  }, [userId, muted]);

  return count;
}
