import { supabase } from '../supabase';

/**
 * Direct-message data layer. 1:1 messaging between accepted friends;
 * RLS (see supabase/messages_schema.sql) enforces that you can only
 * read your own conversations and only send to accepted friends.
 *
 * Delivery is poll-based while a thread is open (simple, reliable, and
 * doesn't depend on the Realtime publication being enabled). Realtime
 * is a drop-in upgrade later.
 */

const SELECT = 'id, sender_id, recipient_id, body, created_at, read_at';

function mapError(err, fallback = 'Something went wrong.') {
  const m = err?.message || '';
  // The friend-only INSERT policy rejects non-friends with an RLS
  // violation — translate it into something actionable.
  if (/row-level security/i.test(m)) return 'You can only message friends.';
  if (/does not exist|relation .* does not exist/i.test(m)) return 'Messaging isn\'t set up on this server yet.';
  return m || fallback;
}

/** Full thread between the current user and one friend, oldest→newest. */
export async function listThread(userId, friendId, limit = 200) {
  const { data, error } = await supabase
    .from('messages')
    .select(SELECT)
    .or(`and(sender_id.eq.${userId},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${userId})`)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(mapError(error, 'Could not load messages.'));
  return data || [];
}

/** Send a message. Returns the inserted row (for optimistic append). */
export async function sendMessage(fromId, toId, body) {
  const text = (body || '').trim();
  if (!text) return null;
  const { data, error } = await supabase
    .from('messages')
    .insert({ sender_id: fromId, recipient_id: toId, body: text.slice(0, 2000) })
    .select(SELECT)
    .single();
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

/** Delete a message you sent (unsend). */
export async function unsendMessage(messageId) {
  const { error } = await supabase.from('messages').delete().eq('id', messageId);
  if (error) throw new Error(mapError(error, 'Could not unsend.'));
}
