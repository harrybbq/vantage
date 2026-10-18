import { supabase } from '../supabase';
import {
  MAX_BODY, PAGE_SIZE, groupConversations, mapConversationRows, groupReactions,
  normalizeEmoji, isNotConfigured,
} from './dmModel.js';

/**
 * Direct-message data layer. 1:1 messaging between accepted friends;
 * RLS (supabase/messages_schema.sql + dm_upgrade_2026_10.sql) enforces
 * that you can only read your own conversations and only send to
 * accepted friends you haven't blocked.
 *
 * Reads are paged (50 at a time) and incremental: a thread loads its
 * newest page, "Load earlier" walks back, and new rows arrive from the
 * Realtime feed (./realtime.js) or, when that can't connect, from
 * listNewer() — never by re-fetching the whole thread.
 *
 * Everything that depends on dm_upgrade_2026_10.sql (reply_to, reactions,
 * the inbox RPC) fails soft until the owner has run it.
 */

const BASE = 'id, sender_id, recipient_id, body, created_at, read_at';
// reply_to arrives with dm_upgrade_2026_10.sql. Until then PostgREST
// refuses a select naming it, so we learn once and stop asking.
let replyCol = true;
const cols = () => (replyCol ? `${BASE}, reply_to` : BASE);

function mapError(err, fallback = 'Something went wrong.') {
  const m = err?.message || '';
  // The friend-only INSERT policy rejects non-friends with an RLS
  // violation — translate it into something actionable.
  if (/row-level security/i.test(m)) return 'You can only message friends.';
  if (/does not exist|relation .* does not exist/i.test(m)) return 'Messaging isn\'t set up on this server yet.';
  return m || fallback;
}

function missingReplyCol(error) {
  return replyCol && isNotConfigured(error) && /reply_to/.test(`${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`);
}

/** Run a select built by `build(columns)`, retrying once without
 *  reply_to if the column isn't there yet. */
async function selectWithFallback(build) {
  let res = await build(cols());
  if (res.error && missingReplyCol(res.error)) {
    replyCol = false;
    res = await build(cols());
  }
  return res;
}

/**
 * Both directions of a conversation as ONE PostgREST `or` filter, with an
 * optional extra condition repeated inside each branch (a second `or=`
 * parameter is not a documented PostgREST combination, so everything goes
 * in one). Timestamps are double-quoted: they contain `.` and `:`, which
 * are reserved inside logical filters.
 */
const q = v => `"${String(v).replace(/"/g, '')}"`;
function pairFilter(a, b, extra = '') {
  const x = extra ? `,${extra}` : '';
  return `and(sender_id.eq.${a},recipient_id.eq.${b}${x}),and(sender_id.eq.${b},recipient_id.eq.${a}${x})`;
}

/**
 * One page of a thread, oldest→newest.
 *
 *   listThread(me, friend)                       newest 50
 *   listThread(me, friend, { before: msg })      the 50 before that message
 *   listThread(me, friend, { before: iso })      the 50 before that time
 *
 * `before` as a message row pages on (created_at, id), so two messages
 * with the same timestamp can't be skipped at a page boundary. A bare
 * number as the third argument is the old `limit` parameter.
 *
 * Returns the rows; `rows.hasMore` is true when a full page came back.
 */
export async function listThread(userId, friendId, opts = {}) {
  const { before = null, limit = PAGE_SIZE } = typeof opts === 'number' ? { limit: opts } : (opts || {});
  const n = Math.max(1, Math.min(200, limit | 0 || PAGE_SIZE));
  let extra = '';
  if (before && typeof before === 'object' && before.created_at) {
    extra = before.id != null && Number.isFinite(Number(before.id))
      ? `or(created_at.lt.${q(before.created_at)},and(created_at.eq.${q(before.created_at)},id.lt.${Number(before.id)}))`
      : `created_at.lt.${q(before.created_at)}`;
  } else if (typeof before === 'string' && before) {
    extra = `created_at.lt.${q(before)}`;
  }
  const { data, error } = await selectWithFallback(c => supabase
    .from('messages').select(c)
    .or(pairFilter(userId, friendId, extra))
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(n));
  if (error) throw new Error(mapError(error, 'Could not load messages.'));
  const rows = (data || []).slice().reverse();
  rows.hasMore = (data || []).length === n;
  return rows;
}

/**
 * Rows at or after `afterIso`, oldest→newest — the polling fallback and
 * the catch-up after a reconnect. `gte`, not `gt`: a row sharing the
 * cursor's timestamp must not be lost; mergeMessages() drops the repeat.
 */
export async function listNewer(userId, friendId, afterIso, limit = 100) {
  const { data, error } = await selectWithFallback((c) => {
    let req = supabase.from('messages').select(c).or(pairFilter(userId, friendId));
    if (afterIso) req = req.gte('created_at', afterIso);
    return req.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
  });
  if (error) throw new Error(mapError(error, 'Could not load messages.'));
  return data || [];
}

/** Specific messages by id (quoted messages older than the loaded page).
 *  RLS returns only ones from your own conversations. */
export async function getMessagesByIds(ids) {
  const list = [...new Set((ids || []).filter(x => x != null && Number.isFinite(Number(x))))].slice(0, 100);
  if (!list.length) return [];
  const { data, error } = await selectWithFallback(c => supabase.from('messages').select(c).in('id', list));
  if (error) return [];
  return data || [];
}

/** Has the friend read my newest message? Returns { id, read_at } of my
 *  newest READ message to them, or null. One indexed row — this is how
 *  the polling fallback learns about "Seen" without Realtime. */
export async function getSeenUpTo(userId, friendId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, created_at, read_at')
    .eq('sender_id', userId)
    .eq('recipient_id', friendId)
    .not('read_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] || null;
}

/**
 * The inbox: [{ friendId, last: { id, body, sender_id, created_at },
 * unread, blockedByMe }] newest first. Uses dm_conversations(); until
 * that exists, groups the newest 300 messages plus every unread row
 * (both bounded) on the client.
 */
export async function listConversations(userId) {
  if (!userId) return [];
  const rpc = await supabase.rpc('dm_conversations');
  if (!rpc.error) return mapConversationRows(rpc.data);

  const [recent, unread] = await Promise.all([
    supabase.from('messages')
      .select(BASE)
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(300),
    supabase.from('messages')
      .select(BASE)
      .eq('recipient_id', userId)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  if (recent.error) throw new Error(mapError(recent.error, 'Could not load conversations.'));
  return groupConversations(recent.data || [], unread.error ? [] : (unread.data || []), userId);
}

/**
 * Send a message. Returns the inserted row (for optimistic reconcile).
 * `replyTo` (a message id from the same conversation) is dropped
 * silently if the server doesn't have replies yet — the text still goes.
 */
export async function sendMessage(fromId, toId, body, { replyTo = null } = {}) {
  const text = (body || '').trim();
  if (!text) return null;
  const row = { sender_id: fromId, recipient_id: toId, body: text.slice(0, MAX_BODY) };
  const withReply = replyCol && replyTo != null ? { ...row, reply_to: replyTo } : row;
  let { data, error } = await supabase.from('messages').insert(withReply).select(cols()).single();
  if (error && missingReplyCol(error)) {
    replyCol = false;
    ({ data, error } = await supabase.from('messages').insert(row).select(cols()).single());
  }
  if (error) throw new Error(mapError(error, 'Could not send.'));
  return data;
}

/** Mark every message this friend sent me as read. Cheap no-op when
 *  there's nothing unread (the partial index makes it fast). */
export async function markThreadRead(userId, friendId) {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .eq('sender_id', friendId)
    .is('read_at', null);
  if (error) throw new Error(mapError(error, 'Could not update messages.'));
}

/** Map of friendId → unread count for badges. Fails soft (returns {})
 *  if the table isn't there yet, so the friends UI never breaks. */
export async function getUnreadCounts(userId) {
  const { data, error } = await supabase
    .from('messages')
    .select('sender_id')
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (error) return {};
  const counts = {};
  for (const r of data || []) counts[r.sender_id] = (counts[r.sender_id] || 0) + 1;
  return counts;
}

/**
 * Delete a message you sent (unsend). A report filed earlier keeps its
 * evidence: reports_snapshot_messages (dm_upgrade_2026_10.sql) copied the
 * last 10 messages of the pair into reports.reported_snapshot at report
 * time, and the moderation queue reads that copy first.
 */
export async function unsendMessage(messageId) {
  const { error } = await supabase.from('messages').delete().eq('id', messageId);
  if (error) throw new Error(mapError(error, 'Could not unsend.'));
}

// ── Reactions ───────────────────────────────────────────────────────────

async function currentUserId() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * Add a reaction. Never throws: { ok: true, row } | { ok: false, reason }
 * with reason 'not_configured' | 'invalid_emoji' | 'signed_out' |
 * 'error' (+ message). Reacting twice with the same emoji is ok: true.
 */
export async function react(messageId, emoji) {
  const e = normalizeEmoji(emoji);
  if (!e) return { ok: false, reason: 'invalid_emoji' };
  const uid = await currentUserId();
  if (!uid) return { ok: false, reason: 'signed_out' };
  const { data, error } = await supabase
    .from('message_reactions')
    .insert({ message_id: messageId, user_id: uid, emoji: e })
    .select('id, message_id, user_id, emoji, created_at')
    .single();
  if (!error) return { ok: true, row: data };
  if (error.code === '23505') return { ok: true, row: null };
  if (isNotConfigured(error)) return { ok: false, reason: 'not_configured' };
  return { ok: false, reason: 'error', message: mapError(error, 'Could not react.') };
}

/** Remove your reaction. Same result shape as react(). */
export async function unreact(messageId, emoji) {
  const e = normalizeEmoji(emoji);
  if (!e) return { ok: false, reason: 'invalid_emoji' };
  const uid = await currentUserId();
  if (!uid) return { ok: false, reason: 'signed_out' };
  const { error } = await supabase
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', uid)
    .eq('emoji', e);
  if (!error) return { ok: true };
  if (isNotConfigured(error)) return { ok: false, reason: 'not_configured' };
  return { ok: false, reason: 'error', message: mapError(error, 'Could not remove the reaction.') };
}

/**
 * Reactions for a set of messages → { [messageId]: rows[] } (rows:
 * { id, message_id, user_id, emoji, created_at }). Use
 * summarizeReactions(rows, me) from dmModel.js to render. Fails soft to
 * {} — including before the table exists.
 */
export async function listReactions(messageIds) {
  const ids = [...new Set((messageIds || []).filter(x => x != null && Number.isFinite(Number(x))))];
  if (!ids.length) return {};
  const rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from('message_reactions')
      .select('id, message_id, user_id, emoji, created_at')
      .in('message_id', ids.slice(i, i + 100));
    if (error) return {};
    rows.push(...(data || []));
  }
  return groupReactions(rows);
}
