/**
 * Realtime plumbing for DMs, written against an injected Supabase-like
 * client so node tests can drive it with a fake. ./realtime.js wires the
 * real client.
 *
 * ONE inbox channel per signed-in user, shared by every listener (rail
 * badge, inbox list, open thread). It carries postgres_changes only;
 * which rows arrive is decided by table RLS on the server:
 *
 *   messages           INSERT  recipient_id = me   (someone wrote to me)
 *                      INSERT  sender_id = me      (I wrote, on another device)
 *                      UPDATE  sender_id = me      (my message was read → "Seen")
 *                      UPDATE  recipient_id = me   (I read on another device)
 *                      DELETE  (unfilterable)      ({ id } only — an unsend)
 *   message_reactions  INSERT  peer_id = me / user_id = me
 *                      DELETE  (unfilterable)      ({ id } only)
 *
 * Realtime sends DELETE events to every subscriber of the table without
 * an RLS check and with only the primary key, so a DELETE for an id the
 * client doesn't hold must simply be ignored — the handlers get { id }.
 *
 * State: 'idle' → 'connecting' → 'live' | 'fallback'. While not 'live'
 * the caller polls listNewer() every FALLBACK_POLL_MS; realtime-js keeps
 * retrying the join in the background and the state flips back to 'live'
 * when it lands. Realtime does not replay events missed while
 * disconnected, so a poller also runs one catch-up fetch on every
 * transition to 'live', and a slow LIVE_POLL_MS safety poll while live.
 */

export const FALLBACK_POLL_MS = 12_000;
export const LIVE_POLL_MS = 60_000;
export const JOIN_TIMEOUT_MS = 10_000;
export const TYPING_SEND_EVERY_MS = 2_500;
export const TYPING_IDLE_MS = 4_500;

export function createDMRealtime(client, {
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
  now = () => Date.now(),
} = {}) {
  let channel = null;
  let channelUser = null;
  let state = 'idle';
  let joinTimer = null;
  const listeners = new Set();
  const stateListeners = new Set();

  function setState(next) {
    if (state === next) return;
    state = next;
    for (const fn of [...stateListeners]) {
      try { fn(state); } catch { /* a listener's bug must not stop the others */ }
    }
  }

  function emit(kind, payload) {
    for (const l of [...listeners]) {
      const fn = l.handlers[kind];
      if (typeof fn === 'function') {
        try { fn(payload); } catch { /* same */ }
      }
    }
  }

  function teardown() {
    if (joinTimer != null) { clearTimer(joinTimer); joinTimer = null; }
    if (channel) {
      const ch = channel;
      channel = null;
      try { client.removeChannel(ch); } catch { /* already gone */ }
    }
    channelUser = null;
  }

  function open(userId) {
    teardown();
    channelUser = userId;
    setState('connecting');
    // Random suffix: the topic of a postgres_changes-only channel grants
    // nothing (RLS does), and a fresh name avoids reusing a channel that
    // realtime-js still holds from a previous session in this tab.
    const name = `dm-inbox-${Math.random().toString(36).slice(2, 10)}`;
    let ch;
    try {
      ch = client.channel(name);
      const pg = (event, table, filter, cb) => {
        const opts = { event, schema: 'public', table };
        if (filter) opts.filter = filter;
        ch = ch.on('postgres_changes', opts, cb);
      };
      const mine = row => row && (row.sender_id === userId || row.recipient_id === userId);
      pg('INSERT', 'messages', `recipient_id=eq.${userId}`, p => { if (mine(p.new)) emit('onMessage', p.new); });
      pg('INSERT', 'messages', `sender_id=eq.${userId}`, p => { if (mine(p.new)) emit('onMessage', p.new); });
      pg('UPDATE', 'messages', `sender_id=eq.${userId}`, p => { if (mine(p.new)) emit('onUpdate', p.new); });
      pg('UPDATE', 'messages', `recipient_id=eq.${userId}`, p => { if (mine(p.new)) emit('onUpdate', p.new); });
      pg('DELETE', 'messages', null, p => { if (p.old?.id != null) emit('onDelete', { id: p.old.id }); });
      const ownReaction = r => r && (r.user_id === userId || r.peer_id === userId);
      pg('INSERT', 'message_reactions', `peer_id=eq.${userId}`, p => { if (ownReaction(p.new)) emit('onReaction', { type: 'INSERT', row: p.new }); });
      pg('INSERT', 'message_reactions', `user_id=eq.${userId}`, p => { if (ownReaction(p.new)) emit('onReaction', { type: 'INSERT', row: p.new }); });
      pg('DELETE', 'message_reactions', null, p => { if (p.old?.id != null) emit('onReaction', { type: 'DELETE', row: { id: p.old.id } }); });
      channel = ch;
      ch.subscribe((status) => {
        if (channel !== ch) return;            // a stale channel reporting in
        if (status === 'SUBSCRIBED') {
          if (joinTimer != null) { clearTimer(joinTimer); joinTimer = null; }
          setState('live');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Publication not enabled, offline, or the socket dropped.
          // realtime-js retries on its own; we poll meanwhile.
          setState('fallback');
        }
      });
    } catch {
      channel = null;
      setState('fallback');
      return;
    }
    joinTimer = setTimer(() => {
      joinTimer = null;
      if (state === 'connecting') setState('fallback');
    }, JOIN_TIMEOUT_MS);
  }

  /**
   * Listen for DM events as `userId`. Returns an unsubscribe function
   * that also exposes `.getState()`. Handlers: onMessage(row),
   * onUpdate(row), onDelete({ id }), onReaction({ type, row }),
   * onStatus(state) — called now and on every change.
   */
  function subscribeDMs(userId, handlers = {}) {
    const entry = { handlers };
    if (!userId) {
      const noop = () => {};
      noop.getState = () => 'idle';
      return noop;
    }
    if (channelUser !== userId) {
      // A different account signed in on this tab: nobody else may keep
      // listening as the old one.
      listeners.clear();
      open(userId);
    }
    listeners.add(entry);
    let statusFn = null;
    if (typeof handlers.onStatus === 'function') {
      statusFn = s => handlers.onStatus(s);
      stateListeners.add(statusFn);
      try { handlers.onStatus(state); } catch { /* ignore */ }
    }
    let done = false;
    const unsubscribe = () => {
      if (done) return;
      done = true;
      listeners.delete(entry);
      if (statusFn) stateListeners.delete(statusFn);
      if (listeners.size === 0) { teardown(); setState('idle'); }
    };
    unsubscribe.getState = () => state;
    return unsubscribe;
  }

  /**
   * Generic poller that follows the hub state: every FALLBACK_POLL_MS
   * while not live, every LIVE_POLL_MS while live, plus one immediate
   * run whenever the state becomes 'live' (catch-up after a gap).
   * `run` is async and must never throw. Returns stop().
   */
  function createPoller(run, { fastMs = FALLBACK_POLL_MS, slowMs = LIVE_POLL_MS } = {}) {
    let timer = null;
    let timerMs = 0;
    let stopped = false;
    let inFlight = false;
    const schedule = () => {
      if (stopped) return;
      if (timer != null) clearTimer(timer);
      timerMs = state === 'live' ? slowMs : fastMs;
      timer = setTimer(tick, timerMs);
    };
    const tick = async () => {
      timer = null;
      if (stopped) return;
      if (!inFlight) {
        inFlight = true;
        try { await run(); } catch { /* run is meant to fail soft */ }
        inFlight = false;
      }
      schedule();
    };
    const onState = (s) => {
      if (stopped) return;
      if (s === 'live') {
        if (timer != null) clearTimer(timer);
        timer = null;
        tick();
      } else if (timer == null || timerMs !== fastMs) {
        schedule();   // was on the slow live rate — speed up; else keep the running timer
      }
    };
    stateListeners.add(onState);
    schedule();
    return () => {
      stopped = true;
      stateListeners.delete(onState);
      if (timer != null) clearTimer(timer);
      timer = null;
    };
  }

  // ── Typing (private broadcast channel) ────────────────────────────────
  const typingChannels = new Map(); // topic → { ch, refs, handlers:Set, live }

  /**
   * Join the typing channel for a pair. `topic` comes from
   * typingTopic(me, friend). onTyping(true|false) fires for the FRIEND
   * only. Returns { sendTyping(), leave(), isAvailable() }. If the
   * private channel can't be joined (SQL not run, not friends, offline),
   * sendTyping is a no-op and onTyping never fires — typing is a nicety.
   */
  function joinTyping(userId, friendId, topic, onTyping) {
    const noop = { sendTyping() {}, leave() {}, isAvailable: () => false };
    if (!userId || !friendId || !topic) return noop;
    let slot = typingChannels.get(topic);
    if (!slot) {
      slot = { ch: null, refs: 0, handlers: new Set(), live: false };
      typingChannels.set(topic, slot);
      try {
        const ch = client.channel(topic, { config: { private: true, broadcast: { self: false } } });
        slot.ch = ch.on('broadcast', { event: 'typing' }, (msg) => {
          const from = msg?.payload?.from;
          for (const h of [...slot.handlers]) h(from);
        });
        slot.ch.subscribe((status) => {
          slot.live = status === 'SUBSCRIBED';
        });
      } catch {
        slot.ch = null;
      }
    }
    slot.refs += 1;
    let idle = null;
    let lastSent = -Infinity;
    let left = false;
    const handler = (from) => {
      if (left || from !== friendId) return;   // my other devices are not "them"
      try { onTyping?.(true); } catch { /* ignore */ }
      if (idle != null) clearTimer(idle);
      idle = setTimer(() => { idle = null; try { onTyping?.(false); } catch { /* ignore */ } }, TYPING_IDLE_MS);
    };
    slot.handlers.add(handler);
    return {
      sendTyping() {
        if (left || !slot.ch || !slot.live) return;   // never fall back to REST
        const t = now();
        if (t - lastSent < TYPING_SEND_EVERY_MS) return;
        lastSent = t;
        try {
          const r = slot.ch.send({ type: 'broadcast', event: 'typing', payload: { from: userId } });
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch { /* ignore */ }
      },
      leave() {
        if (left) return;
        left = true;
        if (idle != null) clearTimer(idle);
        slot.handlers.delete(handler);
        slot.refs -= 1;
        if (slot.refs <= 0) {
          typingChannels.delete(topic);
          if (slot.ch) { try { client.removeChannel(slot.ch); } catch { /* ignore */ } }
        }
      },
      isAvailable: () => !!slot.ch && slot.live,
    };
  }

  return {
    subscribeDMs,
    createPoller,
    joinTyping,
    getState: () => state,
    onState(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); },
  };
}
