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
  // The two sources added in the 2026-08-19 rework, stressed on their
  // own: a long log history (which the lifetime accumulator reads) and
  // far more trackers than the cap allows.
  yield ['ten years of logged days', {
    trackers, logs: mkLogs(3650), visions: mkVisions(8),
  }, 0, 0];
  // A daily target: half the days fall short of it and must not count.
  yield ['number tracker with a daily target', {
    trackers: [{ id: 's', category: 'fitness', type: 'number', dailyGoal: 10000 }],
    logs: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [ymd(now - i * DAY), { s: i % 2 ? 6000 : 11000 }])),
  }, 0, 0];
  yield ['forty trackers in one category', {
    trackers: Array.from({ length: 40 }, (_, i) => ({ id: 'b' + i, category: 'brain', type: 'boolean' })),
    logs: (() => {
      const l = {};
      for (let i = 0; i < 30; i++) {
        l[ymd(now - i * DAY)] = Object.fromEntries(Array.from({ length: 40 }, (_, k) => ['b' + k, true]));
      }
      return l;
    })(),
  }, 0, 0];
  yield ['maxed', {
    trackers, logs: mkLogs(30), visions: mkVisions(VISIONS.length), achievements: mkAchs(200),
    savings: [{ id: 'g', target: 25_000, current: 25_000 }],
    brainScore: { result: 130 }, financeScore: { result: 130 },
    fitnessScore: { result: 130 }, socialScore: { result: 130 },
    vitalsLog: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [ymd(now - i * DAY), { weight: 82 }])),
    burnLog: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [ymd(now - i * DAY), [{ kcal: 1200 }]])),
  }, 50, 400];

  // ── Day-key sanitisation (2026-09-30) ──
  // The fifth element is the account's createdAt (ms). Junk keys, future
  // dates and days before the account existed must score nothing, and
  // lifetime day counts cap at account age — in BOTH implementations.
  const junk = {};
  for (let i = 0; i < 500; i++) junk['x' + i] = { t1: true, t2: true };
  junk['2026-02-30'] = { t1: true };           // not a real date
  junk['20260101'] = { t1: true };             // wrong shape
  junk['2026-01-01T00:00'] = { t1: true };     // wrong shape
  yield ['junk day keys', {
    trackers, logs: { ...mkLogs(10), ...junk },
    vitalsLog: { ...Object.fromEntries(Object.keys(junk).map(k => [k, { weight: 80 }])) },
    burnLog: { ...Object.fromEntries(Object.keys(junk).map(k => [k, [{ kcal: 600 }]])), '2026-01-02': { kcal: 5 } },
  }, 0, 0];
  const future = {};
  for (let i = 2; i < 400; i++) future[ymd(now + i * DAY)] = { t1: true, t2: true, t3: 4 };
  yield ['future-dated days', {
    trackers, logs: { ...mkLogs(5), ...future },
    vitalsLog: Object.fromEntries(Object.keys(future).map(k => [k, { weight: 80 }])),
    burnLog: Object.fromEntries(Object.keys(future).map(k => [k, [{ kcal: 600 }]])),
  }, 0, 0];
  yield ['ten years of days on a ten-day-old account', {
    trackers, logs: mkLogs(3650),
    vitalsLog: Object.fromEntries(Array.from({ length: 3650 }, (_, i) => [ymd(now - i * DAY), { weight: 82 }])),
    burnLog: Object.fromEntries(Array.from({ length: 3650 }, (_, i) => [ymd(now - i * DAY), [{ kcal: 900 }]])),
  }, 3, 5000, now - 10 * DAY];
  yield ['honest year-old account', {
    trackers, logs: mkLogs(300), visions: mkVisions(8), achievements: mkAchs(10),
    vitalsLog: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [ymd(now - i * DAY), { weight: 82 }])),
    burnLog: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [ymd(now - i * DAY), [{ kcal: 450 }]])),
  }, 8, 200, now - 365 * DAY];
}

/* Behaviour, not just agreement: a sanitised state must score exactly
   what its clean half scores, on both sides. Parity alone would pass if
   both files counted junk identically. */
function* behaviourCases() {
  const now = Date.now();
  const clean = {};
  for (let i = 0; i < 10; i++) clean[ymd(now - i * DAY)] = { t1: true };
  const trackers = [{ id: 't1', category: 'fitness', type: 'boolean' }];
  const junky = { ...clean };
  for (let i = 0; i < 300; i++) junky['k' + i] = { t1: true };
  for (let i = 2; i < 300; i++) junky[ymd(now + i * DAY)] = { t1: true };
  yield ['junk + future keys add nothing', { trackers, logs: junky }, { trackers, logs: clean }, {}, {}];
  const old = {};
  for (let i = 0; i < 2000; i++) old[ymd(now - i * DAY)] = { t1: true };
  const recent = {};
  for (let i = 0; i < 6; i++) recent[ymd(now - i * DAY)] = { t1: true };
  // A 4-day-old account: its window runs from the day before creation,
  // so at most six keys (days -5 .. 0) can count.
  yield ['pre-account history adds nothing', { trackers, logs: old }, { trackers, logs: recent },
    { createdAt: now - 4 * DAY }, {}];
}

const TOLERANCE = 1;
let checked = 0;
const failures = [];

for (const [name, S, friendCount, macroDays, createdAt = null] of cases()) {
  const c = clientDerive(S, { friendCount, macroDays, createdAt });
  const s = serverDerive(S, friendCount, {}, macroDays, createdAt);
  for (const k of [...CATS, 'ovr']) {
    checked++;
    if (Math.abs(c[k] - s[k]) > TOLERANCE) {
      failures.push(`${name} · ${k}: app ${c[k]}, leaderboard ${s[k]} (off by ${c[k] - s[k]})`);
    }
  }
}

for (const [name, dirty, clean, dirtyCtx, cleanCtx] of behaviourCases()) {
  const pairs = [
    ['app', clientDerive(dirty, dirtyCtx), clientDerive(clean, cleanCtx)],
    ['leaderboard',
      serverDerive(dirty, 0, {}, 0, dirtyCtx.createdAt ?? null),
      serverDerive(clean, 0, {}, 0, cleanCtx.createdAt ?? null)],
  ];
  for (const [side, d, c] of pairs) {
    for (const k of [...CATS, 'ovr']) {
      checked++;
      if (d[k] !== c[k]) failures.push(`${name} · ${side} ${k}: sanitised ${d[k]}, clean ${c[k]}`);
    }
  }
}

// A ten-day-old account cannot bank ten years: the capped fitness
// rating must sit far below the uncapped one.
{
  const now = Date.now();
  const logs = {};
  for (let i = 0; i < 3650; i++) logs[ymd(now - i * DAY)] = { t1: true };
  const S = { trackers: [{ id: 't1', category: 'fitness', type: 'boolean' }], logs };
  const capped = serverDerive(S, 0, {}, 0, now - 10 * DAY).fitness;
  const open = serverDerive(S, 0, {}, 0, null).fitness;
  checked++;
  if (!(capped < open / 2)) failures.push(`age cap: 10-day account scored ${capped}, uncapped ${open}`);
}

if (failures.length) {
  console.error(`✗ the app and the leaderboard disagree on ${failures.length} of ${checked} values\n`);
  for (const f of failures) console.error('  ' + f);
  console.error('\nsrc/lib/ratings/derive.js and netlify/lib/recompute.js have to');
  console.error('stay in step — whichever one you changed, change the other.');
  process.exit(1);
}
console.log(`✓ ratings parity — ${checked} values across ${[...cases()].length} states, within ${TOLERANCE}`);
