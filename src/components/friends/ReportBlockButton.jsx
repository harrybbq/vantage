import { useState } from 'react';
import ReportFriendModal from './ReportFriendModal';
import { reportUser, blockUser, reportSnapshot } from '../../lib/friends/queries';

/**
 * Report + block for people who aren't (necessarily) friends — the
 * leaderboard and group boards. Apple 1.2 wants both reachable from
 * wherever user-generated content is shown, not just from a friend card.
 *
 * Reuses the friend-card report sheet, which also offers Block, so a
 * dense row only has to find room for one small control.
 *
 * Props:
 *   userId     the signed-in user (reporter / blocker)
 *   target     { id, name, handle? } — the person on the row
 *   where      'leaderboard' | 'group' — carried in the report snapshot
 *   onBlocked  (target) => void — hide them locally once blocked
 *   variant    'icon' (a ⚑ button for a row) | 'text' (Report · Block)
 */
export default function ReportBlockButton({ userId, target, where, onBlocked, variant = 'icon' }) {
  const [open, setOpen] = useState(false);
  if (!userId || !target?.id || target.id === userId) return null;
  const name = target.name || (target.handle ? `@${target.handle}` : 'this user');
  const handle = target.handle || (typeof target.name === 'string' && target.name.startsWith('@') ? target.name.slice(1) : null);

  async function block() {
    const ok = window.confirm(
      `Block ${name}? They'll be removed from your friends if they're on your list, won't be able to message you, and won't be able to send you requests.`
    );
    if (!ok) return;
    try {
      await blockUser(userId, target.id);
      setOpen(false);
      onBlocked?.(target);
    } catch (e) {
      window.alert(e.message || 'Could not block.');
    }
  }

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          className="rb-flag"
          title={`Report or block ${name}`}
          aria-label={`Report or block ${name}`}
          onClick={e => { e.stopPropagation(); setOpen(true); }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 22V4" /><path d="M4 4h13l-2 4 2 4H4" />
          </svg>
        </button>
      ) : (
        <div className="rb-text">
          <button type="button" className="rb-text-btn" onClick={() => setOpen(true)}>Report</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="rb-text-btn" onClick={block}>Block</button>
        </div>
      )}

      <ReportFriendModal
        open={open}
        friend={{ name, handle }}
        onSubmit={(reason, context) =>
          reportUser(userId, target.id, reason, context, reportSnapshot({ handle, name: target.name, where }))}
        onBlock={block}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
