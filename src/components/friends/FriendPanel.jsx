/**
 * A friend, opened over the widget canvas.
 *
 * ── Why not the card under the list ──────────────────────────────────
 * Picking a friend used to append their card BELOW the rail, in a column
 * roughly 240px wide that already scrolls internally — so the card
 * opened off the fold often enough that FriendsRail carries a whole
 * effect to scroll the column for it. And messaging them from there
 * opened a modal on top of everything, which is a lot of ceremony for
 * "say something to Aidan".
 *
 * The middle of the hub is the widest thing on the screen and its
 * contents are the one part of the page nobody is reading while they
 * look at a friend. So the friend takes it: the conversation on the
 * left, the profile on the right, both at a size worth looking at.
 *
 * ── It borrows, it does not copy ─────────────────────────────────────
 * The conversation is MessagesModal in `inline` mode — the same poll,
 * the same optimistic send, the same report and block. The profile is
 * FriendCard with its own message button suppressed, because the
 * conversation it would open is already on screen beside it.
 *
 * Nothing here decides who is selected or fetches anything; FriendsRail
 * owns both and portals this into the slot the layout provides.
 */
import Icon from '../Icon';
import FriendCard from './FriendCard';
import MessagesModal from './MessagesModal';

export default function FriendPanel({
  userId,
  friend,
  loading,
  statsMissing,
  onClose,
  onBlocked,
  onReport,
  onBlock,
  onUnfriend,
}) {
  if (!friend) return null;

  return (
    <div className="os-panel fr-panel" data-hub-module="friend" data-hub-module-label="Friend">
      <div className="os-panel-label">
        <span className="os-panel-label-text">Friend</span>
        <span className="os-panel-label-right">{friend.handle ? `@${friend.handle}` : friend.name}</span>
        {/* Clicking anywhere off the panel closes it too — this is for
            people who would rather aim at something. */}
        <button type="button" className="fr-panel-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="fr-panel-body">
        <div className="fr-panel-chat">
          <MessagesModal
            inline
            open
            userId={userId}
            friend={friend}
            onClose={onClose}
            onBlocked={onBlocked}
          />
        </div>
        <div className="fr-panel-profile">
          <FriendCard
            friend={friend}
            loading={loading}
            statsMissing={statsMissing}
            onReport={onReport}
            onBlock={onBlock}
            onUnfriend={onUnfriend}
          />
        </div>
      </div>
    </div>
  );
}
