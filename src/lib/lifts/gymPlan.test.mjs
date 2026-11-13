/**
 * The session plan fitted to the gym (gymPlan.js): what only one gym has
 * is swapped in there and out everywhere else, in the suggestion, the
 * adaptive Upper and the built-in templates.
 * Invented data only — this file is public. Run: npm run check:lifts
 */
import assert from 'node:assert/strict';
import { PROGRAMME, GYM_ONLY } from '../../data/trainingProgramme.js';
import { onlyGymOf, availableAt } from './lifts.js';
import { setOnlyGym, setSwapFor, DEFAULT_GYMS, setGymArchived, activeGyms } from './store.js';
import { fitForGym, swapLines, MIN_MATCH } from './gymPlan.js';
import { suggestWorkout, suggestedStart, startWorkout, activeOf, templateStart, PROGRAMME_TEMPLATES, progId } from './workout.js';
import { buildAdaptive } from './adaptive.js';
import { musclesOf } from './muscles.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const SMITH = { id: 'own-smith', name: 'Incline Smith Machine Bench', load: 'weight', unit: 'kg', muscles: ['Chest', 'Shoulders'] };
const PEC = { id: 'own-pec', name: 'Pec Deck', load: 'weight', unit: 'kg', muscles: ['Chest'] };
const NAMES = [...new Set(Object.values(PROGRAMME).flat().map(x => x.name))];
const PROG_LIST = NAMES.map(name => ({ id: progId(name), name, load: name === 'Dip' ? 'bodyweight_plus' : 'weight', unit: 'kg' }));
const LIST = [...PROG_LIST, SMITH, PEC];
const GYMS = DEFAULT_GYMS.map(g => g.id);
const PUSH = PROGRAMME.Push.map(x => ({ ...x }));
const names = xs => xs.map(x => x.name);
// Default rota: 2026-10-11 Push · 12 Pull · 13 Legs · 14 Upper · 15 Lower.
const DAY = { push: '2026-10-11', pull: '2026-10-12', legs: '2026-10-13', upper: '2026-10-14' };
const S0 = (list = LIST, extra = {}) => ({ lifts: { list, log: [], sessions: [], ...extra } });

t('the default: the incline Smith bench is Greenock only, by name; everything in the programme is at both', () => {
  assert.equal(GYM_ONLY['Incline Smith Machine Bench'], 'greenock');
  assert.equal(onlyGymOf(SMITH), 'greenock');
  assert.equal(onlyGymOf({ name: '  incline  smith machine BENCH ' }), 'greenock');
  for (const name of NAMES) assert.equal(onlyGymOf({ name }), null, name);
  assert.equal(availableAt(SMITH, 'greenock'), true);
  assert.equal(availableAt(SMITH, 'dxc'), false);
  assert.equal(availableAt(SMITH, null), true, 'no gym chosen: nothing is ruled out');
  assert.equal(availableAt(PEC, 'dxc'), true);
  for (const id of Object.values(GYM_ONLY)) assert.ok(GYMS.includes(id), `${id} is one of the gyms`);
});

t('the lift’s own choice beats the name default, either way', () => {
  assert.equal(onlyGymOf({ ...SMITH, only: false }), null, '"any gym", said by hand');
  assert.equal(onlyGymOf({ ...SMITH, only: 'dxc' }), 'dxc');
  assert.equal(onlyGymOf({ ...PEC, only: 'dxc' }), 'dxc');
  // A gym no longer in use restricts nothing.
  assert.equal(onlyGymOf({ ...PEC, only: 'gone' }, GYMS), null);
  assert.equal(availableAt({ ...PEC, only: 'gone' }, 'dxc', GYMS), true);
});

t('setOnlyGym writes one key on one lift, and nothing when nothing changes', () => {
  const L = { list: LIST.map(l => ({ ...l })), log: [{ id: 'e1', liftId: PEC.id }], sessions: [] };
  const a = setOnlyGym(L, PEC.id, 'dxc');
  assert.equal(a.list.find(l => l.id === PEC.id).only, 'dxc');
  assert.equal(a.log, L.log);
  for (const l of L.list) if (l.id !== PEC.id) assert.equal(a.list.find(x => x.id === l.id), l, 'other lifts are the same objects');
  assert.equal(setOnlyGym(a, PEC.id, 'dxc'), a);
  const any = setOnlyGym(a, SMITH.id, null);
  assert.equal(any.list.find(l => l.id === SMITH.id).only, false, 'any gym is stored, so it beats the default');
  assert.equal(setOnlyGym(any, SMITH.id, null), any);
  assert.equal(setOnlyGym(L, 'nope', 'dxc'), L);
  assert.equal(setOnlyGym(L, PEC.id, 'not-a-gym'), L);
});

t('Greenock: the Smith bench takes the incline dumbbell press’s place, sets and reps kept', () => {
  const fit = fitForGym(PUSH, { gym: 'greenock', list: LIST, gymIds: GYMS, gymLabel: 'Greenock' });
  assert.deepEqual(fit.swaps, [{ from: 'Incline dumbbell press', to: 'Incline Smith Machine Bench', why: 'only' }]);
  const i = PUSH.findIndex(x => x.name === 'Incline dumbbell press');
  const x = fit.exercises[i];
  assert.equal(x.name, 'Incline Smith Machine Bench');
  assert.equal(x.liftId, SMITH.id);
  assert.equal(x.sets, PUSH[i].sets);
  assert.equal(x.reps, PUSH[i].reps);
  assert.equal(x.swapFor, 'Incline dumbbell press');
  assert.deepEqual(x.tags, [{ kind: 'gym', text: 'Greenock · for Incline dumbbell press' }]);
  assert.deepEqual(names(fit.exercises).filter((_, j) => j !== i), names(PUSH).filter((_, j) => j !== i), 'nothing else moves');
  assert.equal(fit.exercises.length, PUSH.length);
  assert.deepEqual(swapLines(fit, 'Greenock'), ['Incline Smith Machine Bench in for Incline dumbbell press (only at Greenock)']);
  assert.equal(PUSH[i].name, 'Incline dumbbell press', 'the plan passed in is not touched');
});

t('DXC, or no gym: the plan is the very same array', () => {
  const ctx = { list: LIST, gymIds: GYMS, gymLabel: 'DXC' };
  assert.equal(fitForGym(PUSH, { ...ctx, gym: 'dxc' }).exercises, PUSH);
  assert.equal(fitForGym(PUSH, { ...ctx, gym: null }).exercises, PUSH);
  assert.equal(fitForGym(PUSH, { gym: 'greenock', list: PROG_LIST, gymIds: GYMS }).exercises, PUSH, 'no Smith bench on the list: nothing to swap');
  // Sessions with nothing like it are left alone at Greenock too.
  for (const code of ['Pull', 'Legs', 'Lower']) {
    const plan = PROGRAMME[code].map(x => ({ ...x }));
    assert.equal(fitForGym(plan, { ...ctx, gym: 'greenock' }).exercises, plan, code);
  }
});

t('a plan holding the Smith bench is fitted back at DXC: the closest thing DXC has', () => {
  const plan = [{ name: 'Dip', sets: 4, reps: '6–10' }, { name: SMITH.name, liftId: SMITH.id, sets: 3, reps: '8–10' }];
  const fit = fitForGym(plan, { gym: 'dxc', list: LIST, gymIds: GYMS, gymLabel: 'DXC' });
  assert.deepEqual(fit.swaps, [{ from: SMITH.name, to: 'Incline dumbbell press', why: 'missing' }]);
  assert.equal(fit.exercises[1].name, 'Incline dumbbell press');
  assert.equal(fit.exercises[1].sets, 3);
  assert.deepEqual(fit.exercises[1].tags, [{ kind: 'gym', text: `Not at DXC: ${SMITH.name}` }]);
  // Already in the plan → nothing close is left → it is left out, and said.
  const both = [{ name: 'Incline dumbbell press', sets: 3, reps: '8–10' }, { name: SMITH.name, liftId: SMITH.id, sets: 3, reps: '8–10' }];
  const fit2 = fitForGym(both, { gym: 'dxc', list: [SMITH, ...PROG_LIST.filter(l => l.name === 'Incline dumbbell press')], gymIds: GYMS, gymLabel: 'DXC' });
  assert.deepEqual(names(fit2.exercises), ['Incline dumbbell press']);
  assert.deepEqual(fit2.dropped, [SMITH.name]);
  assert.match(swapLines(fit2, 'DXC')[0], /left out: not at DXC/);
});

t('only-here lifts go one for one, best match first, and only where the main muscle matches', () => {
  // Pec Deck marked DXC-only: it is a chest fly, so on Push at DXC it stands in for the dip (mid chest), not the incline press.
  const list = [...PROG_LIST, SMITH, { ...PEC, only: 'dxc' }];
  const fit = fitForGym(PUSH, { gym: 'dxc', list, gymIds: GYMS, gymLabel: 'DXC' });
  assert.deepEqual(fit.swaps.map(s => s.to), ['Pec Deck']);
  assert.equal(fit.swaps[0].from, 'Dip');
  // Two Greenock-only upper-chest lifts, one slot: one swap, not two.
  const two = [...PROG_LIST, SMITH, { id: 'own-smith2', name: 'Incline chest press machine', load: 'weight', muscles: ['Chest', 'Shoulders'], only: 'greenock' }];
  const f2 = fitForGym(PUSH, { gym: 'greenock', list: two, gymIds: GYMS, gymLabel: 'Greenock' });
  assert.equal(f2.swaps.length, 1);
  assert.equal(f2.swaps[0].from, 'Incline dumbbell press');
  // An only-here curl has nothing to replace on Push.
  const curl = [...PROG_LIST, { id: 'own-preacher', name: 'Preacher curl machine', load: 'weight', muscles: ['Biceps'], only: 'greenock' }];
  assert.equal(fitForGym(PUSH, { gym: 'greenock', list: curl, gymIds: GYMS }).exercises, PUSH);
  assert.ok(MIN_MATCH > 0.5 && MIN_MATCH < 1);
});

t('the owner can name what a one-gym lift replaces, or say nothing', () => {
  const ctx = { gym: 'greenock', gymIds: GYMS, gymLabel: 'Greenock' };
  // Named: exactly that exercise, even though another is the closer match.
  const named = [...PROG_LIST, { ...SMITH, swapFor: 'Machine shoulder press' }];
  const f = fitForGym(PUSH, { ...ctx, list: named });
  assert.deepEqual(f.swaps, [{ from: 'Machine shoulder press', to: SMITH.name, why: 'only' }]);
  // Named, but this session does not have it: the plan is left alone.
  const pull = PROGRAMME.Pull.map(x => ({ ...x }));
  assert.equal(fitForGym(pull, { ...ctx, list: named }).exercises, pull);
  // Nothing: it never replaces anything.
  assert.equal(fitForGym(PUSH, { ...ctx, list: [...PROG_LIST, { ...SMITH, swapFor: false }] }).exercises, PUSH);
  // null is "the closest match" again.
  assert.equal(fitForGym(PUSH, { ...ctx, list: [...PROG_LIST, { ...SMITH, swapFor: null }] }).swaps[0].from, 'Incline dumbbell press');
  // At the gym without it, a named counterpart is what it falls back to.
  const plan = [{ name: SMITH.name, liftId: SMITH.id, sets: 3, reps: '8–10' }];
  const back = fitForGym(plan, { gym: 'dxc', gymIds: GYMS, gymLabel: 'DXC', list: named });
  assert.equal(back.exercises[0].name, 'Machine shoulder press');
});

t('setSwapFor writes one key on one lift', () => {
  const L = { list: LIST.map(l => ({ ...l })), log: [], sessions: [] };
  const a = setSwapFor(L, SMITH.id, 'Incline dumbbell press');
  assert.equal(a.list.find(l => l.id === SMITH.id).swapFor, 'Incline dumbbell press');
  assert.equal(setSwapFor(a, SMITH.id, 'Incline dumbbell press'), a);
  assert.equal(setSwapFor(a, SMITH.id, false).list.find(l => l.id === SMITH.id).swapFor, false);
  assert.equal(setSwapFor(a, SMITH.id, null).list.find(l => l.id === SMITH.id).swapFor, null);
  assert.equal(setSwapFor(L, SMITH.id, null), L, 'absent and null are the same: nothing to write');
  assert.equal(setSwapFor(L, 'nope', 'x'), L);
  for (const l of L.list) if (l.id !== SMITH.id) assert.equal(a.list.find(x => x.id === l.id), l);
});

t('archived and banned lifts are never swapped in', () => {
  assert.equal(fitForGym(PUSH, { gym: 'greenock', list: [...PROG_LIST, { ...SMITH, archived: true }], gymIds: GYMS }).exercises, PUSH);
  const squat = { id: 'own-sq', name: 'Barbell back squat', load: 'weight', muscles: ['Quads'], only: 'greenock' };
  const legs = PROGRAMME.Legs.map(x => ({ ...x }));
  assert.equal(fitForGym(legs, { gym: 'greenock', list: [...PROG_LIST, squat], gymIds: GYMS }).exercises, legs);
});

t('the suggestion follows the gym: Push at Greenock has the Smith bench, at DXC the dumbbell press', () => {
  const S = S0();
  const g = suggestWorkout(S, DAY.push, { gym: 'greenock' });
  const d = suggestWorkout(S, DAY.push, { gym: 'dxc' });
  assert.equal(g.rotaSession, 'Push');
  assert.ok(names(g.exercises).includes(SMITH.name));
  assert.ok(!names(g.exercises).includes('Incline dumbbell press'));
  assert.deepEqual(g.gymFit.swaps, [{ from: 'Incline dumbbell press', to: SMITH.name, why: 'only' }]);
  const x = g.exercises.find(e => e.name === SMITH.name);
  assert.equal(x.liftId, SMITH.id);
  assert.equal(x.swapFor, 'Incline dumbbell press');
  assert.equal(x.tags[0].kind, 'gym');
  assert.deepEqual(names(d.exercises), names(PROGRAMME.Push));
  assert.deepEqual(d.gymFit, { swaps: [], dropped: [] });
  assert.equal(g.exercises.length, d.exercises.length);
  // Starting it carries the swapped lift into the workout.
  let k = 0;
  const started = startWorkout(S, { ...suggestedStart(g), now: 1000, today: DAY.push, ids: p => `${p}_${++k}` });
  assert.ok(activeOf(started).exercises.some(e => e.liftId === SMITH.id));
  assert.equal(activeOf(started).gym, 'greenock');
});

t('the weights for a swapped-in machine come from that gym’s own sets', () => {
  const log = [{ id: 'e1', liftId: SMITH.id, date: '2026-10-04', weight: 60, reps: 8, gym: 'greenock', createdAt: 1 }];
  const g = suggestWorkout(S0(LIST, { log }), DAY.push, { gym: 'greenock' });
  assert.equal(g.exercises.find(e => e.name === SMITH.name).weight, 60);
});

t('the owner’s own setting drives it: "any gym" stops the swap, "only DXC" reverses it', () => {
  const any = S0(LIST.map(l => (l.id === SMITH.id ? { ...l, only: false } : l)));
  assert.deepEqual(names(suggestWorkout(any, DAY.push, { gym: 'greenock' }).exercises), names(PROGRAMME.Push));
  const flipped = S0(LIST.map(l => (l.id === SMITH.id ? { ...l, only: 'dxc' } : l)));
  assert.ok(names(suggestWorkout(flipped, DAY.push, { gym: 'dxc' }).exercises).includes(SMITH.name));
  assert.ok(!names(suggestWorkout(flipped, DAY.push, { gym: 'greenock' }).exercises).includes(SMITH.name));
});

t('archiving the gym a lift is tied to frees the lift', () => {
  const L = setGymArchived({ list: LIST, log: [], sessions: [], gyms: DEFAULT_GYMS.map(g => ({ ...g })) }, 'greenock', true).lifts;
  assert.deepEqual(activeGyms(L).map(g => g.id), ['dxc']);
  const s = suggestWorkout({ lifts: L }, DAY.push, { gym: 'dxc' });
  assert.deepEqual(s.gymFit, { swaps: [], dropped: [] });
});

t('the built-in Push template is fitted like the suggestion; a saved template is left as written', () => {
  const S = S0();
  const push = PROGRAMME_TEMPLATES.find(x => x.name === 'Push');
  assert.ok(names(templateStart(S, push, DAY.push, { gym: 'greenock' }).exercises).includes(SMITH.name));
  assert.deepEqual(names(templateStart(S, push, DAY.push, { gym: 'dxc' }).exercises), names(PROGRAMME.Push));
  const mine = { id: 'tpl1', name: 'Push - DXC', exercises: [{ liftId: progId('Incline dumbbell press'), sets: 3, reps: '8–10' }] };
  assert.deepEqual(names(templateStart(S, mine, DAY.push, { gym: 'greenock' }).exercises), ['Incline dumbbell press']);
});

t('the adaptive Upper never picks the Smith bench at DXC, however recently it was used', () => {
  // Tracking has started, and the Smith bench was trained this week at Greenock.
  const done = (date, code, liftIds) => ({ id: `w-${date}`, date, startedAt: 1, finishedAt: 2, name: code, rotaSession: code, gym: 'greenock',
    exercises: liftIds.map(id => ({ liftId: id, sets: [{ reps: 8, weight: 50, done: true }, { reps: 8, weight: 50, done: true }, { reps: 8, weight: 50, done: true }] })) });
  const pushIds = PROGRAMME.Push.filter(x => !x.optional).map(x => (x.name === 'Incline dumbbell press' ? SMITH.id : progId(x.name)));
  const sessions = [
    done('2026-10-05', 'Legs', PROGRAMME.Legs.map(x => progId(x.name))),
    done(DAY.push, 'Push', pushIds),
    done(DAY.pull, 'Pull', PROGRAMME.Pull.map(x => progId(x.name))),
    done(DAY.legs, 'Legs', PROGRAMME.Legs.map(x => progId(x.name))),
  ];
  const S = S0(LIST, { sessions });
  const ctx = gym => ({ gym, gymIds: GYMS });
  const atD = buildAdaptive(S, DAY.upper, 'Upper', ctx('dxc'));
  assert.ok(atD && atD.exercises.length);
  assert.ok(!names(atD.exercises).includes(SMITH.name));
  assert.ok(!names(suggestWorkout(S, DAY.upper, { gym: 'dxc' }).exercises).includes(SMITH.name));
  // No gym given: the builder is as it was.
  assert.deepEqual(buildAdaptive(S, DAY.upper, 'Upper'), buildAdaptive(S, DAY.upper, 'Upper', {}));
  // At Greenock an incline press, if the week calls for one, is the Smith bench.
  const g = suggestWorkout(S, DAY.upper, { gym: 'greenock' });
  assert.ok(!names(g.exercises).includes('Incline dumbbell press'));
});

t('"machine" no longer reads as a chin-up: an untagged machine bench is chest', () => {
  assert.deepEqual(musclesOf({ name: 'Incline Smith Machine Bench' }), ['Chest']);
  assert.deepEqual(musclesOf({ name: 'Chin-up' }), ['Back']);
  const untagged = { ...SMITH, muscles: undefined };
  const fit = fitForGym(PUSH, { gym: 'greenock', list: [...PROG_LIST, untagged], gymIds: GYMS, gymLabel: 'Greenock' });
  assert.equal(fit.swaps[0].from, 'Incline dumbbell press');
});

console.log(`gym plan: ${n} tests passed`);
