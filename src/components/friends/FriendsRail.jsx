import { useEffect, useMemo, useState } from 'react';
import FriendsPanelList from './FriendsPanelList';
import FriendCard from './FriendCard';
import PendingRequestsList from './PendingRequestsList';
import HandleClaimModal from './HandleClaimModal';
import AddFriendModal from './AddFriendModal';
import ReportFriendModal from './ReportFriendModal';
import { useFriends } from '../../lib/friends/useFriends';
import { getFriendPublicStats } from '../../lib/friends/queries';
import { useSubscriptionContext } from '../../context/SubscriptionContext';

/**
 * Friends rail — orchestrates everything social on the cream hub:
 *   - Loads the user's profile, friends, and pending requests.
 *   - Gates the rail behind the handle-claim modal (lazy claim).
 *   - Owns the "selected friend" state and fetches their
 *     public_stats on demand.
 *   - Wires the Add modal and pending request mutations.
 *
 * The rail is intentionally graceful when the migrations haven't
 * been applied yet — useFriends absorbs the load error and the rail
 * shows an offline message instead of crashing.
 */
export default function FriendsRail({ userId, onUpgrade }) {
  const { hasPro } = useSubscriptionContext();
  const friends = useFriends(userId, hasPro);

  const [selectedId, setSelectedId] = useState(null);
  const [selectedStats, setSelectedStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [showHandleModal, setShowHandleModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState(null);
  // Report flow holds the friend being reported in state so the modal
  // doesn't have to re-look-up by id when opened.
  const [reportTarget, setReportTarget] = useState(null);

  // ── derived sets (used by AddFriendModal to suppress duplicates) ──
  const friendIds = useMemo(() => new Set(friends.friends.map(f => f.id)), [friends.friends]);
  const pendingIds = useMemo(() => new Set(friends.pending.map(p => p.id)), [friends.pending]);

  // ── fetch the selected friend's public_stats on demand ──
  // We do NOT preload all friends' stats — that's an N+1 over the
  // friend list. Loading per-click matches the use case (you look at
  // one friend at a time) and keeps the initial render snappy.
  useEffect(() => {
    if (!selectedId) { setSelectedStats(null); return; }
    let cancelled = false;
    setStatsLoading(true);
    getFriendPublicStats(selectedId)
      .then(stats => { if (!cancelled) setSelectedStats(stats || null); })
      .catch(()    => { if (!cancelled) setSelectedStats(null); })
      .finally(()  => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  function handleSelect(id) {
    setSelectedId(prev => (prev === id ? null : id));
  }

  // The selected friend assembled from the list row + their public_stats.
  // FriendCard expects a single `friend` prop, so we merge here rather
  // than threading two props down.
  const selectedFriend = useMemo(() => {
    if (!selectedId) return null;
    const base = friends.friends.find(f => f.id === selectedId);
    if (!base) return null;
    return {
      id: base.id,
      name: base.display_name || `@${base.handle}`,
      handle: base.handle,
      ovr: base.ratings_ovr || 1,
      online: !!base.online,
      avatar_url: base.avatar_url || null,
      streak: selectedStats?.current_streak || 0,
      streakHabit: selectedStats?.streak_habit || null,
      heatmap: selectedStats?.heatmap_days || [],
      wins: selectedStats?.recent_wins || [],
      // Plumbed through from profiles.last_active_at via useFriends
      // → derivePresence. Drives the "Last active Xd ago" copy in
      // FriendCard's quiet-state strip.
      lastSeenDays: base.lastSeenDays,
    };
  }, [selectedId, friends.friends, selectedStats]);

  // ── friend list row shape (FriendListRow expects the mock shape) ──
  // Sort online-first, then by OVR desc as a tie-breaker so the
  // highest-rated friend tops the list when several are online.
  const rows = useMemo(() => {
    const mapped = friends.friends.map(f => ({
      id: f.id,
      name: f.display_name || `@${f.handle}`,
      handle: f.handle,
      ovr: f.ratings_ovr || 1,
      online: !!f.online,
      streak: 0,           // not in list view; row shows handle / last-seen instead
      streakHabit: null,
      lastSeenDays: f.lastSeenDays,
    }));
    return mapped.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (b.ovr || 0) - (a.ovr || 0);
    });
  }, [friends.friends]);

  // ── handle claim gating ──
  // If the user has no handle yet, the rail itself is locked behind a
  // friendly empty state with a "Claim handle" CTA.
  const needsHandle = friends.ownProfile && !friends.ownProfile.handle;

  if (friends.loading) {
    return <div className="fc-panel"><div className="fc-panel-empty">Loading friends…</div></div>;
  }

  if (friends.error && !friends.ownProfile) {
    // Most common cause: migrations not yet applied locally. Fail
    // open with a hint so the rest of the hub still works.
    return (
      <div className="fc-panel">
        <div className="fc-panel-empty">
          Friends features aren't ready on this server yet.
        </div>
      </div>
    );
  }

  if (needsHandle) {
    return (
      <>
        <div className="fc-panel">
          <div className="fc-panel-head">
            <span className="fc-panel-label">Friends</span>
          </div>
          <div className="fc-panel-empty">
            Pick a handle so friends can find you.
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowHandleModal(true)}
              >
                Claim handle
              </button>
            </div>
          </div>
        </div>
        <HandleClaimModal
          open={showHandleModal}
          userId={userId}
          suggested={(friends.ownProfile?.display_name || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)}
          onClaim={async (updated) => {
            friends.setOwnProfile(updated);
            await friends.refresh();
          }}
          onClose={() => setShowHandleModal(false)}
        />
      </>
    );
  }

  return (
    <>
      <PendingRequestsList
        pending={friends.pending}
        busyId={busyRequestId}
        onAccept={async id => {
          setBusyRequestId(id);
          try { await friends.accept(id); }
          catch { /* useFriends.refresh would catch + reset state */ }
          finally { setBusyRequestId(null); }
        }}
        onDecline={async id => {
          setBusyRequestId(id);
          try { await friends.decline(id); }
          catch { /* same */ }
          finally { setBusyRequestId(null); }
        }}
      />

      <FriendsPanelList
        friends={rows}
        selectedId={selectedId}
        onSelect={handleSelect}
        onlineCount={friends.onlineCount}
        offlineCount={friends.offlineCount}
      />

      {/* Add-friend CTA — lives below the list so it doesn't compete
          with the list when there are friends to look at. */}
      <button
        type="button"
        className="btn btn-ghost fc-add-btn"
        onClick={() => setShowAddModal(true)}
      >
        + Add a friend
      </button>

      {selectedFriend && (
        <FriendCard
          friend={selectedFriend}
          loading={statsLoading}
          statsMissing={!selectedStats && !statsLoading}
          onReport={(f) => setReportTarget(f)}
          onBlock={async (f) => {
            // Block is destructive — confirm via native dialog. The
            // queries module also drops the friendship row in the same
            // call, so the user is immediately removed from the list.
            const ok = window.confirm(
              `Block ${f.name}? They'll be removed from your friends and won't be able to find you again.`
            );
            if (!ok) return;
            try {
              await friends.block(f.id);
              setSelectedId(null); // close the card since this friend is gone
            } catch (e) {
              window.alert(e.message || 'Could not block.');
            }
          }}
          onUnfriend={async (f) => {
            const ok = window.confirm(`Remove ${f.name} from your friends?`);
            if (!ok) return;
            try {
              await friends.unfriend(f.id);
              setSelectedId(null);
            } catch (e) {
              window.alert(e.message || 'Could not unfriend.');
            }
          }}
        />
      )}

      <AddFriendModal
        open={showAddModal}
        atCap={friends.atCap}
        pendingIds={pendingIds}
        friendIds={friendIds}
        onSearch={friends.search}
        onSend={async (toUserId) => { await friends.send(toUserId); }}
        onClose={() => setShowAddModal(false)}
        onUpgrade={onUpgrade}
      />

      <ReportFriendModal
        open={!!reportTarget}
        friend={reportTarget}
        onSubmit={async (reason, context) => {
          if (!reportTarget) return;
          await friends.report(reportTarget.id, reason, context);
        }}
        onClose={() => setReportTarget(null)}
      />
    </>
  );
}
