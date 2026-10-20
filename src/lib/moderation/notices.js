/**
 * What a safety notice says (STARTUP_REQUIREMENTS item 110).
 *
 * Rows in `safety_notices` (supabase/safety_2026_10b.sql) carry a `kind`
 * and a small `meta`; the words live here, so copy can be fixed without
 * touching stored rows. Written by the server only:
 *
 *   report_received   → reporter, the moment a report lands (DB trigger)
 *   report_actioned   → reporter, when the owner acts on it
 *   report_dismissed  → reporter, when the owner closes it without action
 *   account_suspended → reported user (never says who reported, or why
 *                       in a way that points at anyone)
 *   account_restored  → that user, when a suspension is lifted
 *   content_reset     → that user, when the owner reset their name,
 *                       handle or picture (meta.fields)
 *
 * Pure. safety.test.mjs pins it.
 */

const FIELD_WORDS = {
  display_name: 'display name',
  handle: 'handle',
  avatar: 'profile picture',
};

/** "@sam", or their name, or a neutral fallback — the person the
 *  REPORTER reported (the reporter already knows who that is). */
function who(meta) {
  const h = meta && typeof meta.handle === 'string' && meta.handle.trim();
  if (h) return `@${h.replace(/^@/, '').slice(0, 64)}`;
  const n = meta && typeof meta.name === 'string' && meta.name.trim();
  if (n) return n.slice(0, 64);
  return 'this person';
}

function listWords(fields) {
  const words = (Array.isArray(fields) ? fields : [])
    .map(f => FIELD_WORDS[f]).filter(Boolean);
  const uniq = [...new Set(words)];
  if (!uniq.length) return 'part of your profile';
  if (uniq.length === 1) return `your ${uniq[0]}`;
  return `your ${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`;
}

export const APPEAL_LINE = 'If you think we got this wrong, tell us through Settings → Report a problem and someone will look at it again.';

/**
 * → { title, body, tone: 'info' | 'good' | 'warn', persistent } or null
 * for a kind this build doesn't know (a newer server) — the UI skips it.
 * `persistent`: stays until read, shown first.
 */
export function noticeText(notice) {
  if (!notice || typeof notice !== 'object') return null;
  const meta = notice.meta && typeof notice.meta === 'object' ? notice.meta : {};
  switch (notice.kind) {
    case 'report_received':
      return {
        tone: 'info',
        title: 'We got your report',
        body: `Thanks for reporting ${who(meta)}. We aim to look at every report within 24 hours — sooner when it's about a child's safety, threats or self-harm. We'll let you know here when we've dealt with it. They won't be told who reported them.`,
      };
    case 'report_actioned':
      return {
        tone: 'good',
        title: 'We acted on your report',
        body: `We reviewed your report about ${who(meta)} and took action under our rules. We can't share exactly what, to protect everyone's privacy. Thank you for helping keep Vantage safe.`,
      };
    case 'report_dismissed':
      return {
        tone: 'info',
        title: 'We reviewed your report',
        body: `We looked at your report about ${who(meta)} and didn't find that it broke our rules this time. If it happens again, report it again — and you can always block someone so they can't contact you.`,
      };
    case 'account_suspended':
      return {
        tone: 'warn',
        persistent: true,
        title: 'Your account is suspended',
        body: `We reviewed a report and found that your account broke our community rules. While it's suspended you're hidden from leaderboards, search and group boards, and you can't send messages, reactions or friend requests. Everything you've saved in the app is untouched. ${APPEAL_LINE}`,
      };
    case 'account_restored':
      return {
        tone: 'good',
        title: 'Your suspension has been lifted',
        body: 'You can message friends, send requests and appear on boards again.',
      };
    case 'content_reset':
      return {
        tone: 'warn',
        title: 'We reset part of your profile',
        body: `${capital(listWords(meta.fields))} broke our rules for things other people see, so we removed it. You can choose a new one — the same one won't be accepted again. ${APPEAL_LINE}`,
      };
    default:
      return null;
  }
}

const capital = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Unread first, then newest. Unknown kinds dropped. */
export function sortNotices(list) {
  return (Array.isArray(list) ? list : [])
    .filter(n => n && n.id != null && noticeText(n))
    .sort((a, b) => {
      const ar = a.read_at ? 1 : 0, br = b.read_at ? 1 : 0;
      if (ar !== br) return ar - br;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
}

/** The calm line shown wherever an action is paused for a suspended account. */
export const SUSPENDED_SHORT = 'Your account is suspended, so messages, reactions and friend requests are paused. You can still read your conversations.';

/**
 * Which safety refusal a Supabase/PostgREST error is, from the HINT the
 * database guards set (safety_2026_10b.sql) or, failing that, their
 * wording. → 'suspended' | 'peer-suspended' | 'filtered' | null.
 */
export function safetyErrorKind(err) {
  if (!err) return null;
  const hint = String(err.hint || '');
  if (hint === 'vantage:suspended') return 'suspended';
  if (hint === 'vantage:peer-suspended') return 'peer-suspended';
  if (hint === 'vantage:filtered') return 'filtered';
  const m = String(err.message || '');
  if (/^Your account is suspended/i.test(m)) return 'suspended';
  if (/^This account is suspended/i.test(m)) return 'peer-suspended';
  if (/word we don.t allow in messages/i.test(m)) return 'filtered';
  return null;
}
