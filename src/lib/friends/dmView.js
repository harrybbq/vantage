/**
 * Presentation helpers for the DM screens — labels, clustering, the
 * inbox join. Message STATE (merging, optimistic bubbles, reactions,
 * Seen, replies) lives in dmModel.js, the data layer's model; this file
 * only decides how things read. Pure, so dmView.test.mjs can pin it.
 */
import { ts as parseTs, isTempId } from './dmModel.js';

/** Show the composer's character counter from here on (limit: MAX_BODY). */
export const COUNTER_FROM = 1800;

const ts = m => { const t = parseTs(m?.created_at); return Number.isFinite(t) ? t : 0; };



// ── Time ─────────────────────────────────────────────────────────────

export function dayKey(iso) {
  const d = new Date(parseTs(iso));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso, now = Date.now()) {
  const d = new Date(parseTs(iso));
  if (Number.isNaN(d.getTime())) return '';
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}

export function timeLabel(iso) {
  const d = new Date(parseTs(iso));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Compact recency for inbox rows: now · 5m · 3h · 2d · 12 Oct. Digits,
 *  not "Yesterday", because the rail is 240px wide and the name is the
 *  thing that must not be cut short. */
export function relTime(iso, now = Date.now()) {
  const t = parseTs(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const d = new Date(t);
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(t); b.setHours(0, 0, 0, 0);
  const days = Math.round((a - b) / 86400000);
  if (days === 0) return `${Math.floor(s / 3600)}h`;
  if (days < 7) return `${days}d`;
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = '2-digit';
  return d.toLocaleDateString('en-GB', opts);
}

/** A run of bubbles from one sender within five minutes on one day. The
 *  time is printed once, under the last bubble of the run. */
export function endsCluster(messages, i) {
  const m = messages[i];
  const n = messages[i + 1];
  if (!n) return true;
  if (n.sender_id !== m.sender_id) return true;
  if (dayKey(n.created_at) !== dayKey(m.created_at)) return true;
  return ts(n) - ts(m) > 5 * 60_000;
}

// ── Inbox ────────────────────────────────────────────────────────────

/** One line, "You: " for my own, collapsed whitespace, trimmed. */
export function previewText(last, myId, max = 80) {
  if (!last || !last.body) return '';
  const body = String(last.body).replace(/\s+/g, ' ').trim();
  const clipped = body.length > max ? `${body.slice(0, max - 1)}…` : body;
  return last.sender_id === myId ? `You: ${clipped}` : clipped;
}

/**
 * Join conversations (from listConversations) with the friend list and
 * any extra partner facts. Rows sorted newest first. A partner who is
 * not a friend any more, is blocked, or is suspended is `muted` and
 * carries a `note`; `canSend` says whether the composer is live.
 */
export function buildInbox(conversations, friends, { people = {}, blocked = new Set() } = {}) {
  const byId = new Map((friends || []).map(f => [f.id, f]));
  const rows = (conversations || []).filter(c => c && c.friendId && c.last).map(c => {
    const f = byId.get(c.friendId);
    const p = people[c.friendId] || {};
    const isBlocked = !!c.blockedByMe || blocked.has(c.friendId);
    const suspended = !!(p.suspended_at || f?.suspended_at);
    const isFriend = !!f && !isBlocked;
    let note = null;
    if (isBlocked) note = 'Blocked';
    else if (suspended) note = 'Account suspended';
    else if (!f) note = 'Not friends any more';
    return {
      id: c.friendId,
      name: f?.name || f?.display_name || p.display_name || (p.handle ? `@${p.handle}` : f?.handle ? `@${f.handle}` : 'Former friend'),
      handle: f?.handle || p.handle || null,
      avatar_url: f?.avatar_url || p.avatar_url || null,
      last: c.last,
      unread: isFriend ? Math.max(0, Number(c.unread) || 0) : 0,
      muted: !isFriend || suspended,
      note,
      canSend: isFriend && !suspended,
      friend: f || null,
    };
  });
  return rows.sort((a, b) => ts(b.last) - ts(a.last));
}

export const unreadTotal = rows => (rows || []).reduce((n, r) => n + (r.unread || 0), 0);

/**
 * Fold a live message into the inbox: bump that conversation to the top
 * with the new last message, and count it unread unless it is mine or
 * the thread is open. Unknown partners get a fresh row.
 */
export function bumpConversation(conversations, msg, myId, openId = null) {
  if (!msg || msg.id == null) return conversations;
  const partner = msg.sender_id === myId ? msg.recipient_id : msg.sender_id;
  const list = conversations || [];
  const cur = list.find(c => c.friendId === partner);
  if (cur && cur.last && String(cur.last.id) === String(msg.id)) return list;
  if (cur && cur.last && ts(cur.last) > ts(msg)) return list;
  if (isTempId(msg.id)) return list;
  const incoming = msg.sender_id !== myId && !msg.read_at && partner !== openId;
  const next = {
    friendId: partner,
    last: { id: msg.id, body: msg.body, sender_id: msg.sender_id, created_at: msg.created_at },
    unread: (cur?.unread || 0) + (incoming ? 1 : 0),
    blockedByMe: !!cur?.blockedByMe,
  };
  return [next, ...list.filter(c => c.friendId !== partner)];
}

export function clearUnread(conversations, partner) {
  let hit = false;
  const out = (conversations || []).map(c => {
    if (c.friendId !== partner || !c.unread) return c;
    hit = true;
    return { ...c, unread: 0 };
  });
  return hit ? out : conversations;
}

