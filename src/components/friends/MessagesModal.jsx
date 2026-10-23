import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import {
  listThread, sendMessage, markThreadRead, unsendMessage, getMessagesByIds,
  react as addReaction, unreact as removeReaction, listReactions,
} from '../../lib/friends/messages';
import { subscribeDMs, pollThread, joinTyping } from '../../lib/friends/realtime';
import {
  REACTION_EMOJI, MAX_BODY, isTempId as isTmp, snippet,
  mergeMessages, makeOptimistic, confirmSent, markFailed, removeMessage,
  applySeen, seenMessageId, resolveReplies, missingReplyIds,
  summarizeReactions, applyReactionChange, oldestReal, newestReal,
} from '../../lib/friends/dmModel';
import { COUNTER_FROM, dayKey, dayLabel, timeLabel, endsCluster } from '../../lib/friends/dmView';
import { reportUser, blockUser, reportSnapshot } from '../../lib/friends/queries';
import { invalidatePartnerFacts } from '../../lib/friends/inboxPeople';
import { useSafety } from '../../lib/friends/useSafety';
import { noteSuspended } from '../../lib/friends/safety';
import { messageTextProblem } from '../../lib/moderation/messageFilter';
import { SUSPENDED_SHORT } from '../../lib/moderation/notices';
import ReportFriendModal from './ReportFriendModal';
import { announceBlocked } from './StayingSafe';
import { useMutes } from '../../lib/friends/useMutes';
import { ClanInviteMenuItem, ClanInviteBubble } from './ClanInvite';
import { parseInvite } from '../../lib/friends/clanInvite';
import './friends-dm.css';

/**
 * MessagesModal — the 1:1 conversation, as an overlay or `inline`.
 *
 * ── Delivery ─────────────────────────────────────────────────────────
 * The newest 50 messages load first; "Load earlier" pages back 50 at a
 * time and holds your place. New messages arrive over the shared,
 * ref-counted Realtime inbox channel (subscribeDMs — the rail and this
 * thread hold one channel between them). pollThread keeps the thread
 * current when that channel can't subscribe: rows newer than the newest
 * one held, every 12 s — never the whole thread again, which is what the
 * old 4 s poll of up to 200 rows did. Optimistic, realtime and polled
 * copies of one message collapse into one (dmModel.mergeMessages), and an
 * optimistic bubble keeps its React key (`_key`) when confirmed.
 *
 * ── Scroll ───────────────────────────────────────────────────────────
 * Pinned to the bottom only while you are at the bottom. Scrolled up
 * reading, a new message raises a "New messages ↓" pill instead of
 * yanking you down.
 *
 * ── Inline ───────────────────────────────────────────────────────────
 * `inline` drops the portal and the backdrop so the hub's friend panel
 * and the phone's conversation screen host this same component — two
 * chats would drift the first time either was touched.
 */

const LONG_PRESS_MS = 450;
const COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}
function initials(name = '?') {
  return name.replace(/^@/, '').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
}
const coarsePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

function ReplyGlyph({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 17 4 12l5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

export default function MessagesModal(props) {
  if (!props.open || !props.friend) return null;
  return <Conversation {...props} />;
}

function Conversation({
  userId, friend, onClose, onBlocked, inline = false, onBack = null,
  readOnlyNote: readOnlyNoteProp = null, onActivity, onRead,
}) {
  const friendId = friend.id;
  // A suspended account reads its conversations but can't send (item
  // 111) — the same read-only state as a former friend, with its own
  // calm line, instead of every send failing.
  const safety = useSafety(userId);
  // Mute (item 113): the ⋯ menu offers it beside Report and Block. The
  // thread itself reads the same muted or not — only badges go quiet.
  const mutes = useMutes();
  const isMutedHere = mutes.isMuted(friendId);
  const readOnlyNote = readOnlyNoteProp || (safety.suspended ? SUSPENDED_SHORT : null);
  const name = friend.name || (friend.handle ? `@${friend.handle}` : 'Friend');
  const first = name.replace(/^@/, '').split(' ')[0];

  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState({});
  const [quoted, setQuoted] = useState([]);     // rows fetched for quotes older than the page
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [errMsg, setErrMsg] = useState('');
  const [toast, setToast] = useState('');
  const [toastTone, setToastTone] = useState('error'); // 'info' for calm confirmations (mute)
  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState('');
  const [composeErr, setComposeErr] = useState('');   // the DM filter's inline reason
  const [replyTo, setReplyTo] = useState(null);
  const [menu, setMenu] = useState(null);        // { id, below }
  const [newCount, setNewCount] = useState(0);
  const [typing, setTyping] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [flashId, setFlashId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const headMenuRef = useRef(null);
  const stickRef = useRef(true);
  // "Load earlier" holds your place by pinning the row you were looking
  // at, not a pixel height: reactions and quotes for the new page arrive
  // a moment later and would otherwise push it down.
  const anchorRef = useRef(null);    // { id, offset, until }
  const msgsRef = useRef(messages);
  msgsRef.current = messages;
  const readTimer = useRef(null);
  const announceRef = useRef({ n: 0, at: 0 });
  const typingRef = useRef(null);
  const pressTimer = useRef(null);
  const returnFocusRef = useRef(null);

  const toastTimer = useRef(null);
  const flash = useCallback((text, tone = 'error') => {
    setToast(text);
    setToastTone(tone);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 4000);
  }, []);

  const markRead = useCallback(() => {
    window.clearTimeout(readTimer.current);
    readTimer.current = window.setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      markThreadRead(userId, friendId).then(() => onRead?.(friendId)).catch(() => {});
    }, 400);
  }, [userId, friendId, onRead]);

  const loadReactionsFor = useCallback(async rows => {
    const ids = rows.map(m => m.id).filter(id => !isTmp(id));
    if (!ids.length) return;
    try {
      const got = await listReactions(ids);
      setReactions(prev => {
        const next = { ...prev };
        for (const id of ids) { if (got[id]?.length) next[id] = got[id]; else delete next[id]; }
        return next;
      });
    } catch { /* reactions are decoration; never block the thread */ }
  }, []);

  // Quotes that point above the loaded page: fetch those rows once.
  useEffect(() => {
    const want = missingReplyIds(messages, quoted).filter(id => !isTmp(id));
    if (!want.length) return undefined;
    let cancelled = false;
    getMessagesByIds(want).then(rows => {
      if (cancelled) return;
      // Misses (unsent originals) are remembered too, so they aren't re-asked.
      const got = new Set(rows.map(r => String(r.id)));
      setQuoted(q => [...q, ...rows, ...want.filter(id => !got.has(String(id))).map(id => ({ id, _gone: true }))]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [messages, quoted]);

  // ── initial load ──
  useEffect(() => {
    let cancelled = false;
    setStatus('loading'); setMessages([]); setReactions({}); setQuoted([]); setDraft(''); setReplyTo(null);
    setMenu(null); setNewCount(0); setHasMore(false); stickRef.current = true;
    listThread(userId, friendId)
      .then(rows => {
        if (cancelled) return;
        setMessages([...rows]);
        setHasMore(!!rows.hasMore);
        setStatus('ready');
        loadReactionsFor(rows);
        if (rows.some(m => m.sender_id === friendId && !m.read_at)) markRead();
        else onRead?.(friendId);
      })
      .catch(e => { if (!cancelled) { setStatus('error'); setErrMsg(e.message || 'Could not load messages.'); } });
    return () => { cancelled = true; window.clearTimeout(readTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, friendId]);

  const announceIncoming = useCallback(m => {
    const now = Date.now();
    const a = announceRef.current;
    a.n = now - a.at < 4000 ? a.n + 1 : 1;
    a.at = now;
    setAnnounce(a.n > 1 ? `${a.n} new messages from ${first}` : `New message from ${first}: ${snippet(m.body, 120)}`);
  }, [first]);

  const inPair = useCallback(m => !!m && (
    (m.sender_id === userId && m.recipient_id === friendId) ||
    (m.sender_id === friendId && m.recipient_id === userId)), [userId, friendId]);

  const ingest = useCallback((rows, { liveArrival = false } = {}) => {
    const mine = rows.filter(inPair);
    if (!mine.length) return;
    const known = new Set(msgsRef.current.map(m => String(m.id)));
    const fresh = mine.filter(m => !known.has(String(m.id)));
    setMessages(list => mergeMessages(list, mine, { selfId: userId }));
    const incoming = fresh.filter(m => m.sender_id === friendId);
    if (incoming.length) {
      setTyping(false);
      markRead();
      if (!stickRef.current) setNewCount(n => n + incoming.length);
      if (liveArrival) incoming.forEach(announceIncoming);
    }
    if (fresh.length) loadReactionsFor(fresh);
  }, [userId, friendId, inPair, markRead, announceIncoming, loadReactionsFor]);

  // ── live: the shared inbox channel ──
  // DELETE payloads carry only { id } and arrive for everyone's deletes;
  // ids not on screen fall through removeMessage / applyReactionChange
  // untouched.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    return subscribeDMs(userId, {
      onMessage: m => ingest([m], { liveArrival: true }),
      onUpdate: m => {
        if (!inPair(m) || !msgsRef.current.some(x => String(x.id) === String(m.id))) return;
        setMessages(list => mergeMessages(list, [m], { selfId: userId }));
      },
      onDelete: ({ id } = {}) => { if (id != null) setMessages(list => removeMessage(list, id)); },
      onReaction: change => setReactions(r => applyReactionChange(r, change)),
    });
  }, [status, userId, inPair, ingest]);

  // ── polling: 12 s while the channel is down, a 60 s safety net while
  //    it is up, one catch-up whenever it comes (back) up. Carries "Seen".
  useEffect(() => {
    if (status !== 'ready') return undefined;
    return pollThread(userId, friendId, {
      getAfter: () => newestReal(msgsRef.current)?.created_at || null,
      onRows: rows => ingest(rows, { liveArrival: true }),
      onSeen: seen => setMessages(list => applySeen(list, seen, userId)),
    });
  }, [status, userId, friendId, ingest]);

  // ── typing indicator (a no-op until the data layer's SQL is run) ──
  useEffect(() => {
    if (readOnlyNote) return undefined;
    let handle = null;
    try { handle = joinTyping(userId, friendId, on => setTyping(!!on)); } catch { handle = null; }
    typingRef.current = handle;
    return () => {
      try { handle?.leave?.(); } catch { /* gone */ }
      typingRef.current = null;
      setTyping(false);
    };
  }, [userId, friendId, readOnlyNote]);

  // ── scroll management ──
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = anchorRef.current;
    if (anchor && Date.now() < anchor.until) {
      const row = el.querySelector(`[data-mid="${CSS.escape(anchor.id)}"]`);
      if (row) el.scrollTop += (row.getBoundingClientRect().top - el.getBoundingClientRect().top) - anchor.offset;
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, reactions, quoted, status, typing]);

  // Late layout (web fonts, a reaction row, an avatar) can grow the list
  // after the pin above ran; re-pin once fonts settle if still at bottom.
  useEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => {
      const el = scrollRef.current;
      if (alive && el && stickRef.current) el.scrollTop = el.scrollHeight;
    });
    return () => { alive = false; };
  }, [status]);

  function onScroll(e) {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = atBottom;
    if (atBottom && newCount) setNewCount(0);
    if (menu) setMenu(null);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    anchorRef.current = null;
    setNewCount(0);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  async function loadEarlier(limit = 50) {
    const el = scrollRef.current;
    const oldest = oldestReal(msgsRef.current);
    if (!oldest || loadingEarlier) return { more: false };
    setLoadingEarlier(true);
    try {
      const rows = await listThread(userId, friendId, { before: oldest, limit });
      if (el) {
        const rowEl = el.querySelector(`[data-mid="${CSS.escape(String(oldest.id))}"]`);
        anchorRef.current = rowEl
          ? { id: String(oldest.id), offset: rowEl.getBoundingClientRect().top - el.getBoundingClientRect().top, until: Date.now() + 2000 }
          : null;
      }
      stickRef.current = false;
      setMessages(list => mergeMessages(list, [...rows], { selfId: userId }));
      setHasMore(!!rows.hasMore);
      loadReactionsFor(rows);
      return { more: !!rows.hasMore };
    } catch (e) {
      flash(e.message || 'Could not load earlier messages.');
      return { more: false };
    } finally {
      setLoadingEarlier(false);
    }
  }

  /** Tap a quote → scroll to the original, paging back for it if needed. */
  async function jumpTo(id) {
    let more = hasMore;
    for (let i = 0; i < 8 && !msgsRef.current.some(m => String(m.id) === String(id)) && more; i++) {
      // Bigger pages when hunting for a quoted message (the data layer caps at 200).
      ({ more } = await loadEarlier(200));
      await new Promise(r => requestAnimationFrame(r));
    }
    const el = scrollRef.current;
    const target = el?.querySelector(`[data-mid="${CSS.escape(String(id))}"]`);
    if (!el || !target) { flash('That message is no longer available.'); return; }
    stickRef.current = false;
    anchorRef.current = null;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - el.clientHeight / 3;
    el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    setFlashId(String(id));
    window.setTimeout(() => setFlashId(null), 1600);
    target.querySelector('.msg-bubble')?.focus({ preventScroll: true });
  }

  // ── sending ──
  async function deliver(text, target) {
    const temp = makeOptimistic({ selfId: userId, friendId, body: text, replyTo: target?.id ?? null });
    stickRef.current = true;
    anchorRef.current = null;
    setNewCount(0);
    setMessages(list => [...list, temp]);
    try {
      const saved = await sendMessage(userId, friendId, text, { replyTo: target?.id ?? null });
      setMessages(list => confirmSent(list, temp.id, saved));
      if (saved) onActivity?.(saved);
    } catch (e) {
      if (e?.code === 'filtered' || e?.code === 'suspended') {
        // Not a delivery failure, so no "Not sent · Retry" bubble: take
        // it back out and say why where they're typing.
        setMessages(list => list.filter(x => x.id !== temp.id));
        if (e.code === 'filtered') {
          setDraft(d => d || text);
          if (target) setReplyTo(r => r || target);
          setComposeErr(e.message);
        } else {
          noteSuspended(userId);
        }
        return;
      }
      setMessages(list => markFailed(list, temp.id, e.message || 'Not sent'));
    }
  }

  function handleSend() {
    const text = draft.trim();
    if (!text || readOnlyNote) return;
    const problem = messageTextProblem(text);
    if (problem) { setComposeErr(problem); return; }
    const target = replyTo;
    setDraft('');
    setReplyTo(null);
    if (inputRef.current) inputRef.current.style.height = '';
    deliver(text.slice(0, MAX_BODY), target);
  }

  function retry(m) {
    const target = m.reply_to != null ? (msgsRef.current.find(x => String(x.id) === String(m.reply_to)) || { id: m.reply_to }) : null;
    setMessages(list => list.filter(x => x.id !== m.id));
    deliver(m.body, target);
  }

  function onDraftChange(e) {
    const v = e.target.value.slice(0, MAX_BODY);
    setDraft(v);
    if (composeErr) setComposeErr('');
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    // sendTyping throttles itself (one broadcast per 2.5 s).
    if (v.trim()) { try { typingRef.current?.sendTyping?.(); } catch { /* best effort */ } }
  }

  function onComposerKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !coarsePointer()) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── reactions ──
  async function toggleReaction(m, emoji) {
    if (isTmp(m.id)) return;
    const rows = reactions[m.id] || [];
    const had = rows.some(r => r.user_id === userId && r.emoji === emoji);
    const mine = { message_id: m.id, user_id: userId, emoji };
    // Optimistic: an id-less row, which the realtime echo (with an id)
    // replaces rather than duplicates.
    setReactions(r => applyReactionChange(r, { type: had ? 'DELETE' : 'INSERT', row: mine }));
    const res = had ? await removeReaction(m.id, emoji) : await addReaction(m.id, emoji);
    if (res?.ok) {
      if (!had && res.row) setReactions(r => applyReactionChange(r, { type: 'INSERT', row: res.row }));
      return;
    }
    setReactions(r => applyReactionChange(r, { type: had ? 'INSERT' : 'DELETE', row: mine }));
    flash(res?.reason === 'not_configured' ? 'Reactions aren\'t switched on yet.' : (res?.message || 'Could not react.'));
  }

  async function unsend(m) {
    closeMenu();
    if (!window.confirm('Unsend this message? It will be removed for both of you.')) return;
    const before = msgsRef.current;
    setMessages(list => removeMessage(list, m.id));
    try { await unsendMessage(m.id); }
    catch (e) { setMessages(before); flash(e.message || 'Could not unsend.'); }
  }

  async function copyText(m) {
    closeMenu();
    try { await navigator.clipboard.writeText(m.body); flash('Copied'); }
    catch { flash('Copy isn\'t available here.'); }
  }

  function startReply(m) {
    closeMenu(false);
    setReplyTo(m);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  // ── per-message menu ──
  function openMenu(m, trigger) {
    if (isTmp(m.id)) return;
    returnFocusRef.current = trigger || null;
    const el = scrollRef.current;
    const row = el?.querySelector(`[data-mid="${CSS.escape(String(m.id))}"]`);
    let below = false;
    if (el && row) below = row.getBoundingClientRect().top - el.getBoundingClientRect().top < 120;
    setMenu({ id: String(m.id), below });
  }
  function closeMenu(restore = true) {
    setMenu(null);
    if (restore) {
      const t = returnFocusRef.current;
      returnFocusRef.current = null;
      if (t && typeof t.focus === 'function') window.setTimeout(() => t.focus({ preventScroll: true }), 0);
    }
  }
  function pressStart(e, m) {
    if (e.pointerType !== 'touch') return;
    const t = e.currentTarget;
    const x = e.clientX, y = e.clientY;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => { navigator.vibrate?.(8); openMenu(m, t); }, LONG_PRESS_MS);
    pressTimer.origin = { x, y };
  }
  function pressMove(e) {
    const o = pressTimer.origin;
    if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) window.clearTimeout(pressTimer.current);
  }
  function pressEnd() { window.clearTimeout(pressTimer.current); }

  // Outside click closes the per-message menu / header menu.
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = e => { if (!e.target.closest?.('.dm-menu, .dm-actions')) setMenu(null); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menu]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = e => { if (!headMenuRef.current?.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Escape: menu → reply → header menu → close (overlay only).
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if (menu) { e.stopPropagation(); closeMenu(); return; }
      if (menuOpen) { setMenuOpen(false); return; }
      if (replyTo) { setReplyTo(null); return; }
      if (!inline) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu, menuOpen, replyTo, inline, onClose]);

  function toggleMute() {
    setMenuOpen(false);
    if (isMutedHere) {
      mutes.unmute(friendId);
      flash(`Unmuted. You'll be notified about ${first}'s messages again.`, 'info');
    } else {
      mutes.mute({ id: friendId, name: friend.name, handle: friend.handle });
      flash(`Muted. You won't be notified about ${first}'s messages. They won't know. You can still report them.`, 'info');
    }
  }

  async function handleBlock() {
    setMenuOpen(false);
    const ok = window.confirm(
      `Block ${name}? They'll be removed from your friends, won't be able to message you, and won't be able to find you again.`
    );
    if (!ok) return;
    try {
      await blockUser(userId, friendId);
      invalidatePartnerFacts();
      onBlocked?.(friend);
      onClose?.();
      announceBlocked({ name, handle: friend.handle });
    } catch (e) {
      flash(e.message || 'Could not block.');
    }
  }

  // Recent messages FROM the reported user ride along as evidence.
  function reportEvidence() {
    return messages
      .filter(m => m.sender_id === friendId)
      .slice(-5)
      .map(m => `"${String(m.body).slice(0, 70)}"`)
      .join(' · ')
      .slice(0, 400);
  }

  const replies = useMemo(() => resolveReplies(messages, quoted.filter(q => !q._gone)), [messages, quoted]);
  const seenId = seenMessageId(messages, userId);
  const nowTs = Date.now();
  const left = MAX_BODY - draft.length;

  const bubbles = messages.map((m, i) => {
    const mine = m.sender_id === userId;
    const prev = messages[i - 1];
    const showDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
    const showTime = endsCluster(messages, i) || m._failed;
    const invite = parseInvite(m.body);
    const key = String(m.id);
    const reply = m.reply_to != null ? replies[m.id] : null;
    const summary = summarizeReactions(reactions[m.id], userId);
    const seenHere = seenId != null && String(seenId) === key;
    const menuHere = menu?.id === key;
    const who = mine ? 'You' : first;
    const label = `${who}: ${snippet(m.body, 200)}. ${timeLabel(m.created_at)}${summary.length ? `. Reactions ${summary.map(s => `${s.emoji} ${s.count}`).join(', ')}` : ''}`;
    return (
      <div key={m._key || m.id}>
        {showDay && <div className="msg-daysep dm-daysep" role="separator">{dayLabel(m.created_at, nowTs)}</div>}
        <div
          className={`msg-row ${mine ? 'mine' : 'theirs'} dm-row${flashId === key ? ' is-flash' : ''}${menuHere ? ' has-menu' : ''}`}
          data-mid={key}
        >
          <div className="dm-stack">
            <div className="dm-line">
              {invite ? (
                <ClanInviteBubble invite={invite} mine={mine} time={timeLabel(m.created_at)} />
              ) : (
                <div
                  className={`msg-bubble dm-bubble${m._pending ? ' pending' : ''}${m._failed ? ' failed' : ''}`}
                  tabIndex={isTmp(m.id) ? -1 : 0}
                  aria-label={label}
                  aria-haspopup={isTmp(m.id) ? undefined : 'menu'}
                  title={timeLabel(m.created_at)}
                  onKeyDown={e => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu') { e.preventDefault(); openMenu(m, e.currentTarget); }
                  }}
                  onContextMenu={e => { if (!isTmp(m.id)) { e.preventDefault(); openMenu(m, e.currentTarget); } }}
                  onPointerDown={e => pressStart(e, m)}
                  onPointerMove={pressMove}
                  onPointerUp={pressEnd}
                  onPointerCancel={pressEnd}
                >
                  {m.reply_to != null && (
                    <button
                      type="button"
                      className="dm-quote"
                      onClick={e => { e.stopPropagation(); jumpTo(m.reply_to); }}
                      aria-label={reply && !reply.missing ? `Replying to ${reply.sender_id === userId ? 'you' : first}: ${snippet(reply.body, 80)}. Show original` : 'Replying to a message that is no longer available'}
                    >
                      <span className="dm-quote-who">{reply && !reply.missing ? (reply.sender_id === userId ? 'You' : first) : 'Earlier message'}</span>
                      <span className="dm-quote-body">{reply && !reply.missing ? reply.body : (quoted.some(q => String(q.id) === String(m.reply_to)) ? 'No longer available' : 'Loading…')}</span>
                    </button>
                  )}
                  <span className="dm-body">{m.body}</span>
                </div>
              )}
              {!isTmp(m.id) && !readOnlyNote && (
                <div className="dm-actions" aria-hidden={menuHere ? undefined : true}>
                  <button type="button" tabIndex={-1} className="dm-act" title="React" onClick={e => openMenu(m, e.currentTarget.closest('.dm-line')?.querySelector('.msg-bubble'))}>
                    <Icon name="smile" size={14} />
                  </button>
                  <button type="button" tabIndex={-1} className="dm-act" title="Reply" onClick={() => startReply(m)}>
                    <ReplyGlyph />
                  </button>
                </div>
              )}
            </div>

            {menuHere && (
              <MessageMenu
                mine={mine}
                below={menu.below}
                readOnly={!!readOnlyNote}
                rows={reactions[m.id]}
                userId={userId}
                onReact={emoji => { toggleReaction(m, emoji); closeMenu(); }}
                onReply={() => startReply(m)}
                onCopy={() => copyText(m)}
                onUnsend={mine ? () => unsend(m) : null}
                onClose={() => closeMenu()}
              />
            )}

            {summary.length > 0 && (
              <div className="dm-reacts">
                {summary.map(s => (
                  <button
                    key={s.emoji}
                    type="button"
                    className={`dm-react${s.mine ? ' is-mine' : ''}`}
                    aria-pressed={s.mine}
                    aria-label={`${s.emoji} ${s.count}${s.mine ? ', including you' : ''}. ${s.mine ? 'Remove' : 'Add'} your reaction`}
                    disabled={!!readOnlyNote}
                    onClick={() => toggleReaction(m, s.emoji)}
                  >
                    <span aria-hidden="true">{s.emoji}</span>
                    <span className="dm-react-n" aria-hidden="true">{s.count}</span>
                  </button>
                ))}
              </div>
            )}

            {m._failed ? (
              <div className="dm-failed" role="alert">
                Not sent.
                <button type="button" className="dm-linkbtn" onClick={() => retry(m)}>Retry</button>
                <button type="button" className="dm-linkbtn" onClick={() => setMessages(list => list.filter(x => x.id !== m.id))}>Delete</button>
              </div>
            ) : showTime && !invite ? (
              <div className="dm-time">
                {m._pending ? 'Sending…' : timeLabel(m.created_at)}
                {seenHere && <span className="dm-seen"> · Seen</span>}
              </div>
            ) : seenHere ? (
              <div className="dm-time"><span className="dm-seen">Seen</span></div>
            ) : null}
          </div>
        </div>
      </div>
    );
  });

  const body = (
    <>
      <div className={`msg-modal dm${inline ? ' msg-inline' : ''}`} role={inline ? 'region' : 'dialog'} aria-label={`Messages with ${name}`}>
        <div className="msg-head dm-head">
          {onBack && (
            <button type="button" className="dm-iconbtn dm-back" onClick={onBack} aria-label="Back to messages">
              <Icon name="chevron-left" size={18} />
            </button>
          )}
          <div className="msg-head-who">
            {friend.avatar_url
              ? <img className="msg-avatar msg-avatar-img" src={friend.avatar_url} alt="" />
              : <div className="msg-avatar" style={{ background: avatarColor(name) }} aria-hidden="true">{initials(name)}</div>}
            <div className="dm-head-text">
              <div className="msg-head-name">{name}</div>
              <div className="msg-head-handle dm-head-sub">
                {typing ? <span className="dm-typing-inline">typing…</span> : `${friend.handle ? `@${friend.handle}` : ''}${isMutedHere ? `${friend.handle ? ' · ' : ''}Muted` : ''}`}
              </div>
            </div>
          </div>
          <div className="fc-menu-wrap" ref={headMenuRef} style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className="msg-close dm-iconbtn"
              style={{ marginLeft: 0 }}
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Conversation actions"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              title="More"
            ><Icon name="ellipsis" size={16} /></button>
            {menuOpen && (
              <div className="fc-menu" role="menu">
                {!readOnlyNote && (
                  <>
                    <ClanInviteMenuItem
                      disabled={false}
                      friendId={friendId}
                      friendName={first}
                      onInvite={text => { setMenuOpen(false); deliver(text, null); }}
                    />
                    <div className="fc-menu-sep" role="separator" />
                  </>
                )}
                <button type="button" role="menuitem" className="fc-menu-item" onClick={() => { setMenuOpen(false); setReporting(true); }}>
                  Report abuse
                </button>
                {mutes.ready && (
                  <button type="button" role="menuitem" className="fc-menu-item" onClick={toggleMute}>
                    {isMutedHere ? 'Unmute' : 'Mute'}
                  </button>
                )}
                <button type="button" role="menuitem" className="fc-menu-item fc-menu-item-warn" onClick={handleBlock}>
                  Block user
                </button>
              </div>
            )}
          </div>
          {!inline && (
            <button type="button" className="msg-close dm-iconbtn" style={{ marginLeft: 0 }} onClick={() => onClose?.()} aria-label="Close"><Icon name="x" size={15} /></button>
          )}
        </div>

        <div className="dm-scroll-wrap">
          <div
            className="msg-scroll dm-scroll"
            ref={scrollRef}
            onScroll={onScroll}
            onWheel={() => { anchorRef.current = null; }}
            onTouchStart={() => { anchorRef.current = null; }}
          >
            {status === 'loading' && <div className="msg-empty">Loading…</div>}
            {status === 'error' && <div className="msg-empty msg-error">{errMsg}</div>}
            {status === 'ready' && hasMore && (
              <button type="button" className="dm-earlier" onClick={() => loadEarlier()} disabled={loadingEarlier}>
                {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
              </button>
            )}
            {status === 'ready' && messages.length === 0 && (
              <div className="msg-empty">No messages yet — say hi to {first}.</div>
            )}
            {status === 'ready' && bubbles}
            {typing && status === 'ready' && (
              <div className="msg-row theirs dm-row" aria-hidden="true">
                <div className="dm-typing"><span /><span /><span /></div>
              </div>
            )}
          </div>
          {newCount > 0 && (
            <button type="button" className="dm-newpill" onClick={scrollToBottom}>
              {newCount === 1 ? 'New message' : `${newCount} new messages`} <Icon name="arrow-down" size={13} />
            </button>
          )}
          <div className="dm-sr" aria-live="polite" aria-atomic="true">{announce}</div>
        </div>

        {toast && <div className={`msg-inline-err dm-toast${toastTone === 'info' ? ' is-info' : ''}`} role="status">{toast}</div>}

        {readOnlyNote ? (
          <div className="dm-readonly">{readOnlyNote}</div>
        ) : (
          <div className="dm-composer-wrap">
            {replyTo && (
              <div className="dm-replying">
                <ReplyGlyph size={13} />
                <div className="dm-replying-text">
                  <span className="dm-replying-who">Replying to {replyTo.sender_id === userId ? 'yourself' : first}</span>
                  <span className="dm-replying-body">{snippet(replyTo.body, 120)}</span>
                </div>
                <button type="button" className="dm-iconbtn" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><Icon name="x" size={14} /></button>
              </div>
            )}
            <div className="msg-composer dm-composer">
              <textarea
                ref={inputRef}
                className="msg-input dm-input"
                placeholder={`Message ${first}…`}
                aria-label={`Message ${first}`}
                value={draft}
                rows={1}
                onChange={onDraftChange}
                onKeyDown={onComposerKey}
                maxLength={MAX_BODY}
                aria-invalid={composeErr ? true : undefined}
                aria-describedby={composeErr ? `dm-err-${friendId}` : undefined}
              />
              <button type="button" className="msg-send dm-send" onClick={handleSend} disabled={!draft.trim()} aria-label="Send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg>
              </button>
            </div>
            {composeErr && (
              <div className="dm-compose-err" id={`dm-err-${friendId}`} role="alert">{composeErr}</div>
            )}
            {draft.length >= COUNTER_FROM && (
              <div className={`dm-counter${left <= 0 ? ' is-max' : ''}`} aria-live="polite">{draft.length}/{MAX_BODY}</div>
            )}
          </div>
        )}
      </div>

      <ReportFriendModal
        open={reporting}
        friend={friend}
        onSubmit={(reason, context) =>
          reportUser(userId, friendId, reason, [context, reportEvidence()].filter(Boolean).join(' — recent messages: '),
            reportSnapshot({ handle: friend?.handle, name: friend?.name, where: 'messages' }))}
        onClose={() => setReporting(false)}
      />
    </>
  );

  if (inline) return body;

  // Portalled to <body>: the rail lives in a sticky column, which is a
  // stacking context no z-index can escape (see ui/Overlay).
  return createPortal(
    <div className="msg-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      {body}
    </div>,
    document.body
  );
}

/** The long-press / hover / keyboard menu on one message. */
function MessageMenu({ mine, below, readOnly, rows, userId, onReact, onReply, onCopy, onUnsend, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus({ preventScroll: true });
  }, []);
  const mineSet = new Set((rows || []).filter(r => r.user_id === userId).map(r => r.emoji));
  function onKeyDown(e) {
    const items = [...ref.current.querySelectorAll('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  }
  return (
    <div ref={ref} className={`dm-menu ${mine ? 'is-mine' : 'is-theirs'}${below ? ' is-below' : ''}`} role="menu" aria-label="Message actions" onKeyDown={onKeyDown}>
      {!readOnly && <div className="dm-menu-emoji">
        {REACTION_EMOJI.map(e => (
          <button
            key={e}
            type="button"
            role="menuitemcheckbox"
            aria-checked={mineSet.has(e)}
            aria-label={`React ${e}`}
            className={`dm-menu-emo${mineSet.has(e) ? ' is-on' : ''}`}
            onClick={() => onReact(e)}
          >{e}</button>
        ))}
      </div>}
      <div className="dm-menu-items">
        {!readOnly && <button type="button" role="menuitem" className="dm-menu-item" onClick={onReply}><ReplyGlyph /> Reply</button>}
        <button type="button" role="menuitem" className="dm-menu-item" onClick={onCopy}><Icon name="copy" size={14} /> Copy text</button>
        {onUnsend && !readOnly && (
          <button type="button" role="menuitem" className="dm-menu-item is-warn" onClick={onUnsend}><Icon name="x" size={14} /> Unsend</button>
        )}
      </div>
    </div>
  );
}
