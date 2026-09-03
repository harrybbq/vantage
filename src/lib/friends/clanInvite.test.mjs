/**
 * The invite rides inside a free-text message body, so the parser is the
 * whole contract. What matters: it round-trips, it does not fire on
 * ordinary messages, and a name containing the separator does not break
 * it — which is the reason the code comes first.
 */
import assert from 'node:assert/strict';
import { formatInvite, parseInvite, isInvite, INVITE_PREFIX, isClanMember } from './clanInvite.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ── Round trip ──
{
  const body = formatInvite({ inviteCode: '7QK2P9', name: 'Night Owls' });
  eq(body, '⚔ Clan invite · code 7QK2P9 · Night Owls', 'the body reads as a sentence');
  eq(parseInvite(body), { code: '7QK2P9', name: 'Night Owls' }, 'and parses back');
  ok(isInvite(body), 'and is recognised');
}

// ── A name containing the separator — the reason code comes first ──
{
  const body = formatInvite({ inviteCode: 'ABCD', name: 'Rest · Day · Crew' });
  eq(parseInvite(body).code, 'ABCD', 'the code survives a name full of separators');
  eq(parseInvite(body).name, 'Rest · Day · Crew', 'and the whole name comes back intact');
}

// ── Ordinary messages must never look like invites ──
{
  const notInvites = [
    'hey, want to join my clan?',
    'code 7QK2P9',
    'Clan invite',
    '⚔ Clan invite',                        // prefix started, no code
    `${INVITE_PREFIX}`,                      // prefix only
    `${INVITE_PREFIX}shout · Night Owls`,    // lowercase, not a code shape
    `${INVITE_PREFIX}!!!! · Night Owls`,     // punctuation, not a code shape
    `${INVITE_PREFIX}ab · Night Owls`,       // too short to be a code
    'talk about the ⚔ Clan invite · code ABCD later',   // not at the start
    '',
  ];
  for (const body of notInvites) {
    eq(parseInvite(body), null, `not an invite: ${JSON.stringify(body.slice(0, 40))}`);
  }
  eq(parseInvite(null), null, 'null is not an invite');
  eq(parseInvite(undefined), null, 'nor undefined');
  eq(parseInvite(42), null, 'nor a number');
  eq(parseInvite({ body: 'x' }), null, 'nor an object');
}

// ── Refusing to build one ──
{
  eq(formatInvite(null), null, 'no group, no invite');
  eq(formatInvite({}), null, 'no code, no invite');
  eq(formatInvite({ inviteCode: '', name: 'x' }), null, 'an empty code is no code');
  eq(formatInvite({ inviteCode: 'ab', name: 'x' }), null, 'and a malformed one is refused rather than sent');
  eq(formatInvite({ inviteCode: 'ZZZZ' }), '⚔ Clan invite · code ZZZZ · my clan',
    'a nameless group still reads sensibly rather than trailing off');
  eq(parseInvite(formatInvite({ inviteCode: 'ZZZZ' })), { code: 'ZZZZ', name: 'my clan' },
    'and round-trips with that stand-in');
  // A body with no name segment at all — the code is the part that works.
  eq(parseInvite('⚔ Clan invite · code ZZZZ'), { code: 'ZZZZ', name: '' },
    'an invite with no name is still joinable');
}

// ── Tolerances ──
{
  eq(parseInvite('  ⚔ Clan invite · code ABCD · Owls  '), { code: 'ABCD', name: 'Owls' },
    'surrounding whitespace is forgiven');
  eq(parseInvite('⚔ Clan invite · code A1B2-C3D4 · Owls').code, 'A1B2-C3D4',
    'hyphens are part of a code');
  const long = 'X'.repeat(32);
  eq(parseInvite(`${INVITE_PREFIX}${long} · Owls`).code, long, 'a 32-character code is accepted');
  eq(parseInvite(`${INVITE_PREFIX}${'X'.repeat(33)} · Owls`), null, 'a 33-character one is not');
}

// ── Who is already in ──
// An invite offered to an existing member sends a code that works and is
// then refused with "you are already in a group". Better not to offer it.
{
  const members = [{ userId: 'a', name: 'Amy' }, { userId: 'b', name: 'Ben' }];
  ok(isClanMember(members, 'a'), 'a member is recognised');
  ok(!isClanMember(members, 'zzz'), 'a non-member is not');
  ok(!isClanMember(members, null), 'nobody is not a member');
  ok(!isClanMember(members, undefined), 'and neither is undefined');
  ok(!isClanMember(null, 'a'), 'a board still loading reports nobody rather than throwing');
  ok(!isClanMember(undefined, 'a'), 'and so does a missing members list');
  ok(!isClanMember([null, undefined, {}], 'a'), 'ragged rows do not throw');
  ok(!isClanMember('not an array', 'a'), 'nor does the wrong type entirely');
}

console.log(`clan invite: ${n} assertions passed`);
