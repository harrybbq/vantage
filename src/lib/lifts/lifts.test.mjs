/**
 * Lifts: Epley maths, the rep-max rule, bodyweight-plus loads, PB
 * detection (ties, edits, first sets), trend over gaps, validation,
 * seed-only-when-absent, and Undo restoring the exact entry.
 * Invented data only — this file is public. Run: npm run check:lifts
 */
import assert from 'node:assert/strict';
import {
  e1rm, e1rmInfo, isLowConfidence, effectiveLoad, entryE1rm, personalBests, isNewPB, pbTimeline, trend,
  relativeToBodyweight, showsBodyweightRatio, makeBwOf, bodyweightOn, bannedRule, BANNED_NOTE, REP_MAX_NS,
  fmtKg, fmtE1rm, weightText, setText, shortLiftName, pbMessage, pbKinds, isIso, addDays, daysBetween,
  pbBasis, pbLoad, isRealPB, pbHeadline, estText,
} from './lifts.js';
import {
  DEFAULT_LIFTS, seedLifts, ensureLifts, liftsOf, withLifts, validateEntry, makeEntry, upsertEntry, removeEntry,
  restoreEntry, addLift, renameLift, setArchived, moveLift, deleteLift, recentFirst, newId,
} from './store.js';
import { PROGRAMME } from '../../data/trainingProgramme.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} ≈ ${b}`);

const PRESS = { id: 'lp', name: 'Machine leg press', load: 'weight' };
const DIP = { id: 'dp', name: 'Dip', load: 'bodyweight_plus' };
const DB = { id: 'db', name: 'Incline dumbbell press', load: 'per_hand' };
let seq = 0;
const set = (liftId, date, weight, reps, extra = {}) => ({ id: `e${++seq}`, liftId, date, weight, reps, createdAt: seq, ...extra });

// ── Epley ──
t('e1rm: Epley, a single is the weight itself', () => {
  assert.equal(e1rm(100, 1), 100);
  near(e1rm(100, 10), 100 * (1 + 10 / 30));
  near(e1rm(180, 6), 216, 'the spec example');
  near(e1rm(60, 30), 120);
  assert.equal(e1rm(0, 5), 0);
  assert.equal(e1rm('100', '5'), e1rm(100, 5), 'numeric strings read as numbers');
});
t('e1rm: nonsense is null', () => {
  for (const [w, r] of [[null, 5], [100, 0], [100, -1], [-5, 5], ['x', 5], [100, NaN], [Infinity, 3]]) assert.equal(e1rm(w, r), null);
});
t('low confidence above 12 reps, not at 12', () => {
  assert.equal(isLowConfidence(12), false);
  assert.equal(isLowConfidence(13), true);
  assert.deepEqual(e1rmInfo(50, 15), { value: 50 * 1.5, low: true });
  assert.equal(e1rmInfo(50, 5).low, false);
});

// ── Loads ──
t('effectiveLoad: weight and per_hand are the logged number', () => {
  assert.equal(effectiveLoad({ weight: 180 }, PRESS, 80), 180);
  assert.equal(effectiveLoad({ weight: 32 }, DB, 80), 32, 'per dumbbell, never doubled');
  near(entryE1rm({ weight: 32, reps: 8 }, DB, null), 32 * (1 + 8 / 30));
});
t('effectiveLoad: bodyweight_plus adds bodyweight, null without one', () => {
  assert.equal(effectiveLoad({ weight: 20 }, DIP, 80), 100);
  assert.equal(effectiveLoad({ weight: 0 }, DIP, 81.5), 81.5, 'a bodyweight dip');
  assert.equal(effectiveLoad({ weight: 20 }, DIP, null), null);
  assert.equal(effectiveLoad({ weight: 20 }, DIP, 0), null);
  assert.equal(entryE1rm({ weight: 20, reps: 8 }, DIP, null), null);
  near(entryE1rm({ weight: 20, reps: 6 }, DIP, 80), 120);
});
t('bodyweight: nearest earlier reading within 14 days', () => {
  const vit = { '2026-03-01': { weight: 80 }, '2026-03-10': { weight: 81 }, '2026-03-12': { sleep: 7 }, 'junk': { weight: 99 }, '2026-04-01': { weight: 0 } };
  assert.equal(bodyweightOn(vit, '2026-03-10'), 81, 'same day');
  assert.equal(bodyweightOn(vit, '2026-03-09'), 80, 'earlier, not later');
  assert.equal(bodyweightOn(vit, '2026-03-24'), 81, '14 days on still counts');
  assert.equal(bodyweightOn(vit, '2026-03-25'), null, '15 days is too old');
  assert.equal(bodyweightOn(vit, '2026-02-28'), null, 'nothing before');
  assert.equal(bodyweightOn(vit, '2026-04-02'), null, 'a zero is not a reading');
  assert.equal(bodyweightOn(null, '2026-03-10'), null);
  assert.deepEqual(makeBwOf(vit)('2026-03-11'), { kg: 81, date: '2026-03-10' });
});

// ── Rep maxes and bests ──
t('rep max at N = heaviest weight for ≥ N reps', () => {
  const log = [set('lp', '2026-01-05', 160, 10), set('lp', '2026-01-12', 170, 8), set('lp', '2026-01-19', 175, 5), set('lp', '2026-01-26', 150, 12)];
  const pb = personalBests(log, PRESS);
  assert.deepEqual(Object.keys(pb.repMaxes).map(Number), REP_MAX_NS);
  assert.equal(pb.repMaxes[1].weight, 175, 'a 5-rep set is also your best for 1');
  assert.equal(pb.repMaxes[3].weight, 175);
  assert.equal(pb.repMaxes[5].weight, 175);
  assert.equal(pb.repMaxes[8].weight, 170);
  assert.equal(pb.repMaxes[10].weight, 160);
  assert.equal(pb.repMaxes[12].weight, 150);
  assert.equal(pb.heaviest.value, 175);
  near(pb.bestE1rm.value, 170 * (1 + 8 / 30), '170×8 (215.3) beats 175×5 (204.2)');
  assert.equal(pb.bestE1rm.entry.weight, 170);
});
t('bests ignore other lifts and junk rows', () => {
  const log = [set('lp', '2026-01-05', 160, 10), set('db', '2026-01-05', 400, 10), { id: 'x', liftId: 'lp', date: 'nope', weight: 900, reps: 1 }, null,
    { id: 'y', liftId: 'lp', date: '2026-01-06', weight: 'abc', reps: 3 }];
  const pb = personalBests(log, PRESS);
  assert.equal(pb.heaviest.value, 160);
  assert.equal(personalBests([], PRESS).heaviest, null);
  assert.equal(personalBests(null, PRESS).bestE1rm, null);
});
t('bodyweight_plus bests: heaviest is the added load, e1RM needs bodyweight', () => {
  const log = [set('dp', '2026-02-02', 10, 10), set('dp', '2026-02-09', 25, 6)];
  const none = personalBests(log, DIP);
  assert.equal(none.heaviest.value, 25);
  assert.equal(none.bestE1rm, null, 'no bodyweight → no e1RM');
  const bwOf = () => ({ kg: 80 });
  const pb = personalBests(log, DIP, { bwOf });
  near(pb.bestE1rm.value, 105 * 1.2, '105×6 (126) beats 90×10 (120)');
  assert.equal(pb.bestE1rm.entry.weight, 25);
  assert.equal(pb.bestE1rm.bodyweight, 80);
  const bwPlain = personalBests(log, DIP, { bwOf: () => 80 });
  near(bwPlain.bestE1rm.value, 126, 'bwOf may answer a bare number too');
  assert.equal(none.basis, 'weight', 'no bodyweight → PBs compare the added load');
  assert.equal(pb.basis, 'total', 'bodyweight known → PBs compare bodyweight + added');
  assert.equal(pb.heaviest.value, 105);
  assert.equal(pb.heaviest.entry.weight, 25);
});
t('bodyweight_plus basis: one scale per lift — a single set without bodyweight drops to added', () => {
  const log = [set('dp', '2026-02-02', 10, 10), set('dp', '2026-03-20', 12.5, 6)];
  const bwOf = iso => (iso < '2026-03-01' ? { kg: 80 } : null);
  assert.equal(pbBasis(log, DIP, bwOf), 'weight', 'mixed → added, never total vs added');
  assert.equal(personalBests(log, DIP, { bwOf }).heaviest.value, 12.5);
  // A lighter bodyweight can make a heavier total a PB even at the same added load
  const bwDrop = iso => ({ kg: iso < '2026-03-01' ? 80 : 84 });
  const r = isNewPB([set('dp', '2026-02-02', 20, 8)], { id: 'b1', liftId: 'dp', date: '2026-03-02', weight: 20, reps: 8 }, DIP, { bwOf: bwDrop });
  assert.equal(r.basis, 'total');
  assert.equal(r.heaviest, true, '84 + 20 beats 80 + 20 on total load');
  assert.equal(pbLoad({ date: '2026-03-02', weight: 20 }, DIP, 'total', bwDrop), 104);
  assert.equal(pbLoad({ date: '2026-03-02', weight: 20 }, DIP, 'weight', bwDrop), 20);
  assert.equal(pbBasis(log, PRESS, bwDrop), 'weight', 'only dips ever use total');
});
t('per_hand PBs compare one dumbbell', () => {
  const prev = [set('db', '2026-01-05', 30, 8)];
  const r = isNewPB(prev, { id: 'h', liftId: 'db', date: '2026-01-12', weight: 32, reps: 8 }, DB);
  assert.equal(r.heaviest, true);
  assert.deepEqual(r.repMaxes, [1, 3, 5, 8]);
  assert.equal(personalBests([...prev, set('db', '2026-01-12', 32, 8)], DB).heaviest.value, 32, 'never doubled');
});
t('heaviest: equal weight shows the set with more reps', () => {
  const log = [set('lp', '2026-01-05', 180, 4), set('lp', '2026-01-12', 180, 6)];
  assert.equal(personalBests(log, PRESS).heaviest.entry.reps, 6);
});

// ── PB detection ──
t('isNewPB: strictly greater; a tie is not a PB', () => {
  const prev = [set('lp', '2026-01-05', 170, 8), set('lp', '2026-01-12', 175, 5)];
  const tie = isNewPB(prev, { id: 'n1', liftId: 'lp', date: '2026-01-19', weight: 175, reps: 5 }, PRESS);
  assert.equal(tie.any, false);
  assert.equal(tie.heaviest, false);
  const heavier = isNewPB(prev, { id: 'n2', liftId: 'lp', date: '2026-01-19', weight: 177.5, reps: 3 }, PRESS);
  assert.equal(heavier.heaviest, true, 'a heavier real set is a PB even with a LOWER e1RM (195 vs 215)');
  assert.equal('e1rm' in heavier, false, 'there is no e1RM PB kind');
  assert.deepEqual(heavier.repMaxes, [1, 3]);
  assert.deepEqual(pbKinds(heavier), ['heaviest', '3RM'], 'the 1RM is the heaviest — said once');
  assert.equal(pbHeadline(heavier), 'heaviest ever · new 3RM');
});
t('an e1RM-only improvement is NOT a PB', () => {
  const prev = [set('lp', '2026-01-05', 170, 8), set('lp', '2026-01-12', 175, 5)];
  const e1 = isNewPB(prev, { id: 'n3', liftId: 'lp', date: '2026-01-19', weight: 170, reps: 9 }, PRESS);
  assert.ok(e1.value > personalBests(prev, PRESS).bestE1rm.value, 'the estimate went up (221 vs 215)…');
  assert.equal(e1.any, false, '…but no real record was beaten: the 8RM (170) is only tied');
  assert.equal(e1.heaviest, false);
  assert.deepEqual(e1.repMaxes, []);
  assert.deepEqual(pbKinds(e1), []);
  assert.equal(isRealPB(e1), false);
  const tl = pbTimeline([...prev, { id: 'n3', liftId: 'lp', date: '2026-01-19', weight: 170, reps: 9, createdAt: 999 }], PRESS);
  assert.equal(tl.length, 1, 'only the 175×5 heavier set is on the timeline');
  assert.equal(tl[0].entry.weight, 175);
});
t('rep-max PB without a heaviest: the highest N names it', () => {
  const prev = [set('lp', '2026-01-05', 180, 6), set('lp', '2026-01-12', 160, 8)];
  const r = isNewPB(prev, { id: 'rm', liftId: 'lp', date: '2026-01-19', weight: 170, reps: 8 }, PRESS);
  assert.equal(r.heaviest, false);
  assert.deepEqual(r.repMaxes, [8]);
  assert.equal(r.any, true);
  assert.equal(pbHeadline(r), 'new 8RM');
  assert.deepEqual(pbKinds(r), ['8RM']);
});
t('isNewPB: first set of a lift is a baseline, not a PB', () => {
  const r = isNewPB([set('db', '2026-01-01', 30, 8)], { id: 'f', liftId: 'lp', date: '2026-01-02', weight: 100, reps: 10 }, PRESS);
  assert.equal(r.first, true);
  assert.equal(r.any, false);
  near(r.value, 100 * (1 + 10 / 30), 'the e1RM is still reported');
});
t('isNewPB: an edit is judged against the other sets, not itself', () => {
  const a = set('lp', '2026-01-05', 170, 8), b = set('lp', '2026-01-12', 180, 6);
  const log = [a, b];
  // b is the PB. Re-saving it unchanged is judged against a alone — had it
  // been compared with itself, 180 > 180 would be false.
  const same = isNewPB(log, { ...b }, PRESS);
  assert.equal(same.heaviest, true);
  assert.equal(same.any, true);
  // a tie with ANOTHER set is still not a PB
  assert.equal(isNewPB([a, b, set('lp', '2026-01-19', 180, 6)], { ...b }, PRESS).any, false);
  // and editing b DOWN below a is not
  assert.equal(isNewPB(log, { ...b, weight: 150 }, PRESS).any, false);
});
t('isNewPB: rep maxes only when a real number is beaten', () => {
  const prev = [set('lp', '2026-01-05', 160, 8)];
  const r = isNewPB(prev, { id: 'r', liftId: 'lp', date: '2026-01-12', weight: 120, reps: 12 }, PRESS);
  assert.deepEqual(r.repMaxes, [], 'no 10RM or 12RM existed: nothing beaten');
  const s = isNewPB(prev, { id: 's', liftId: 'lp', date: '2026-01-12', weight: 165, reps: 8 }, PRESS);
  assert.deepEqual(s.repMaxes, [1, 3, 5, 8]);
});
t('isNewPB: dips without bodyweight compare added load; with it, total', () => {
  const prev = [set('dp', '2026-02-02', 20, 8)];
  const noBw = isNewPB(prev, { id: 'd', liftId: 'dp', date: '2026-02-09', weight: 22.5, reps: 8 }, DIP);
  assert.equal(noBw.heaviest, true);
  assert.equal(noBw.basis, 'weight');
  assert.equal(noBw.value, null, 'no estimate without bodyweight');
  const bw = isNewPB(prev, { id: 'd', liftId: 'dp', date: '2026-02-09', weight: 22.5, reps: 8 }, DIP, { bwOf: () => 80 });
  assert.equal(bw.basis, 'total');
  assert.equal(bw.heaviest, true);
  assert.ok(bw.value > 0, 'the estimate is reported for display');
});
t('pbTimeline: PBs as lifted, oldest first; ties and the first set excluded', () => {
  const log = [set('lp', '2026-01-05', 160, 8), set('lp', '2026-01-12', 160, 8), set('lp', '2026-01-19', 165, 8), set('lp', '2026-01-26', 140, 12),
    set('lp', '2026-02-02', 170, 8, { shift: 'night' })];
  const tl = pbTimeline(log, PRESS);
  assert.deepEqual(tl.map(x => x.entry.date), ['2026-01-19', '2026-02-02']);
  assert.equal(tl[1].heaviest, true, 'night sets count raw weight');
  assert.equal('e1rm' in tl[1], false, 'no e1RM kind on the timeline');
});

// ── Trend ──
t('trend: best per day, form over 28 days, change over 4 and 12 weeks', () => {
  const log = [
    set('lp', '2026-01-01', 150, 8), set('lp', '2026-01-01', 155, 8),
    set('lp', '2026-02-10', 160, 8), set('lp', '2026-03-20', 170, 8), set('lp', '2026-04-15', 175, 8),
  ];
  const tr = trend(log, PRESS, { today: '2026-04-20' });
  assert.equal(tr.series.length, 4, 'one point per day');
  near(tr.series[0].value, e1rm(155, 8), 'the better of two sets that day');
  near(tr.current, e1rm(175, 8));
  near(tr.change4w, e1rm(175, 8) - e1rm(170, 8), 'vs the 28 days to 23 Mar');
  near(tr.change12w, e1rm(175, 8) - e1rm(155, 8), 'vs the 28 days to 26 Jan');
  assert.equal(trend(log, PRESS, { today: '2026-04-20', weeks: 8 }).series.length, 2);
});
t('trend over gaps: an empty window is null, never a fake drop', () => {
  const log = [set('lp', '2026-01-01', 150, 8), set('lp', '2026-03-28', 160, 8)];
  const tr = trend(log, PRESS, { today: '2026-04-10' });
  near(tr.current, e1rm(160, 8));
  assert.equal(tr.change4w, null, 'nothing in the 28 days to 13 Mar');
  near(tr.change12w, e1rm(160, 8) - e1rm(150, 8), '1 Jan sits inside the 28 days to 16 Jan');
  const far = trend([set('lp', '2025-12-01', 150, 8), set('lp', '2026-04-01', 160, 8)], PRESS, { today: '2026-04-10' });
  assert.equal(far.change12w, null, 'nothing in the 28 days to 16 Jan');
  const stale = trend(log, PRESS, { today: '2026-06-01' });
  assert.equal(stale.current, null, 'two months off: no current form');
  assert.equal(stale.change4w, null);
  assert.equal(trend([], PRESS, { today: '2026-06-01' }).series.length, 0);
});
t('trend: night sets are marked, dips without bodyweight skipped', () => {
  const tr = trend([set('lp', '2026-01-01', 150, 8, { shift: 'night' })], PRESS, { today: '2026-01-02' });
  assert.equal(tr.series[0].night, true);
  assert.equal(trend([set('dp', '2026-01-01', 10, 8)], DIP, { today: '2026-01-02' }).series.length, 0);
});

// ── × bodyweight ──
t('relativeToBodyweight only where it means something', () => {
  assert.equal(relativeToBodyweight(180, 80, PRESS), 2.25);
  assert.equal(relativeToBodyweight(128, 80, DIP), 1.6);
  assert.equal(relativeToBodyweight(120, 80, { name: 'Hip thrust', load: 'weight' }), 1.5);
  assert.equal(relativeToBodyweight(40, 80, DB), null, 'one dumbbell vs bodyweight is meaningless');
  assert.equal(relativeToBodyweight(70, 80, { name: 'Lat pulldown', load: 'weight' }), null, 'cable stack');
  assert.equal(relativeToBodyweight(180, null, PRESS), null);
  assert.equal(showsBodyweightRatio({ name: 'Barbell back squat', load: 'weight' }), true);
});

// ── Programme ──
t('banned lifts are recognised (and still loggable)', () => {
  assert.ok(bannedRule({ name: 'Barbell back squat' }));
  assert.ok(bannedRule({ name: 'Conventional deadlift' }));
  assert.ok(bannedRule({ name: 'Barbell RDL' }));
  assert.equal(bannedRule({ name: 'Machine leg press' }), null);
  assert.equal(bannedRule({ name: 'Bench press' }), null, 'bench is out of Push, not banned');
  assert.match(BANNED_NOTE, /Not in your programme/);
  const ok = validateEntry({ liftId: 'sq', date: '2026-01-01', weight: 100, reps: 5 }, '2026-01-02');
  assert.equal(ok.ok, true, 'validation never blocks a banned lift');
});
t('default lifts come from the programme', () => {
  const names = new Set(Object.values(PROGRAMME).flat().map(x => x.name));
  for (const l of DEFAULT_LIFTS) assert.ok(names.has(l.name), `${l.name} is in the programme`);
  assert.equal(DEFAULT_LIFTS.length, 7);
  assert.ok(DEFAULT_LIFTS.every(l => !bannedRule(l)));
  assert.equal(DEFAULT_LIFTS.find(l => l.name === 'Dip').load, 'bodyweight_plus');
  assert.equal(DEFAULT_LIFTS.find(l => l.name === 'Incline dumbbell press').load, 'per_hand');
  assert.equal(new Set(DEFAULT_LIFTS.map(l => l.id)).size, 7);
});

// ── Validation ──
t('validateEntry: weight 0–1000, whole reps 1–50, no future dates', () => {
  const T = '2026-05-10';
  const base = { liftId: 'lp', date: '2026-05-10', weight: 100, reps: 5 };
  assert.equal(validateEntry(base, T).ok, true);
  assert.equal(validateEntry({ ...base, weight: 0 }, T).ok, true);
  assert.equal(validateEntry({ ...base, weight: 1000 }, T).ok, true);
  assert.ok(validateEntry({ ...base, weight: 1000.5 }, T).errors.weight);
  assert.ok(validateEntry({ ...base, weight: -1 }, T).errors.weight);
  assert.ok(validateEntry({ ...base, weight: '' }, T).errors.weight);
  assert.equal(validateEntry({ ...base, reps: 1 }, T).ok, true);
  assert.equal(validateEntry({ ...base, reps: 50 }, T).ok, true);
  assert.ok(validateEntry({ ...base, reps: 0 }, T).errors.reps);
  assert.ok(validateEntry({ ...base, reps: 51 }, T).errors.reps);
  assert.ok(validateEntry({ ...base, reps: 5.5 }, T).errors.reps);
  assert.ok(validateEntry({ ...base, date: '2026-05-11' }, T).errors.date, 'tomorrow');
  assert.ok(validateEntry({ ...base, date: '2026-02-30' }, T).errors.date, 'not a real day');
  assert.ok(validateEntry({ ...base, liftId: '' }, T).errors.liftId);
  assert.ok(validateEntry({ ...base, rpe: 11 }, T).errors.rpe);
  assert.equal(validateEntry({ ...base, rpe: '' }, T).ok, true, 'RPE is optional');
  assert.equal(validateEntry({ ...base, rpe: 8.5 }, T).ok, true);
  assert.ok(validateEntry({ ...base, notes: 'x'.repeat(501) }, T).errors.notes);
});
t('makeEntry: clean record, optional keys only when set', () => {
  const e = makeEntry({ liftId: 'lp', date: '2026-05-10', weight: '182.5', reps: '6', notes: '  felt good ', rpe: '8' }, { id: 'a', now: 5, shift: 'night' });
  assert.deepEqual(e, { id: 'a', liftId: 'lp', date: '2026-05-10', weight: 182.5, reps: 6, createdAt: 5, notes: 'felt good', rpe: 8, shift: 'night' });
  const bare = makeEntry({ liftId: 'lp', date: '2026-05-10', weight: 100, reps: 5, notes: '  ', rpe: '' }, { id: 'b', now: 6, shift: null });
  assert.deepEqual(Object.keys(bare).sort(), ['createdAt', 'date', 'id', 'liftId', 'reps', 'weight']);
  const edit = makeEntry({ id: 'a', liftId: 'lp', date: '2026-05-10', weight: 100, reps: 5, createdAt: 1, shift: 'day' }, { now: 99 });
  assert.equal(edit.createdAt, 1, 'an edit keeps when it was first entered');
  assert.equal(edit.shift, 'day', 'and its shift tag unless re-tagged');
});

// ── Seeding ──
t('seed only when S.lifts is absent; an existing list is never replaced', () => {
  const S = { habits: [{ id: 'h1' }], vitalsLog: { '2026-01-01': { weight: 80 } } };
  const seeded = ensureLifts(S, 42);
  assert.notEqual(seeded, S);
  assert.equal(seeded.habits, S.habits, 'other keys untouched (same reference)');
  assert.equal(seeded.vitalsLog, S.vitalsLog);
  assert.equal(seeded.lifts.list.length, 7);
  assert.deepEqual(seeded.lifts.log, []);
  assert.ok(seeded.lifts.list.every(l => l.unit === 'kg' && l.createdAt === 42));
  // already there → the very same object back
  const mine = { ...S, lifts: { list: [{ id: 'x', name: 'Bench press', load: 'weight', unit: 'kg' }], log: [] } };
  assert.equal(ensureLifts(mine, 1), mine);
  const emptyList = { ...S, lifts: { list: [], log: [] } };
  assert.equal(ensureLifts(emptyList, 1), emptyList, 'an emptied list stays empty');
  const odd = { ...S, lifts: { log: [{ id: 'z' }] } };
  assert.equal(ensureLifts(odd, 1), odd, 'even a malformed store is not reseeded');
  assert.deepEqual(liftsOf(odd).list, []);
  assert.equal(liftsOf({}).list.length, 7, 'the read view shows defaults without writing');
});
t('withLifts touches only lifts, keeps unknown keys, and no-ops return prev', () => {
  const S = { habits: [1], lifts: { list: [], log: [], future: { keep: true } } };
  const next = withLifts(S, l => upsertEntry(l, { id: 'a', liftId: 'x', date: '2026-01-01', weight: 1, reps: 1 }));
  assert.equal(next.habits, S.habits);
  assert.deepEqual(next.lifts.future, { keep: true });
  assert.equal(next.lifts.log.length, 1);
  assert.equal(S.lifts.log.length, 0, 'prev is not mutated');
  assert.equal(withLifts(S, l => l), S, 'no change → the same state');
  const fresh = withLifts({ habits: [] }, l => l, 7);
  assert.equal(fresh.lifts.list.length, 7, 'a write before the seed seeds first');
});
t('seed ids are stable, so two devices seeding merge by id', () => {
  assert.deepEqual(seedLifts(1).list.map(l => l.id), seedLifts(2).list.map(l => l.id));
});

// ── Undo ──
t('remove + restore puts back the identical entry in its place', () => {
  const a = { id: 'a', liftId: 'lp', date: '2026-01-01', weight: 100, reps: 5, createdAt: 1 };
  const b = { id: 'b', liftId: 'lp', date: '2026-01-02', weight: 110, reps: 5, createdAt: 2, notes: 'easy', rpe: 7, shift: 'night' };
  const c = { id: 'c', liftId: 'lp', date: '2026-01-03', weight: 120, reps: 5, createdAt: 3 };
  const lifts = { list: [], log: [a, b, c] };
  const snapshot = JSON.parse(JSON.stringify(lifts));
  const { lifts: after, removed } = removeEntry(lifts, 'b');
  assert.deepEqual(after.log.map(e => e.id), ['a', 'c']);
  assert.equal(removed.entry, b, 'the very object');
  assert.equal(removed.index, 1);
  const back = restoreEntry(after, removed);
  assert.deepEqual(back, snapshot, 'byte-for-byte what it was');
  assert.equal(back.log[1], b);
  assert.equal(restoreEntry(back, removed), back, 'restoring twice is a no-op');
  // another set added meanwhile: restore still lands at its old index
  const busy = restoreEntry(upsertEntry(after, { id: 'd', liftId: 'lp', date: '2026-01-04', weight: 1, reps: 1 }), removed);
  assert.deepEqual(busy.log.map(e => e.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(removeEntry(lifts, 'nope'), { lifts, removed: null });
});
t('upsertEntry replaces in place on edit', () => {
  const lifts = { list: [], log: [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }] };
  const next = upsertEntry(lifts, { id: 'a', weight: 5 });
  assert.deepEqual(next.log.map(e => e.weight), [5, 2]);
});

// ── Managing lifts ──
t('add / rename / archive / move / delete', () => {
  let L = seedLifts(0);
  const add = addLift(L, { name: '  Bench   press ', load: 'weight' }, { id: 'bp', now: 9 });
  assert.equal(add.ok, true);
  L = add.lifts;
  assert.deepEqual(L.list[7], { id: 'bp', name: 'Bench press', load: 'weight', unit: 'kg', createdAt: 9 });
  assert.equal(addLift(L, { name: 'bench press', load: 'weight' }, { id: 'z' }).ok, false, 'case-insensitive duplicate');
  assert.equal(addLift(L, { name: '', load: 'weight' }, { id: 'z' }).ok, false);
  assert.equal(addLift(L, { name: 'Thing', load: 'kettlebell' }, { id: 'z' }).ok, false);
  assert.equal(addLift(L, { name: 'x'.repeat(61), load: 'weight' }, { id: 'z' }).ok, false);
  const ren = renameLift(L, 'bp', 'Flat bench');
  assert.equal(ren.lifts.list[7].name, 'Flat bench');
  assert.equal(renameLift(L, 'bp', 'Dip').ok, false, 'name taken');
  assert.equal(renameLift(L, 'bp', 'Bench press').lifts, L, 'same name, no change');
  L = setArchived(L, 'bp', true);
  assert.equal(L.list[7].archived, true);
  assert.equal(setArchived(L, 'bp', true), L);
  const un = setArchived(L, 'bp', false);
  assert.equal('archived' in un.list[7], false, 'unarchive removes the flag');
  // move skips over the archived lift
  const m = moveLift(L, 'seed-hip-thrust', 1);
  assert.equal(m, L, 'last active lift cannot move down past an archived one');
  const up = moveLift(L, 'seed-dip', -1);
  assert.deepEqual(up.list.slice(0, 2).map(l => l.id), ['seed-dip', 'seed-leg-press']);
  assert.equal(moveLift(L, 'seed-leg-press', -1), L);
  // delete: only without sets
  const withSet = upsertEntry(L, { id: 's', liftId: 'bp', date: '2026-01-01', weight: 60, reps: 5 });
  assert.equal(deleteLift(withSet, 'bp').ok, false);
  assert.match(deleteLift(withSet, 'bp').error, /archive/);
  assert.equal(deleteLift(L, 'bp').ok, true);
  assert.equal(deleteLift(L, 'bp').lifts.list.length, 7);
});
t('recentFirst: most recently logged first, archived left out', () => {
  let L = seedLifts(0);
  L = upsertEntry(L, { id: '1', liftId: 'seed-hip-thrust', date: '2026-03-01', weight: 1, reps: 1 });
  L = upsertEntry(L, { id: '2', liftId: 'seed-dip', date: '2026-03-05', weight: 1, reps: 1 });
  L = setArchived(L, 'seed-lat-pulldown', true);
  const ids = recentFirst(L).map(l => l.id);
  assert.deepEqual(ids.slice(0, 3), ['seed-dip', 'seed-hip-thrust', 'seed-leg-press']);
  assert.equal(ids.includes('seed-lat-pulldown'), false);
  assert.equal(ids.length, 6);
});
t('newId is unique', () => {
  const s = new Set(Array.from({ length: 200 }, () => newId()));
  assert.equal(s.size, 200);
});

// ── Words ──
t('formatting', () => {
  assert.equal(fmtKg(180), '180');
  assert.equal(fmtKg(182.5), '182.5');
  assert.equal(fmtKg(null), '—');
  assert.equal(fmtE1rm(215.333), '215');
  assert.equal(weightText({ weight: 180 }, PRESS), '180 kg');
  assert.equal(weightText({ weight: 20 }, DIP), 'BW +20 kg');
  assert.equal(weightText({ weight: 0 }, DIP), 'BW');
  assert.equal(weightText({ weight: 32 }, DB), '32 kg/hand');
  assert.equal(setText({ weight: 180, reps: 6 }, PRESS), '180 kg × 6');
  assert.equal(shortLiftName('Machine leg press'), 'Leg press');
  assert.equal(shortLiftName('Dip'), 'Dip');
  assert.equal(shortLiftName('Single-arm cable row'), 'Cable row');
  assert.equal(pbMessage({ weight: 180, reps: 6 }, PRESS, 216), 'New PB: Leg press 180 kg × 6', 'no e1RM in a PB line');
  assert.equal(pbMessage({ weight: 20, reps: 6 }, DIP), 'New PB: Dip BW +20 kg × 6');
  assert.equal(estText(241.2), 'est. 1RM ~241 kg');
  assert.equal(estText(50, true), 'est. 1RM ≈50 kg');
  assert.equal(estText(null), 'est. 1RM —');
});
t('date helpers', () => {
  assert.equal(isIso('2026-02-29'), false);
  assert.equal(isIso('2028-02-29'), true);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-10-24', 7), '2026-10-31', 'no DST drift');
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
});

console.log(`lifts: ${n} tests passed`);
