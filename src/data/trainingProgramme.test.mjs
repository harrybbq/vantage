/**
 * The programme's own guards.
 *
 * assertNoBannedLifts() and cycleCarbBalance() were written to be run —
 * the first says so in its own docstring — and neither was called from
 * anywhere. A guard that never executes is a comment. This runs them,
 * and the build runs this.
 *
 * The banned-lift check is the one that matters: there is ongoing
 * chiropractic care for mid-thoracic pain, and the whole point of the
 * list is that a future edit cannot quietly put a back squat or a
 * deadlift in front of someone being treated for it.
 */
import assert from 'node:assert/strict';
import {
  PROGRAMME, SESSION_CODES, STRETCHES, BANNED_LIFTS,
  assertNoBannedLifts, cycleCarbBalance, carbDeltaFor, targetsForDay,
  exercisesFor, stretchesFor, targetsFor, DAY_TYPE_TARGETS, FLOOR_MACROS,
  NIGHT_LOAD_SCALE, KCAL_PER_CARB_G,
  COMMUTE, commuteMinutes, commuteKcal, commutesOn, commuteForDay,
} from './trainingProgramme.js';
import { SEQ, TRAIN_POS, REST_POS } from '../lib/rotation/pattern.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ── The guard that protects a spine under treatment ──
eq(assertNoBannedLifts(), [], 'no contraindicated lift is prescribed anywhere');

// And it must actually catch one, or the empty result above means nothing.
const sneaky = {
  Legs: [{ name: 'Barbell Back Squat (heavy)', sets: 5, reps: '5' }],
  Pull: [{ name: 'Romanian Deadlift', sets: 3, reps: '8' }],
  Lower: [{ name: 'Barbell RDL', sets: 3, reps: '8' }],
};
const caught = assertNoBannedLifts(sneaky);
eq(caught.length, 3, 'the guard catches all three banned patterns');
ok(caught.some(t => t.includes('back squat')), 'including a capitalised, parenthesised back squat');
ok(caught.some(t => t.includes('deadlift')), 'and a deadlift under another name');
ok(BANNED_LIFTS.length === 3, 'three patterns are guarded');
// The hip thrust and hyperextension carry the posterior chain instead —
// they must NOT be mistaken for the lifts they replace.
eq(assertNoBannedLifts({ Lower: [{ name: 'Hip thrust' }, { name: '45° hyperextension' }, { name: 'Seated leg curl' }] }), [],
  'the sanctioned substitutes are not false positives');

// ── Every session is real ──
for (const code of SESSION_CODES) {
  const list = exercisesFor(code);
  ok(list.length >= 5, `${code}: has a full session, not a stub`);
  ok(list.every(e => e.name && e.sets > 0 && e.reps), `${code}: every entry names a movement, sets and reps`);
  ok(new Set(list.map(e => e.name)).size === list.length, `${code}: no movement listed twice in one session`);
  ok(stretchesFor(code).length >= 3, `${code}: carries a stretch block`);
}
eq(exercisesFor('Rest'), [], 'a rest day prescribes nothing');
ok(stretchesFor('Rest').length >= 4, 'but still gets the longer rest-day flow');
ok(stretchesFor('Nonsense') === STRETCHES.Rest, 'an unknown session falls back to the rest flow');

// ── The gap that prompted this: knee-flexion hamstring work ──
// Hyperextensions train the hamstring as a hip extensor only. Without a
// curl somewhere the split trains half the muscle, which is what the
// Lower day was written to fix.
const everything = SESSION_CODES.flatMap(c => exercisesFor(c).map(e => e.name.toLowerCase()));
ok(everything.some(nme => nme.includes('leg curl')), 'the split contains knee-flexion hamstring work');
ok(everything.some(nme => nme.includes('hip thrust')), 'and loaded hip extension');
ok(everything.some(nme => nme.includes('seated calf')), 'soleus is trained seated, not only standing');
ok(everything.some(nme => nme.includes('standing calf')), 'and gastrocnemius standing');

// ── Optional movements are marked, not missing ──
const optional = SESSION_CODES.flatMap(c => exercisesFor(c).filter(e => e.optional));
ok(optional.length >= 2, 'the "sometimes" movements are flagged rather than dropped');
ok(optional.every(e => e.sets > 0), 'and still carry a prescription for when they are done');

// ── Carb cycling still balances over a cycle ──
// Ten training days (each session twice) and six rest days. If this is
// not zero the fortnightly average has moved and the deficit the whole
// recomposition depends on is not what the plan says.
const cycle = [...SESSION_CODES, ...SESSION_CODES, ...Array(6).fill('Rest')];
eq(cycle.length, 16, 'a cycle is sixteen days');
eq(cycleCarbBalance(cycle), 0, 'the carb cycling redistributes and does not inflate');
eq(carbDeltaFor('Legs'), 45, 'the big lower days get the most');
eq(carbDeltaFor('Rest'), -45, 'and the rest days pay for it');
eq(carbDeltaFor('Arms'), 0, 'a hand-swapped session sits at baseline rather than guessing');

// ── Day targets ──
const legsOnOff = targetsForDay('off', 'Legs');
eq(legsOnOff.carbs, DAY_TYPE_TARGETS.off.carbs + 45, 'a leg day adds its carbs to the shift baseline');
eq(legsOnOff.kcal, DAY_TYPE_TARGETS.off.kcal + 45 * KCAL_PER_CARB_G, 'and the calories follow the carbs, so they cannot drift');
eq(targetsForDay('night_shift', 'Rest').protein, DAY_TYPE_TARGETS.night_shift.protein,
  'protein is a floor and does not move with the session');
ok(DAY_TYPE_TARGETS.night_shift.kcal > DAY_TYPE_TARGETS.off.kcal,
  'nights run at maintenance on purpose — a deficit through one produces a binge, not a loss');
eq(targetsFor('nonsense'), DAY_TYPE_TARGETS.off, 'an unknown day type falls back to the deficit day');
ok(FLOOR_MACROS.has('protein') && FLOOR_MACROS.has('fat'), 'protein and fat are floors');
ok(!FLOOR_MACROS.has('carbs'), 'carbs are not — they are the dial being turned');
ok(NIGHT_LOAD_SCALE > 0 && NIGHT_LOAD_SCALE < 1, 'nights are lighter, same sets and reps');

// ── The commute ──
eq(COMMUTE.miles, 5, 'five miles round trip');
eq(Math.round(commuteMinutes()), 25, 'about twenty-five minutes in the saddle');
ok(commutesOn('day_shift') && commutesOn('night_shift'), 'it happens on every shift');
ok(!commutesOn('off'), 'and not on an off day');
eq(commuteForDay('off', 78), null, 'so an off day reports no commute at all');
ok(commuteForDay('day_shift', 78).kcal > 0, 'a shift day reports one');

// Heavier rider, more work — the estimate is not a fixed number.
ok(commuteKcal(90) > commuteKcal(70), 'the estimate scales with body weight');
eq(commuteKcal(null), null, 'and is withheld when the weight is unknown');
eq(commuteKcal(0), null, 'rather than dividing something by nothing');
eq(commuteForDay('day_shift', null).kcal, null, 'the day still reports the distance without it');
eq(commuteForDay('day_shift', null).miles, 5, 'which is the part that is actually known');

// ── Which sessions carry it ──
// Training sits on the four shift days plus the first day off, so four
// of the five sessions land on a shift. This is the fact that makes the
// commute worth modelling at all rather than ignoring.
const SHIFT_POS = new Set([0, 1, 2, 3, 8, 9, 10, 11]);
const sessionAtPos = {};
for (const [i, pos] of TRAIN_POS.slice(0, 5).entries()) sessionAtPos[SEQ[i]] = pos;
const onShift = SEQ.filter(code => SHIFT_POS.has(sessionAtPos[code]));
eq(onShift, ['Push', 'Pull', 'Legs', 'Upper'],
  'four of the five sessions land on a shift day and carry the commute');
ok(!SHIFT_POS.has(sessionAtPos.Lower),
  'Lower is the only session on a day off — the one with no commute attached');
ok([...REST_POS].every(pos => !SHIFT_POS.has(pos)),
  'and no rest day is a shift day, so the rest days stay genuine rest');

console.log(`training programme: ${n} assertions passed`);
