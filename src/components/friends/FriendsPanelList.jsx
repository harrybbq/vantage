import FriendListRow from './FriendListRow';

/**
 * Compact panel housing the friend list. Header carries the section
 * label ("// Friends") and an online · offline counter; body is a
 * column of FriendListRow buttons.
 *
 * Selection is owned by the parent so the same state can drive both
 * "this row is highlighted" and "render this friend's expanded card
 * below the panel".
 */
export default function FriendsPanelList({
  friends,
  selectedId,
  onSelect,
  onMessage,
  onlineCount,
  offlineCount,
}) {
  // Fall back to deriving from the rows if counts aren't passed (e.g.
  // some old caller, or an alternate use of the panel). Lets the panel
  // stay drop-in compatible.
  const onlineN = onlineCount ?? friends.filter(f => f.online).length;
  const offlineN = offlineCount ?? Math.max(0, friends.length - onlineN);

  return (
    <div className="fc-panel">
      <div className="fc-panel-head">
        <span className="fc-panel-label">Friends</span>
        <span className="fc-panel-meta">
          <span className="fc-panel-meta-online">
            <span className="fc-panel-meta-dot" />{onlineN} online
          </span>
          <span className="fc-panel-meta-sep">·</span>
          <span>{offlineN} offline</span>
        </span>
      </div>
      {friends.length === 0 ? (
        <div className="fc-panel-empty">
          Add a friend by their @handle to compare progress.
        </div>
      ) : (
        <div className="fc-panel-body">
          {friends.map(f => (
            <FriendListRow
              key={f.id}
              friend={f}
              selected={f.id === selectedId}
              onClick={() => onSelect(f.id)}
              onMessage={onMessage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
