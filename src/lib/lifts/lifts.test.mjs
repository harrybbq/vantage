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
  restoreEntry, addLift, renameLift, setArchived, moveLift, deleteLift, recentFirst, newId, setLiftStep, setLiftRest, STEP_CHOICES, editEntry,
} from './store.js';
import { PROGRAMME } from '../../data/trainingProgramme.js';
import {
  weekPlan, dayDetail, blockPips, nextTraining, dayWord, sessionE1rms, trendSegments, splitByGap, median, niceTicks, repMaxRows, predictWeight,
  perGymBests, orderGyms, sparkPoints, groupLifts, agoShort, resolveLogDate, dateChipLabel, monthGrid, addMonths,
  trendDelta, sessionKey, lastSessionSummary,
} from './home.js';
import { weekStrip, planStrip } from './workout.js';

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

// ── Lifts home (Oct 2026 redesign): src/lib/lifts/home.js ──
{
  const ANCHOR = { id: 'w-anchor', date: '2026-10-05', startedAt: 1, finishedAt: 2, name: 'Legs', source: 'suggested', rotaSession: 'Legs',
    exercises: [{ liftId: 'lp', sets: [{ reps: 8, weight: 100, done: true }] }] };
  const W = (id, date, code, extra = {}) => ({ id, date, startedAt: 5, finishedAt: 6, name: code, source: 'suggested', rotaSession: code,
    exercises: [{ liftId: 'lp', sets: [{ reps: 8, weight: 100, done: true }] }], ...extra });
  const HS = sessions => ({ lifts: { list: [PRESS], log: [], sessions: [ANCHOR, ...sessions] } });

  t('weekPlan: ONE Mon–Sun strip — plan session, shift code, trained, today, moved, missed', () => {
    // Default rota: 2026-10-11 Push … 15 Lower (day block), 19 Push N1 … 23 Lower, 24–26 rest.
    const wk = weekPlan(HS([W('a', '2026-10-11', 'Push')]), '2026-10-13');
    assert.equal(wk.length, 7);
    assert.deepEqual(wk.map(c => c.dow), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    assert.deepEqual(wk.map(c => c.iso), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    assert.deepEqual(wk.map(c => c.today), [false, true, false, false, false, false, false]);
    assert.equal(wk[0].missed, true, 'Pull passed untrained: missed');
    assert.equal(wk[1].session, 'Pull', 'and carries forward onto today (plan.js rule)');
    assert.equal(wk[1].moved, true);
    assert.equal(wk[3].short, 'Upr', 'short names fit a 46 px cell');
    assert.deepEqual(wk.slice(4).map(c => c.short), ['Rest', 'Rest', 'Rest']);
    assert.ok(wk.every(c => c.short.length <= 4));
    assert.equal(wk[4].code, 'Off');
    const nights = weekPlan(HS([W('b', '2026-10-19', 'Push')]), '2026-10-20');
    assert.deepEqual(nights.map(c => c.code), ['N1', 'N2', 'N3', 'N4', 'Off', 'Off', 'Off'], 'shift codes N1–N4 then Off');
    assert.deepEqual(nights.map(c => c.night), [true, true, true, true, false, false, false]);
    assert.equal(nights[0].trained, true, 'a finished workout marks its day trained');
    assert.equal(nights[0].session, 'Push', 'a done day shows what was done');
    assert.equal(weekPlan({}, 'nope').length, 0);
  });
  t('weekPlan merges the old planStrip + weekStrip: same sessions, nothing invented', () => {
    const S = HS([W('a', '2026-10-11', 'Push')]);
    const wk = weekPlan(S, '2026-10-13');
    const old = weekStrip(S, '2026-10-13');
    assert.deepEqual(wk.map(c => c.session), old.map(d => d.session), 'the week strip\'s sessions');
    const next = planStrip(S, '2026-10-13', 5);
    for (const d of next) {
      const c = wk.find(x => x.iso === d.iso);
      if (c) assert.equal(c.session || 'Rest', d.session, `${d.iso}: the 5-day plan's session`);
    }
    const dd = dayDetail(S, wk[2]);
    assert.equal(dd.title, 'Wed 14 Oct');
    assert.ok(dd.exercises.length > 0 && dd.exercises.every(x => x.name && x.sets));
    assert.equal(dayDetail(S, wk[5]).exercises.length, 0, 'a rest day lists no exercises');
  });
  t('blockPips: done / today (+ carried) / to do, in PPLUL order', () => {
    const bp = blockPips(HS([W('a', '2026-10-11', 'Push')]), '2026-10-13');
    assert.deepEqual(bp.pips.map(p => p.letter).join(''), 'PPLUL');
    assert.deepEqual(bp.pips.map(p => p.state), ['done', 'today', 'todo', 'todo', 'todo']);
    assert.equal(bp.pips[1].carried, true, 'Pull was missed yesterday and carried onto today');
    assert.equal(bp.done, 1);
    assert.equal(bp.total, 5);
    const later = blockPips(HS([W('a', '2026-10-11', 'Push')]), '2026-10-16');
    assert.ok(later.pips.some(p => p.state === 'missed' && p.carried), 'a rest day: owed sessions read missed, carried');
    assert.equal(nextTraining(HS([]), '2026-10-15').session, 'Push');
    assert.equal(nextTraining(HS([]), '2026-10-15').word, 'Mon');
    assert.equal(dayWord('2026-10-16', '2026-10-15'), 'tomorrow');
  });

  // The chart.
  const CH = (date, weight, reps, extra = {}) => set('lp', date, weight, reps, extra);
  t('sessionE1rms: warm-ups and > 12 reps make no estimate; 6–12 reps are loose', () => {
    const pts = sessionE1rms([
      CH('2026-01-01', 300, 3, { type: 'W' }), CH('2026-01-01', 100, 5),
      CH('2026-01-08', 90, 15), CH('2026-01-15', 80, 8),
    ], PRESS);
    assert.equal(pts.length, 2, 'the 15-rep day has no estimate');
    near(pts[0].value, e1rm(100, 5), 'the warm-up 300 × 3 is ignored');
    assert.equal(pts[0].loose, false);
    assert.equal(pts[1].loose, true);
  });
  t('trendSegments: rolling median of DAY sessions — night and warm-ups never join it', () => {
    const sets = [];
    ['2026-02-01', '2026-02-04', '2026-02-07', '2026-02-10', '2026-02-13'].forEach((d, i) => sets.push(CH(d, 100 + i * 5, 1)));
    sets.push(CH('2026-02-15', 60, 1, { shift: 'night' }));
    sets.push(CH('2026-02-16', 400, 1, { type: 'W' }));
    const pts = sessionE1rms(sets, PRESS);
    assert.equal(pts.length, 6, 'the night session is a point; the warm-up is not');
    const seg = trendSegments(pts);
    assert.equal(seg.length, 1);
    assert.equal(seg[0].length, 5, 'night left out of the trend');
    assert.deepEqual(seg[0].map(p => p.value), [100, 102.5, 105, 107.5, 110], 'trailing medians');
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
  });
  t('trendSegments: a gap over 28 days breaks the line and restarts the median', () => {
    const pts = sessionE1rms([CH('2026-03-01', 100, 1), CH('2026-03-08', 110, 1), CH('2026-04-10', 50, 1), CH('2026-04-12', 52, 1)], PRESS);
    const seg = trendSegments(pts);
    assert.equal(seg.length, 2, '33 days between 8 Mar and 10 Apr');
    assert.deepEqual(seg[1].map(p => p.value), [50, 51], 'the new run does not average in the old one');
    assert.equal(splitByGap([{ n: 1 }, { n: 29 }, { n: 58 }]).length, 2, '28 days exactly stays joined');
    const tk = niceTicks(183, 247);
    assert.ok(tk.ticks.length >= 3 && tk.ticks.length <= 5 && [10, 20, 25].includes(tk.step), `round ticks ${JSON.stringify(tk)}`);
    assert.ok(tk.lo <= 183 && tk.hi >= 247);
  });
  t('trendDelta: day sessions only; a night last session is flagged, never a drop', () => {
    const sets = [];
    for (let i = 0; i < 16; i++) sets.push(CH(`2026-0${i < 8 ? 6 : 7}-${String((i % 8) * 3 + 1).padStart(2, '0')}`, 100 + i, 1));
    const pts = sessionE1rms(sets, PRESS);
    const d = trendDelta(pts, { weeks: 4 });
    assert.ok(d.delta > 0, `rising trend ${JSON.stringify(d)}`);
    assert.equal(d.lastNight, false);
    const withNight = sessionE1rms([...sets, CH('2026-07-30', 60, 1, { shift: 'night' })], PRESS);
    const dn = trendDelta(withNight, { weeks: 4 });
    assert.equal(dn.lastNight, true);
    assert.equal(dn.delta, d.delta, 'the light night session does not move the trend');
    assert.equal(trendDelta(pts.slice(0, 2)).delta, null, 'fewer than 3 day sessions: no delta');
    assert.equal(sessionKey({ sessionId: 'w1', date: '2026-01-01' }), 's:w1');
    assert.equal(sessionKey({ date: '2026-01-01', gym: 'dxc' }), 'd:2026-01-01:dxc');
  });
  t('lastSessionSummary: top working set + like-for-like delta (night vs night)', () => {
    const mk = (id, date, shift, w) => ({ id, date, startedAt: 1, finishedAt: 2, name: 'Push', shift, exercises: [{ liftId: 'lp', sets: [{ weight: w * 2, reps: 10, type: 'W', done: true }, { weight: w, reps: 8, done: true }, { weight: w + 50, reps: 8, done: false }] }] });
    const S = { lifts: { list: [PRESS], log: [], sessions: [mk('a', '2026-10-01', 'day', 100), mk('b', '2026-10-05', 'night', 80), mk('c', '2026-10-08', 'night', 82.5)] } };
    const ls = lastSessionSummary(S, { today: '2026-10-19' });
    assert.equal(ls.session.id, 'c');
    assert.deepEqual(ls.rows[0].top, { weight: 82.5, reps: 8 }, 'warm-ups and unticked sets never count');
    assert.equal(ls.rows[0].delta, 2.5, 'compared with the last NIGHT session, not the heavier day one');
    assert.equal(lastSessionSummary({ lifts: { list: [], log: [], sessions: [] } }, { today: '2026-10-19' }), null);
  });
  t('repMaxRows: real sets, their estimate, and muted "(pred.)" values only where none exists', () => {
    const log = [CH('2026-05-01', 100, 5), CH('2026-05-08', 120, 3), CH('2026-05-15', 90, 8)];
    const pb = personalBests(log, PRESS);
    const rows = repMaxRows(pb, PRESS);
    assert.deepEqual(rows.map(r => r.n), [1, 3, 5, 8, 10, 12]);
    assert.equal(rows[0].entry.weight, 120);
    assert.equal(rows[0].heaviest, true);
    assert.equal(rows[2].entry.weight, 100);
    assert.equal(rows[3].entry.weight, 90);
    assert.equal(rows[3].pred, null, 'a real set never shows a prediction');
    assert.equal(rows[4].entry, null);
    const best = pb.bestE1rm.value;
    near(rows[4].pred, best / (1 + 10 / 30), 'predicted 10-rep weight from the best estimate');
    near(rows[5].pred, best / (1 + 12 / 30));
    near(predictWeight(150, 1), 150);
    const dip = repMaxRows(personalBests([set('dp', '2026-05-01', 20, 5)], DIP), DIP, { bwOf: () => ({ kg: 80 }) });
    assert.equal(dip[5].pred, null, 'no prediction on a total-load estimate');
  });

  // The lift list.
  t('perGymBests: a machine\'s bests per gym, the ACTIVE gym first, unassigned last, never combined', () => {
    const LP = { ...PRESS, perGym: true };
    const log = [
      set('lp', '2026-06-01', 200, 8, { gym: 'dxc' }), set('lp', '2026-06-02', 150, 8, { gym: 'greenock' }),
      set('lp', '2026-06-03', 170, 8), set('lp', '2026-06-04', 210, 5, { gym: 'dxc' }),
    ];
    const order = ['dxc', 'greenock'];
    assert.deepEqual(perGymBests(log, LP, { activeGym: 'greenock', gymOrder: order }).map(g => [g.gym, g.best.entry.weight]),
      [['greenock', 150], ['dxc', 210], [null, 170]]);
    assert.deepEqual(perGymBests(log, LP, { activeGym: 'dxc', gymOrder: order }).map(g => g.gym), ['dxc', 'greenock', null]);
    assert.deepEqual(perGymBests(log, { ...PRESS, perGym: false }, { activeGym: 'dxc' }), [], 'a free weight has one best');
    assert.deepEqual(orderGyms(['b', null, 'z', 'a'], 'z', ['a']), ['z', 'a', 'b', null]);
    const sp = sparkPoints(log, LP, { gym: 'dxc', pbIds: new Set([log[3].id]) });
    assert.deepEqual(sp.map(p => p.y), [200, 210], 'dxc sessions only');
    assert.equal(sp[1].pb, true);
    assert.equal(sp[1].last, true);
  });
  t('groupLifts: empty lifts grouped into one row; archived left out; order kept', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c', archived: true }, { id: 'd' }];
    const counts = { a: 3, d: 1 };
    const g = groupLifts(list, id => counts[id]);
    assert.deepEqual(g.logged.map(l => l.id), ['a', 'd']);
    assert.deepEqual(g.empty.map(l => l.id), ['b']);
    assert.equal(agoShort('2026-10-16', '2026-10-19'), '3d');
    assert.equal(agoShort('2026-10-19', '2026-10-19'), 'today');
    assert.equal(agoShort('2026-08-01', '2026-10-19'), '3mo');
  });

  // Quick log's date chip.
  t('resolveLogDate: Today / Yesterday / a picked day → ISO, never after maxDate', () => {
    const o = { today: '2026-10-20', maxDate: '2026-10-21' };   // 3:30am Wed after Tuesday's night: today = the training day
    assert.equal(resolveLogDate('today', o), '2026-10-20');
    assert.equal(resolveLogDate('yesterday', o), '2026-10-19');
    assert.equal(resolveLogDate('2026-10-02', o), '2026-10-02');
    assert.equal(resolveLogDate('2026-10-21', o), '2026-10-21', 'the calendar day is allowed');
    assert.equal(resolveLogDate('2026-10-25', o), '2026-10-21', 'the future is clamped to maxDate');
    assert.equal(resolveLogDate('garbage', o), '2026-10-20');
    assert.equal(dateChipLabel('2026-10-20', '2026-10-20'), 'Today');
    assert.equal(dateChipLabel('2026-10-19', '2026-10-20'), 'Yesterday');
    assert.equal(dateChipLabel('2026-10-12', '2026-10-20'), 'Mon 12 Oct');
    assert.equal(dateChipLabel('2025-10-12', '2026-10-20'), 'Sun 12 Oct 2025');
    const g = monthGrid('2026-10', { maxDate: '2026-10-21', today: '2026-10-20' });
    assert.equal(g.label, 'October 2026');
    const days = g.weeks.flat();
    assert.equal(days[0].iso, '2026-09-28', 'Monday-first');
    assert.equal(days.find(d => d.iso === '2026-10-22').disabled, true);
    assert.equal(days.find(d => d.iso === '2026-10-21').disabled, false);
    assert.equal(addMonths('2026-01', -1), '2025-12');
    assert.equal(addMonths('2026-12', 1), '2027-01');
  });

  // Manage: step / rest writes.
  t('setLiftStep / setLiftRest: additive — only that lift changes, every other key and lift kept', () => {
    const L0 = { list: [{ id: 'a', name: 'A', load: 'weight', perGym: true, muscles: ['Quads'] }, { id: 'b', name: 'B', load: 'per_hand' }], log: [set('a', '2026-01-01', 10, 5)], gyms: [{ id: 'dxc', name: 'DXC' }], extra: { x: 1 } };
    const L1 = setLiftStep(L0, 'a', 1.25);
    assert.deepEqual(L1.list[0], { ...L0.list[0], step: 1.25 });
    assert.equal(L1.list[1], L0.list[1], 'other lifts are the same objects');
    assert.equal(L1.log, L0.log);
    assert.equal(L1.gyms, L0.gyms);
    assert.equal(L1.extra, L0.extra);
    const L2 = setLiftStep(L1, 'a', 5, 'dxc');
    assert.deepEqual(L2.list[0].stepByGym, { dxc: 5 });
    assert.equal(L2.list[0].step, 1.25, 'the gym step sits beside the lift step');
    assert.equal(setLiftStep(L2, 'a', 3), L2, 'only STEP_CHOICES');
    assert.equal(setLiftStep(L2, 'a', 5, 'dxc'), L2, 'same value → no write');
    const L3 = setLiftStep(L2, 'a', null, 'dxc');
    assert.equal('stepByGym' in L3.list[0], false, 'clearing the last gym step removes the key');
    const R1 = setLiftRest(L0, 'b', 120);
    assert.equal(R1.list[1].restSec, 120);
    assert.equal(R1.list[0], L0.list[0]);
    assert.equal(setLiftRest(R1, 'b', 120), R1);
    assert.equal('restSec' in setLiftRest(R1, 'b', null).list[1], false);
    assert.equal(setLiftRest(L0, 'nope', 90), L0);
    assert.deepEqual(STEP_CHOICES, [1, 1.25, 2, 2.5, 5]);
  });
  t('editEntry keeps sessionId and unknown keys; cleared fields go', () => {
    const prev = { id: 'x1', liftId: 'lp', date: '2026-05-01', weight: 100, reps: 5, createdAt: 7, sessionId: 'wk1', gym: 'dxc', rpe: 8, notes: 'hi', type: 'W', future: { a: 1 } };
    const out = editEntry(prev, { liftId: 'lp', date: '2026-05-01', weight: '102.5', reps: '5', rpe: '', notes: '', gym: 'dxc', type: null }, { shift: 'night' });
    assert.equal(out.id, 'x1');
    assert.equal(out.createdAt, 7);
    assert.equal(out.sessionId, 'wk1', 'the workout link survives an edit');
    assert.deepEqual(out.future, { a: 1 });
    assert.equal(out.weight, 102.5);
    assert.equal('rpe' in out, false);
    assert.equal('notes' in out, false);
    assert.equal('type' in out, false, 'Normal clears the warm-up flag');
    assert.equal(out.shift, 'night');
    assert.equal(editEntry(prev, { ...prev, type: 'D' }).type, 'D');
  });
}

console.log(`lifts: ${n} tests passed`);
