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
export async function shareInvite() {
  const invite = await getMyInvite();
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
