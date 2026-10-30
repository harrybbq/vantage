import Icon from '../Icon';
import { previewText, relTime } from '../../lib/friends/dmView';
import './friends-dm.css';

/**
 * The Messages tab: one row per conversation, newest first.
 *
 * Rows are real <button>s (nothing nests inside them), so Tab reaches
 * each one and Enter/Space opens it. A conversation with someone who is
 * no longer a friend, is blocked, or is suspended stays in the list —
 * the history is still yours, and reporting needs it — but is muted and
 * says why, and opens read-only.
 *
 * Conversations with someone this account has muted (item 113; rows
 * flagged `silenced` by lib/friends/mutes.js) come last, under a "Muted"
 * label, with no unread badge or bold — still listed, still readable.
 */
const COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}
function initials(name = '?') {
  return name.replace(/^@/, '').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
}

export default function ConversationList({ rows, userId, selectedId, loading, onOpen, onInvite, now = Date.now() }) {
  return (
    <div className="fc-panel dm-inbox" id="fr-tabpanel-messages" role="tabpanel" aria-labelledby="fr-tab-messages">
      {loading && rows.length === 0 ? (
        <div className="fc-panel-empty">Loading conversations…</div>
      ) : rows.length === 0 ? (
        <div className="dm-inbox-empty">
          <div className="dm-inbox-empty-title">No conversations yet</div>
          <p>Messages with your friends show up here. Know someone who'd keep you honest?</p>
          <button type="button" className="btn btn-primary btn-sm dm-invite-cta" data-ob="add-friend" onClick={onInvite}>
            <Icon name="user-plus" size={14} /> Invite a friend
          </button>
        </div>
      ) : (
        <ul className="dm-inbox-list">
          {rows.map((r, i) => {
            const unread = !r.silenced && r.unread > 0;
            const firstQuiet = r.silenced && !rows[i - 1]?.silenced;
            const time = relTime(r.last.created_at, now);
            const preview = previewText(r.last, userId);
            return (
              <li key={r.id}>
                {firstQuiet && <div className="dm-inbox-group" role="presentation">Muted</div>}
                <button
                  type="button"
                  className={`dm-conv${unread ? ' is-unread' : ''}${r.muted ? ' is-muted' : ''}${r.silenced ? ' is-silenced' : ''}${selectedId === r.id ? ' is-selected' : ''}`}
                  onClick={() => onOpen(r)}
                  aria-current={selectedId === r.id ? 'true' : undefined}
                  aria-label={`${r.name}${r.note ? ` (${r.note})` : ''}${r.silenced ? ' (muted)' : ''}. ${unread ? `${r.unread} unread. ` : ''}${preview}. ${time}`}
                >
                  {r.avatar_url
                    ? <img className="dm-conv-avatar" src={r.avatar_url} alt="" />
                    : <span className="dm-conv-avatar" style={{ background: r.muted ? undefined : avatarColor(r.name) }} aria-hidden="true">{initials(r.name)}</span>}
                  <span className="dm-conv-main">
                    <span className="dm-conv-top">
                      <span className="dm-conv-name">{r.name}</span>
                      <span className="dm-conv-time">{time}</span>
                    </span>
                    <span className="dm-conv-bottom">
                      <span className="dm-conv-preview">{r.note ? <em className="dm-conv-note">{r.note} · </em> : null}{preview}</span>
                      {unread && <span className="dm-conv-badge" aria-hidden="true">{r.unread > 99 ? '99+' : r.unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Friends | Messages switcher. Arrow keys move between the two tabs. */
export function FriendsTabs({ tab, onTab, friendCount, unread }) {
  function onKeyDown(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = tab === 'friends' ? 'messages' : 'friends';
    onTab(next);
    window.setTimeout(() => document.getElementById(`fr-tab-${next}`)?.focus(), 0);
  }
  return (
    <div className="dm-tabs" role="tablist" aria-label="Friends and messages" onKeyDown={onKeyDown}>
      <button
        type="button" role="tab" id="fr-tab-friends"
        aria-selected={tab === 'friends'} aria-controls="fr-tabpanel-friends"
        tabIndex={tab === 'friends' ? 0 : -1}
        className={`dm-tab${tab === 'friends' ? ' is-on' : ''}`}
        onClick={() => onTab('friends')}
      >
        Friends{friendCount > 0 && <span className="dm-tab-n">{friendCount}</span>}
      </button>
      <button
        type="button" role="tab" id="fr-tab-messages"
        aria-selected={tab === 'messages'} aria-controls="fr-tabpanel-messages"
        tabIndex={tab === 'messages' ? 0 : -1}
        className={`dm-tab${tab === 'messages' ? ' is-on' : ''}`}
        onClick={() => onTab('messages')}
        aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
      >
        Messages{unread > 0 && <span className="dm-tab-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>
  );
}
