import { useEffect, useRef, useState } from 'react';
import FriendsHeatmap from './FriendsHeatmap';
import { ovrTier } from '../../lib/ratings/tiers';

/**
 * Expanded "cheerleader" view of a single friend.
 *
 * Sections (top-to-bottom):
 *   1. Header — avatar, name, @handle, OVR badge, ⋯ menu (Report/Block)
 *   2. Streak strip — big number + habit name OR a quiet "last active"
 *      line for friends without an active streak (no shaming language)
 *   3. 91-day activity heatmap (with hover tooltip)
 *   4. Recent wins — chips for the last few completed achievements
 *   5. Footer — "Remove from friends" button
 *
 * Action surfacing rationale:
 *   - "Unfriend" is a normal, non-hostile action (people drift apart;
 *     boards change). Surfaced as a visible footer button.
 *   - "Report" and "Block" are *moderation* actions — they imply the
 *     other person did something wrong. Tucked behind ⋯ so they don't
 *     dominate a card that's meant to celebrate someone.
 *
 * Callbacks (all optional — card still renders without them):
 *   onReport(friend)    — opens the report flow
 *   onBlock(friend)     — block + remove friendship
 *   onUnfriend(friend)  — remove friendship
 */

const COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];

function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}

function initials(name) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function FriendCard({
  friend,
  loading = false,
  statsMissing = false,
  unread = 0,
  onMessage,
  onReport,
  onBlock,
  onUnfriend,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside-click. Lives on FriendCard rather than a
  // shared Popover because the menu is small and lifecycle-tied to
  // the card itself.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [menuOpen]);

  if (!friend) return null;
  const ovr = friend.ovr || 1;
  const prestige = ovrTier(ovr);
  const hasStreak = friend.streak > 0;
  const hasHeatmap = Array.isArray(friend.heatmap) && friend.heatmap.length > 0;
  // Only Report + Block live in the kebab now. Unfriend has its own
  // footer button so users can find it without opening a menu.
  const hasMenu = !!(onReport || onBlock);

  function handleMenu(action) {
    setMenuOpen(false);
    action?.(friend);
  }

  return (
    <div className="fc-card">
      {/* Header */}
      <div className="fc-header">
        <div className="fc-avatar-wrap">
          {friend.avatar_url ? (
            <img
              className="fc-avatar fc-avatar-img"
              src={friend.avatar_url}
              alt=""
            />
          ) : (
            <div className="fc-avatar" style={{ background: avatarColor(friend.name) }}>
              {initials(friend.name)}
            </div>
          )}
          {friend.online && <div className="fc-online-dot" />}
        </div>
        <div className="fc-identity">
          <div className="fc-name">{friend.name}</div>
          <div className="fc-meta-row">
            <span className="fc-handle">@{friend.handle}</span>
            <span className={`fc-level ovr-chip ovr-tier-${prestige.key}`} title={`${prestige.label} tier`}>OVR {ovr}</span>
          </div>
        </div>
        {hasMenu && (
          <div className="fc-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="fc-menu-trigger"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="More actions"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              title="More"
            >⋯</button>
            {menuOpen && (
              <div className="fc-menu" role="menu">
                {onReport && (
                  <button
                    type="button"
                    role="menuitem"
                    className="fc-menu-item"
                    onClick={() => handleMenu(onReport)}
                  >
                    Report
                  </button>
                )}
                {onBlock && (
                  <button
                    type="button"
                    role="menuitem"
                    className="fc-menu-item fc-menu-item-warn"
                    onClick={() => handleMenu(onBlock)}
                  >
                    Block
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Primary action — message this friend. Sits right under the
          header so it reads as the main thing you'd do on a friend. */}
      {onMessage && (
        <div className="fc-actions">
          <button type="button" className="fc-message-btn" onClick={() => onMessage(friend)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
            Message
            {unread > 0 && <span className="fc-message-badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
        </div>
      )}

      <div className="fc-divider" />

      {/* Streak strip */}
      {hasStreak ? (
        <div className="fc-streak-row">
          <span className="fc-streak-num">{friend.streak}</span>
          <div className="fc-streak-body">
            <span className="fc-streak-label">Day streak</span>
            <span className="fc-streak-habit">{friend.streakHabit}</span>
          </div>
        </div>
      ) : (
        <div className="fc-streak-quiet">
          {loading
            ? 'Loading activity…'
            : friend.lastSeenDays != null
              ? `Last active ${friend.lastSeenDays} days ago`
              : 'No active streak'}
        </div>
      )}

      <div className="fc-divider" />

      {/* Activity heatmap. When the friend hasn't published stats yet
          (e.g. just signed up, or is on an older client) we show a
          calm placeholder rather than an empty grid. */}
      {hasHeatmap ? (
        <FriendsHeatmap days={friend.heatmap} />
      ) : (
        <div className="fc-heatmap-wrap">
          <div className="fc-heatmap-title">
            <span>Activity · 3 months</span>
          </div>
          <div className="fc-heatmap-empty">
            {loading ? 'Loading…' : statsMissing ? 'No activity to share yet.' : ''}
          </div>
        </div>
      )}

      <div className="fc-divider" />

      {/* Recent wins */}
      <div className="fc-wins-wrap">
        <div className="fc-wins-label">Recent wins</div>
        {(friend.wins && friend.wins.length > 0) ? (
          <div className="fc-wins-chips">
            {friend.wins.map((w, i) => (
              <div key={i} className="fc-win-chip">
                <span className="fc-win-chip-icon">{w.icon}</span>
                {w.name}
              </div>
            ))}
          </div>
        ) : (
          <div className="fc-empty-wins">{loading ? 'Loading…' : 'None yet'}</div>
        )}
      </div>

      {/* Footer — visible Unfriend action. Subdued styling because the
          card's primary purpose is celebration, not friend management,
          but the option must exist somewhere obvious. */}
      {onUnfriend && (
        <>
          <div className="fc-divider" />
          <div className="fc-footer">
            <button
              type="button"
              className="fc-footer-btn"
              onClick={() => onUnfriend(friend)}
            >
              Remove from friends
            </button>
          </div>
        </>
      )}
    </div>
  );
}
