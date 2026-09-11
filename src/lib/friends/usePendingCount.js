/**
 * How many friend requests are waiting — for the chrome bar's chip.
 *
 * Deliberately its own tiny hook rather than a second `useFriends`: that
 * one loads the whole social graph (profiles, presence, public stats
 * plumbing) because the rail needs it, and the chip needs one integer.
 * Mounting it in the header would double every one of those queries on
 * every page of the app.
 *
 * Polls, like the unread counter beside it does, and re-reads whenever
 * `nudge` changes so accepting a request in the rail updates the chip
 * without waiting out the interval.
 */
import { useEffect, useState } from 'react';
import { countPendingRequests } from './queries';

/** A minute. The chip is a nudge, not a notification — nobody is waiting
 *  on it, and this runs on every page for every signed-in user. */
const POLL_MS = 60_000;

export function usePendingCount(userId, nudge) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) { setCount(0); return undefined; }
    let cancelled = false;
    const pull = () => countPendingRequests(userId)
      .then(n => { if (!cancelled) setCount(n); })
      .catch(() => { /* countPendingRequests already fails to zero */ });
    pull();
    const id = setInterval(pull, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId, nudge]);

  return count;
}
