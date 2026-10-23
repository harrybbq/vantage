// node netlify/lib/coachWearableGuard.test.mjs
// WHOOP / Oura data and the AI coach: stripped by default, passed only
// when AI_WEARABLE_DATA_ALLOWED === 'true'. Covers the server guard, the
// client snapshot builder, and that ai-coach-daily actually uses the guard.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { guardWearableData, wearableAllowed, ENV_NAME } = require('./coachWearableGuard.js');
const { buildSnapshot } = await import('../../src/lib/coach/snapshot.js');
const { cellFromBand } = await import('../../src/lib/coach/wearableProvenance.js');

const here = path.dirname(fileURLToPath(import.meta.url));

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { console.log('  FAIL ' + msg); fails++; }
}
const has = (obj, needle) => JSON.stringify(obj).includes(needle);

// ── A snapshot as a modified / future client might send it ───────────
function heavySnapshot() {
  return {
    name: 'Sam',
    today_ymd: '2026-10-17',
    weekday: 'Saturday',
    habits: [{ id: 'h1', name: 'No late snacks', days_clean: 12, relapse_count: 1 }],
    achievements: [{ id: 'a9', name: 'Run a 10k', completed: false, coins: 40 }],
    trackers: [
      { id: 't-read', name: 'Read 20 pages', type: 'boolean', last_7_total: 5, prior_7_total: 4,
        last_14_days: [{ ymd: '2026-10-17', value: 1 }, { ymd: '2026-10-16', value: 1 }] },
      { id: 't-steps', name: 'Steps', type: 'number', unit: 'steps', wearable: true, last_7_total: 71000,
        last_14_days: [{ ymd: '2026-10-17', value: 11000, src: 'wearable' }] },
      { id: 't-sleep', name: 'Sleep', type: 'number', unit: 'h', last_7_total: 52,
        last_14_days: [{ ymd: '2026-10-17', value: 7.4 }, { ymd: '2026-10-16', value: 7.1, src: 'wearable' }] },
    ],
    vitals: {
      '2026-10-16': { weight: 81.2, sleep: 7.1, rhr: 52, hrv: 88, recovery: 71, strain: 12.4, burnKcal: 2980, stepsWhoop: 11200 },
      '2026-10-15': { weight: 81.4, sleep: 6.8, rhr: 55 },               // hand / Apple Health row
      '2026-10-14': { sleep: 7.9, stepsOura: 9400 },
    },
    burn: {
      '2026-10-16': [
        { id: 'whoop-77812', label: 'WHOOP workout', kcal: 512 },
        { id: 'oura-a1b2', label: 'Oura workout', kcal: 300 },
        { id: 'ah-steps-2026-10-16', label: '8,214 steps', kcal: 290 },
      ],
    },
    readings: [{ metric: 'hrv', value: 90, source: 'oura' }, { metric: 'weight', value: 81, source: 'manual' }],
    whoopConnected: true,
    recent_briefs: [],
    recent_dismissed_topics: [],
  };
}

console.log('env switch');
ok(!wearableAllowed({}), 'unset: not allowed');
ok(!wearableAllowed({ [ENV_NAME]: '1' }), "'1': not allowed");
ok(!wearableAllowed({ [ENV_NAME]: 'TRUE' }), "'TRUE': not allowed (exact match only)");
ok(!wearableAllowed({ [ENV_NAME]: 'false' }), "'false': not allowed");
ok(wearableAllowed({ [ENV_NAME]: 'true' }), "'true': allowed");

console.log('server guard — default strips');
{
  const input = heavySnapshot();
  const before = JSON.stringify(input);
  const out = guardWearableData(input, { env: {} });
  ok(JSON.stringify(input) === before, 'input is not mutated');
  const ids = out.trackers.map(t => t.id);
  ok(ids.includes('t-read'), 'hand-logged tracker kept');
  ok(!ids.includes('t-steps'), 'tracker flagged wearable removed');
  ok(!ids.includes('t-sleep'), 'tracker with any wearable cell removed whole (no holes)');
  for (const k of ['hrv', 'recovery', 'strain', 'burnKcal', 'stepsWhoop', 'stepsOura', 'whoopConnected']) {
    ok(!has(out, `"${k}"`), `no "${k}" anywhere`);
  }
  ok(!has(out, 'whoop-77812') && !has(out, 'oura-a1b2'), 'device workouts (whoop-/oura- ids) removed');
  ok(has(out, 'ah-steps-2026-10-16'), 'Apple Health steps entry kept');
  ok(out.vitals['2026-10-16'].sleep === undefined && out.vitals['2026-10-16'].rhr === undefined,
    'sleep/rhr on a row a band touched removed');
  ok(out.vitals['2026-10-16'].weight === 81.2, 'weight on that row kept (no band writes weight)');
  ok(out.vitals['2026-10-15'].sleep === 6.8 && out.vitals['2026-10-15'].rhr === 55, 'hand / Apple Health row kept whole');
  ok(out.vitals['2026-10-14'].sleep === undefined, 'Oura-touched row loses sleep too');
  ok(out.readings.length === 1 && out.readings[0].source === 'manual', "entries with source 'oura' removed, 'manual' kept");
  ok(out.habits.length === 1 && out.achievements.length === 1 && out.name === 'Sam', 'everything else untouched');
  ok(!/wearable|whoop|oura/i.test(JSON.stringify(out)), 'nothing left that names a device or says data was removed');
}
{
  const out = guardWearableData(heavySnapshot()); // reads process.env
  if (process.env[ENV_NAME] !== 'true') ok(out.trackers.length === 1, 'reads process.env by default (unset here → strips)');
}

console.log("server guard — env 'true' passes");
{
  const input = heavySnapshot();
  const out = guardWearableData(input, { env: { [ENV_NAME]: 'true' } });
  ok(out === input, 'snapshot passed through untouched');
  ok(out.trackers.length === 3 && has(out, '"hrv"') && has(out, 'whoop-77812'), 'band values present');
}

console.log('ai-coach-daily wiring');
{
  // The prompt pipeline moved to lib/coachPrompt.js (item 105) so the
  // red-team eval can run it; the handler hands it the raw snapshot.
  const src = fs.readFileSync(path.join(here, './handlers/ai-coach-daily.js'), 'utf8');
  const lib = fs.readFileSync(path.join(here, 'coachPrompt.js'), 'utf8');
  ok(/prepareBrief\(body\.snapshot\)/.test(src), 'function hands the raw snapshot to prepareBrief');
  ok(/require\('\.\/coachWearableGuard'\)/.test(lib), 'pipeline requires the guard');
  const prep = lib.slice(lib.indexOf('function prepareBrief'));
  const iGuard = prep.indexOf('guardWearableData(rawSnapshot');
  ok(iGuard > 0 && iGuard < prep.indexOf('assessSnapshot(guarded)') && iGuard < prep.indexOf('fitSnapshot('), 'guard runs before the snapshot is assessed, sized and sent');
  ok(!/VisionBoard|vision-board/i.test(src + lib), 'no stale VisionBoard naming');
  ok(/personal life app called Vantage/.test(lib), 'SYSTEM_PROMPT names Vantage');
}

// ── Client snapshot ──────────────────────────────────────────────────
console.log('client snapshot');
const DAY = 86_400_000;
const key = i => new Date(Date.now() - i * DAY).toISOString().slice(0, 10); // same keys buildSnapshot uses
function clientState() {
  const logs = {}, logsAuto = {}, vitalsLog = {}, burnLog = {};
  for (let i = 0; i < 14; i++) {
    const d = key(i);
    logs[d] = { tRead: i % 3 !== 0, tSteps: 9000 + i * 100, tStrain: true, tSleep: 7 + (i % 3) / 10, tWeigh: true, tPhone: 6000 + i };
    logsAuto[d] = { tSteps: 'steps', tStrain: 'strain', tSleep: 'sleep', tWeigh: 'weight', tPhone: 'steps' };
    vitalsLog[d] = { weight: 80 + i / 10, sleep: 7.2, stepsWhoop: 9000 + i * 100 };
    if (i % 2) vitalsLog[d].recovery = 60 + i;
    burnLog[d] = [{ id: 'ah-steps-' + d, label: `${(6000 + i).toLocaleString('en-GB')} steps`, steps: 6000 + i, kcal: 200 }];
  }
  // A hand-touched cell on a band tracker stays the user's.
  logsAuto[key(2)].tSteps = 'manual';
  return {
    profile: { name: 'Sam Example' },
    coins: 120,
    habits: [],
    achievements: [{ id: 'a1', name: 'First 5k', completed: false, coins: 20 }],
    trackers: [
      { id: 'tRead', name: 'Read', type: 'boolean' },
      { id: 'tSteps', name: 'Steps', type: 'number', unit: 'steps', auto: { source: 'steps' } },
      { id: 'tStrain', name: 'Hard day', type: 'boolean', auto: { source: 'strain', threshold: 10 } },
      { id: 'tSleep', name: 'Sleep', type: 'number', unit: 'h', auto: { source: 'sleep' } },
      { id: 'tWeigh', name: 'Weigh in', type: 'boolean', auto: { source: 'weight' } },
      { id: 'tPhone', name: 'Phone steps', type: 'number', unit: 'steps', auto: { source: 'steps' } },
    ],
    logs, logsAuto, vitalsLog, burnLog,
    whoopConnected: true,
  };
}
{
  const S = clientState();
  ok(cellFromBand(S, key(0), S.trackers[1]) === true, 'steps cell above the phone count → band');
  ok(cellFromBand(S, key(2), S.trackers[1]) === false, "cell marked 'manual' → not band");
  ok(cellFromBand(S, key(0), S.trackers[5]) === false, 'steps cell equal to the Apple Health count → not band');
  ok(cellFromBand(S, key(1), S.trackers[3]) === true, 'sleep cell on a row a band synced → band');
  ok(cellFromBand(S, key(0), S.trackers[4]) === false, 'weight cell → never band');
  ok(cellFromBand(S, key(0), S.trackers[0]) === false, 'hand tracker → never band');

  const snap = buildSnapshot(S, { allowWearable: false });
  const ids = snap.trackers.map(t => t.id);
  ok(ids.includes('tRead') && ids.includes('tWeigh') && ids.includes('tPhone'), 'hand, weight and Apple-Health-steps trackers sent');
  ok(!ids.includes('tSteps') && !ids.includes('tStrain') && !ids.includes('tSleep'), 'WHOOP steps, strain and band-night sleep trackers withheld');
  ok(!/wearable|whoop|oura/i.test(JSON.stringify(snap)), 'client snapshot says nothing about devices');
  ok(guardWearableData(snap, { env: {} }).trackers.length === snap.trackers.length, 'server guard has nothing left to strip');

  const tagged = buildSnapshot(S, { allowWearable: true });
  const steps = tagged.trackers.find(t => t.id === 'tSteps');
  ok(tagged.trackers.length === 6 && steps && steps.wearable === true, 'build flag on: band trackers sent, tagged');
  ok(steps.last_14_days.some(c => c.src === 'wearable'), 'band cells tagged src: wearable');
  ok(guardWearableData(tagged, { env: {} }).trackers.length === 3, 'server strips tagged trackers when its switch is off');
  ok(guardWearableData(tagged, { env: { [ENV_NAME]: 'true' } }).trackers.length === 6, 'server passes them when its switch is on');

  // Default (no override) follows the build flag, which is unset in node.
  ok(buildSnapshot(S).trackers.length === 3, 'default build: band data withheld');
}

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log('\ncoach wearable guard: all passing');
