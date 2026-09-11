/**
 * Single row in the compact Friends panel. Renders avatar + name + a
 * short status line + a small OVR chip (glow-tinted by prestige tier),
 * and — on hover — a message button immediately left of that chip, with
 * any unread count sitting on the button itself.
 *
 * Status line precedence:
 *   1. Active streak (with flame) if streak > 0
 *   2. Last-seen days if recently quiet
 *   3. Handle as a fallback identifier
 *
 * Click-to-expand is wired by the parent — the row just emits onClick.
 *
 * ── Why the row is a div and not a button ────────────────────────────
 * It was a <button>, which is the right element for "press this to open
 * the card". But a button cannot legally contain another button, and the
 * message control has to sit INSIDE the row: to the left of the level
 * chip, in the same flex line, so it takes its place in the layout
 * rather than being floated over whatever happens to be there. So the
 * row carries the button role itself and handles Enter and Space, and
 * the message button nests inside it legitimately.
 */
import Icon from '../Icon';
import { ovrTier } from '../../lib/ratings/tiers';

const COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];

function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}

function initials(name) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function statusLine(friend) {
  if (friend.streak > 0) return `🔥 ${friend.streak}d`;
  if (friend.lastSeenDays != null) return `${friend.lastSeenDays}d ago`;
  return `@${friend.handle}`;
}

export default function FriendListRow({ friend, selected, onClick, onMessage }) {
  const ovr = friend.ovr || 1;
  const prestige = ovrTier(ovr);
  const unread = friend.unread > 0;

  function onKeyDown(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    e.preventDefault();          // Space would otherwise scroll the panel
    onClick();
  }

  return (
    <div
      className={`fc-row${selected ? ' fc-row-selected' : ''}${unread ? ' fc-row-has-unread' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={!!selected}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className="fc-row-avatar-wrap">
        {friend.avatar_url ? (
          <img
            className="fc-row-avatar fc-row-avatar-img"
            src={friend.avatar_url}
            alt=""
          />
        ) : (
          <div className="fc-row-avatar" style={{ background: avatarColor(friend.name) }}>
            {initials(friend.name)}
          </div>
        )}
        {/* Online dot is reserved for a future presence layer — see
            future_ideas/README. We render the slot but leave it hidden
            until Realtime is wired up. Keeps card geometry stable. */}
        {friend.online && <div className="fc-row-online-dot" />}
      </div>
      <div className="fc-row-info">
        <div className="fc-row-name">{friend.name}</div>
        <div className="fc-row-status">{statusLine(friend)}</div>
      </div>
      {/* Straight to the conversation. Opening the card to reach its
          Message button was two clicks and a card's worth of scrolling
          for the thing people do most. stopPropagation because the row
          underneath would otherwise also expand the card behind the
          chat.

          The unread count rides ON the button rather than sitting beside
          it: the number and the way to act on it are the same thought,
          and a row with something waiting keeps the button visible
          (below), so the count is never hidden with it. */}
      {onMessage && (
        <button
          type="button"
          className="fc-row-msg"
          title={unread
            ? `${friend.unread} unread message${friend.unread === 1 ? '' : 's'} from ${friend.name}`
            : `Message ${friend.name}`}
          aria-label={unread
            ? `Message ${friend.name}, ${friend.unread} unread`
            : `Message ${friend.name}`}
          onClick={e => { e.stopPropagation(); onMessage(friend); }}
          onKeyDown={e => e.stopPropagation()}
        >
          <Icon name="mail" size={13} />
          {unread && <span className="fc-row-unread">{friend.unread > 9 ? '9+' : friend.unread}</span>}
        </button>
      )}
      <div className={`fc-row-level ovr-chip ovr-tier-${prestige.key}`} title={`OVR ${ovr} · ${prestige.label}`}>{ovr}</div>
    </div>
  );
}
