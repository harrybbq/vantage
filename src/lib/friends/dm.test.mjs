/**
 * DM data layer — the pure parts. What matters:
 *   - a message appears ONCE however many paths deliver it (optimistic
 *     bubble, insert response, live feed, poll, earlier pages);
 *   - the inbox fallback gets unread maths right without the RPC;
 *   - replies and reactions resolve and aggregate the way the UI shows them;
 *   - invite codes/URLs and the typing topic match the SQL exactly;
 *   - the Realtime hub shares one channel, reports its state honestly, and
 *     the poller follows that state.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  ts, compareMessages, mergeMessages, makeOptimistic, confirmSent, markFailed, removeMessage,
  oldestReal, newestReal, seenMessageId, applySeen, resolveReplies, missingReplyIds, snippet,
  REACTION_EMOJI, normalizeEmoji, groupReactions, summarizeReactions, applyReactionChange,
  groupConversations, mapConversationRows, totalUnread,
  isValidInviteCode, inviteUrl, parseInvitePath, typingTopic, isNotConfigured, MAX_BODY,
} from './dmModel.js';
import {
  createDMRealtime, FALLBACK_POLL_MS, LIVE_POLL_MS, JOIN_TIMEOUT_MS, TYPING_IDLE_MS, TYPING_SEND_EVERY_MS,
} from './dmRealtimeCore.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const ME = '11111111-1111-4111-8111-111111111111';
const AVA = '22222222-2222-4222-8222-222222222222';
const BEN = '33333333-3333-4333-8333-333333333333';
const msg = (id, from, to, body, t, extra = {}) =>
  ({ id, sender_id: from, recipient_id: to, body, created_at: `2026-10-17T10:${String(t).padStart(2, '0')}:00.123456+00:00`, read_at: null, ...extra });

// ── Timestamps ──
{
  eq(ts('2026-10-17T10:00:00.123456+00:00'), Date.UTC(2026, 9, 17, 10, 0, 0, 123), 'microseconds are cut to ms');
  eq(ts('2026-10-17T10:00:00.123456'), Date.UTC(2026, 9, 17, 10, 0, 0, 123), 'no offset reads as UTC, not local');
  eq(ts('2026-10-17 10:00:00+00'), Date.UTC(2026, 9, 17, 10), 'Postgres text form parses');
  ok(Number.isNaN(ts(null)), 'null is NaN');
  ok(compareMessages(msg(2, ME, AVA, 'a', 1), msg(1, ME, AVA, 'b', 1)) > 0, 'same time → id breaks the tie');
}

// ── Merge: every path, one bubble ──
{
  const base = [msg(1, AVA, ME, 'hey', 1), msg(2, ME, AVA, 'hi', 2)];
  const again = mergeMessages(base, [msg(2, ME, AVA, 'hi', 2), msg(1, AVA, ME, 'hey', 1)], { selfId: ME });
  ok(again === base, 'a poll returning known rows changes nothing (same array, no re-render)');

  const live = mergeMessages(base, [msg(3, AVA, ME, 'new', 3)], { selfId: ME });
  eq(live.map(m => m.id), [1, 2, 3], 'a live row appends');
  const pollToo = mergeMessages(live, [msg(2, ME, AVA, 'hi', 2), msg(3, AVA, ME, 'new', 3)], { selfId: ME });
  ok(pollToo === live, 'the poll repeating the live row adds nothing');

  // Optimistic → live feed first → insert response second.
  const temp = makeOptimistic({ selfId: ME, friendId: AVA, body: 'on my way', now: Date.UTC(2026, 9, 17, 10, 4) });
  let l = mergeMessages(live, [], {});
  l = [...l, temp];
  const real = msg(4, ME, AVA, 'on my way', 4);
  l = mergeMessages(l, [real], { selfId: ME });
  eq(l.filter(m => m.body === 'on my way').length, 1, 'live own-insert replaces the pending bubble');
  eq(l.find(m => m.id === 4)._key, temp._key, 'and keeps its React key');
  l = confirmSent(l, temp.id, real);
  eq(l.filter(m => m.body === 'on my way').length, 1, 'the late insert response does not duplicate it');

  // Optimistic → insert response first → live feed second.
  const t2 = makeOptimistic({ selfId: ME, friendId: AVA, body: 'second', now: Date.UTC(2026, 9, 17, 10, 5) });
  let l2 = [...l, t2];
  const real2 = msg(5, ME, AVA, 'second', 5);
  l2 = confirmSent(l2, t2.id, real2);
  ok(!l2.some(m => m._pending), 'the response swaps the bubble for the row');
  l2 = mergeMessages(l2, [real2], { selfId: ME });
  eq(l2.filter(m => m.body === 'second').length, 1, 'then the live row is a no-op');

  // Two identical pending bodies — each real row takes ONE bubble.
  const a = makeOptimistic({ selfId: ME, friendId: AVA, body: 'ok', now: 1 });
  const b = makeOptimistic({ selfId: ME, friendId: AVA, body: 'ok', now: 2 });
  let l3 = mergeMessages([a, b], [msg(10, ME, AVA, 'ok', 30)], { selfId: ME });
  eq(l3.filter(m => m._pending).length, 1, 'first echo replaces one of two identical bubbles');
  l3 = mergeMessages(l3, [msg(11, ME, AVA, 'ok', 31)], { selfId: ME });
  eq(l3.filter(m => m._pending).length, 0, 'second echo the other');
  eq(l3.length, 2, 'never four');

  // A friend's message with the same text never eats my bubble.
  const c = makeOptimistic({ selfId: ME, friendId: AVA, body: 'lol', now: 3 });
  const l4 = mergeMessages([c], [msg(12, AVA, ME, 'lol', 32)], { selfId: ME });
  eq(l4.length, 2, 'their "lol" and my pending "lol" are two messages');

  // Failure keeps the text for retry.
  const f = markFailed([c], c.id, 'offline');
  ok(f[0]._failed && !f[0]._pending && f[0].body === 'lol', 'failed bubble keeps its body for retry');
  const l5 = mergeMessages(f, [msg(13, ME, AVA, 'lol', 33)], { selfId: ME });
  eq(l5.length, 2, 'a failed bubble is not silently matched by a later identical send');

  // Updates merge in place (Seen).
  const seen = mergeMessages(base, [{ ...msg(2, ME, AVA, 'hi', 2), read_at: '2026-10-17T10:09:00+00:00' }], { selfId: ME });
  eq(seen.find(m => m.id === 2).read_at, '2026-10-17T10:09:00+00:00', 'UPDATE sets read_at on the existing row');
  eq(seen.length, 2, 'without adding a row');

  eq(removeMessage(seen, 2).map(m => m.id), [1], 'unsend removes by id');
  ok(removeMessage(seen, 999) === seen, 'an unknown DELETE id (someone else\'s) is ignored');
  ok(removeMessage(seen, '2').length === 1, 'string and number ids compare equal');
}

// ── Pages: Load earlier + overlap ──
{
  const page2 = Array.from({ length: 50 }, (_, i) => msg(51 + i, i % 2 ? ME : AVA, i % 2 ? AVA : ME, `m${51 + i}`, i % 60));
  const page1 = Array.from({ length: 50 }, (_, i) => msg(1 + i, i % 2 ? ME : AVA, i % 2 ? AVA : ME, `m${1 + i}`, 0));
  // page1 all share a timestamp — ordering must still follow ids.
  const merged = mergeMessages(page2, page1, { selfId: ME });
  eq(merged.length, 100, 'earlier page prepends');
  ok(merged.every((m, i) => i === 0 || compareMessages(merged[i - 1], m) <= 0), 'and the whole list stays ordered');
  const overlap = mergeMessages(merged, page1.slice(40).concat(page2.slice(0, 5)), { selfId: ME });
  ok(overlap === merged, 'overlapping pages add nothing');
  const withTemp = [...merged, makeOptimistic({ selfId: ME, friendId: AVA, body: 'x' })];
  eq(oldestReal(withTemp).id, 1, 'oldest real row is the Load-earlier cursor');
  eq(newestReal(withTemp).id, newestReal(merged).id, 'newest real row ignores the pending bubble');
}

// ── Seen ──
{
  const l = [msg(1, ME, AVA, 'a', 1, { read_at: 'x' }), msg(2, AVA, ME, 'b', 2), msg(3, ME, AVA, 'c', 3)];
  eq(seenMessageId(l, ME), null, 'my newest is unread → no Seen');
  const l2 = applySeen(l, { id: 3, created_at: l[2].created_at, read_at: '2026-10-17T10:10:00Z' }, ME);
  eq(seenMessageId(l2, ME), 3, 'poll reports it read → Seen under it');
  ok(applySeen(l2, { id: 3, created_at: l[2].created_at, read_at: 'y' }, ME) === l2, 'repeat poll is a no-op');
  const l3 = applySeen(l, { id: 1, created_at: l[0].created_at, read_at: 'z' }, ME);
  eq(l3.find(m => m.id === 3).read_at, null, 'only messages up to the seen one are marked');
}

// ── Replies ──
{
  const l = [msg(5, AVA, ME, 'see you at the gym tomorrow?', 1), msg(6, ME, AVA, 'yes', 2, { reply_to: 5 }),
    msg(7, AVA, ME, 'great', 3, { reply_to: 2 }), msg(8, ME, AVA, 'old one', 4, { reply_to: 1 })];
  const extra = [msg(1, ME, AVA, 'a very old message from last week', 0)];
  const r = resolveReplies(l, extra);
  eq(r[6], { id: 5, sender_id: AVA, body: 'see you at the gym tomorrow?', missing: false }, 'quote resolves from the page');
  eq(r[8].body, 'a very old message from last week', 'and from the separately fetched rows');
  eq(r[7], { id: 2, sender_id: null, body: '', missing: true }, 'an unsent quote reads as missing');
  ok(!(5 in r), 'non-replies have no entry');
  eq(missingReplyIds(l, extra), [2], 'only quotes we don\'t hold are fetched');
  eq(snippet('a\n\n b   c'), 'a b c', 'snippet flattens whitespace');
  eq(snippet('x'.repeat(200)).length, 90, 'and caps at 90 chars');
}

// ── Reactions ──
{
  eq(REACTION_EMOJI.length, 6, 'six reactions');
  eq(normalizeEmoji('❤'), '❤️', 'bare heart becomes ❤️ (the form the SQL check accepts)');
  eq(normalizeEmoji('💩'), null, 'anything else is refused client-side');
  const rows = [
    { id: 1, message_id: 9, user_id: AVA, emoji: '🔥' },
    { id: 2, message_id: 9, user_id: ME, emoji: '👍' },
    { id: 3, message_id: 9, user_id: AVA, emoji: '👍' },
    { id: 4, message_id: 10, user_id: ME, emoji: '😂' },
  ];
  const g = groupReactions(rows);
  eq(Object.keys(g), ['9', '10'], 'grouped per message');
  eq(summarizeReactions(g[9], ME), [{ emoji: '👍', count: 2, mine: true }, { emoji: '🔥', count: 1, mine: false }],
    'counts in the fixed order, mine flagged');
  let m = applyReactionChange(g, { type: 'INSERT', row: { id: 5, message_id: 9, user_id: AVA, emoji: '😮' } });
  eq(m[9].length, 4, 'live insert adds');
  ok(applyReactionChange(m, { type: 'INSERT', row: { id: 5, message_id: 9, user_id: AVA, emoji: '😮' } }) === m, 'repeat insert is a no-op');
  m = applyReactionChange(m, { type: 'DELETE', row: { id: 1 } });
  eq(summarizeReactions(m[9], ME).map(x => x.emoji), ['👍', '😮'], 'live DELETE by id only removes it');
  ok(applyReactionChange(m, { type: 'DELETE', row: { id: 999 } }) === m, 'someone else\'s DELETE id is ignored');
  // Optimistic toggle: add without id, real row arrives, then remove.
  let o = applyReactionChange(m, { type: 'INSERT', row: { message_id: 10, user_id: ME, emoji: '❤️' } });
  o = applyReactionChange(o, { type: 'INSERT', row: { id: 6, message_id: 10, user_id: ME, emoji: '❤️' } });
  eq(o[10].filter(x => x.emoji === '❤️').map(x => x.id), [6], 'the real row takes over the optimistic one');
  o = applyReactionChange(o, { type: 'DELETE', row: { message_id: 10, user_id: ME, emoji: '😂' } });
  eq(o[10].map(x => x.emoji), ['❤️'], 'optimistic un-react by (message, user, emoji)');
  o = applyReactionChange(o, { type: 'DELETE', row: { id: 6 } });
  ok(!(10 in o), 'last reaction removed → no entry');
}

// ── Inbox fallback grouping ──
{
  const recent = [
    msg(30, ME, AVA, 'you there?', 30),
    msg(29, AVA, ME, 'one', 29, { read_at: 'r' }),
    msg(28, BEN, ME, 'ben old', 10, { read_at: 'r' }),
  ];
  const unread = [
    msg(31, AVA, ME, 'yes', 31), msg(32, AVA, ME, 'here', 32),
    msg(5, BEN, ME, 'ben unread but older than the window', 5),
    msg(31, AVA, ME, 'yes', 31), // duplicate row (both queries) counted once
    msg(40, '44444444-4444-4444-8444-444444444444', ME, 'only unread, outside window', 2),
  ];
  const c = groupConversations(recent, unread, ME);
  eq(c.map(x => x.friendId), [AVA, BEN, '44444444-4444-4444-8444-444444444444'], 'newest conversation first');
  eq(c[0].last.body, 'here', 'last message is the newest of either query');
  eq(c[0].unread, 2, 'Ava: two unread (duplicate counted once)');
  eq(c[1].unread, 1, 'Ben: unread older than the window still counts');
  eq(c[1].last.body, 'ben old', 'but his last message is still the newest one');
  eq(c[2].unread, 1, 'a partner seen only through an unread row appears');
  eq(totalUnread(c), 4, 'badge total');
  eq(groupConversations([msg(1, ME, ME, 'self', 1)], [], ME), [], 'a self-row never makes a conversation');
  eq(groupConversations([msg(1, ME, AVA, 'mine', 1)], [], ME)[0].unread, 0, 'my own messages are never unread for me');

  const rpc = mapConversationRows([
    { partner_id: AVA, last_id: 9, last_body: 'b', last_sender_id: AVA, last_created_at: 'x', unread: '3', blocked_by_me: false },
    { partner_id: BEN, last_id: 8, last_body: 'a', last_sender_id: ME, last_created_at: 'y', unread: 2, blocked_by_me: true },
  ]);
  eq(rpc[0], { friendId: AVA, last: { id: 9, body: 'b', sender_id: AVA, created_at: 'x' }, unread: 3, blockedByMe: false },
    'RPC rows map to the same shape');
  eq(totalUnread(rpc), 3, 'blocked conversations do not feed the badge');
}

// ── Invites ──
{
  ok(isValidInviteCode('Ab3_-xYz9QkLmNoPqRsTuV'), 'a 22-char base64url code is valid');
  ok(!isValidInviteCode('short'), 'under 10 chars is not');
  ok(!isValidInviteCode('has space here'), 'spaces are not');
  ok(!isValidInviteCode('a/b/../../etc'), 'slashes are not');
  ok(!isValidInviteCode('x'.repeat(65)), 'over 64 is not');
  ok(!isValidInviteCode(null), 'null is not');
  eq(inviteUrl('Ab3_-xYz9QkLmNoPqRsTuV', 'https://vantage.example/'), 'https://vantage.example/invite/Ab3_-xYz9QkLmNoPqRsTuV', 'URL has no double slash');
  eq(inviteUrl('bad code', 'https://x.example'), null, 'no URL for an invalid code');
  eq(parseInvitePath('/invite/Ab3_-xYz9QkLmNoPqRsTuV'), 'Ab3_-xYz9QkLmNoPqRsTuV', 'path parses');
  eq(parseInvitePath('/invite/Ab3_-xYz9QkLmNoPqRsTuV/?utm=wa#x'), 'Ab3_-xYz9QkLmNoPqRsTuV', 'trailing slash, query and hash are ignored');
  eq(parseInvitePath('/invite/Ab3%5F-xYz9QkLmNoPqRsTuV'), 'Ab3_-xYz9QkLmNoPqRsTuV', 'percent-encoding decodes');
  eq(parseInvitePath('/invite/%E0%A4%A'), null, 'broken encoding is refused');
  eq(parseInvitePath('/invite/abc'), null, 'too short is refused');
  eq(parseInvitePath('/invites/Ab3_-xYz9QkLmNoPqRsTuV'), null, 'other routes are not invites');
  eq(parseInvitePath('/invite/Ab3_-xYz9QkLmNoPqRsTuV/extra'), null, 'deeper paths are not invites');
}

// ── Typing topic matches dm_typing_topic_ok() ──
{
  const t = typingTopic(BEN, AVA);
  eq(t, `dm-typing:${AVA}:${BEN}`, 'ids in ascending text order');
  eq(typingTopic(AVA, BEN), t, 'either side computes the same topic');
  eq(typingTopic(AVA.toUpperCase(), BEN), t, 'case-insensitive (Postgres prints lower case)');
  eq(typingTopic(AVA, AVA), null, 'no topic with yourself');
  ok(/^dm-typing:[0-9a-f-]{36}:[0-9a-f-]{36}$/.test(t), 'shape the SQL regex accepts');
}

// ── Not-configured detection ──
{
  ok(isNotConfigured({ code: 'PGRST202', message: 'Could not find the function public.dm_conversations' }), 'missing RPC');
  ok(isNotConfigured({ code: '42P01', message: 'relation "public.message_reactions" does not exist' }), 'missing table');
  ok(isNotConfigured({ code: 'PGRST205', message: 'Could not find the table public.friend_invites in the schema cache' }), 'missing table (cache)');
  ok(isNotConfigured({ code: '42703', message: 'column messages.reply_to does not exist' }), 'missing column');
  ok(!isNotConfigured({ code: '42501', message: 'new row violates row-level security policy' }), 'RLS refusal is a real error');
  ok(!isNotConfigured({ code: 'P0001', message: 'Slow down — too many reactions in a minute.' }), 'throttle is a real error');
  ok(!isNotConfigured(null), 'no error');
  eq(makeOptimistic({ selfId: ME, friendId: AVA, body: 'x'.repeat(3000) }).body.length, MAX_BODY, 'optimistic body capped like the server');
}

// ── Realtime hub (fake client) ──
function fakeTimers() {
  let t = 0; let seq = 0; const q = new Map();
  return {
    setTimer: (fn, ms) => { const id = ++seq; q.set(id, { fn, at: t + ms }); return id; },
    clearTimer: id => { q.delete(id); },
    now: () => t,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...q.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        q.delete(next[0]); t = next[1].at; await next[1].fn(); await Promise.resolve();
      }
      t = end;
    },
    pending: () => q.size,
  };
}
function fakeClient() {
  const channels = [];
  const removed = [];
  return {
    channels, removed,
    channel(name, opts) {
      const ch = { name, opts, bindings: [], sent: [], status: null,
        on(type, filter, cb) { this.bindings.push({ type, filter, cb }); return this; },
        subscribe(cb) { this.statusCb = cb; return this; },
        send(m) { this.sent.push(m); return Promise.resolve('ok'); },
        fire(status) { this.statusCb?.(status); },
        emit(type, match, payload) {
          for (const b of this.bindings) if (b.type === type && match(b.filter)) b.cb(payload);
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) { removed.push(ch); },
  };
}

{
  const timers = fakeTimers();
  const client = fakeClient();
  const hub = createDMRealtime(client, timers);
  const got = { msg: [], upd: [], del: [], rx: [], st: [] };
  const off = hub.subscribeDMs(ME, {
    onMessage: r => got.msg.push(r.id), onUpdate: r => got.upd.push(r.id), onDelete: d => got.del.push(d.id),
    onReaction: e => got.rx.push(`${e.type}:${e.row.id}`), onStatus: s => got.st.push(s),
  });
  eq(client.channels.length, 1, 'one channel');
  const ch = client.channels[0];
  ok(!ch.name.includes(ME), 'channel name carries no user id');
  const f = ch.bindings.map(b => `${b.filter.event} ${b.filter.table} ${b.filter.filter || '*'}`);
  eq(f, [
    `INSERT messages recipient_id=eq.${ME}`, `INSERT messages sender_id=eq.${ME}`,
    `UPDATE messages sender_id=eq.${ME}`, `UPDATE messages recipient_id=eq.${ME}`, 'DELETE messages *',
    `INSERT message_reactions peer_id=eq.${ME}`, `INSERT message_reactions user_id=eq.${ME}`, 'DELETE message_reactions *',
  ], 'bindings: both directions + updates + unfilterable deletes + reactions');
  eq(got.st, ['connecting'], 'starts connecting');
  ch.fire('SUBSCRIBED');
  eq(hub.getState(), 'live', 'SUBSCRIBED → live');
  eq(off.getState(), 'live', 'state readable from the unsubscribe handle');

  ch.emit('postgres_changes', fl => fl.event === 'INSERT' && fl.table === 'messages' && fl.filter.startsWith('recipient'), { new: msg(1, AVA, ME, 'hi', 1) });
  ch.emit('postgres_changes', fl => fl.event === 'INSERT' && fl.table === 'messages' && fl.filter.startsWith('sender'), { new: msg(2, ME, AVA, 'yo', 2) });
  ch.emit('postgres_changes', fl => fl.event === 'INSERT' && fl.table === 'messages' && fl.filter.startsWith('recipient'), { new: msg(3, AVA, BEN, 'not mine', 3) });
  eq(got.msg, [1, 2], 'own-conversation inserts delivered; a stray row is dropped client-side too');
  ch.emit('postgres_changes', fl => fl.event === 'UPDATE' && fl.filter.startsWith('sender'), { new: { ...msg(2, ME, AVA, 'yo', 2), read_at: 'r' } });
  eq(got.upd, [2], 'read receipt arrives as an update');
  ch.emit('postgres_changes', fl => fl.event === 'DELETE' && fl.table === 'messages', { old: { id: 77 } });
  eq(got.del, [77], 'DELETE passes the bare id through');
  ch.emit('postgres_changes', fl => fl.event === 'INSERT' && fl.table === 'message_reactions' && fl.filter.startsWith('peer'), { new: { id: 5, message_id: 2, user_id: AVA, peer_id: ME, emoji: '🔥' } });
  ch.emit('postgres_changes', fl => fl.event === 'DELETE' && fl.table === 'message_reactions', { old: { id: 5 } });
  eq(got.rx, ['INSERT:5', 'DELETE:5'], 'reactions both ways');

  // Second listener shares the channel.
  const got2 = [];
  const off2 = hub.subscribeDMs(ME, { onMessage: r => got2.push(r.id) });
  eq(client.channels.length, 1, 'a second listener reuses the channel');
  ch.emit('postgres_changes', fl => fl.event === 'INSERT' && fl.table === 'messages' && fl.filter.startsWith('recipient'), { new: msg(4, AVA, ME, 'both', 4) });
  ok(got.msg.includes(4) && got2.includes(4), 'both listeners hear it');

  ch.fire('CHANNEL_ERROR');
  eq(hub.getState(), 'fallback', 'CHANNEL_ERROR (e.g. publication not enabled) → fallback');
  ch.fire('SUBSCRIBED');
  eq(hub.getState(), 'live', 'the library rejoin → live again');

  off();
  eq(client.removed.length, 0, 'channel kept while someone listens');
  off2();
  eq(client.removed.length, 1, 'last listener gone → channel removed');
  eq(hub.getState(), 'idle', 'and the hub is idle');
  off2();
  eq(client.removed.length, 1, 'unsubscribe twice is harmless');
}

{
  // Join never answers → fallback after JOIN_TIMEOUT_MS. User switch reopens.
  const timers = fakeTimers();
  const client = fakeClient();
  const hub = createDMRealtime(client, timers);
  hub.subscribeDMs(ME, {});
  await timers.advance(JOIN_TIMEOUT_MS - 1);
  eq(hub.getState(), 'connecting', 'still connecting just before the timeout');
  await timers.advance(1);
  eq(hub.getState(), 'fallback', 'no answer → fallback (poll)');
  hub.subscribeDMs(AVA, {});
  eq(client.channels.length, 2, 'a different account gets a fresh channel');
  eq(client.removed.length, 1, 'and the old account\'s channel is removed');
  client.channels[0].fire('SUBSCRIBED');
  eq(hub.getState(), 'connecting', 'a stale channel reporting in is ignored');
}

{
  // Poller follows the state.
  const timers = fakeTimers();
  const client = fakeClient();
  const hub = createDMRealtime(client, timers);
  hub.subscribeDMs(ME, {});
  let runs = 0;
  const stop = hub.createPoller(async () => { runs++; });
  await timers.advance(FALLBACK_POLL_MS);
  eq(runs, 1, 'connecting → polls at the fallback rate');
  await timers.advance(FALLBACK_POLL_MS * 2);
  eq(runs, 3, 'and keeps going');
  client.channels[0].fire('SUBSCRIBED');
  await Promise.resolve(); await Promise.resolve();
  eq(runs, 4, 'going live runs one catch-up fetch at once');
  await timers.advance(FALLBACK_POLL_MS * 2);
  eq(runs, 4, 'live → no fast polling');
  await timers.advance(LIVE_POLL_MS);
  eq(runs, 5, 'only the slow safety poll');
  client.channels[0].fire('CLOSED');
  await timers.advance(FALLBACK_POLL_MS);
  eq(runs, 6, 'socket dropped → back to the fallback rate');
  stop();
  await timers.advance(LIVE_POLL_MS * 3);
  eq(runs, 6, 'stopped means stopped');
  eq(timers.pending() <= 1, true, 'no poll timers left behind');
}

{
  // Typing.
  const timers = fakeTimers();
  const client = fakeClient();
  const hub = createDMRealtime(client, timers);
  const topic = typingTopic(ME, AVA);
  const seen = [];
  const t1 = hub.joinTyping(ME, AVA, topic, v => seen.push(v));
  const ch = client.channels[0];
  eq(ch.name, topic, 'typing channel uses the policy topic');
  eq(ch.opts, { config: { private: true, broadcast: { self: false } } }, 'private, no self-echo');
  t1.sendTyping();
  eq(ch.sent.length, 0, 'nothing sent before the private join succeeds (no REST fallback)');
  ok(!t1.isAvailable(), 'not available yet');
  ch.fire('SUBSCRIBED');
  ok(t1.isAvailable(), 'available once joined');
  t1.sendTyping(); t1.sendTyping();
  eq(ch.sent.length, 1, 'throttled');
  eq(ch.sent[0], { type: 'broadcast', event: 'typing', payload: { from: ME } }, 'payload is just who');
  await timers.advance(TYPING_SEND_EVERY_MS);
  t1.sendTyping();
  eq(ch.sent.length, 2, 'sends again after the throttle window');
  ch.emit('broadcast', () => true, { payload: { from: ME } });
  eq(seen, [], 'my other device typing is not "them"');
  ch.emit('broadcast', () => true, { payload: { from: AVA } });
  eq(seen, [true], 'friend typing → true');
  await timers.advance(TYPING_IDLE_MS);
  eq(seen, [true, false], 'then false when they stop');
  const t2 = hub.joinTyping(ME, AVA, topic, () => {});
  eq(client.channels.length, 1, 'a second joiner shares the channel');
  t1.leave();
  eq(client.removed.length, 0, 'kept while one joiner remains');
  t2.leave();
  eq(client.removed.length, 1, 'removed with the last');
  const none = hub.joinTyping(ME, AVA, null, () => {});
  none.sendTyping(); none.leave();
  ok(!none.isAvailable(), 'no topic → harmless no-op');
}

// ── Moderation: evidence copied at report time wins ──
{
  const require = createRequire(import.meta.url);
  const { snapshotMessages } = require('../../../netlify/lib/moderationCore.js');
  const snap = { handle: 'x', messages: [
    { from: 'reported', body: 'abuse', at: 'a' }, { from: 'reporter', body: 'stop', at: 'b' },
    { from: 'evil', body: 'coerced to reporter' }, { body: 42 }, null,
  ] };
  eq(snapshotMessages(snap), [
    { from: 'reported', body: 'abuse', at: 'a' }, { from: 'reporter', body: 'stop', at: 'b' },
    { from: 'reporter', body: 'coerced to reporter', at: null },
  ], 'snapshot messages read in the queue shape, junk dropped');
  eq(snapshotMessages(null), [], 'no snapshot → empty (live read fallback)');
  eq(snapshotMessages({ messages: Array.from({ length: 15 }, (_, i) => ({ from: 'reported', body: `m${i}` })) }).length, 10, 'capped at 10');
}

console.log(`dm: ${n} checks passed`);
