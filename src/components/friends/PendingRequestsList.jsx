/**
 * Inline list of incoming pending friend requests, rendered above
 * the friends list when there's anything to show. Hidden entirely
 * when empty so the rail isn't littered with empty headers.
 *
 * Props:
 *   pending     — array of profile rows from useFriends
 *   onAccept    — async (requesterId) => void
 *   onDecline   — async (requesterId) => void
 *   busyId      — currently-acting request id (disables both buttons)
 */
const COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];

function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}

import Icon from '../Icon';

function initials(name) {
  return (name || '').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
}

export default function PendingRequestsList({ pending, onAccept, onDecline, busyId }) {
  if (!pending || pending.length === 0) return null;

  return (
    <div className="fc-panel fc-panel--pending">
      <div className="fc-panel-head">
        <span className="fc-panel-label">Requests</span>
        <span className="fc-panel-meta">{pending.length}</span>
      </div>
      <div className="fc-panel-body">
        {pending.map(p => {
          const name = p.display_name || `@${p.handle}`;
          const seed = p.handle || p.id;
          const busy = busyId === p.id;
          return (
            <div key={p.id} className="fc-request-row">
              <div className="fc-row-avatar" style={{ background: avatarColor(seed) }}>
                {initials(name)}
              </div>
              <div className="fc-row-info">
                <div className="fc-row-name">{name}</div>
                <div className="fc-row-status">@{p.handle}</div>
              </div>
              <div className="fc-request-actions">
                <button
                  type="button"
                  className="fc-request-btn fc-request-btn-accept"
                  onClick={() => onAccept(p.id)}
                  disabled={busy}
                  aria-label={`Accept request from @${p.handle}`}
                  title="Accept"
                ><Icon name="check" size={14} /></button>
                <button
                  type="button"
                  className="fc-request-btn fc-request-btn-decline"
                  onClick={() => onDecline(p.id)}
                  disabled={busy}
                  aria-label={`Decline request from @${p.handle}`}
                  title="Decline"
                ><Icon name="x" size={14} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
