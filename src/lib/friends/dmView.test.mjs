/**
 * The DM screens' presentation rules: how the inbox is joined, sorted
 * and labelled, how a live message folds into it, and where a bubble
 * run prints its time. State (merging, reactions, Seen) is dmModel's and
 * is tested there.
 */
import assert from 'node:assert/strict';
import {
  relTime, dayKey, dayLabel, endsCluster, previewText,
  buildInbox, bumpConversation, clearUnread, unreadTotal,
} from './dmView.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime();
const iso = ms => new Date(ms).toISOString();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

// ── relTime ──
{
  eq(relTime(iso(NOW - 20 * 1000), NOW), 'now', 'under a minute reads now');
  eq(relTime(iso(NOW - 5 * MIN), NOW), '5m', 'minutes');
  eq(relTime(iso(NOW - 3 * HOUR), NOW), '3h', 'hours, same day');
  eq(relTime(iso(NOW - 1 * DAY), NOW), '1d', 'yesterday is 1d — the rail is too narrow for a word');
  eq(relTime(iso(NOW - 6 * DAY), NOW), '6d', 'up to six days in digits');
  ok(/Oct|Sept|Sep/.test(relTime(iso(NOW - 10 * DAY), NOW)), 'older reads as a date');
  ok(/\d{2}$/.test(relTime(iso(new Date(2025, 2, 3).getTime()), NOW)), 'another year carries the year');
  eq(relTime('2026-10-17T10:59:30.123456+00:00', Date.parse('2026-10-17T11:00:00Z')), 'now', 'Postgres microsecond timestamps parse');
  eq(relTime('nonsense', NOW), '', 'garbage is blank, not NaN');
  eq(relTime(iso(NOW + 5 * MIN), NOW), 'now', 'a clock a little ahead is not "in the future"');
}

// ── days ──
{
  ok(dayKey(iso(NOW)) === dayKey(iso(NOW - 2 * HOUR)), 'same calendar day, same key');
  ok(dayKey(iso(NOW)) !== dayKey(iso(NOW - DAY)), 'different day, different key');
  eq(dayLabel(iso(NOW - HOUR), NOW), 'Today', 'today');
  eq(dayLabel(iso(NOW - DAY), NOW), 'Yesterday', 'yesterday (separators have room for the word)');
  eq(dayLabel(iso(NOW - 3 * DAY), NOW), new Date(NOW - 3 * DAY).toLocaleDateString('en-GB', { weekday: 'long' }), 'this week by weekday');
}

// ── clusters ──
{
  const t0 = NOW - HOUR;
  const list = [
    { id: 1, sender_id: 'a', created_at: iso(t0) },
    { id: 2, sender_id: 'a', created_at: iso(t0 + MIN) },
    { id: 3, sender_id: 'a', created_at: iso(t0 + 10 * MIN) },
    { id: 4, sender_id: 'b', created_at: iso(t0 + 11 * MIN) },
  ];
  ok(!endsCluster(list, 0), 'same sender a minute later continues the run');
  ok(endsCluster(list, 1), 'a nine-minute gap ends it');
  ok(endsCluster(list, 2), 'a different sender ends it');
  ok(endsCluster(list, 3), 'the last message always ends a run');
}

// ── previews ──
{
  eq(previewText({ body: 'hi', sender_id: 'me' }, 'me'), 'You: hi', 'own messages say You:');
  eq(previewText({ body: 'line one\n\n  line two', sender_id: 'f' }, 'me'), 'line one line two', 'whitespace collapses to one line');
  eq(previewText({ body: 'x'.repeat(200), sender_id: 'f' }, 'me').length, 80, 'long bodies clip to 80 with an ellipsis');
  eq(previewText(null, 'me'), '', 'no last message, no preview');
}

// ── inbox join ──
{
  const friends = [{ id: 'f1', name: 'Aidan' }, { id: 'f2', name: 'Maya', suspended_at: null }, { id: 'f3', name: 'Zed' }];
  const conv = [
    { friendId: 'f1', last: { id: 1, body: 'old', sender_id: 'f1', created_at: iso(NOW - DAY) }, unread: 2 },
    { friendId: 'f2', last: { id: 2, body: 'new', sender_id: 'me', created_at: iso(NOW - MIN) }, unread: 0 },
    { friendId: 'gone', last: { id: 3, body: 'bye', sender_id: 'gone', created_at: iso(NOW - HOUR) }, unread: 4 },
    { friendId: 'f3', last: { id: 4, body: 'x', sender_id: 'f3', created_at: iso(NOW - 2 * HOUR) }, unread: 1, blockedByMe: true },
    { friendId: 'empty', last: null, unread: 0 },
  ];
  const rows = buildInbox(conv, friends, { people: { gone: { display_name: 'Morgan' } } });
  eq(rows.map(r => r.id), ['f2', 'gone', 'f3', 'f1'], 'newest first; a partner with no last message is skipped');
  const gone = rows.find(r => r.id === 'gone');
  eq([gone.name, gone.muted, gone.canSend, gone.unread, gone.note], ['Morgan', true, false, 0, 'Not friends any more'], 'a former friend is muted, read-only, and not counted unread');
  const blocked = rows.find(r => r.id === 'f3');
  eq([blocked.note, blocked.canSend, blocked.unread], ['Blocked', false, 0], 'blockedByMe from the data layer mutes the row');
  eq(buildInbox(conv, friends, { blocked: new Set(['f1']) }).find(r => r.id === 'f1').note, 'Blocked', 'a block known only from the blocks table also mutes');
  const susp = buildInbox(conv, friends, { people: { f2: { suspended_at: iso(NOW) } } }).find(r => r.id === 'f2');
  eq([susp.note, susp.canSend, susp.muted], ['Account suspended', false, true], 'a suspended friend is muted and read-only');
  eq(unreadTotal(rows), 2, 'the total only counts conversations you can act on');
  eq(buildInbox(conv, friends).find(r => r.id === 'gone').name, 'Former friend', 'no readable profile → a neutral name');
}

// ── live folding ──
{
  const base = [
    { friendId: 'f1', last: { id: 10, body: 'a', sender_id: 'f1', created_at: iso(NOW - HOUR) }, unread: 1 },
    { friendId: 'f2', last: { id: 11, body: 'b', sender_id: 'me', created_at: iso(NOW - 2 * HOUR) }, unread: 0 },
  ];
  const m = { id: 12, sender_id: 'f2', recipient_id: 'me', body: 'hey', created_at: iso(NOW), read_at: null };
  const next = bumpConversation(base, m, 'me');
  eq(next.map(c => c.friendId), ['f2', 'f1'], 'a new message moves its conversation to the top');
  eq(next[0].unread, 1, 'and counts unread');
  ok(bumpConversation(next, m, 'me') === next, 'the same message twice (realtime + poll) changes nothing');
  eq(bumpConversation(base, m, 'me', 'f2')[0].unread, 0, 'not counted while that thread is open');
  eq(bumpConversation(base, { ...m, sender_id: 'me', recipient_id: 'f1' }, 'me')[0], { friendId: 'f1', last: { id: 12, body: 'hey', sender_id: 'me', created_at: iso(NOW) }, unread: 1, blockedByMe: false }, 'my own message bumps without adding unread');
  ok(bumpConversation(base, { ...m, created_at: iso(NOW - 3 * HOUR), sender_id: 'f1' }, 'me') === base, 'an older straggler never replaces a newer preview');
  ok(bumpConversation(base, { ...m, id: 'tmp-1' }, 'me') === base, 'a pending bubble is not an inbox event');
  eq(bumpConversation(base, { ...m, sender_id: 'new', recipient_id: 'me' }, 'me')[0].friendId, 'new', 'an unknown partner gets a fresh row');
  eq(clearUnread(next, 'f2')[0].unread, 0, 'opening a thread clears its count');
  ok(clearUnread(base, 'f2') === base, 'clearing an already-read thread returns the same array');
}

console.log(`dm view: ${n} assertions passed`);
