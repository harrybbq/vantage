// Run: node src/lib/lifts/bodymap.test.mjs   (part of npm run check:lifts)
import assert from 'node:assert/strict';
import { sessionTargets, workoutLoad, bodyMap, PEAK_TARGETS, MAP_MUSCLES, bodyMapParts, workoutPartLoad, PEAK_PARTS } from './bodymap.js';
import { PARTS, sessionParts } from './adaptive.js';

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

// ── By muscle part ("All muscles") ──
{
  const load = workoutPartLoad(W, list);
  close(load['Mid & lower chest'], 3, 'dip: lower chest first, warm-up out');
  close(load['Triceps lateral & medial'], 1.5, 'dip: triceps at half');
  close(load['Front delts'], 1.5, 'dip: front delts at half');
  close(load['Side delts'], 4, 'lateral raise: side delts');
  close(load.Biceps, 2, 'curl');
  assert.equal(load['Upper chest'], undefined, 'no incline work, no upper chest');
}
{
  const b = bodyMapParts(W, list);
  assert.equal(b.session, 'Push');
  assert.deepEqual(b.parts.map(p => p.part), PARTS.map(p => p[0]), 'one row per part, in PARTS order');
  const m = Object.fromEntries(b.parts.map(x => [x.part, x]));
  const t = sessionParts('Push');
  close(m['Side delts'].target, Math.round(t['Side delts'] * 10) / 10, "side delts against Push's own target");
  close(m['Side delts'].ratio, Math.min(1, 4 / t['Side delts']), 'side delts ratio');
  assert.equal(m['Mid & lower chest'].group, 'Chest');
  assert.equal(m.Biceps.planned, false, 'Push asks nothing of biceps');
  close(m.Biceps.ratio, Math.min(1, 2 / PEAK_PARTS.Biceps), 'an off-plan part is measured against the most any session asks of it');
  assert.equal(m.Hamstrings.ratio, 0, 'untouched is empty');
}
{
  const b = bodyMapParts({ exercises: [] }, list);
  assert.equal(b.session, null);
  assert.ok(b.parts.every(x => x.ratio === 0 && x.target === Math.round((PEAK_PARTS[x.part] || 0) * 10) / 10));
}

console.log('bodymap: ok');
