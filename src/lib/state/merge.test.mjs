/**
 * The merge decides whether data survives, so the awkward cases are the
 * ones written down: two devices touching the same day, the same habit,
 * the same array; a delete racing an edit; and the two symptoms that
 * were actually reported.
 *
 * The first block is a REPRODUCTION of the old behaviour — it shows what
 * the unconditional whole-state upsert did — so the fix is measured
 * against the bug rather than against an assertion that it is fixed.
 */
import assert from 'node:assert/strict';
import { mergeState, sameValue } from './merge.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ── The bug, reproduced ──────────────────────────────────────────────
// Whole-state upsert with no compare-and-set: whoever writes last wins,
// and the other device's work is gone with no error anywhere.
{
  const cloudAtLogin = { profile: { name: 'H' }, logs: {}, coins: 10 };
  const phone = { ...cloudAtLogin, logs: { '2026-08-25': { gym: true } } };
  const desktopStale = { ...cloudAtLogin };            // opened before, never refreshed

  let cloud = cloudAtLogin;
  cloud = phone;                                       // phone saves
  const lastWriteWins = { ...desktopStale };           // desktop saves its stale copy
  cloud = lastWriteWins;
  eq(cloud.logs, {}, 'REPRODUCED: the old upsert loses the phone\'s tracker entirely');

  const { state } = mergeState(cloudAtLogin, desktopStale, phone);
  eq(state.logs, { '2026-08-25': { gym: true } },
    'merged: the desktop writing later keeps the phone\'s tracker');
}

// ── sameValue ──
ok(sameValue(1, 1) && sameValue('a', 'a') && sameValue(null, null), 'primitives compare');
ok(!sameValue(null, undefined), 'null and undefined are not the same');
ok(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), 'deep structures compare');
ok(!sameValue({ a: 1 }, { a: 1, b: 2 }), 'an extra key is a difference');
ok(!sameValue([1, 2], [2, 1]), 'array order matters');

// ── Rules 1–2: only one side changed ──
{
  const base = { coins: 5, theme: 'dark-os', logs: {} };
  eq(mergeState(base, { ...base, coins: 9 }, base).state.coins, 9, 'only local changed → local wins');
  eq(mergeState(base, base, { ...base, coins: 7 }).state.coins, 7, 'only remote changed → remote wins');
  eq(mergeState(base, base, base).state.coins, 5, 'neither changed → unchanged');
  eq(mergeState(base, { ...base, coins: 9 }, base).state.theme, 'dark-os', 'untouched keys are left alone');
}

// ── Rule 3: date-keyed stores union ──
{
  const base = { logs: { '2026-08-20': { a: true } }, vitalsLog: {} };
  const phone = { logs: { '2026-08-20': { a: true }, '2026-08-25': { gym: true } }, vitalsLog: {} };
  const desk = { logs: { '2026-08-20': { a: true }, '2026-08-24': { run: true } }, vitalsLog: {} };
  const { state } = mergeState(base, phone, desk);
  eq(Object.keys(state.logs).sort(), ['2026-08-20', '2026-08-24', '2026-08-25'],
    'two devices logging different days both survive');

  // The harder one: the SAME day, different trackers.
  const p2 = { logs: { '2026-08-25': { gym: true } } };
  const d2 = { logs: { '2026-08-25': { water: true } } };
  const m2 = mergeState({ logs: {} }, p2, d2).state;
  eq(m2.logs['2026-08-25'], { gym: true, water: true },
    'the same day on two devices merges tracker by tracker');

  // And weight logged on one device, sleep on the other, same date.
  const p3 = { vitalsLog: { '2026-08-25': { weight: 78 } } };
  const d3 = { vitalsLog: { '2026-08-25': { sleep: 7 } } };
  eq(mergeState({ vitalsLog: {} }, p3, d3).state.vitalsLog['2026-08-25'],
    { weight: 78, sleep: 7 }, 'and so does a vitals day');
}

// ── Rule 4: arrays of things with ids ──
{
  const h = (id, extra = {}) => ({ id, name: id, startTime: 1000, ...extra });
  const base = { habits: [h('a'), h('b')] };
  // Phone resets habit a; desktop renames habit b.
  const phone = { habits: [h('a', { startTime: 5000 }), h('b')] };
  const desk = { habits: [h('a'), { ...h('b'), name: 'renamed' }] };
  const { state } = mergeState(base, phone, desk);
  eq(state.habits.length, 2, 'no habit is duplicated');
  eq(state.habits.find(x => x.id === 'a').startTime, 5000, 'the reset survives');
  eq(state.habits.find(x => x.id === 'b').name, 'renamed', 'and so does the rename');

  // Both edited the SAME habit, different fields.
  const p2 = { habits: [h('a', { startTime: 5000 })] };
  const d2 = { habits: [h('a', { relapseCount: 3 })] };
  const m2 = mergeState({ habits: [h('a')] }, p2, d2).state.habits[0];
  eq(m2.startTime, 5000, 'same habit, different fields: this device\'s field survives');
  eq(m2.relapseCount, 3, 'and so does the other device\'s');

  // Added on both.
  const p3 = { habits: [h('a'), h('new-phone')] };
  const d3 = { habits: [h('a'), h('new-desk')] };
  eq(mergeState({ habits: [h('a')] }, p3, d3).state.habits.map(x => x.id),
    ['a', 'new-phone', 'new-desk'], 'additions from both devices are kept, local order first');
}

// ── The overriding rule: a merge never deletes what the other side changed ──
{
  const h = (id, extra = {}) => ({ id, name: id, ...extra });
  const base = { habits: [h('a'), h('b')] };

  // Deleted here, untouched there → the delete stands.
  const del = { habits: [h('a')] };
  eq(mergeState(base, del, base).state.habits.map(x => x.id), ['a'],
    'a delete the other device never touched is honoured');

  // Deleted here, EDITED there → kept, and reported.
  const edited = { habits: [h('a'), h('b', { name: 'still using this' })] };
  const r = mergeState(base, del, edited);
  eq(r.state.habits.map(x => x.id).sort(), ['a', 'b'],
    'a delete racing an edit keeps the item — losing it is unrecoverable, keeping it is a nuisance');
  ok(r.conflicts.some(c => c.includes('deleted on one device')), 'and says so');

  // Same for an object key.
  const kb = { backgrounds: { hub: 'x.jpg', shop: 'y.jpg' } };
  const kdel = { backgrounds: { hub: 'x.jpg' } };
  const kedit = { backgrounds: { hub: 'x.jpg', shop: 'CHANGED.jpg' } };
  eq(mergeState(kb, kdel, kedit).state.backgrounds,
    { hub: 'x.jpg', shop: 'CHANGED.jpg' }, 'a removed key the other side changed is kept');
  eq(mergeState(kb, kdel, kb).state.backgrounds, { hub: 'x.jpg' },
    'but a removal the other side left alone goes through');
}

// ── Rule 5: genuinely irreconcilable, and reported ──
{
  const base = { coins: 10 };
  const r = mergeState(base, { coins: 25 }, { coins: 40 });
  eq(r.state.coins, 25, 'a scalar changed on both takes this device\'s value');
  eq(r.conflicts.length, 1, 'and is reported rather than swallowed');
  ok(r.conflicts[0].includes('coins'), 'naming the key that could not be reconciled');
  eq(mergeState(base, { coins: 25 }, { coins: 25 }).conflicts, [],
    'agreeing on the same new value is not a conflict');
}

// ── No common ancestor ──
{
  const r = mergeState(null, { logs: { d1: { a: 1 } } }, { logs: { d2: { b: 2 } } });
  eq(r.state.logs, { d1: { a: 1 }, d2: { b: 2 } },
    'with no base known it still keeps both sides rather than picking one');
  eq(mergeState(undefined, { a: 1 }, {}).state.a, 1, 'an undefined base does not throw');
}

// ── The reported symptom, end to end ─────────────────────────────────
// "OVR 31 on mobile, 29 on desktop at the same moment." OVR is derived
// from trackers and logs, so the two devices disagreeing means their
// logs disagree. Merging makes both devices agree on the union.
{
  const base = {
    profile: { name: 'H' },
    trackers: [{ id: 't1', name: 'Gym' }, { id: 't2', name: 'Water' }],
    logs: { '2026-08-24': { t1: true } },
    savings: [{ id: 's1', name: 'House', current: 100 }],
  };
  const mobile = {
    ...base,
    logs: { '2026-08-24': { t1: true }, '2026-08-25': { t1: true, t2: true } },
  };
  const desktop = {
    ...base,
    savings: [{ id: 's1', name: 'House', current: 250 }],
  };
  const { state, conflicts } = mergeState(base, mobile, desktop);
  eq(state.logs['2026-08-25'], { t1: true, t2: true }, 'the mobile session survives');
  eq(state.savings[0].current, 250, 'and the desktop contribution survives');
  eq(conflicts, [], 'with nothing irreconcilable, because they touched different stores');
}

// ── It must not mangle a state it has no business changing ──
{
  const rich = {
    profile: { name: 'H', photo: 'data:image/png;base64,AAA' },
    backgrounds: { hub: 'bg.jpg' },
    logs: { d: { t: true } },
    habits: [{ id: 'h', name: 'x' }],
    coins: 3,
  };
  eq(mergeState(rich, rich, rich).state, rich, 'merging three identical states is the identity');
  ok(mergeState(rich, rich, rich).state.profile.photo === rich.profile.photo,
    'and the photo in particular is untouched — it is the thing a bad write nulls');
}

/* ══════════════════════════════════════════════════════════════════════
   The whole algorithm, against a cloud that behaves like the database.
   ══════════════════════════════════════════════════════════════════════
   The merge is only half the fix; the other half is compare-and-set. This
   simulates the real sequence — two clients, one row, conditional writes —
   so the thing being checked is the algorithm rather than the pieces.
*/
function makeCloud(initial) {
  let row = { state: initial, updated_at: 't0' };
  let tick = 0;
  return {
    read: () => ({ ...row }),
    // Mirrors the .update().eq('updated_at', base) path: no match, no write.
    write(state, base) {
      if (base != null && base !== row.updated_at) return { conflict: true };
      row = { state, updated_at: 't' + (++tick) };
      return { updatedAt: row.updated_at };
    },
  };
}

/** One client's save, with the same conflict handling the hook uses. */
function clientSave(cloud, client) {
  let res = cloud.write(client.local, client.base);
  if (!res.conflict) {
    client.base = res.updatedAt;
    client.baseState = client.local;
    return { merged: false };
  }
  const fresh = cloud.read();
  const { state: merged, conflicts } = mergeState(client.baseState, client.local, fresh.state);
  res = cloud.write(merged, fresh.updated_at);
  ok(!res.conflict, 'the write after a merge lands');
  client.base = res.updatedAt;
  client.baseState = merged;
  client.local = merged;
  return { merged: true, conflicts };
}

{
  // The exact reported sequence: phone logs a tracker, desktop has been
  // open since before that and then saves.
  const start = { profile: { name: 'H' }, logs: { '2026-08-24': { t1: true } }, coins: 10 };
  const cloud = makeCloud(start);

  const phone = { base: 't0', baseState: start, local: { ...start, logs: { ...start.logs, '2026-08-25': { t1: true } } } };
  const desktop = { base: 't0', baseState: start, local: { ...start, coins: 15 } };

  const a = clientSave(cloud, phone);
  eq(a.merged, false, 'the phone saves cleanly — it was first');

  const b = clientSave(cloud, desktop);
  eq(b.merged, true, 'the stale desktop is refused and merges instead of overwriting');
  eq(cloud.read().state.logs['2026-08-25'], { t1: true }, 'the phone\'s tracker is still there');
  eq(cloud.read().state.coins, 15, 'and the desktop\'s change landed too');

  // Now the phone comes back and saves again — it is the stale one this time.
  phone.local = { ...phone.local, logs: { ...phone.local.logs, '2026-08-26': { t1: true } } };
  const c = clientSave(cloud, phone);
  eq(c.merged, true, 'and it works the other way round');
  const final = cloud.read().state;
  eq(Object.keys(final.logs).sort(), ['2026-08-24', '2026-08-25', '2026-08-26'], 'every day survives');
  eq(final.coins, 15, 'and so does the coin change made on the other device');
}

{
  // Three writes racing: none may be lost.
  const start = { profile: {}, logs: {} };
  const cloud = makeCloud(start);
  const mk = day => ({ base: 't0', baseState: start, local: { profile: {}, logs: { [day]: { t: true } } } });
  const a = mk('d1'); const b = mk('d2'); const c = mk('d3');
  clientSave(cloud, a); clientSave(cloud, b); clientSave(cloud, c);
  eq(Object.keys(cloud.read().state.logs).sort(), ['d1', 'd2', 'd3'],
    'three devices writing against the same base all survive');
}

{
  // A client with no base (first ever write) is unconditional, as today.
  const cloud = makeCloud({ profile: {} });
  const res = cloud.write({ profile: {}, x: 1 }, null);
  ok(!res.conflict, 'a null base writes unconditionally — nothing exists yet to lose');
}

// ── The 2026-09-25 incident: a replay with no common ancestor ────────
//
// A desktop killed inside the debounce window leaves a snapshot in
// localStorage. Days later it is opened and the snapshot replays. Its
// stored version no longer matches the cloud, so there is no common
// ancestor — and the merge was called with an empty base, on the
// reasoning that "every key looks changed on both sides, so it keeps
// both".
//
// Objects and id-arrays do keep both. The LEAVES underneath them fell
// through to the last-resort rule, which took local. So an empty base
// handed every number in the state to whichever device happened to be
// doing the merge, however old its copy was: four relapses recorded on
// the phone in between were undone, the counters went DOWN, tracker
// streaks lost a week, and a savings pot was left reading £1,002 less
// than the sum of its own contributions — because the contributions
// merged by id and the total did not.
{
  const habit = (relapseCount, startTime) => ({
    id: 'h-flan', name: 'Flannagan', relapseCount, startTime,
    strikesPeriod: 'week', strikeTimes: [], milestones: [],
  });
  // Self-consistent on both sides: `current` always equals the ledger.
  const pot = (contribs) => ({
    id: 'sv1', name: 'House',
    current: contribs.reduce((t, c) => t + c.amount, 0),
    contributions: contribs,
  });
  const older = [{ id: 'c1', amount: 17400 }, { id: 'c2', amount: 1592 }];
  const newer = [...older, { id: 'c3', amount: 1002 }];

  const stale = {                       // the desktop, last open days ago
    habits: [habit(61, 1_758_000_000_000)],
    savings: [pot(older)],
    streaks: { t1: { best: 5, current: 1, lastDate: '2026-09-18' } },
    coins: 45,
  };
  const cloud = {                       // everything done on the phone since
    habits: [habit(65, 1_758_700_000_000)],
    savings: [pot(newer)],
    streaks: { t1: { best: 5, current: 1, lastDate: '2026-09-24' } },
    coins: 85,
  };

  // What shipped, reproduced.
  const was = mergeState({}, stale, cloud).state;
  eq(was.habits[0].relapseCount, 61, 'REPRO: the stale device wins the counter…');
  ok(was.habits[0].relapseCount < cloud.habits[0].relapseCount,
    'REPRO: …so a count of things that HAPPENED goes down, which it cannot');
  eq(was.streaks.t1.lastDate, '2026-09-18', 'REPRO: and the streak loses a week');
  ok(was.savings[0].current !== was.savings[0].contributions.reduce((t, c) => t + c.amount, 0),
    'REPRO: and the pot disagrees with its own ledger — the contributions merged, the total did not');

  // The fix: with no common ancestor, the cloud wins what cannot be
  // reconciled. The replayed snapshot is older by construction.
  const now = mergeState({}, stale, cloud, { tieBreak: 'remote' });
  const h = now.state.habits[0];
  const g = now.state.savings[0];
  eq(h.relapseCount, 65, 'the four relapses survive the replay');
  eq(h.startTime, 1_758_700_000_000, 'and so does the timer they reset');
  eq(now.state.streaks.t1.lastDate, '2026-09-24', 'the streak keeps its week');
  eq(now.state.coins, 85, 'and the coins earned in between are still there');
  eq(g.current, g.contributions.reduce((t, c) => t + c.amount, 0),
    'the pot total and its ledger come from the same side, so they agree');
  eq(g.contributions.length, 3, 'with the contribution added in between kept');
  ok(now.conflicts.length > 0, 'and every one of those is reported rather than swallowed');
  ok(now.conflicts.every(c => /cloud/.test(c) || /kept/.test(c)),
    'saying which side won, so a notice can tell the user the truth');
}

{
  // The other direction is unchanged: with a KNOWN ancestor, the person
  // at this screen wins a genuine conflict. That is the whole reason
  // rule 5 exists and the fix must not quietly reverse it.
  const base   = { note: 'a', coins: 10 };
  const local  = { note: 'b', coins: 10 };
  const remote = { note: 'c', coins: 10 };
  eq(mergeState(base, local, remote).state.note, 'b',
    'a known base still keeps what this device just typed');
  eq(mergeState(base, local, remote, { tieBreak: 'local' }).state.note, 'b',
    'and saying so explicitly changes nothing');
}

{
  // An unreconcilable value only ONE side moved is not a tie, so the
  // tie-break must not touch it — otherwise 'remote' would throw away
  // every edit made on this device since the snapshot.
  const stale  = { note: 'edited here', untouched: 7 };
  const cloud  = { note: 'original',    untouched: 7 };
  const out = mergeState({}, stale, cloud, { tieBreak: 'remote' });
  eq(out.state.untouched, 7, 'a value both sides agree on is never a conflict');
  eq(out.state.note, 'original',
    'with no ancestor, a differing value IS a tie — there is no way to know who moved it');
}

console.log(`state merge: ${n} assertions passed (including the two-device simulation)`);
