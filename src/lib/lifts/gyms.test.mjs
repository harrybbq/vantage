/**
 * Gyms as a tracking dimension: the machine rule (perGym), within-gym
 * PBs / Previous / pre-fills / summary PBs for machines, free weights
 * across gyms, unassigned sets, the gym store (seed, add, rename,
 * archive, delete-when-unused), lastGym, and moving a live workout to
 * another gym (re-tag on Finish).
 * Invented data only — this file is public. Run: npm run check:lifts
 */
import assert from 'node:assert/strict';
import {
  perGymByName, perGymOf, gymOf, inGym, gymsUsed, personalBests, isNewPB, pbTimeline,
} from './lifts.js';
import {
  DEFAULT_GYMS, seedLifts, ensureLifts, gymList, activeGyms, gymName, defaultGym, addGym, renameGym, setGymArchived,
  deleteGym, setLastGym, setPerGym, makeEntry, addLift, liftsOf,
} from './store.js';
import {
  previousSets, planFor, suggestWorkout, suggestedStart, startWorkout, activeOf, toggleDone, updateSet, setWorkoutGym,
  finishWorkout, sessionPBs, summariseWorkout, addExercises, templateStart, PROGRAMME_TEMPLATES, doneSetCount,
} from './workout.js';
import { liftsCard } from '../upgrade/homeLines.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
let idn = 0;
const ids = p => `${p}_${++idn}`;

t('the machine rule: per gym for machines, across gyms for free weights', () => {
  const table = {
    'Machine leg press': true, 'Leg press, feet high': true, 'Leg extension': true, 'Seated leg curl': true,
    'Lat pulldown': true, 'Single-arm cable row': true, 'Cable bar pullover': true, 'Pec deck': true, 'Hack squat': true,
    'Smith machine squat': true, 'Assisted pull-up': true, 'Assisted dip': true, 'Machine shoulder press': true,
    'Seated calf raise': true, 'Calf raise machine': true, 'Ab crunch machine': true, 'Pallof press': true,
    'Hip thrust machine': true, 'Chest press': true, 'Hammer Strength row': true, 'Single-arm cable triceps pushdown (cuff)': true,
    'Dip': false, 'Incline dumbbell press': false, 'Dumbbell lateral raise': false, 'Barbell row': false, 'Reverse EZ-bar curl': false,
    'Hip thrust': false, 'Walking dumbbell lunge': false, 'Reverse lunge': false, 'Pull-up': false, 'Push-up': false,
    '45° hyperextension': false, 'Bench press': false, 'Kettlebell swing': false, 'Bodyweight squat': false, 'Plank': false,
  };
  for (const [name, want] of Object.entries(table)) assert.equal(perGymByName(name), want, name);
  assert.equal(perGymOf({ name: 'Dip' }), false);
  assert.equal(perGymOf({ name: 'Dip', perGym: true }), true, 'the lift’s own setting beats the rule');
  assert.equal(perGymOf({ name: 'Machine leg press', perGym: false }), false);
  assert.equal(perGymOf(null), false);
});

// Two gyms, the same leg press: DXC's stack runs far heavier than Greenock's.
const LP = { id: 'lp', name: 'Machine leg press', load: 'weight' };
const DB = { id: 'db', name: 'Incline dumbbell press', load: 'per_hand' };
let c = 0;
const e = (liftId, date, weight, reps, gym, extra = {}) => ({ id: `e${++c}`, liftId, date, weight, reps, createdAt: ++c, ...(gym ? { gym } : {}), ...extra });
const LOG = [
  e('lp', '2026-09-01', 180, 8, 'dxc', { sessionId: 's1' }), e('lp', '2026-09-01', 185, 6, 'dxc', { sessionId: 's1' }),
  e('lp', '2026-09-05', 140, 10, 'greenock', { sessionId: 's2' }), e('lp', '2026-09-05', 145, 8, 'greenock', { sessionId: 's2' }),
  e('lp', '2026-09-08', 192.5, 6, 'dxc', { sessionId: 's3' }),
  e('lp', '2026-09-12', 150, 8, 'greenock', { sessionId: 's4' }),
  e('lp', '2026-08-01', 120, 10, null),                    // unassigned (no gym)
  e('db', '2026-09-01', 30, 8, 'dxc'), e('db', '2026-09-05', 32, 8, 'greenock'),
];

t('within-gym PBs: a DXC record is not a Greenock record, and vice versa', () => {
  assert.equal(personalBests(LOG, LP, { gym: 'dxc' }).heaviest.value, 192.5);
  assert.equal(personalBests(LOG, LP, { gym: 'greenock' }).heaviest.value, 150);
  assert.equal(personalBests(LOG, LP, { gym: null }).heaviest.value, 120, 'unassigned is its own bucket');
  assert.equal(personalBests(LOG, LP).heaviest.value, 192.5, 'no gym asked: the lift overall (All)');
  const g = isNewPB(LOG, { id: 'n1', liftId: 'lp', date: '2026-09-20', weight: 155, reps: 8, gym: 'greenock' }, LP);
  assert.equal(g.any, true, '155 beats Greenock’s 150 though it is far under DXC');
  assert.equal(g.heaviest, true);
  const d = isNewPB(LOG, { id: 'n2', liftId: 'lp', date: '2026-09-20', weight: 190, reps: 6, gym: 'dxc' }, LP);
  assert.equal(d.any, false, '190 at DXC is under DXC’s 192.5');
  const first = isNewPB(LOG, { id: 'n3', liftId: 'lp', date: '2026-09-20', weight: 50, reps: 8, gym: 'gym-new' }, LP);
  assert.equal(first.first, true, 'a lift’s first set at a new gym is a baseline there');
  const tl = pbTimeline(LOG, LP);
  assert.deepEqual(tl.map(x => [x.entry.gym, x.entry.weight]), [['dxc', 185], ['greenock', 145], ['dxc', 192.5], ['greenock', 150]],
    'Greenock’s first set (140) is a baseline, not measured against DXC');
  assert.deepEqual(gymsUsed(LOG, LP, ['dxc', 'greenock']), ['dxc', 'greenock', null]);
  assert.equal(inGym(LOG, LP, 'dxc').filter(x => x.liftId === 'lp').length, 3);
  assert.equal(inGym(LOG, LP, 'dxc').filter(x => x.liftId === 'db').length, 2, 'other lifts pass through');
});

t('free weights compare across gyms', () => {
  assert.equal(perGymOf(DB), false);
  assert.equal(personalBests(LOG, DB, { gym: 'dxc' }).heaviest.value, 32, 'gym ignored for a free weight');
  const r = isNewPB(LOG, { id: 'x', liftId: 'db', date: '2026-09-20', weight: 31, reps: 8, gym: 'dxc' }, DB);
  assert.equal(r.any, false, '31 at DXC does not beat 32 at Greenock');
  assert.equal(pbTimeline(LOG, DB).length, 1, 'the Greenock 32 was a PB over the DXC 30');
});

const S0 = () => ({ habits: [{ id: 'h' }], lifts: { list: [LP, DB].map(l => ({ ...l })), log: LOG.map(x => ({ ...x })), sessions: [] } });

t('Previous and the pre-filled weights come from the same gym (machines only)', () => {
  const S = S0();
  assert.deepEqual(previousSets(S, 'lp', { gym: 'dxc' }).sets.map(s => s.weight), [192.5]);
  assert.deepEqual(previousSets(S, 'lp', { gym: 'greenock' }).sets.map(s => s.weight), [150]);
  assert.equal(previousSets(S, 'lp', { gym: 'gym-new' }), null, 'never trained there');
  assert.deepEqual(previousSets(S, 'lp').sets.map(s => s.weight), [150], 'no gym given: the last time anywhere');
  assert.deepEqual(previousSets(S, 'db', { gym: 'dxc' }).sets.map(s => s.weight), [32], 'a free weight: the last time anywhere');
  assert.deepEqual(planFor(S, LP, { sets: 2, gym: 'greenock' }).rows.map(r => r.weight), [150, 150]);
  assert.deepEqual(planFor(S, LP, { sets: 2, gym: 'dxc', night: true }).rows.map(r => r.weight), [155, 155], '192.5 × 0.8 = 154 → 155');
  const legsDay = '2026-10-13';
  const atG = suggestWorkout(S, legsDay, { gym: 'greenock' });
  const atD = suggestWorkout(S, legsDay, { gym: 'dxc' });
  assert.equal(atG.exercises.find(x => x.liftId === 'lp').weight, 150);
  assert.equal(atD.exercises.find(x => x.liftId === 'lp').weight, 192.5);
  assert.equal(atD.gym, 'dxc');
  assert.equal(suggestWorkout(S, legsDay).gym, 'dxc', 'default: the first gym (no lastGym yet)');
  assert.equal(templateStart(S, PROGRAMME_TEMPLATES.find(x => x.name === 'Legs'), legsDay, { gym: 'greenock' }).gym, 'greenock');
});

t('summary PBs at a gym are judged against that gym', () => {
  const S = S0();
  const sess = { date: '2026-09-20', gym: 'greenock', exercises: [{ liftId: 'lp', sets: [{ reps: 8, weight: 155, done: true }] }] };
  const pbs = sessionPBs(S.lifts.log, sess, S.lifts.list);
  assert.equal(pbs.length, 1);
  assert.match(pbs[0].text, /155 kg × 8/);
  assert.deepEqual(sessionPBs(S.lifts.log, { ...sess, gym: 'dxc' }, S.lifts.list), [], '155 is nothing at DXC');
});

t('the gym store: seeded defaults, add / rename / archive / delete-when-unused, lastGym, perGym', () => {
  assert.deepEqual(seedLifts(0).gyms, [{ id: 'dxc', name: 'DXC' }, { id: 'greenock', name: 'Greenock' }]);
  assert.equal(DEFAULT_GYMS.length, 2);
  const S = S0();
  assert.equal(ensureLifts(S, 1), S, 'an existing store is not reseeded for gyms');
  const L = liftsOf(S);
  assert.equal(L.gyms, undefined, 'nothing written by reading');
  assert.deepEqual(gymList(L).map(g => g.id), ['dxc', 'greenock'], 'the read view shows the defaults');
  assert.equal(gymName(L, 'greenock'), 'Greenock');
  assert.equal(gymName(L, null), 'Unassigned');
  assert.equal(defaultGym(L), 'dxc');
  const a = addGym(L, '  Hotel   gym ');
  assert.equal(a.ok, true);
  assert.equal(a.id, 'gym-hotel-gym');
  assert.deepEqual(a.lifts.gyms.map(g => g.name), ['DXC', 'Greenock', 'Hotel gym'], 'defaults written out with it');
  assert.equal(a.lifts.log, L.log, 'the log is untouched (same reference)');
  assert.equal(addGym(a.lifts, 'hotel GYM').ok, false, 'no duplicate names');
  assert.equal(addGym(a.lifts, '').ok, false);
  const r = renameGym(a.lifts, 'dxc', 'DXC Arena');
  assert.equal(gymName(r.lifts, 'dxc'), 'DXC Arena');
  assert.equal(r.lifts.gyms.find(g => g.id === 'dxc').id, 'dxc', 'the id never changes, so every set still points at it');
  const del = deleteGym(r.lifts, 'dxc');
  assert.equal(del.ok, false, 'DXC has sets — archive it instead');
  assert.match(del.error, /archive/);
  const del2 = deleteGym(r.lifts, 'gym-hotel-gym');
  assert.equal(del2.ok, true);
  assert.deepEqual(del2.lifts.gyms.map(g => g.id), ['dxc', 'greenock']);
  const ar = setGymArchived(r.lifts, 'greenock', true);
  assert.equal(ar.ok, true);
  assert.deepEqual(activeGyms(ar.lifts).map(g => g.id), ['dxc', 'gym-hotel-gym']);
  assert.equal(setGymArchived(setGymArchived(ar.lifts, 'dxc', true).lifts, 'gym-hotel-gym', true).ok, false, 'one gym must stay in use');
  assert.equal(setGymArchived(ar.lifts, 'greenock', false).lifts.gyms.find(g => g.id === 'greenock').archived, undefined);
  const lg = setLastGym(L, 'greenock');
  assert.equal(lg.lastGym, 'greenock');
  assert.equal(defaultGym(lg), 'greenock');
  assert.equal(setLastGym(L, 'nowhere'), L, 'an unknown gym is ignored');
  assert.equal(defaultGym({ ...ar.lifts, lastGym: 'greenock' }), 'dxc', 'an archived last gym falls back to the first in use');
  const pg = setPerGym(L, 'db', true);
  assert.equal(pg.list.find(l => l.id === 'db').perGym, true);
  assert.equal(setPerGym(pg, 'db', true), pg, 'no change → same object');
  assert.equal(addLift(L, { name: 'Pec deck', load: 'weight', perGym: false }, { id: 'pd' }).lifts.list.find(l => l.id === 'pd').perGym, false);
  assert.equal('perGym' in addLift(L, { name: 'Pec deck', load: 'weight' }, { id: 'pd' }).lifts.list.find(l => l.id === 'pd'), false, 'left to the rule unless chosen');
  assert.deepEqual(makeEntry({ liftId: 'lp', date: '2026-09-01', weight: 100, reps: 8 }, { id: 'x', now: 1, gym: 'dxc' }).gym, 'dxc');
  assert.equal('gym' in makeEntry({ liftId: 'lp', date: '2026-09-01', weight: 100, reps: 8 }, { id: 'x', now: 1 }), false);
  assert.equal(gymOf({ gym: '' }), null);
});

t('a workout is at one gym: start tags it, Previous follows it, a change re-fills untouched rows and re-tags on Finish', () => {
  idn = 0;
  const day = '2026-10-13';
  let S = S0();
  S = startWorkout(S, { ...suggestedStart(suggestWorkout(S, day, { gym: 'dxc' })), now: 1000, today: day, ids });
  const a = activeOf(S);
  assert.equal(a.gym, 'dxc');
  assert.equal(S.lifts.lastGym, 'dxc', 'remembered');
  assert.deepEqual(S.lifts.gyms.map(g => g.id), ['dxc', 'greenock'], 'gyms written out (additively) with the first workout');
  assert.deepEqual(S.habits, [{ id: 'h' }], 'other keys untouched');
  const i = a.exercises.findIndex(x => x.liftId === 'lp');
  assert.deepEqual(a.exercises[i].sets.map(s => s.weight), [192.5, 192.5, 192.5, 192.5]);
  // type one row by hand, tick another
  S = updateSet(S, i, 1, { weight: 160 });
  S = toggleDone(S, i, 0, 2000);
  assert.equal(doneSetCount(activeOf(S)), 1);
  const G = setWorkoutGym(S, 'greenock');
  const b = activeOf(G);
  assert.equal(b.gym, 'greenock');
  assert.equal(b.id, a.id);
  assert.deepEqual(b.exercises[i].sets.map(s => [s.weight, s.done]), [[192.5, true], [160, false], [150, false], [150, false]],
    'done set kept (re-tagged on Finish), typed 160 kept, untouched pre-fills now Greenock’s');
  assert.equal(G.lifts.lastGym, 'greenock');
  assert.equal(setWorkoutGym(G, 'greenock'), G, 'same gym → no write');
  assert.equal(setWorkoutGym(G, 'nowhere'), G, 'unknown gym → no write');
  const F = finishWorkout(G, 9000);
  const added = F.lifts.log.slice(G.lifts.log.length);
  assert.ok(added.length >= 1);
  assert.ok(added.every(x => x.gym === 'greenock'), 'every set written under the gym the workout ended at');
  assert.equal(F.lifts.sessions[F.lifts.sessions.length - 1].gym, 'greenock');
  // …which makes 192.5 × 8 at Greenock a Greenock PB, not a DXC one
  const sum = summariseWorkout(G, 9000);
  assert.ok(sum.pbs.some(p => p.liftId === 'lp'), '192.5 beats Greenock’s 150');
  // added lifts read Previous from the workout's gym
  let A = startWorkout(S0(), { source: 'blank', name: 'W', now: 1, today: day, gym: 'greenock', ids });
  A = addExercises(A, ['lp']);
  assert.equal(activeOf(A).exercises[0].sets.length, 1, 'one set, like Greenock’s last time');
  A = toggleDone(A, 0, 0, 5);
  assert.equal(activeOf(A).exercises[0].sets[0].weight, 150, 'an empty row ticks with Greenock’s Previous');
});

t('home card: a machine’s best names its gym', () => {
  const lifts = { list: [LP], log: LOG.filter(x => x.liftId === 'lp'), gyms: [{ id: 'dxc', name: 'DXC' }, { id: 'greenock', name: 'Greenock' }] };
  const c = liftsCard({ lifts, vitalsLog: {}, today: '2026-09-14' });
  assert.equal(c.figure, '150 kg', 'the latest PB was at Greenock: Greenock’s best');
  assert.equal(c.figureLabel, 'Leg press best · Greenock');
  const c2 = liftsCard({ lifts: { ...lifts, log: lifts.log.filter(x => x.gym !== 'greenock') }, vitalsLog: {}, today: '2026-09-14' });
  assert.equal(c2.figure, '192.5 kg');
  assert.equal(c2.figureLabel, 'Leg press best · DXC');
});

console.log(`gyms: ${n} tests passed`);
