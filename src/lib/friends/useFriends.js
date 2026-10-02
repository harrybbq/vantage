import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listAcceptedFriends,
  listPendingRequests,
  getOwnProfile,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  blockUser,
  reportUser,
  searchByHandle,
  derivePresence,
  FREE_FRIEND_CAP,
  ONLINE_THRESHOLD_MS,
} from './queries';

/**
 * One hook to drive the entire Friends rail: keeps the user's own
 * profile, accepted friends, pending incoming requests, and the
 * search results in sync. Mutations all refresh the affected slice
 * before returning so the UI doesn't flicker.
 *
 * Why a single hook (rather than one per slice)?
 *   The rail renders all four slices on the same surface and
 *   mutations cross slices (accepting a request moves it from
 *   `pending` to `friends`). One hook means one source of truth and
 *   coherent loading states.
 */
export function useFriends(userId, hasPro) {
  const [ownProfile, setOwnProfile] = useState(null);
  const [friends, setFriends] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── load all slices ───────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const [profile, list, pend] = await Promise.all([
        getOwnProfile(userId),
        listAcceptedFriends(userId).catch(() => []),
        listPendingRequests(userId).catch(() => []),
      ]);
      setOwnProfile(profile);
      setFriends(list);
      setPending(pend);
    } catch (e) {
      // The most common failure mode here is "tables don't exist
      // yet" — the migration hasn't been applied. We surface that as
      // a friendly state rather than crashing the rail.
      setError(e.message || 'Could not load friends.');
      setFriends([]);
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    refresh();
  }, [userId, refresh]);

  // ── mutators ─────────────────────────────────────────────────
  const send = useCallback(async (toUserId) => {
    await sendFriendRequest(userId, toUserId);
    // Sender doesn't see their request in `pending` (which is
    // incoming-only) — but the search result UI will hide them on
    // its own once the request exists.
  }, [userId]);

  const accept = useCallback(async (requesterId) => {
    await acceptFriendRequest(userId, requesterId);
    await refresh();
  }, [userId, refresh]);

  const decline = useCallback(async (otherUserId) => {
    await removeFriendship(userId, otherUserId);
    await refresh();
  }, [userId, refresh]);

  const unfriend = useCallback(async (otherUserId) => {
    await removeFriendship(userId, otherUserId);
    await refresh();
  }, [userId, refresh]);

  const block = useCallback(async (otherUserId) => {
    await blockUser(userId, otherUserId);
    await refresh();
  }, [userId, refresh]);

  const report = useCallback(async (otherUserId, reason, context, snapshot) => {
    await reportUser(userId, otherUserId, reason, context, snapshot);
  }, [userId]);

  const search = useCallback((q) => searchByHandle(q), []);

  // ── presence ticker ──────────────────────────────────────────
  // Re-render the friend list every minute so the online/offline
  // boundary actually flips when a friend's last_active_at ages out
  // of the threshold. Without this, a friend who went silent at
  // load time would *display* online forever until something else
  // triggered a re-render. Cheap (no network), only ticks while the
  // hook is mounted (i.e. while the rail is rendered).
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPresenceTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Friends enriched with derived `online` + `lastSeenDays` so callers
  // (the rail, the card) don't have to re-implement the presence
  // heuristic. presenceTick is in the dep array purely to force
  // recomputation on the minute boundary.
  const friendsWithPresence = useMemo(() => {
    return friends.map(f => ({
      ...f,
      ...derivePresence(f.last_active_at),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends, presenceTick]);

  // ── derived ──────────────────────────────────────────────────
  // Free users: 5 friends. Pro/Lifetime: unlimited (we still cap
  // the displayed badge at "∞" via the component).
  const friendCap = hasPro ? Infinity : FREE_FRIEND_CAP;
  const atCap = friends.length >= friendCap;

  const onlineCount = friendsWithPresence.filter(f => f.online).length;
  const offlineCount = friendsWithPresence.length - onlineCount;

  return {
    ownProfile,
    friends: friendsWithPresence,
    pending,
    loading,
    error,
    atCap,
    friendCap,
    onlineCount,
    offlineCount,
    refresh,
    send,
    accept,
    decline,
    unfriend,
    block,
    report,
    search,
    setOwnProfile, // exposed so HandleClaimModal can update without a round-trip
    ONLINE_THRESHOLD_MS,
  };
}
