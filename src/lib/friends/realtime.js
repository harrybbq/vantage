import { supabase } from '../supabase';
import { createDMRealtime, FALLBACK_POLL_MS, LIVE_POLL_MS } from './dmRealtimeCore.js';
import { typingTopic } from './dmModel.js';
import { listNewer, getSeenUpTo } from './messages.js';

/**
 * Live DMs. See dmRealtimeCore.js for the channel layout and states.
 *
 *   const off = subscribeDMs(me, { onMessage, onUpdate, onDelete, onReaction, onStatus });
 *   off.getState();   // 'idle' | 'connecting' | 'live' | 'fallback'
 *   off();
 *
 * Until supabase/dm_upgrade_2026_10.sql adds the tables to the
 * supabase_realtime publication, the channel cannot deliver and the state
 * settles on 'fallback' — pollThread() then fetches only rows newer than
 * the newest one on screen, every FALLBACK_POLL_MS.
 */

const hub = createDMRealtime(supabase);

export { FALLBACK_POLL_MS, LIVE_POLL_MS };

export function subscribeDMs(userId, handlers) {
  return hub.subscribeDMs(userId, handlers);
}

export function getRealtimeState() {
  return hub.getState();
}

export function onRealtimeState(fn) {
  return hub.onState(fn);
}

/**
 * Keep one open thread current without Realtime, or as a safety net
 * beside it. `getAfter()` returns the created_at of the newest real
 * message on screen (newestReal(list)?.created_at). `onRows(rows)` gets
 * the new rows (merge them with mergeMessages — repeats are expected);
 * `onSeen(row)` gets my newest read message so "Seen" updates too.
 * Returns stop().
 */
export function pollThread(userId, friendId, { getAfter, onRows, onSeen } = {}) {
  if (!userId || !friendId) return () => {};
  return hub.createPoller(async () => {
    const after = typeof getAfter === 'function' ? getAfter() : null;
    try {
      const rows = await listNewer(userId, friendId, after);
      if (rows.length) onRows?.(rows);
    } catch { /* next tick */ }
    if (onSeen) {
      const seen = await getSeenUpTo(userId, friendId);
      if (seen) onSeen(seen);
    }
  });
}

/**
 * Typing indicator over a PRIVATE broadcast channel, authorised by the
 * realtime.messages policies in dm_upgrade_2026_10.sql (only the two
 * friends can join). Returns { sendTyping(), leave(), isAvailable() };
 * a no-op until the SQL is run.
 */
export function joinTyping(userId, friendId, onTyping) {
  return hub.joinTyping(userId, friendId, typingTopic(userId, friendId), onTyping);
}
