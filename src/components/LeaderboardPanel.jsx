/**
 * LeaderboardPanel — Friends/Global × All-time/Weekly-climb board.
 *
 * Visual language mirrors RatingsPanel (Ledger): mono eyebrow, OVR glow,
 * dense rows. Data is server-canonical via useLeaderboard (reads
 * profiles + rating_snapshots; never the caller's local S).
 *
 * Tap a non-self row → FriendRatingsModal (4 numbers + tier badges,
 * no source-of-points). Tap self → opens own RatingsPanel via the
 * onOpenSelfBreakdown callback the parent passes.
 */
import { useState } from 'react';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { ovrTier } from '../lib/ratings/tiers';
import FriendRatingsModal from './FriendRatingsModal';

const COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}
function initials(name) {
  return (name || '?').replace(/^@/, '').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}
function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

// Pure rank decoration — independent of OVR prestige tier system.
function medalColor(rank) {
  if (rank === 1) return '#d4af37';
  if (rank === 2) return '#a8a8a8';
  if (rank === 3) return '#b8732e';
  return 'var(--text-muted)';
}

export default function LeaderboardPanel({
  onOpenSelfBreakdown,
  onAddFriends,
  onOpenSettings,
}) {
  const [scope, setScope] = useState('friends');           // 'friends' | 'global'
  const [timeframe, setTimeframe] = useState('alltime');   // 'alltime' | 'weekly'
  const [selectedRow, setSelectedRow] = useState(null);
  const { data, loading, error, refresh } = useLeaderboard({ scope, timeframe });

  const stale = data?.computedAt && (Date.now() - new Date(data.computedAt).getTime()) > 24 * 60 * 60 * 1000;
  const optedOut = scope === 'global' && data && data.callerRank == null && (data.rows || []).every(r => !r.isSelf);
  const noFriends = scope === 'friends' && data && (data.rows || []).length <= 1;
  const noClimb = timeframe === 'weekly' && data && (data.rows || []).every(r => r.climb == null);

  function onRowClick(row) {
    if (row.isSelf && onOpenSelfBreakdown) onOpenSelfBreakdown();
    else setSelectedRow(row);
  }

  return (
    <>
      <div className="lb-panel">
        <div className="lb-head">
          <div className="lb-eyebrow">LEADERBOARD</div>
          <div className="lb-meta">
            {data?.computedAt && <span>UPDATED {timeAgo(data.computedAt)}</span>}
            {(stale || error) && (
              <button type="button" className="lb-refresh" onClick={refresh}>↻ Refresh</button>
            )}
          </div>
        </div>

        {/* Scope tabs */}
        <div className="lb-tabs" role="tablist">
          {['friends', 'global'].map(s => (
            <button key={s} role="tab" aria-selected={scope === s}
              className={`lb-tab${scope === s ? ' is-active' : ''}`}
              onClick={() => setScope(s)}
            >{s === 'friends' ? 'Friends' : 'Global'}</button>
          ))}
        </div>

        {/* Timeframe sub-tabs */}
        <div className="lb-subtabs" role="tablist">
          {[['alltime', 'All-time'], ['weekly', 'Weekly climb']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={timeframe === k}
              className={`lb-subtab${timeframe === k ? ' is-active' : ''}`}
              onClick={() => setTimeframe(k)}
            >{label}</button>
          ))}
        </div>

        {/* Banners / states */}
        {optedOut && (
          <div className="lb-banner">
            <div>
              <strong>You're not on the global board.</strong>
              <span style={{ display: 'block', marginTop: 2, color: 'var(--text-muted)', fontSize: 11 }}>
                Enable in Settings → Privacy.
              </span>
            </div>
            {onOpenSettings && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onOpenSettings}>Open Settings</button>
            )}
          </div>
        )}

        {loading && !data && <div className="lb-empty">Loading…</div>}
        {error && <div className="lb-empty" style={{ color: 'rgb(220,60,60)' }}>{error}</div>}

        {data && noFriends && (
          <div className="lb-empty">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Just you here.</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              Add friends to see how you compare.
            </div>
            {onAddFriends && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onAddFriends}>Add friends</button>
            )}
          </div>
        )}

        {data && !noFriends && noClimb && (
          <div className="lb-empty">
            Weekly climb data starts appearing after a week of activity.
          </div>
        )}

        {data && (data.rows || []).length > 0 && (
          <ul className="lb-rows">
            {data.rows.map(row => {
              const prestige = ovrTier(row.ovr || 1);
              const primary = timeframe === 'weekly' ? row.climb : row.ovr;
              const secondary = timeframe === 'weekly'
                ? `OVR ${row.ovr}`
                : (row.climb == null ? '—' : `${row.climb >= 0 ? '+' : ''}${row.climb} 7d`);
              const isMedal = row.rank <= 3;
              return (
                <li key={row.userId}>
                  <button
                    type="button"
                    className={`lb-row${row.isSelf ? ' is-self' : ''}`}
                    onClick={() => onRowClick(row)}
                  >
                    <span className={`lb-rank${isMedal ? ' is-medal' : ''}`} style={{ color: medalColor(row.rank) }}>
                      {row.rank}
                    </span>
                    {row.avatarUrl
                      ? <img src={row.avatarUrl} alt="" className="lb-avatar lb-avatar-img" />
                      : <span className="lb-avatar" style={{ background: avatarColor(row.username) }}>
                          {initials(row.username)}
                        </span>
                    }
                    <span className="lb-name">{row.username}</span>
                    <span className="lb-secondary">{secondary}</span>
                    <span className={`lb-primary ovr-num ovr-tier-${prestige.key}`}>
                      {timeframe === 'weekly' && primary != null && primary >= 0 ? '+' : ''}{primary == null ? '—' : primary}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {data && data.callerRank != null && (
          <div className="lb-footer">
            You're #{data.callerRank} on this board.
          </div>
        )}
      </div>

      {selectedRow && <FriendRatingsModal row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </>
  );
}
