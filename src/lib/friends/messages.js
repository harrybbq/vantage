// STUB — replaced by the data agent's version at merge
import { supabase } from '../supabase';
import {
  MAX_BODY, PAGE_SIZE, groupConversations, mapConversationRows, groupReactions,
  normalizeEmoji, isNotConfigured,
} from './dmModel.js';

/**
 * Direct-message data layer — UI-side stub with the data agent's exports
 * and result shapes (see their messages.js for the real behaviour).
 */

const BASE = 'id, sender_id, recipient_id, body, created_at, read_at';
let replyCol = true;
const cols = () => (replyCol ? `${BASE}, reply_to` : BASE);

function mapError(err, fallback = 'Something went wrong.') {
  const m = err?.message || '';
  if (/row-level security/i.test(m)) return 'You can only message friends.';
  if (/does not exist|relation .* does not exist/i.test(m)) return 'Messaging isn\'t set up on this server yet.';
  return m || fallback;
}
const missingReplyCol = e => replyCol && isNotConfigured(e) && /reply_to/.test(e?.message || '');
async function selectWithFallback(build) {
  let res = await build(cols());
  if (res.error && missingReplyCol(res.error)) { replyCol = false; res = await build(cols()); }
  return res;
}
const q = v => `"${String(v).replace(/"/g, '')}"`;
function pairFilter(a, b, extra = '') {
  const x = extra ? `,${extra}` : '';
  return `and(sender_id.eq.${a},recipient_id.eq.${b}${x}),and(sender_id.eq.${b},recipient_id.eq.${a}${x})`;
}

/** One page, oldest→newest; `rows.hasMore` when a full page came back.
 *  `before` may be a message row or an ISO timestamp. */
export async function listThread(userId, friendId, opts = {}) {
  const { before = null, limit = PAGE_SIZE } = typeof opts === 'number' ? { limit: opts } : (opts || {});
  const n = Math.max(1, Math.min(200, limit | 0 || PAGE_SIZE));
  const at = before && typeof before === 'object' ? before.created_at : before;
  const extra = at ? `created_at.lt.${q(at)}` : '';
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

/** Rows at or after `afterIso`, oldest→newest. */
export async function listNewer(userId, friendId, afterIso, limit = 100) {
  const { data, error } = await selectWithFallback((c) => {
    let req = supabase.from('messages').select(c).or(pairFilter(userId, friendId));
    if (afterIso) req = req.gte('created_at', afterIso);
    return req.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
  });
  if (error) throw new Error(mapError(error, 'Could not load messages.'));
  return data || [];
}

export async function getMessagesByIds(ids) {
  const list = [...new Set((ids || []).filter(x => x != null && Number.isFinite(Number(x))))].slice(0, 100);
  if (!list.length) return [];
  const { data, error } = await selectWithFallback(c => supabase.from('messages').select(c).in('id', list));
  return error ? [] : (data || []);
}

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

/** [{ friendId, last, unread, blockedByMe }] newest first. */
export async function listConversations(userId) {
  if (!userId) return [];
  const rpc = await supabase.rpc('dm_conversations');
  if (!rpc.error) return mapConversationRows(rpc.data);
  const [recent, unread] = await Promise.all([
    supabase.from('messages').select(BASE)
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order('created_at', { ascending: false }).limit(300),
    supabase.from('messages').select(BASE)
      .eq('recipient_id', userId).is('read_at', null)
      .order('created_at', { ascending: false }).limit(500),
  ]);
  if (recent.error) throw new Error(mapError(recent.error, 'Could not load conversations.'));
  return groupConversations(recent.data || [], unread.error ? [] : (unread.data || []), userId);
}

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

export async function markThreadRead(userId, friendId) {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .eq('sender_id', friendId)
    .is('read_at', null);
  if (error) throw new Error(mapError(error, 'Could not update messages.'));
}

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

export async function unsendMessage(messageId) {
  const { error } = await supabase.from('messages').delete().eq('id', messageId);
  if (error) throw new Error(mapError(error, 'Could not unsend.'));
}

async function currentUserId() {
  try { const { data } = await supabase.auth.getSession(); return data?.session?.user?.id || null; } catch { return null; }
}

/** { ok: true, row } | { ok: false, reason } — never throws. */
export async function react(messageId, emoji) {
  const e = normalizeEmoji(emoji);
  if (!e) return { ok: false, reason: 'invalid_emoji' };
  const uid = await currentUserId();
  if (!uid) return { ok: false, reason: 'signed_out' };
  const { data, error } = await supabase.from('message_reactions')
    .insert({ message_id: messageId, user_id: uid, emoji: e })
    .select('id, message_id, user_id, emoji, created_at').single();
  if (!error) return { ok: true, row: data };
  if (error.code === '23505') return { ok: true, row: null };
  if (isNotConfigured(error)) return { ok: false, reason: 'not_configured' };
  return { ok: false, reason: 'error', message: mapError(error, 'Could not react.') };
}

export async function unreact(messageId, emoji) {
  const e = normalizeEmoji(emoji);
  if (!e) return { ok: false, reason: 'invalid_emoji' };
  const uid = await currentUserId();
  if (!uid) return { ok: false, reason: 'signed_out' };
  const { error } = await supabase.from('message_reactions').delete()
    .eq('message_id', messageId).eq('user_id', uid).eq('emoji', e);
  if (!error) return { ok: true };
  if (isNotConfigured(error)) return { ok: false, reason: 'not_configured' };
  return { ok: false, reason: 'error', message: mapError(error, 'Could not remove the reaction.') };
}

/** { [messageId]: rows[] } — fails soft to {}. */
export async function listReactions(messageIds) {
  const ids = [...new Set((messageIds || []).filter(x => x != null && Number.isFinite(Number(x))))];
  if (!ids.length) return {};
  const { data, error } = await supabase.from('message_reactions')
    .select('id, message_id, user_id, emoji, created_at').in('message_id', ids.slice(0, 500));
  if (error) return {};
  return groupReactions(data || []);
}
