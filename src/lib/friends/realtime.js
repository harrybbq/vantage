// STUB — replaced by the data agent's version at merge
import { supabase } from '../supabase';
import { typingTopic } from './dmModel.js';
import { listNewer, getSeenUpTo } from './messages.js';

/**
 * Live DMs — UI-side stub with the data agent's exports (their real
 * version lives in realtime.js + dmRealtimeCore.js). One shared,
 * ref-counted inbox channel; state 'idle' | 'connecting' | 'live' |
 * 'fallback'; pollThread follows the state (12 s while not live, 60 s
 * safety while live, one catch-up on going live).
 */

export const FALLBACK_POLL_MS = 12_000;
export const LIVE_POLL_MS = 60_000;
const JOIN_TIMEOUT_MS = 10_000;

let channel = null;
let channelUser = null;
let state = 'idle';
let joinTimer = null;
const listeners = new Set();
const stateListeners = new Set();

function setState(next) {
  if (state === next) return;
  state = next;
  for (const fn of [...stateListeners]) { try { fn(state); } catch { /* ignore */ } }
}
function emit(kind, payload) {
  for (const l of [...listeners]) { const fn = l[kind]; if (typeof fn === 'function') { try { fn(payload); } catch { /* ignore */ } } }
}
function teardown() {
  clearTimeout(joinTimer); joinTimer = null;
  if (channel) { try { supabase.removeChannel(channel); } catch { /* gone */ } channel = null; }
  channelUser = null;
}
function open(userId) {
  teardown();
  channelUser = userId;
  setState('connecting');
  try {
    let ch = supabase.channel(`dm-inbox-${Math.random().toString(36).slice(2, 10)}`);
    const pg = (event, table, filter, cb) => { const o = { event, schema: 'public', table }; if (filter) o.filter = filter; ch = ch.on('postgres_changes', o, cb); };
    pg('INSERT', 'messages', `recipient_id=eq.${userId}`, p => emit('onMessage', p.new));
    pg('INSERT', 'messages', `sender_id=eq.${userId}`, p => emit('onMessage', p.new));
    pg('UPDATE', 'messages', `sender_id=eq.${userId}`, p => emit('onUpdate', p.new));
    pg('UPDATE', 'messages', `recipient_id=eq.${userId}`, p => emit('onUpdate', p.new));
    pg('DELETE', 'messages', null, p => { if (p.old?.id != null) emit('onDelete', { id: p.old.id }); });
    pg('INSERT', 'message_reactions', `peer_id=eq.${userId}`, p => emit('onReaction', { type: 'INSERT', row: p.new }));
    pg('INSERT', 'message_reactions', `user_id=eq.${userId}`, p => emit('onReaction', { type: 'INSERT', row: p.new }));
    pg('DELETE', 'message_reactions', null, p => { if (p.old?.id != null) emit('onReaction', { type: 'DELETE', row: { id: p.old.id } }); });
    channel = ch;
    ch.subscribe(status => {
      if (channel !== ch) return;
      if (status === 'SUBSCRIBED') { clearTimeout(joinTimer); setState('live'); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setState('fallback');
    });
  } catch { channel = null; setState('fallback'); return; }
  joinTimer = setTimeout(() => { if (state === 'connecting') setState('fallback'); }, JOIN_TIMEOUT_MS);
}

export function subscribeDMs(userId, handlers = {}) {
  if (!userId) { const noop = () => {}; noop.getState = () => 'idle'; return noop; }
  if (channelUser !== userId) { listeners.clear(); open(userId); }
  listeners.add(handlers);
  let statusFn = null;
  if (typeof handlers.onStatus === 'function') { statusFn = s => handlers.onStatus(s); stateListeners.add(statusFn); handlers.onStatus(state); }
  let done = false;
  const off = () => {
    if (done) return;
    done = true;
    listeners.delete(handlers);
    if (statusFn) stateListeners.delete(statusFn);
    if (listeners.size === 0) { teardown(); setState('idle'); }
  };
  off.getState = () => state;
  return off;
}

export const getRealtimeState = () => state;
export function onRealtimeState(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); }

export function pollThread(userId, friendId, { getAfter, onRows, onSeen } = {}) {
  if (!userId || !friendId) return () => {};
  let timer = null, stopped = false, busy = false;
  const run = async () => {
    const after = typeof getAfter === 'function' ? getAfter() : null;
    try { const rows = await listNewer(userId, friendId, after); if (rows.length) onRows?.(rows); } catch { /* next tick */ }
    if (onSeen) { const seen = await getSeenUpTo(userId, friendId); if (seen) onSeen(seen); }
  };
  const schedule = () => { if (stopped) return; clearTimeout(timer); timer = setTimeout(tick, state === 'live' ? LIVE_POLL_MS : FALLBACK_POLL_MS); };
  const tick = async () => { if (stopped) return; if (!busy) { busy = true; try { await run(); } catch { /* */ } busy = false; } schedule(); };
  const onState = s => { if (stopped) return; if (s === 'live') { clearTimeout(timer); tick(); } else schedule(); };
  stateListeners.add(onState);
  schedule();
  return () => { stopped = true; stateListeners.delete(onState); clearTimeout(timer); };
}

/** onTyping(true|false) for the friend only. */
export function joinTyping(userId, friendId, onTyping) {
  const topic = typingTopic(userId, friendId);
  const noop = { sendTyping() {}, leave() {}, isAvailable: () => false };
  if (!topic) return noop;
  let live = false, idle = null, last = -Infinity, left = false, ch = null;
  try {
    ch = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, msg => {
        if (left || msg?.payload?.from !== friendId) return;
        onTyping?.(true);
        clearTimeout(idle);
        idle = setTimeout(() => onTyping?.(false), 4500);
      });
    ch.subscribe(s => { live = s === 'SUBSCRIBED'; });
  } catch { return noop; }
  return {
    sendTyping() {
      if (left || !live) return;
      const t = Date.now();
      if (t - last < 2500) return;
      last = t;
      try { ch.send({ type: 'broadcast', event: 'typing', payload: { from: userId } }); } catch { /* */ }
    },
    leave() { if (left) return; left = true; clearTimeout(idle); try { supabase.removeChannel(ch); } catch { /* */ } },
    isAvailable: () => live,
  };
}
