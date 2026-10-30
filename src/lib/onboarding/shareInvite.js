import { getMyInvite } from '../friends/invites';

/**
 * Onboarding's Friends stop and the hub's Getting started card: share
 * the user's invite link (lib/friends/invites getMyInvite — the same link
 * Friends › Invite shows). The system share sheet where there is one,
 * else the clipboard.
 *
 * → { ok: true, how: 'shared'|'copied', url } | { ok: false, reason, message }
 * `ok` means the link left the app (shared, or copied to paste), so the
 * caller can count the first thing as done (onboarding.markInvited).
 * Cancelling the share sheet is { ok: false, reason: 'cancelled' }.
 * Never throws.
 */
// The link, fetched ahead of the tap. Safari only lets navigator.share
// (and the clipboard) run close to the tap that asked for it; a database
// round trip in between can use that up, so the Friends stop fetches the
// link as it opens and the tap shares straight away.
let ready = null;   // { at, promise }
const FRESH_MS = 60 * 1000;   // short: Friends › Invite can replace the link

/** Start fetching the invite link now; shareInvite() reuses it for a minute. */
export function prefetchInvite() {
  if (ready && Date.now() - ready.at < FRESH_MS) return ready.promise;
  const promise = getMyInvite().catch(() => ({ ok: false, reason: 'error' }));
  ready = { at: Date.now(), promise };
  promise.then(r => { if (!r || !r.ok) ready = null; });
  return promise;
}

export async function shareInvite() {
  const invite = await prefetchInvite();
  if (!invite || !invite.ok) {
    return { ok: false, reason: invite?.reason || 'error', message: invite?.message || 'Couldn’t get your invite link. Try again in a moment.' };
  }
  const url = invite.url;
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Add me on Vantage', text: 'Add me as a friend on Vantage:', url });
      return { ok: true, how: 'shared', url };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      // Fall through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return { ok: true, how: 'copied', url };
  } catch {
    return { ok: false, reason: 'error', message: `Copy this link to share it: ${url}`, url };
  }
}
