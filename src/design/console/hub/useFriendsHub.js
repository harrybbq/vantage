/**
 * Everything social the console hub shows, from the SAME data layer the
 * classic FriendsRail uses — nothing here queries Supabase itself:
 *
 *   useFriends          friends, presence, pending requests, accept /
 *                       decline / block / unfriend / report / search
 *   useLeaderboard      the friends board (one cached fetch) — the League
 *                       widget's rows, and the friends' category ratings
 *                       and prestige, which the public profile columns do
 *                       not carry (lib/friends/profileColumns.js)
 *   listConversations + subscribeDMs + bumpConversation / clearUnread
 *                       the inbox and live unread counts, as FriendsRail
 *   getFriendPublicStats  the opened friend's streak, heatmap, wins
 *
 * One instance per hub (ConsoleHub), handed to the League and Friends
 * widgets and the player strip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFriends } from '../../../lib/friends/useFriends';
import { useLeaderboard } from '../../../hooks/useLeaderboard';
import { getFriendPublicStats, reportSnapshot } from '../../../lib/friends/queries';
import { listConversations } from '../../../lib/friends/messages';
import { subscribeDMs, getRealtimeState, onRealtimeState } from '../../../lib/friends/realtime';
import { bumpConversation, clearUnread, previewText } from '../../../lib/friends/dmView';
import { useMutes } from '../../../lib/friends/useMutes';
import { silenceFriends } from '../../../lib/friends/mutes';
import { announceBlocked } from '../../../components/friends/StayingSafe';

const POLL_MS = 60_000;

export function useFriendsHub({ userId, hasPro }) {
  const friends = useFriends(userId, hasPro);
  const mutes = useMutes();
  const { data: board, loading: boardLoading, error: boardError } = useLeaderboard({ scope: 'friends', timeframe: 'alltime' });

  // ── Inbox ──
  const [rtState, setRtState] = useState(getRealtimeState);
  useEffect(() => onRealtimeState(setRtState), []);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const openRef = useRef(null);
  openRef.current = selectedId;

  const pull = useCallback(async () => {
    if (!userId) return;
    try {
      const list = await listConversations(userId);
      if (Array.isArray(list)) setConversations(openRef.current ? clearUnread(list, openRef.current) : list);
    } catch { /* keep what we have */ }
  }, [userId]);
  useEffect(() => { pull(); }, [pull]);
  useEffect(() => { if (rtState === 'live') pull(); }, [rtState, pull]);
  useEffect(() => {
    if (rtState !== 'fallback') return undefined;
    const id = setInterval(() => { if (document.visibilityState !== 'hidden') pull(); }, POLL_MS);
    return () => clearInterval(id);
  }, [rtState, pull]);
  useEffect(() => subscribeDMs(userId, {
    onMessage: m => setConversations(c => bumpConversation(c, m, userId, openRef.current)),
    onDelete: () => pull(),
  }), [userId, pull]);
  useEffect(() => { if (selectedId) setConversations(c => clearUnread(c, selectedId)); }, [selectedId]);

  // ── Rows: friends joined with the board and the inbox ──
  const byBoard = useMemo(() => {
    const m = {};
    for (const r of (board && board.rows) || []) if (r && r.userId) m[r.userId] = r;
    return m;
  }, [board]);
  const conv = useMemo(() => {
    const m = {};
    for (const c of conversations) if (c && c.friendId) m[c.friendId] = c;
    return m;
  }, [conversations]);

  const rows = useMemo(() => {
    const mapped = friends.friends.map(f => {
      const b = byBoard[f.id];
      const c = conv[f.id];
      // A muted friend's messages still arrive, but raise no pill and no
      // preview (item 113, mute) — the conversation is there when opened.
      const muted = mutes.isMuted(f.id);
      const unread = c && !c.blockedByMe && !muted ? (c.unread || 0) : 0;
      return {
        id: f.id,
        name: f.display_name || `@${f.handle}`,
        handle: f.handle,
        avatar_url: f.avatar_url || null,
        ovr: b ? b.ovr : (f.ratings_ovr || null),
        cats: b ? b.categories : null,
        prestige: b ? b.prestige || 0 : 0,
        climb: b ? b.climb : null,
        rank: b ? b.rank : null,
        online: !!f.online,
        lastSeenDays: f.lastSeenDays,
        unread,
        lastText: unread && c && c.last ? previewText(c.last, userId, 60) : null,
      };
    });
    // Muted friends sit below everyone else; silenceFriends flags them
    // `silenced` for the card's folded activity and the ⋯ Unmute.
    return silenceFriends(mapped.sort((a, b) => {
      if (!!b.unread !== !!a.unread) return b.unread ? 1 : -1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (b.ovr || 0) - (a.ovr || 0);
    }), mutes.map);
  }, [friends.friends, byBoard, conv, userId, mutes]);

  const unreadTotal = useMemo(() => rows.reduce((n, r) => n + (r.unread || 0), 0), [rows]);
  // The header chip listens for this, as it does for the classic rail.
  useEffect(() => {
    if (friends.loading) return;
    try { window.dispatchEvent(new CustomEvent('vantage:dm-unread', { detail: unreadTotal })); } catch { /* old browsers */ }
  }, [unreadTotal, friends.loading]);

  // ── The opened friend ──
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  useEffect(() => {
    if (!selectedId) { setStats(null); return undefined; }
    let cancelled = false;
    setStatsLoading(true);
    getFriendPublicStats(selectedId)
      .then(s => { if (!cancelled) setStats(s || null); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    const r = rows.find(x => x.id === selectedId);
    if (!r) return null;
    return {
      ...r,
      // FriendCard / MessagesModal shape
      streak: stats?.current_streak || 0,
      streakHabit: stats?.streak_habit || null,
      heatmap: stats?.heatmap_days || [],
      wins: stats?.recent_wins || [],
    };
  }, [selectedId, rows, stats]);

  // ── Overlays ──
  const [addOpen, setAddOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [thread, setThread] = useState(null); // friend whose conversation is open as an overlay
  const [busyId, setBusyId] = useState(null);
  const [handleOpen, setHandleOpen] = useState(false);

  const friendIds = useMemo(() => new Set(friends.friends.map(f => f.id)), [friends.friends]);
  const pendingIds = useMemo(() => new Set(friends.pending.map(p => p.id)), [friends.pending]);

  const act = useCallback(async (id, fn) => {
    setBusyId(id);
    try { await fn(); } catch { /* useFriends resets on refresh */ } finally { setBusyId(null); }
  }, []);

  const block = useCallback(async f => {
    if (!window.confirm(`Block ${f.name}? They'll be removed from your friends and won't be able to find you again.`)) return;
    try { await friends.block(f.id); setSelectedId(null); setThread(null); announceBlocked(f); }
    catch (e) { window.alert(e.message || 'Could not block.'); }
  }, [friends]);
  const unfriend = useCallback(async f => {
    if (!window.confirm(`Remove ${f.name} from your friends?`)) return;
    try { await friends.unfriend(f.id); setSelectedId(null); }
    catch (e) { window.alert(e.message || 'Could not unfriend.'); }
  }, [friends]);
  const submitReport = useCallback(async (reason, context) => {
    if (!reportTarget) return;
    await friends.report(reportTarget.id, reason, context,
      reportSnapshot({ handle: reportTarget.handle, name: reportTarget.name, where: 'friend-card' }));
  }, [friends, reportTarget]);

  const onThreadActivity = useCallback(msg => setConversations(c => bumpConversation(c, msg, userId, openRef.current)), [userId]);
  const onThreadRead = useCallback(fid => setConversations(c => clearUnread(c, fid)), []);
  const onBlocked = useCallback(() => {
    setSelectedId(null); setThread(null);
    friends.refresh().catch(() => {});
    pull();
  }, [friends, pull]);

  return {
    userId, friends, board, boardLoading, boardError,
    rows, unreadTotal, pending: friends.pending, busyId,
    loading: friends.loading, error: friends.error && !friends.ownProfile ? friends.error : null,
    needsHandle: !!(friends.ownProfile && !friends.ownProfile.handle),
    onlineCount: friends.onlineCount,
    isFriend: id => friendIds.has(id),
    friendIds, pendingIds,
    selected, selectedId, statsLoading, statsMissing: !stats && !statsLoading,
    openFriend: id => setSelectedId(id),
    closeFriend: () => setSelectedId(null),
    accept: id => act(id, () => friends.accept(id)),
    decline: id => act(id, () => friends.decline(id)),
    block, unfriend,
    handleOpen, openHandle: () => setHandleOpen(true), closeHandle: () => setHandleOpen(false),
    addOpen, openAdd: () => setAddOpen(true), closeAdd: () => setAddOpen(false),
    reportTarget, openReport: f => setReportTarget(f), closeReport: () => setReportTarget(null), submitReport,
    thread, openThread: f => setThread(f), closeThread: () => setThread(null),
    // Mute (item 113): private to this account, nobody is told.
    canMute: mutes.ready,
    mute: f => mutes.mute({ id: f.id, name: f.name, handle: f.handle }),
    unmute: f => mutes.unmute(f.id),
    onThreadActivity, onThreadRead, onBlocked,
  };
}
