import { useMemo, useState } from 'react';
import { useSafety } from '../../lib/friends/useSafety';
import { noticeText, APPEAL_LINE } from '../../lib/moderation/notices';
import './friends-dm.css';

/**
 * Safety notices at the top of Friends (STARTUP_REQUIREMENTS 110, 111).
 *
 *   - Suspended: one calm, solid banner that stays while the suspension
 *     lasts — what's paused, what isn't, how to appeal. Not an error.
 *   - Unread notices (report received, the outcome, a reset name or
 *     picture, a lifted suspension): a card each with "Got it", which
 *     stamps read_at. Newest first, at most three at a time.
 *   - Earlier notices fold away under one quiet line.
 *
 * Renders nothing at all when there's nothing to say — including before
 * supabase/safety_2026_10b.sql is run (useSafety answers empty).
 */
const MAX_UNREAD = 3;

function when(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function SafetyNotices({ userId }) {
  const { suspended, notices, markRead } = useSafety(userId);
  const [showEarlier, setShowEarlier] = useState(false);

  const { unread, earlier } = useMemo(() => {
    const u = [];
    const e = [];
    for (const n of notices || []) {
      // While suspended the banner says it; the notice would repeat it.
      if (suspended && n.kind === 'account_suspended') { if (n.read_at) e.push(n); continue; }
      (n.read_at ? e : u).push(n);
    }
    return { unread: u, earlier: e };
  }, [notices, suspended]);

  if (!suspended && !unread.length && !earlier.length) return null;
  const shown = unread.slice(0, MAX_UNREAD);
  const suspendedNotice = (notices || []).find(n => n.kind === 'account_suspended' && !n.read_at);

  return (
    <div className="sn-wrap" aria-label="Safety notices">
      {suspended && (
        <section className="sn-card is-warn sn-banner" role="status">
          <div className="sn-title">Your account is suspended</div>
          <p className="sn-body">
            Messages, reactions and friend requests are paused, and you&apos;re hidden from
            leaderboards, search and group boards. You can still read your conversations, and
            everything you&apos;ve saved in the app is untouched.
          </p>
          <p className="sn-body sn-appeal">{APPEAL_LINE}</p>
          {suspendedNotice && (
            <button type="button" className="sn-ok" onClick={() => markRead([suspendedNotice.id])}>Got it</button>
          )}
        </section>
      )}

      {shown.map(n => {
        const t = noticeText(n);
        if (!t) return null;
        return (
          <section key={n.id} className={`sn-card is-${t.tone}`}>
            <div className="sn-head">
              <span className="sn-title">{t.title}</span>
              <span className="sn-when">{when(n.created_at)}</span>
            </div>
            <p className="sn-body">{t.body}</p>
            <button type="button" className="sn-ok" onClick={() => markRead([n.id])}>Got it</button>
          </section>
        );
      })}
      {unread.length > MAX_UNREAD && (
        <button type="button" className="sn-more" onClick={() => markRead(shown.map(n => n.id))}>
          {unread.length - MAX_UNREAD} more — mark these read to see them
        </button>
      )}

      {earlier.length > 0 && (
        <div className="sn-earlier">
          <button type="button" className="sn-more" aria-expanded={showEarlier} onClick={() => setShowEarlier(v => !v)}>
            {showEarlier ? 'Hide earlier notices' : `Earlier notices · ${earlier.length}`}
          </button>
          {showEarlier && (
            <ul className="sn-list">
              {earlier.map(n => {
                const t = noticeText(n);
                if (!t) return null;
                return (
                  <li key={n.id}>
                    <span className="sn-list-title">{t.title}</span>
                    <span className="sn-when">{when(n.created_at)}</span>
                    <p className="sn-body">{t.body}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
