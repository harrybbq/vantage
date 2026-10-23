import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import FriendsPanelList from './FriendsPanelList';
import FriendCard from './FriendCard';
import PendingRequestsList from './PendingRequestsList';
import HandleClaimModal from './HandleClaimModal';
import AddFriendModal from './AddFriendModal';
import ReportFriendModal from './ReportFriendModal';
import MessagesModal from './MessagesModal';
import FriendPanel from './FriendPanel';
import SafetyNotices from './SafetyNotices';
import FriendsPrestigeSource from './FriendsPrestigeSource';
import { useFriends } from '../../lib/friends/useFriends';
import { getFriendPublicStats, reportSnapshot } from '../../lib/friends/queries';
import { listConversations } from '../../lib/friends/messages';
import { useSubscriptionContext } from '../../context/SubscriptionContext';
import { subscribeDMs, getRealtimeState, onRealtimeState } from '../../lib/friends/realtime';
import { loadPartnerFacts } from '../../lib/friends/inboxPeople';
import { buildInbox, bumpConversation, clearUnread } from '../../lib/friends/dmView';
import { useMutes } from '../../lib/friends/useMutes';
import { silenceInbox, silenceFriends, audibleUnread } from '../../lib/friends/mutes';
import { announceBlocked } from './StayingSafe';
import ConversationList, { FriendsTabs } from './ConversationList';
import Overlay from '../ui/Overlay';
import './friends-dm.css';

/** Remembered per viewer: which tab the rail opens on. */
const TAB_KEY = 'vantage.friends.tab';
function readTab() {
  try { return localStorage.getItem(TAB_KEY) === 'messages' ? 'messages' : 'friends'; } catch { return 'friends'; }
}

/** Inbox refresh while Realtime is unavailable: quicker while the inbox
 *  or a conversation is on screen, slower while it is not. */
const INBOX_POLL_ACTIVE_MS = 30_000;
const INBOX_POLL_IDLE_MS = 60_000;

/** Why a conversation opens read-only. */
function readOnlyNoteFor(row) {
  if (!row || row.canSend) return null;
  if (row.note === 'Blocked') return 'You blocked this person. Their messages stay here for your records.';
  if (row.note === 'Account suspended') return 'This account is suspended, so messages are paused.';
  return 'You\'re not friends any more, so you can\'t send new messages.';
}

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
 *
 * `panelSlot` is an element the host offers for the selected friend —
 * on the OS hub, a layer over the widget canvas. Given one, the rail
 * portals a FriendPanel into it (conversation + profile, side by side)
 * instead of appending the card below itself. The rail keeps owning
 * selection and the public_stats fetch either way; the host only lends
 * a place to put it, which is why this is a DOM node rather than a
 * dozen props threaded through the layout.
 */
export default function FriendsRail({ userId, onUpgrade, panelSlot = null, layout = 'rail' }) {
  const { hasPro } = useSubscriptionContext();
  const friends = useFriends(userId, hasPro);
  // Mute (item 113): who this account has muted, from its own state.
  const mutes = useMutes();

  const [selectedId, setSelectedId] = useState(null);
  // Friends' prestige (avatar rings, badges), from the friends board.
  const [prestigeById, setPrestigeById] = useState({});
  const [selectedStats, setSelectedStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [showHandleModal, setShowHandleModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState(null);
  // Report flow holds the friend being reported in state so the modal
  // doesn't have to re-look-up by id when opened.
  const [reportTarget, setReportTarget] = useState(null);
  // A conversation opened outside the hub's friend panel — the overlay on
  // a desktop rail, the full-screen conversation on a phone. Also how a
  // read-only conversation (a former friend) opens everywhere.
  const [threadTarget, setThreadTarget] = useState(null); // { friend, readOnlyNote }
  const [tab, setTabState] = useState(readTab);
  const setTab = useCallback(t => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ }
  }, []);

  // ── Inbox ──
  // The realtime layer keeps ONE ref-counted channel per user; the rail
  // and an open conversation both subscribe and share it.
  const [rtState, setRtState] = useState(getRealtimeState);
  useEffect(() => onRealtimeState(setRtState), []);
  const [conversations, setConversations] = useState([]);
  const [convLoading, setConvLoading] = useState(true);
  const [facts, setFacts] = useState({ people: {}, blocked: new Set() });
  const openId = panelSlot ? selectedId : (threadTarget?.friend?.id || null);
  const openIdRef = useRef(openId);
  openIdRef.current = openId;

  const pullConversations = useCallback(async () => {
    if (!userId) return;
    try {
      const list = await listConversations(userId);
      if (Array.isArray(list)) {
        const open = openIdRef.current;
        setConversations(open ? clearUnread(list, open) : list);
      }
    } catch { /* keep what we have */ }
    setConvLoading(false);
  }, [userId]);

  useEffect(() => { pullConversations(); }, [pullConversations]);

  // Re-sync when the channel comes up (catch-up) and when the tab is
  // shown again (a phone that slept may have missed events).
  useEffect(() => { if (rtState === 'live') pullConversations(); }, [rtState, pullConversations]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') pullConversations(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [pullConversations]);

  // Without Realtime: a slow inbox poll (one RPC), never per-friend.
  const inboxActive = tab === 'messages' || !!openId;
  useEffect(() => {
    if (rtState !== 'fallback') return undefined;
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') pullConversations();
    }, inboxActive ? INBOX_POLL_ACTIVE_MS : INBOX_POLL_IDLE_MS);
    return () => clearInterval(id);
  }, [rtState, inboxActive, pullConversations]);

  // Live: fold each message into the inbox locally — no refetch. A
  // DELETE reaches every subscriber with only { id }, so the inbox is
  // re-read only when the unsent message was the preview on one of MY
  // rows; anyone else's unsend costs nothing.
  const deleteTimer = useRef(null);
  const convRef = useRef(conversations);
  convRef.current = conversations;
  useEffect(() => subscribeDMs(userId, {
    onMessage: m => setConversations(c => bumpConversation(c, m, userId, openIdRef.current)),
    onDelete: ({ id } = {}) => {
      if (id == null || !convRef.current.some(c => c.last && String(c.last.id) === String(id))) return;
      clearTimeout(deleteTimer.current);
      deleteTimer.current = setTimeout(pullConversations, 800);
    },
  }), [userId, pullConversations]);
  useEffect(() => () => clearTimeout(deleteTimer.current), []);

  // Opening a conversation reads it.
  useEffect(() => { if (openId) setConversations(c => clearUnread(c, openId)); }, [openId]);

  const onThreadActivity = useCallback(msg => {
    setConversations(c => bumpConversation(c, msg, userId, openIdRef.current));
  }, [userId]);
  const onThreadRead = useCallback(fid => setConversations(c => clearUnread(c, fid)), []);

  // Partner facts (blocked / suspended / former friends' names).
  const partnerKey = conversations.map(c => c.friendId).sort().join(',');
  useEffect(() => {
    if (!userId || !partnerKey) return undefined;
    let cancelled = false;
    loadPartnerFacts(userId, partnerKey.split(','))
      .then(f => { if (!cancelled) setFacts(f); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, partnerKey]);

  // Per-friend unread, for the list rows' message buttons. A muted
  // friend's messages raise no count (they are still there to read).
  const unread = useMemo(() => {
    const m = {};
    for (const c of conversations) if (c.unread > 0 && !mutes.isMuted(c.friendId)) m[c.friendId] = c.unread;
    return m;
  }, [conversations, mutes]);


  // The chip asks the rail to show the inbox.
  useEffect(() => {
    const onTab = e => { if (e.detail === 'messages' || e.detail === 'friends') setTab(e.detail); };
    window.addEventListener('vantage:friends-tab', onTab);
    return () => window.removeEventListener('vantage:friends-tab', onTab);
  }, [setTab]);

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

  // "Message this friend" — on the hub the friend panel already holds the
  // conversation, so it opens that; elsewhere it opens the conversation
  // on its own.
  function openThreadFor(f) {
    if (!f) return;
    if (panelSlot) { setSelectedId(f.id); return; }
    setThreadTarget({ friend: f, readOnlyNote: null });
  }

  function openConversation(row) {
    if (row.canSend && row.friend && panelSlot) { setSelectedId(row.id); return; }
    const friend = row.friend
      ? rows.find(r => r.id === row.id) || { id: row.id, name: row.name, handle: row.handle, avatar_url: row.avatar_url }
      : { id: row.id, name: row.name, handle: row.handle, avatar_url: row.avatar_url };
    setThreadTarget({ friend, readOnlyNote: readOnlyNoteFor(row) });
  }

  // Named rather than written inline on the card, because the friend
  // panel offers the same two actions and two copies of "are you sure"
  // would drift.
  async function handleBlock(f) {
    // Block is destructive — confirm via native dialog. The queries
    // module also drops the friendship row in the same call, so the user
    // is immediately removed from the list.
    const ok = window.confirm(
      `Block ${f.name}? They'll be removed from your friends and won't be able to find you again.`
    );
    if (!ok) return;
    try {
      await friends.block(f.id);
      setSelectedId(null); // close the card since this friend is gone
      announceBlocked(f);
    } catch (e) {
      window.alert(e.message || 'Could not block.');
    }
  }

  // Mute is private and instant — no confirm, because it is undone from
  // the same menu and nobody else is affected.
  const muteProps = mutes.ready ? {
    onMute: f => mutes.mute({ id: f.id, name: f.name, handle: f.handle }),
    onUnmute: f => mutes.unmute(f.id),
  } : {};

  async function handleUnfriend(f) {
    const ok = window.confirm(`Remove ${f.name} from your friends?`);
    if (!ok) return;
    try {
      await friends.unfriend(f.id);
      setSelectedId(null);
    } catch (e) {
      window.alert(e.message || 'Could not unfriend.');
    }
  }

  // Picking a friend appends their card BELOW the list. On the OS hub
  // the rail lives in a pinned column that scrolls internally, so the
  // card can open entirely below that column's fold and the click reads
  // as having done nothing.
  //
  // Scrolls the COLUMN, never the page. scrollIntoView would be shorter
  // but it walks every scrollable ancestor including the document, which
  // on a hub whose columns are already pinned to the viewport means the
  // whole canvas lurches for no reason.
  const cardRef = useRef(null);
  useEffect(() => {
    if (!selectedId || panelSlot) return undefined;
    // One frame later: the card mounts in its loading state first and
    // grows when public_stats land, so measuring immediately measures
    // the wrong box.
    const id = requestAnimationFrame(() => {
      const el = cardRef.current;
      if (!el) return;
      let box = el.parentElement;
      while (box && box !== document.body) {
        const oy = getComputedStyle(box).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight + 1) break;
        box = box.parentElement;
      }
      if (!box || box === document.body) return;
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      // Prefer showing the TOP of the card when it can't fit whole —
      // the name and avatar are what confirm the click landed.
      if (r.top < b.top) box.scrollTop -= (b.top - r.top) + 8;
      else if (r.bottom > b.bottom) {
        box.scrollTop += Math.min(r.bottom - b.bottom + 8, r.top - b.top);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [selectedId, statsLoading, panelSlot]);

  /* Click anywhere that is not the panel to put it away.
   *
   * A friend ROW is deliberately not "outside": clicking another friend
   * while the panel is open should switch it to them, which is what the
   * row's own handler does — so this bows out and lets it. Same for
   * anything portalled on top of the panel (the report modal, a native
   * confirm's backdrop), since those belong to it.
   *
   * pointerdown rather than click: a mousedown that starts inside the
   * panel and ends outside it — selecting a message, dragging a slider
   * — must not count as leaving.
   */
  useEffect(() => {
    if (!selectedId || !panelSlot) return undefined;
    const onDown = e => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (panelSlot.contains(t)) return;                 // the panel itself
      if (t.closest && t.closest('.fc-row')) return;     // switching friends
      if (t.closest && t.closest('.modal-overlay, .msg-overlay, .fc-menu')) return;
      setSelectedId(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [selectedId, panelSlot]);

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
      prestige: prestigeById[base.id] || 0,
      streak: selectedStats?.current_streak || 0,
      streakHabit: selectedStats?.streak_habit || null,
      heatmap: selectedStats?.heatmap_days || [],
      wins: selectedStats?.recent_wins || [],
      // Plumbed through from profiles.last_active_at via useFriends
      // → derivePresence. Drives the "Last active Xd ago" copy in
      // FriendCard's quiet-state strip.
      lastSeenDays: base.lastSeenDays,
      silenced: mutes.isMuted(base.id),
    };
  }, [selectedId, friends.friends, selectedStats, prestigeById, mutes]);

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
      // The row has always been able to draw a real avatar; it was
      // simply never handed one, so every row fell back to initials —
      // and now the chat opened from a row would have done the same.
      avatar_url: f.avatar_url || null,
      prestige: prestigeById[f.id] || 0,
      streak: 0,           // not in list view; row shows handle / last-seen instead
      streakHabit: null,
      lastSeenDays: f.lastSeenDays,
      unread: unread[f.id] || 0,
    }));
    // Muted friends go to the end of the list, flagged `silenced`.
    return silenceFriends(mapped.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (b.ovr || 0) - (a.ovr || 0);
    }), mutes.map);
  }, [friends.friends, unread, prestigeById, mutes.map]);

  // The inbox, joined with the friend list and partner facts. Unread
  // only counts conversations you can act on (friends, not blocked),
  // and not muted ones, which sit at the end under "Muted".
  const inbox = useMemo(
    () => silenceInbox(buildInbox(conversations, rows, facts), mutes.map),
    [conversations, rows, facts, mutes.map],
  );
  const total = useMemo(() => audibleUnread(inbox), [inbox]);
  // The header chip listens for this, so it moves the moment the rail
  // knows rather than on its own next poll. Not sent until the friend
  // list has loaded — before then every conversation looks foreign.
  useEffect(() => {
    if (friends.loading) return;
    try { window.dispatchEvent(new CustomEvent('vantage:dm-unread', { detail: total })); } catch { /* old browsers */ }
  }, [total, friends.loading]);

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
        {/* A handle reset by moderation lands here — the notice says why. */}
        <SafetyNotices userId={userId} />
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

  const threadNode = threadTarget && (
    layout === 'page' ? (
      <DMScreen>
        <MessagesModal
          inline
          open
          userId={userId}
          friend={threadTarget.friend}
          readOnlyNote={threadTarget.readOnlyNote}
          onBack={() => setThreadTarget(null)}
          onClose={() => setThreadTarget(null)}
          onActivity={onThreadActivity}
          onRead={onThreadRead}
          onBlocked={() => { setSelectedId(null); friends.refresh().catch(() => {}); pullConversations(); }}
        />
      </DMScreen>
    ) : (
      <MessagesModal
        open
        userId={userId}
        friend={threadTarget.friend}
        readOnlyNote={threadTarget.readOnlyNote}
        onClose={() => setThreadTarget(null)}
        onActivity={onThreadActivity}
        onRead={onThreadRead}
        onBlocked={() => {
          // Blocked from inside the conversation — the friendship row is
          // gone, so drop the card and refresh the list.
          setSelectedId(null);
          friends.refresh().catch(() => {});
          pullConversations();
        }}
      />
    )
  );

  return (
    <>
      <SafetyNotices userId={userId} />

      <PendingRequestsList
        pending={friends.pending}
        busyId={busyRequestId}
        userId={userId}
        onBlocked={() => { friends.refresh().catch(() => {}); }}
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

      <FriendsTabs tab={tab} onTab={setTab} friendCount={rows.length} unread={total} />

      {friends.friends.length > 0 && <FriendsPrestigeSource onData={setPrestigeById} />}
      {tab === 'messages' ? (
        <ConversationList
          rows={inbox}
          userId={userId}
          loading={convLoading}
          selectedId={openId}
          onOpen={openConversation}
          onInvite={() => setShowAddModal(true)}
        />
      ) : (
        <FriendsPanelList
          friends={rows}
          selectedId={selectedId}
          onSelect={handleSelect}
          onMessage={openThreadFor}
          onlineCount={friends.onlineCount}
          offlineCount={friends.offlineCount}
        />
      )}

      {/* Add-friend CTA — lives below the list so it doesn't compete
          with the list when there are friends to look at. Invite links
          live in the same modal, above handle search. */}
      {/* The empty inbox carries its own invite button; a second one
          straight under it would be the same offer twice. */}
      {!(tab === 'messages' && inbox.length === 0 && !convLoading) && (
        <button
          type="button"
          className="btn btn-ghost fc-add-btn"
          onClick={() => setShowAddModal(true)}
        >
          <span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="plus" size={14} /> {tab === 'messages' ? 'Invite a friend' : 'Add a friend'}</span>
        </button>
      )}

      {selectedFriend && !panelSlot && (
        <div ref={cardRef} className="fc-card-slot">
          <FriendCard
            friend={selectedFriend}
            loading={statsLoading}
            statsMissing={!selectedStats && !statsLoading}
            unread={unread[selectedFriend.id] || 0}
            onMessage={(f) => openThreadFor(f)}
            onReport={(f) => setReportTarget(f)}
            {...muteProps}
            onBlock={handleBlock}
            onUnfriend={handleUnfriend}
          />
        </div>
      )}

      {/* The selected friend, in the space the host lent us. */}
      {selectedFriend && panelSlot && createPortal(
        <FriendPanel
          userId={userId}
          friend={selectedFriend}
          loading={statsLoading}
          statsMissing={!selectedStats && !statsLoading}
          onClose={() => setSelectedId(null)}
          onBlocked={() => { setSelectedId(null); friends.refresh().catch(() => {}); pullConversations(); }}
          onReport={(f) => setReportTarget(f)}
          {...muteProps}
          onBlock={handleBlock}
          onUnfriend={handleUnfriend}
          onActivity={onThreadActivity}
          onRead={onThreadRead}
        />,
        panelSlot,
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
          await friends.report(reportTarget.id, reason, context,
            reportSnapshot({ handle: reportTarget.handle, name: reportTarget.name, where: 'friend-card' }));
        }}
        onClose={() => setReportTarget(null)}
      />

      {threadNode}
    </>
  );
}

/**
 * A conversation on a phone: the whole screen, solid, above the app's own
 * bars, with Back where a thumb expects it. Height follows the dynamic
 * viewport so the composer rides up with the keyboard instead of hiding
 * behind it.
 */
function DMScreen({ children }) {
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { html.style.overflow = prev; };
  }, []);
  return (
    <Overlay>
      <div className="dm-screen">{children}</div>
    </Overlay>
  );
}
