/**
 * Mute (item 113; ABUSE_HANDLING G-1): the stored shape, the updaters'
 * no-op discipline, what a muted person's conversation and badge do,
 * how two devices' mutes merge, and that a state without the key loads
 * exactly as before. Plus the supportive-information copy (G-2): its
 * numbers agree with the report sheet and the coach.
 */
import assert from 'node:assert/strict';
import {
  readMutes, isMuted, mutedIds, mutedList, muteUser, unmuteUser,
  silenceInbox, silenceFriends, badgeUnread, audibleUnread,
} from './mutes.js';
import { buildInbox, unreadTotal } from './dmView.js';
import { mergeState, sameValue } from '../state/merge.js';
import { supportLines, plainText, linksIn, HELP, BLOCKED_BODY, REQUEST_LINE } from '../safety/support.js';
import { SIGNPOSTS } from '../moderation/reasons.js';
import { HELPLINES } from '../coach/safety.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const T0 = new Date('2026-10-22T09:00:00Z');
const T1 = new Date('2026-10-22T10:00:00Z');

// A realistic slice of a real state: the stores the merge must not touch.
const STATE = Object.freeze({
  habits: [{ id: 'h1', name: 'No alcohol', relapses: 3 }],
  savings: [{ id: 's1', name: 'Holiday', saved: 420 }],
  vitalsLog: { '2026-10-21': { weight: 81.2, sleep: 7.1 } },
  privacy: { shareStreak: false },
  theme: 'dark-os',
});

// ── Reading ──
{
  eq(readMutes(STATE.mutedUsers), {}, 'a state without the key reads as no one muted');
  eq(readMutes(null), {}, 'null is no one muted');
  eq(readMutes('junk'), {}, 'a malformed value reads as no one muted');
  eq(readMutes({ [A]: '2026-10-01T00:00:00Z' }), { [A]: { at: '2026-10-01T00:00:00Z' } }, 'the bare-ISO form the G-1 sketch used still reads');
  eq(readMutes({ [A]: 7, [B]: { at: 'x' } }), { [B]: { at: 'x' } }, 'entries that are neither are skipped');
  ok(!('mutedUsers' in STATE), 'reading never adds the key');
  ok(!isMuted(STATE.mutedUsers, A), 'not muted by default');
  ok(!isMuted({ [A]: { at: 'x' } }, null), 'a missing id is never muted');
  eq(mutedIds({ [B]: {}, [A]: {}, "x') or 1=1": {} }), [A, B], 'ids for a query filter: uuid characters only, sorted');
}

// ── Updaters ──
{
  const s1 = muteUser(STATE, { id: A, name: 'Aidan Clarke', handle: 'aidan' }, T0);
  eq(s1.mutedUsers, { [A]: { at: T0.toISOString(), name: 'Aidan Clarke', handle: 'aidan' } }, 'mute stores when, and a name for the Settings list');
  for (const k of Object.keys(STATE)) ok(s1[k] === STATE[k], `mute leaves ${k} as the same object`);
  eq(Object.keys(s1).sort(), [...Object.keys(STATE), 'mutedUsers'].sort(), 'mute adds exactly one top-level key');
  ok(isMuted(s1.mutedUsers, A), 'then they read as muted');

  ok(muteUser(s1, { id: A, name: 'Other' }, T1) === s1, 'muting someone already muted returns the same state — no save queued');
  ok(muteUser(s1, null) === s1, 'no person, no change');
  ok(muteUser(s1, { id: '' }) === s1, 'an empty id, no change');
  ok(unmuteUser(STATE, A) === STATE, 'unmuting on a state without the key returns the same state');
  ok(unmuteUser(s1, B) === s1, 'unmuting someone not muted returns the same state');

  const s2 = muteUser(s1, { id: B, name: 'x'.repeat(200) }, T1);
  eq(s2.mutedUsers[B].name.length, 80, 'a snapshot name is capped');
  eq(mutedList(s2.mutedUsers).map(p => p.id), [B, A], 'the list is most recently muted first');

  const s3 = unmuteUser(s2, A);
  eq(Object.keys(s3.mutedUsers), [B], 'unmute removes only that person');
  for (const k of Object.keys(STATE)) ok(s3[k] === STATE[k], `unmute leaves ${k} as the same object`);
  ok(s2.mutedUsers[A], 'the updaters never mutate their input');
  const s4 = unmuteUser(s3, B);
  eq(s4.mutedUsers, {}, 'unmuting the last person leaves an empty map, nothing else changes');
  ok(sameValue({ ...s4, mutedUsers: undefined }, { ...STATE, mutedUsers: undefined }), 'mute then unmute: everything else identical to the state loaded');
}

// ── Inbox: a muted friend's conversation ──
{
  const NOW = Date.parse('2026-10-22T12:00:00Z');
  const at = m => new Date(NOW - m * 60_000).toISOString();
  const friends = [{ id: A, name: 'Aidan' }, { id: B, name: 'Beth' }, { id: C, name: 'Cal' }];
  const conversations = [
    { friendId: A, last: { id: 1, body: 'hi', sender_id: A, created_at: at(1) }, unread: 4 },
    { friendId: B, last: { id: 2, body: 'yo', sender_id: B, created_at: at(5) }, unread: 2 },
    { friendId: C, last: { id: 3, body: 'k', sender_id: C, created_at: at(9) }, unread: 1, blockedByMe: true },
  ];
  const inbox = buildInbox(conversations, friends);
  eq(unreadTotal(inbox), 6, 'baseline: unread counts friends, not the blocked row');

  const none = silenceInbox(inbox, {});
  ok(none === inbox, 'no one muted: the same rows back');
  eq(audibleUnread(none), unreadTotal(inbox), 'and the badge is the ordinary total');

  const muted = { [A]: { at: 'x' } };
  const rows = silenceInbox(inbox, muted);
  eq(rows.map(r => r.id), [B, C, A], 'the muted conversation sorts below the others');
  ok(rows[2].silenced && !rows[2].muted, 'flagged silenced, not the greyed `muted`');
  eq(rows[2].unread, 4, 'its unread count is kept, not thrown away');
  eq(rows[2].last.body, 'hi', 'and the conversation is still there to read');
  eq(audibleUnread(rows), 2, 'a muted friend’s messages don’t change the unread total');
  eq(badgeUnread(rows[2]), 0, 'nor their own row’s badge');

  const mutedThenBlocked = silenceInbox(inbox, { [C]: { at: 'x' } });
  const c = mutedThenBlocked.find(r => r.id === C);
  eq(c.note, 'Blocked', 'muted, then blocked: still reads "Blocked"');
  ok(!c.silenced, 'and is not moved into Muted');

  eq(audibleUnread(silenceInbox(inbox, unmuteUser({ mutedUsers: muted }, A).mutedUsers)), 6, 'unmute restores the count');

  const list = [{ id: C, n: 1 }, { id: A, n: 2 }, { id: B, n: 3 }];
  eq(silenceFriends(list, muted).map(r => r.id), [C, B, A], 'friend rows: muted to the end, order otherwise kept');
  ok(silenceFriends(list, { [C + 'x']: {} }) === list, 'friend rows: same array when no one listed is muted');
}

// ── Merge across devices (lib/state/merge.js, unchanged) ──
{
  const base = { ...STATE };
  const phone = muteUser(base, { id: A }, T0);
  const desk = muteUser(base, { id: B }, T1);
  const both = mergeState(base, phone, desk).state;
  eq(Object.keys(both.mutedUsers).sort(), [A, B], 'muted on two devices before the key existed: both kept');
  eq(both.habits, STATE.habits, 'and nothing else moves');

  const synced = both;
  const unA = unmuteUser(synced, A);
  const r1 = mergeState(synced, unA, synced).state;
  eq(Object.keys(r1.mutedUsers), [B], 'unmuted on one device, the other untouched: the unmute wins');

  const unAplusC = mergeState(synced, unA, muteUser(synced, { id: C }, T1)).state;
  eq(Object.keys(unAplusC.mutedUsers).sort(), [B, C], 'unmute here, a different mute there: both happen');

  const remuted = { ...synced, mutedUsers: { ...synced.mutedUsers, [A]: { at: T1.toISOString() } } };
  const r2 = mergeState(synced, unA, remuted).state;
  ok(isMuted(r2.mutedUsers, A), 'unmuted on one device while the other re-muted the same person: kept muted (a merge never deletes what the other side changed)');

  const noKey = mergeState(base, base, base).state;
  ok(!('mutedUsers' in noKey) && sameValue(noKey, base), 'a state without the key merges to itself, key still absent');
}

// ── Supportive information (G-2) ──
{
  const short = supportLines();
  eq(short.map(l => l.id), ['childline', 'ceop', 'emergency'], 'after a report or block: Childline, CEOP, 999');
  eq(supportLines({ full: true }).map(l => l.id), ['childline', 'ceop', 'samaritans', 'emergency'], 'Settings adds Samaritans');
  ok(plainText(short[0]).includes('0800 1111') && plainText(short[0]).includes('childline.org.uk'), 'Childline number and site in the words');
  ok(plainText(short[1]).includes('ceop.police.uk'), 'CEOP site in the words');

  eq(supportLines({ already: SIGNPOSTS.selfHarm }).map(l => l.id), ['ceop'], 'self-harm signpost already names 999 and Childline: only CEOP added');
  eq(supportLines({ already: SIGNPOSTS.child }).map(l => l.id), ['childline'], 'child-safety signpost already names 999 and CEOP: only Childline added');
  eq(supportLines({ already: SIGNPOSTS.threat }).map(l => l.id), ['childline', 'ceop'], 'threat signpost names 999: the rest added');

  eq(HELP.childline.phone, HELPLINES.childline, 'Childline number matches the coach');
  eq(HELP.samaritans.phone, HELPLINES.samaritans, 'Samaritans number matches the coach');
  eq(HELP.emergency.phone, HELPLINES.emergency, '999 matches the coach');
  ok(SIGNPOSTS.selfHarm.includes(HELP.childline.phone) && SIGNPOSTS.selfHarm.includes(HELP.samaritans.phone), 'and the report sheet');
  ok(SIGNPOSTS.child.includes(HELP.ceop.site), 'CEOP site matches the report sheet');

  for (const l of linksIn(supportLines({ full: true }))) {
    ok(/^(tel:\d+|https:\/\/[a-z.]+(\/.*)?)$/.test(l.href), `link ${l.href} is tel: digits or https`);
    if (l.href.startsWith('tel:')) eq(l.href.slice(4), l.text.replace(/\s/g, ''), `${l.text}: tel: dials what it shows`);
  }
  ok(BLOCKED_BODY('Aidan').startsWith('Aidan can'), 'block notice names the person');
  ok(!/urgent|warning|danger(?! right now)/i.test([REQUEST_LINE, BLOCKED_BODY('x'), ...supportLines({ full: true }).map(plainText)].join(' ')), 'no alarm words');
}

console.log(`mutes + support: ${n} assertions passed`);
