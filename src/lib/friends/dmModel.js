/**
 * Pure DM model — no Supabase import, so node tests can load it.
 *
 * Everything here is about keeping ONE list of messages correct while
 * rows arrive from four places at once: the first page, "Load earlier",
 * the live Realtime feed and the fallback poll — plus the optimistic
 * bubble the composer adds before the server has answered. The rule is
 * simple: a message is its server id; a pending bubble is replaced by
 * the server row that matches it, never shown next to it.
 */

export const MAX_BODY = 2000;
export const PAGE_SIZE = 50;

/** The six reactions the server accepts (message_reactions_emoji_check).
 *  ❤️ is U+2764 U+FE0F — the bare U+2764 is normalised to it. */
export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export function normalizeEmoji(e) {
  if (e === '❤') return '❤️';
  return REACTION_EMOJI.includes(e) ? e : null;
}

// ── Time + ordering ─────────────────────────────────────────────────────

/**
 * Milliseconds for a Postgres timestamp string. PostgREST and Realtime
 * both send microseconds ("…:05.123456+00:00"); JS dates keep three
 * digits, and a string without an offset would otherwise parse as LOCAL
 * time, so both are normalised first.
 */
export function ts(iso) {
  if (iso == null) return NaN;
  if (typeof iso === 'number') return iso;
  let s = String(iso).trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  if (/T.*[+-]\d{2}$/.test(s)) s += ':00';                       // "+00" → "+00:00"
  else s = s.replace(/(T.*[+-]\d{2})(\d{2})$/, '$1:$2');          // "+0100" → "+01:00"
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(s)) s += 'Z';
  return Date.parse(s);
}

function idNum(id) {
  const n = typeof id === 'number' ? id : Number(id);
  return Number.isFinite(n) ? n : Infinity; // temp ids sort after real ones
}

/** Oldest → newest; ties broken by id (server ids are a sequence). */
export function compareMessages(a, b) {
  const d = ts(a.created_at) - ts(b.created_at);
  if (d) return d;
  return idNum(a.id) - idNum(b.id);
}

export function isTempId(id) {
  return typeof id === 'string' && id.startsWith('tmp-');
}

// ── Merging ─────────────────────────────────────────────────────────────

/** A pending bubble for the composer. `_key` stays stable when the server
 *  row replaces it, so React keeps the same element. */
export function makeOptimistic({ selfId, friendId, body, replyTo = null, now = Date.now() }) {
  const id = `tmp-${now}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id, _key: id, _pending: true,
    sender_id: selfId, recipient_id: friendId,
    body: String(body || '').slice(0, MAX_BODY),
    reply_to: replyTo ?? null,
    created_at: new Date(now).toISOString(),
    read_at: null,
  };
}

/**
 * Merge `incoming` server rows into `list`. Idempotent — the same row
 * arriving from the poll, the live feed and the send response appears
 * once. An own message whose body matches a pending bubble replaces that
 * bubble (the live feed can beat the insert response). Returns a new
 * array, or the SAME array when nothing changed so callers can skip a
 * re-render.
 */
export function mergeMessages(list, incoming, { selfId } = {}) {
  const rows = (Array.isArray(incoming) ? incoming : [incoming]).filter(r => r && r.id != null);
  if (!rows.length) return list || [];
  const out = (list || []).slice();
  const at = new Map(out.map((m, i) => [String(m.id), i]));
  let changed = false;
  for (const r of rows) {
    const k = String(r.id);
    if (at.has(k)) {
      const i = at.get(k);
      const cur = out[i];
      if (!sameRow(cur, r)) { out[i] = { ...cur, ...r }; changed = true; }
      continue;
    }
    if (!isTempId(r.id) && selfId && r.sender_id === selfId) {
      const ti = out.findIndex(m => m._pending && !m._failed
        && m.recipient_id === r.recipient_id && m.body === r.body);
      if (ti !== -1) {
        at.delete(String(out[ti].id));
        out[ti] = { ...r, _key: out[ti]._key || out[ti].id };
        at.set(k, ti);
        changed = true;
        continue;
      }
    }
    at.set(k, out.length);
    out.push(r);
    changed = true;
  }
  if (!changed) return list;
  out.sort(compareMessages);
  return out;
}

function sameRow(a, b) {
  for (const key of Object.keys(b)) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/** The insert returned: swap the bubble for the row, unless the live
 *  feed already delivered that row (then just drop the bubble). */
export function confirmSent(list, tempId, saved) {
  if (!saved || saved.id == null) return list;
  const has = list.some(m => String(m.id) === String(saved.id));
  if (has) return list.filter(m => m.id !== tempId);
  let found = false;
  const out = list.map(m => {
    if (m.id !== tempId) return m;
    found = true;
    return { ...saved, _key: m._key || m.id };
  });
  return found ? out.sort(compareMessages) : mergeMessages(list, [saved]);
}

export function markFailed(list, tempId, error) {
  return list.map(m => (m.id === tempId ? { ...m, _pending: false, _failed: true, _error: error || null } : m));
}

export function removeMessage(list, id) {
  const k = String(id);
  const out = list.filter(m => String(m.id) !== k);
  return out.length === list.length ? list : out;
}

/** Cursors for paging: the oldest REAL row (for "Load earlier") and the
 *  newest real row (for the poll). Pending bubbles are ignored. */
export function oldestReal(list) {
  return (list || []).find(m => !isTempId(m.id)) || null;
}
export function newestReal(list) {
  const l = list || [];
  for (let i = l.length - 1; i >= 0; i--) if (!isTempId(l[i].id)) return l[i];
  return null;
}

// ── Seen ────────────────────────────────────────────────────────────────

/** The id of my newest message the friend has read — where "Seen" goes.
 *  Only shown when it is ALSO my newest message overall. */
export function seenMessageId(list, selfId) {
  const mine = (list || []).filter(m => m.sender_id === selfId && !isTempId(m.id));
  const last = mine[mine.length - 1];
  return last && last.read_at ? last.id : null;
}

/**
 * The poll's answer to "has the friend read my messages?" — my newest
 * READ message ({ id, created_at, read_at }). Every message of mine up to
 * it is read too (markThreadRead marks a whole thread at once).
 */
export function applySeen(list, seen, selfId) {
  if (!seen || !seen.read_at) return list;
  let changed = false;
  const out = (list || []).map(m => {
    if (m.sender_id !== selfId || m.read_at || isTempId(m.id)) return m;
    if (compareMessages(m, seen) > 0) return m;
    changed = true;
    return { ...m, read_at: seen.read_at };
  });
  return changed ? out : list;
}

// ── Replies ─────────────────────────────────────────────────────────────

/**
 * id → the quoted message's preview for every message with reply_to.
 * `extra` holds rows fetched separately for quotes older than the loaded
 * page. A quoted message that was unsent resolves to { missing: true }.
 */
export function resolveReplies(list, extra = []) {
  const byId = new Map();
  for (const m of [...(extra || []), ...(list || [])]) if (m && m.id != null) byId.set(String(m.id), m);
  const out = {};
  for (const m of list || []) {
    if (m.reply_to == null) continue;
    const q = byId.get(String(m.reply_to));
    out[m.id] = q
      ? { id: q.id, sender_id: q.sender_id, body: snippet(q.body), missing: false }
      : { id: m.reply_to, sender_id: null, body: '', missing: true };
  }
  return out;
}

/** reply_to ids that aren't in the loaded list (to fetch once). */
export function missingReplyIds(list, extra = []) {
  const have = new Set([...(list || []), ...(extra || [])].map(m => String(m.id)));
  const want = new Set();
  for (const m of list || []) {
    if (m.reply_to != null && !have.has(String(m.reply_to))) want.add(m.reply_to);
  }
  return [...want];
}

export function snippet(body, n = 90) {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ── Reactions ───────────────────────────────────────────────────────────

/** Raw reaction rows → { [messageId]: rows[] }. */
export function groupReactions(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!r || r.message_id == null) continue;
    (out[r.message_id] ||= []).push(r);
  }
  return out;
}

/** One message's rows → [{ emoji, count, mine }] in the fixed order,
 *  only emoji with at least one reaction. */
export function summarizeReactions(rows, selfId) {
  const counts = new Map();
  for (const r of rows || []) {
    const e = normalizeEmoji(r.emoji);
    if (!e) continue;
    const c = counts.get(e) || { emoji: e, count: 0, mine: false };
    c.count += 1;
    if (r.user_id === selfId) c.mine = true;
    counts.set(e, c);
  }
  return REACTION_EMOJI.filter(e => counts.has(e)).map(e => counts.get(e));
}

/**
 * Apply one change to a grouped map. INSERT carries the row; DELETE
 * carries only { id } (Realtime sends just the primary key) — or, for an
 * optimistic toggle, { message_id, user_id, emoji }.
 */
export function applyReactionChange(map, change) {
  const cur = map || {};
  if (!change) return cur;
  if (change.type === 'INSERT') {
    const r = change.row;
    if (!r || r.message_id == null) return cur;
    const arr = cur[r.message_id] || [];
    const dup = arr.some(x => (r.id != null && x.id === r.id)
      || (x.user_id === r.user_id && x.emoji === r.emoji));
    if (dup) {
      // A real row replacing an optimistic one (no id yet) — take the id.
      if (r.id != null && arr.some(x => x.id == null && x.user_id === r.user_id && x.emoji === r.emoji)) {
        return { ...cur, [r.message_id]: arr.map(x => (x.id == null && x.user_id === r.user_id && x.emoji === r.emoji ? r : x)) };
      }
      return cur;
    }
    return { ...cur, [r.message_id]: [...arr, r] };
  }
  if (change.type === 'DELETE') {
    const r = change.row || {};
    for (const [mid, arr] of Object.entries(cur)) {
      const next = arr.filter(x => !(
        (r.id != null && x.id === r.id)
        || (r.id == null && String(r.message_id) === mid && x.user_id === r.user_id && x.emoji === r.emoji)
      ));
      if (next.length !== arr.length) {
        const out = { ...cur };
        if (next.length) out[mid] = next; else delete out[mid];
        return out;
      }
    }
    return cur;
  }
  return cur;
}

// ── Conversations (fallback grouping) ───────────────────────────────────

/**
 * Inbox rows from plain queries, used until dm_conversations() exists.
 * `recent` = my newest messages (both directions, any order); `unread` =
 * rows sent TO me with read_at null. Unread counts come from `unread`
 * (exact), and a partner whose only messages are older than the recent
 * window still appears via their newest unread row.
 */
export function groupConversations(recent, unread, selfId) {
  const byFriend = new Map();
  const consider = (m) => {
    if (!m || m.id == null) return;
    const friendId = m.sender_id === selfId ? m.recipient_id : m.sender_id;
    if (!friendId || friendId === selfId) return;
    const cur = byFriend.get(friendId);
    if (!cur || compareMessages(m, cur.last) > 0) {
      byFriend.set(friendId, {
        friendId,
        last: { id: m.id, body: m.body, sender_id: m.sender_id, created_at: m.created_at },
        unread: cur ? cur.unread : 0,
      });
    }
  };
  for (const m of recent || []) consider(m);
  for (const m of unread || []) consider(m);
  const seen = new Set();
  for (const m of unread || []) {
    if (!m || m.recipient_id !== selfId || m.read_at || seen.has(String(m.id))) continue;
    seen.add(String(m.id));
    const c = byFriend.get(m.sender_id);
    if (c) c.unread += 1;
  }
  return [...byFriend.values()].sort((a, b) => compareMessages(b.last, a.last));
}

/** RPC rows → the same shape as groupConversations. */
export function mapConversationRows(rows) {
  return (rows || []).filter(r => r && r.partner_id).map(r => ({
    friendId: r.partner_id,
    last: r.last_id == null ? null : {
      id: r.last_id, body: r.last_body, sender_id: r.last_sender_id, created_at: r.last_created_at,
    },
    unread: Number(r.unread) || 0,
    blockedByMe: !!r.blocked_by_me,
  }));
}

export function totalUnread(conversations) {
  return (conversations || []).reduce((n, c) => n + (c.blockedByMe ? 0 : (c.unread || 0)), 0);
}

// ── Invites ─────────────────────────────────────────────────────────────

export const INVITE_CODE_RE = /^[A-Za-z0-9_-]{10,64}$/;

export function isValidInviteCode(code) {
  return typeof code === 'string' && INVITE_CODE_RE.test(code);
}

export function inviteUrl(code, origin) {
  if (!isValidInviteCode(code)) return null;
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/invite/${code}`;
}

/** '/invite/<code>' (optionally with a trailing slash, query or hash) →
 *  the code, or null. */
export function parseInvitePath(pathname) {
  const m = /^\/invite\/([^/?#]+)\/?$/.exec(String(pathname || '').split(/[?#]/)[0]);
  if (!m) return null;
  let code;
  try { code = decodeURIComponent(m[1]); } catch { return null; }
  return isValidInviteCode(code) ? code : null;
}

// ── Typing ──────────────────────────────────────────────────────────────

/** Private channel topic — ids in ascending text order, matching
 *  public.dm_typing_topic_ok() in supabase/dm_upgrade_2026_10.sql. */
export function typingTopic(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (!x || !y || x === y) return null;
  return x < y ? `dm-typing:${x}:${y}` : `dm-typing:${y}:${x}`;
}

// ── Errors ──────────────────────────────────────────────────────────────

/** True when an error means "the SQL for this hasn't been run yet". */
export function isNotConfigured(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (['PGRST202', 'PGRST205', 'PGRST204', '42883', '42P01', '42703'].includes(code)) return true;
  if (error.status === 404) return true;
  const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return /could not find the (function|table)|does not exist|schema cache/i.test(text);
}
