// STUB — replaced by the data agent's version at merge
/**
 * Pure DM model — UI-side stub with the data agent's exports and shapes
 * (see their dmModel.js). Compact implementations, enough to drive the
 * screens and the harness; the real file owns the details and the tests.
 */

export const MAX_BODY = 2000;
export const PAGE_SIZE = 50;
export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export function normalizeEmoji(e) {
  if (e === '❤') return '❤️';
  return REACTION_EMOJI.includes(e) ? e : null;
}

export function ts(iso) {
  if (iso == null) return NaN;
  if (typeof iso === 'number') return iso;
  return Date.parse(iso);
}

const idNum = id => { const n = typeof id === 'number' ? id : Number(id); return Number.isFinite(n) ? n : Infinity; };
export function compareMessages(a, b) {
  return (ts(a.created_at) - ts(b.created_at)) || (idNum(a.id) - idNum(b.id));
}
export const isTempId = id => typeof id === 'string' && id.startsWith('tmp-');

export function makeOptimistic({ selfId, friendId, body, replyTo = null, now = Date.now() }) {
  const id = `tmp-${now}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id, _key: id, _pending: true, sender_id: selfId, recipient_id: friendId,
    body: String(body || '').slice(0, MAX_BODY), reply_to: replyTo ?? null,
    created_at: new Date(now).toISOString(), read_at: null,
  };
}

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
      if (Object.keys(r).some(key => out[i][key] !== r[key])) { out[i] = { ...out[i], ...r }; changed = true; }
      continue;
    }
    if (!isTempId(r.id) && selfId && r.sender_id === selfId) {
      const ti = out.findIndex(m => m._pending && !m._failed && m.recipient_id === r.recipient_id && m.body === r.body);
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
  return out.sort(compareMessages);
}

export function confirmSent(list, tempId, saved) {
  if (!saved || saved.id == null) return list;
  if (list.some(m => String(m.id) === String(saved.id))) return list.filter(m => m.id !== tempId);
  let found = false;
  const out = list.map(m => { if (m.id !== tempId) return m; found = true; return { ...saved, _key: m._key || m.id }; });
  return found ? out.sort(compareMessages) : mergeMessages(list, [saved]);
}

export function markFailed(list, tempId, error) {
  return list.map(m => (m.id === tempId ? { ...m, _pending: false, _failed: true, _error: error || null } : m));
}

export function removeMessage(list, id) {
  const out = list.filter(m => String(m.id) !== String(id));
  return out.length === list.length ? list : out;
}

export const oldestReal = list => (list || []).find(m => !isTempId(m.id)) || null;
export function newestReal(list) {
  const l = list || [];
  for (let i = l.length - 1; i >= 0; i--) if (!isTempId(l[i].id)) return l[i];
  return null;
}

export function seenMessageId(list, selfId) {
  const mine = (list || []).filter(m => m.sender_id === selfId && !isTempId(m.id));
  const last = mine[mine.length - 1];
  return last && last.read_at ? last.id : null;
}

export function applySeen(list, seen, selfId) {
  if (!seen || !seen.read_at) return list;
  let changed = false;
  const out = (list || []).map(m => {
    if (m.sender_id !== selfId || m.read_at || isTempId(m.id) || compareMessages(m, seen) > 0) return m;
    changed = true;
    return { ...m, read_at: seen.read_at };
  });
  return changed ? out : list;
}

export function snippet(body, n = 90) {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function resolveReplies(list, extra = []) {
  const byId = new Map();
  for (const m of [...(extra || []), ...(list || [])]) if (m && m.id != null) byId.set(String(m.id), m);
  const out = {};
  for (const m of list || []) {
    if (m.reply_to == null) continue;
    const q = byId.get(String(m.reply_to));
    out[m.id] = q ? { id: q.id, sender_id: q.sender_id, body: snippet(q.body), missing: false }
      : { id: m.reply_to, sender_id: null, body: '', missing: true };
  }
  return out;
}

export function missingReplyIds(list, extra = []) {
  const have = new Set([...(list || []), ...(extra || [])].map(m => String(m.id)));
  const want = new Set();
  for (const m of list || []) if (m.reply_to != null && !have.has(String(m.reply_to))) want.add(m.reply_to);
  return [...want];
}

export function groupReactions(rows) {
  const out = {};
  for (const r of rows || []) if (r && r.message_id != null) (out[r.message_id] ||= []).push(r);
  return out;
}

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

export function applyReactionChange(map, change) {
  const cur = map || {};
  if (!change) return cur;
  const r = change.row || {};
  if (change.type === 'INSERT') {
    if (r.message_id == null) return cur;
    const arr = cur[r.message_id] || [];
    const same = x => (r.id != null && x.id === r.id) || (x.user_id === r.user_id && x.emoji === r.emoji);
    if (arr.some(same)) {
      if (r.id != null && arr.some(x => x.id == null && x.user_id === r.user_id && x.emoji === r.emoji)) {
        return { ...cur, [r.message_id]: arr.map(x => (x.id == null && x.user_id === r.user_id && x.emoji === r.emoji ? r : x)) };
      }
      return cur;
    }
    return { ...cur, [r.message_id]: [...arr, r] };
  }
  if (change.type === 'DELETE') {
    for (const [mid, arr] of Object.entries(cur)) {
      const next = arr.filter(x => !((r.id != null && x.id === r.id)
        || (r.id == null && String(r.message_id) === mid && x.user_id === r.user_id && x.emoji === r.emoji)));
      if (next.length !== arr.length) {
        const out = { ...cur };
        if (next.length) out[mid] = next; else delete out[mid];
        return out;
      }
    }
  }
  return cur;
}

export function groupConversations(recent, unread, selfId) {
  const by = new Map();
  for (const m of [...(recent || []), ...(unread || [])]) {
    if (!m || m.id == null) continue;
    const friendId = m.sender_id === selfId ? m.recipient_id : m.sender_id;
    const cur = by.get(friendId);
    if (!cur || compareMessages(m, cur.last) > 0) {
      by.set(friendId, { friendId, last: { id: m.id, body: m.body, sender_id: m.sender_id, created_at: m.created_at }, unread: cur ? cur.unread : 0 });
    }
  }
  const seen = new Set();
  for (const m of unread || []) {
    if (!m || m.recipient_id !== selfId || m.read_at || seen.has(String(m.id))) continue;
    seen.add(String(m.id));
    const c = by.get(m.sender_id);
    if (c) c.unread += 1;
  }
  return [...by.values()].sort((a, b) => compareMessages(b.last, a.last));
}

export function mapConversationRows(rows) {
  return (rows || []).filter(r => r && r.partner_id).map(r => ({
    friendId: r.partner_id,
    last: r.last_id == null ? null : { id: r.last_id, body: r.last_body, sender_id: r.last_sender_id, created_at: r.last_created_at },
    unread: Number(r.unread) || 0,
    blockedByMe: !!r.blocked_by_me,
  }));
}

export function totalUnread(conversations) {
  return (conversations || []).reduce((n, c) => n + (c.blockedByMe ? 0 : (c.unread || 0)), 0);
}

export const INVITE_CODE_RE = /^[A-Za-z0-9_-]{10,64}$/;
export const isValidInviteCode = code => typeof code === 'string' && INVITE_CODE_RE.test(code);
export function inviteUrl(code, origin) {
  if (!isValidInviteCode(code)) return null;
  return `${String(origin || '').replace(/\/+$/, '')}/invite/${code}`;
}
export function parseInvitePath(pathname) {
  const m = /^\/invite\/([^/?#]+)\/?$/.exec(String(pathname || '').split(/[?#]/)[0]);
  if (!m) return null;
  let code;
  try { code = decodeURIComponent(m[1]); } catch { return null; }
  return isValidInviteCode(code) ? code : null;
}

export function typingTopic(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (!x || !y || x === y) return null;
  return x < y ? `dm-typing:${x}:${y}` : `dm-typing:${y}:${x}`;
}

export function isNotConfigured(error) {
  if (!error) return false;
  if (['PGRST202', 'PGRST205', 'PGRST204', '42883', '42P01', '42703'].includes(String(error.code || ''))) return true;
  return /could not find the (function|table)|does not exist|schema cache/i.test(`${error.message || ''} ${error.details || ''}`);
}
