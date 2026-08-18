/**
 * Do the app and the leaderboard agree on a user's rating?
 *
 * There are two implementations of the ratings algorithm on purpose:
 * the client's (src/lib/ratings/derive.js) so the number moves the
 * instant you log something, and the server's (netlify/lib/recompute.js)
 * because a number other people can see must not be computed on the
 * machine of the person it flatters. Both files carry a comment saying
 * the other is a mirror. Nothing checked.
 *
 * They had drifted by half. A user the app showed at OVR 20 appeared on
 * the leaderboard at 9, and it looked frozen rather than wrong because
 * the sqrt curve barely moves down there. This runs the same states
 * through both and fails if any category differs by more than a point.
 *
 * One point of slack, not zero: the two round independently after
 * accumulating floats in a different order, so an exact match is a
 * stricter promise than the algorithm makes. Two would hide a real bug.
 *
 * Run: npm run check:parity   (also part of npm run build)
 */
import { deriveRatings as clientDerive } from '../src/lib/ratings/derive.js';
import { VISIONS } from '../src/lib/visions/definitions.js';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);

/* The functions are CommonJS inside a "type": "module" package, so they
   are copied to .cjs to be required. visionXp comes along because
   recompute requires it by relative path. */
const tmpRecompute = join(tmpdir(), `recompute.${process.pid}.cjs`);
const tmpVisionXp = join(tmpdir(), `visionXp.${process.pid}.cjs`);
writeFileSync(tmpVisionXp, readFileSync(join(root, 'netlify/lib/visionXp.js')));
writeFileSync(
  tmpRecompute,
  readFileSync(join(root, 'netlify/lib/recompute.js'), 'utf8')
    .replace("require('./visionXp')", JSON.stringify(tmpVisionXp).replace(/^/, 'require(').replace(/$/, ')')),
);
let serverDerive;
try {
  ({ deriveRatings: serverDerive } = require(tmpRecompute));
} finally {
  for (const f of [tmpRecompute, tmpVisionXp]) { try { unlinkSync(f); } catch { /* best effort */ } }
}

const DAY = 86_400_000;
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const CATS = ['brain', 'finance', 'fitness', 'social'];

/** States spanning empty → long-serving, since drift hides at the ends. */
function* cases() {
  const now = Date.now();
  const mkLogs = days => {
    const logs = {};
    for (let i = 0; i < days; i++) logs[ymd(now - i * DAY)] = { t1: true, t2: true, t3: 4 };
    return logs;
  };
  const mkVisions = n => Object.fromEntries(
    VISIONS.slice(0, n).map(v => [v.id, new Date(now - 30 * DAY).toISOString()]),
  );
  const mkAchs = (n, spaced = true) => Array.from({ length: n }, (_, i) => ({
    id: 'a' + i, category: CATS[i % 4], completed: true,
    createdAt: now - 60 * DAY,
    completedAt: now - (spaced ? 20 : 59.5) * DAY,
  }));
  const trackers = [
    { id: 't1', category: 'fitness', type: 'boolean' },
    { id: 't2', category: 'brain', type: 'boolean' },
    { id: 't3', category: 'finance', type: 'number' },
  ];

  yield ['empty', {}, 0, 0];
  yield ['visions only, one', { visions: mkVisions(1) }, 0, 0];
  yield ['visions only, all', { visions: mkVisions(VISIONS.length) }, 0, 0];
  for (const n of [3, 8, 13, 18]) {
    yield [`${n} visions, active`, {
      trackers, logs: mkLogs(24), visions: mkVisions(n), achievements: mkAchs(6),
      savings: [{ id: 'g', target: 4500, current: 3180 }],
      brainScore: { result: 112 }, financeScore: { result: 95 },
      fitnessScore: { result: 130 }, socialScore: { result: 70 },
      vitalsLog: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [ymd(now - i * DAY), { weight: 82 }])),
      burnLog: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [ymd(now - i * DAY), [{ kcal: 900 }]])),
    }, 7, 44];
  }
  yield ['achievement spam, inside the 7-day window', {
    achievements: mkAchs(40, false), visions: mkVisions(5),
  }, 0, 0];
  yield ['achievement pile, properly spaced', { achievements: mkAchs(40), visions: mkVisions(5) }, 20, 0];
  yield ['savings over the cap', {
    savings: [{ id: 'a', target: 30_000, current: 30_000 }, { id: 'b', target: 5_000, current: 5_000 }],
  }, 0, 0];
  yield ['sub-£10 savings goals only', {
    savings: [{ id: 'a', target: 5, current: 5 }, { id: 'b', target: 9, current: 9 }],
  }, 0, 0];
  yield ['maxed', {
    trackers, logs: mkLogs(30), visions: mkVisions(VISIONS.length), achievements: mkAchs(200),
    savings: [{ id: 'g', target: 25_000, current: 25_000 }],
    brainScore: { result: 130 }, financeScore: { result: 130 },
    fitnessScore: { result: 130 }, socialScore: { result: 130 },
    vitalsLog: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [ymd(now - i * DAY), { weight: 82 }])),
    burnLog: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [ymd(now - i * DAY), [{ kcal: 1200 }]])),
  }, 50, 400];
}

const TOLERANCE = 1;
let checked = 0;
const failures = [];

for (const [name, S, friendCount, macroDays] of cases()) {
  const c = clientDerive(S, { friendCount, macroDays });
  const s = serverDerive(S, friendCount, {}, macroDays);
  for (const k of [...CATS, 'ovr']) {
    checked++;
    if (Math.abs(c[k] - s[k]) > TOLERANCE) {
      failures.push(`${name} · ${k}: app ${c[k]}, leaderboard ${s[k]} (off by ${c[k] - s[k]})`);
    }
  }
}

if (failures.length) {
  console.error(`✗ the app and the leaderboard disagree on ${failures.length} of ${checked} values\n`);
  for (const f of failures) console.error('  ' + f);
  console.error('\nsrc/lib/ratings/derive.js and netlify/lib/recompute.js have to');
  console.error('stay in step — whichever one you changed, change the other.');
  process.exit(1);
}
console.log(`✓ ratings parity — ${checked} values across ${[...cases()].length} states, within ${TOLERANCE}`);
