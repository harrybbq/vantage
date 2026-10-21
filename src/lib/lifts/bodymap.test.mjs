// Run: node src/lib/lifts/bodymap.test.mjs   (part of npm run check:lifts)
import assert from 'node:assert/strict';
import { sessionTargets, workoutLoad, bodyMap, PEAK_TARGETS, MAP_MUSCLES } from './bodymap.js';

const close = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`);

// Push, from the programme: Dip 4 · Incline DB press 3 · Machine shoulder
// press 3 · Lateral raise 4 · Pushdown 3 · (Overhead extension, optional — out).
{
  const t = sessionTargets('Push');
  close(t.Chest, 4 + 3, 'chest: dip + incline press, both chest-first');
  close(t.Shoulders, 4 * 0.5 + 3 * 0.5 + 3 + 4, 'shoulders: half from the presses, full from shoulder press and raises');
  close(t.Triceps, 4 * 0.5 + 3 * 0.5 + 3, 'triceps: the optional overhead extension is not owed');
  assert.equal(t.Quads, undefined, 'push asks nothing of quads');
}

const list = [
  { id: 'dip', name: 'Dip' },
  { id: 'lat', name: 'Dumbbell lateral raise' },
  { id: 'curl', name: 'Incline dumbbell curl, 21s' },
  { id: 'mystery', name: 'Thing I made up' },
];
const W = {
  rotaSession: 'Push',
  exercises: [
    { liftId: 'dip', sets: [{ type: 'W' }, {}, {}, {}] },     // 3 working sets
    { liftId: 'lat', sets: [{}, {}, {}, {}] },                // 4
    { liftId: 'curl', sets: [{}, {}] },                       // off-plan for Push
    { liftId: 'mystery', sets: [{}] },                        // no tags: credits nothing
  ],
};

{
  const load = workoutLoad(W, list);
  close(load.Chest, 3, 'warm-ups are not work');
  close(load.Triceps, 1.5, 'secondary tags at half');
  close(load.Shoulders, 1.5 + 4, 'lateral raise is shoulders-first');
  close(load.Biceps, 2, 'curl');
}

{
  const m = Object.fromEntries(bodyMap(W, list).muscles.map(x => [x.muscle, x]));
  assert.equal(bodyMap(W, list).session, 'Push');
  close(m.Chest.ratio, 3 / 7, 'chest: 3 of 7');
  assert.equal(m.Chest.planned, true);
  assert.equal(m.Biceps.planned, false, 'Push does not ask for biceps');
  close(m.Biceps.ratio, Math.min(1, 2 / PEAK_TARGETS.Biceps), 'an off-plan muscle is measured against the most any session asks of it');
  assert.equal(m.Quads.ratio, 0, 'untouched is empty');
  assert.ok(MAP_MUSCLES.every(x => m[x]), 'a row for every drawable muscle');
  assert.ok(!('Other' in m), 'Other has nowhere to go on a body');
}

// Meeting the target fills the muscle, and more never overflows.
{
  const big = { rotaSession: 'Push', exercises: [{ liftId: 'dip', sets: Array.from({ length: 12 }, () => ({})) }] };
  const chest = bodyMap(big, list).muscles.find(x => x.muscle === 'Chest');
  assert.equal(chest.ratio, 1);
}

// No session and nothing logged: an empty body, not an error.
{
  const b = bodyMap({ exercises: [] }, list);
  assert.equal(b.session, null);
  assert.ok(b.muscles.every(x => x.ratio === 0));
}

console.log('bodymap: ok');
