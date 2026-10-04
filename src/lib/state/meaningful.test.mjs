/**
 * The anti-wipe guard decides whether a save may replace the cloud row,
 * so the fixtures are the real shapes that matter: the factory seed, the
 * seed after the app has booted on it (and written its own keys), and
 * users whose ONLY data is one store the old predicate never looked at.
 *
 * The first block REPRODUCES the old predicate against a WHOOP-only user
 * so the fix is measured against the bug, not against itself.
 */
import assert from 'node:assert/strict';
import { DEFAULT_STATE } from '../../data/initialState.js';
import {
  hasMeaningfulData, looksLikeFactoryDefault, meaningfulEvidence, MEANINGFUL_IGNORE,
} from './meaningful.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const clone = o => JSON.parse(JSON.stringify(o));
const seed = () => clone(DEFAULT_STATE);

// ── Heavy realistic builders ─────────────────────────────────────────
const DAY = 86_400_000;
const T0 = Date.UTC(2025, 8, 30);
const iso = i => new Date(T0 + i * DAY).toISOString().slice(0, 10);
const days = (count, fn) => Object.fromEntries(Array.from({ length: count }, (_, i) => [iso(i), fn(i)]));

const vitalsLog = () => days(365, i => ({
  weight: 82 - i * 0.01, sleep: 7 + (i % 5) / 10, rhr: 52 + (i % 7),
  recovery: 40 + (i % 50), strain: 8 + (i % 9), source: 'whoop',
}));
const burnLog = () => days(365, i => ({ active: 500 + (i % 300), rest: 1800, source: 'whoop' }));

/** A year of everything, the way an engaged account actually looks. */
function heavyUser() {
  const s = seed();
  s.profile = { name: 'Harry', tagline: 'one more rep', photo: null };
  s.logs = days(300, i => ({ t1: i % 2 === 0, t2: i % 3 === 0, t3: i * 5 }));
  s.vitalsLog = vitalsLog();
  s.burnLog = burnLog();
  s.bodyLog = days(52, i => ({ waist: 86 - i * 0.05, chest: 101 }));
  s.moodLog = days(120, i => ({ mood: 1 + (i % 5) }));
  s.habits = Array.from({ length: 6 }, (_, i) => ({
    id: 'h' + i, name: 'Habit ' + i, startTime: T0 + i * DAY,
    strikeTimes: [], runs: Array.from({ length: 40 }, (_, r) => ({ start: T0 + r * DAY, end: T0 + (r + 1) * DAY })),
  }));
  s.savings = [{ id: 's1', name: 'House', target: 20000, current: 8200,
    contributions: Array.from({ length: 80 }, (_, i) => ({ id: 'c' + i, amount: 100, ts: T0 + i * DAY })) }];
  s.subscriptions = Array.from({ length: 14 }, (_, i) => ({ id: 'sub' + i, name: 'Sub ' + i, price: 9.99 }));
  s.coins = 4210;
  s.coinHistory = Array.from({ length: 300 }, (_, i) => ({ type: 'earn', amount: 5, ts: T0 + i * DAY }));
  s.theme = 'dark-os';
  s.visionsBackfilled = true;
  s['awarded_t1_2026-W39'] = true;
  return s;
}

/** DEFAULT_STATE after a boot on it, with NO user action: everything the
 *  app writes by itself. This must still read as factory default, or the
 *  outgoing-state check stops recognising a wipe in progress. */
function wipedAndBooted() {
  const s = seed();
  s.theme = 'cream-pro';
  s.colorScheme = 'green';
  s.ratings = { brain: 3, finance: 1, fitness: 2, social: 1, ovr: 2, computedAt: Date.now() };
  s.prestige = 1;
  s.visionsBackfilled = true;
  s.tutorialCompleted = true;
  s.planLedger = { from: '2026-09', months: {} };
  s.whoopLastError = { at: Date.now(), message: 'token expired', reconnect: true };
  s.whoopConnected = true;
  s.ghCache = { harrybbq: { at: Date.now(), user: { login: 'x' }, repos: [{ name: 'r' }] } };
  s.streaks = { t1: { current: 0, best: 0, lastDate: null }, t2: { current: 0, best: 0, lastDate: null } };
  s.coachMemory = { 'insight-1': { lastShownYmd: '2026-09-30', showCount: 1 } };
  s.coachBriefHistory = [{ focus: 'sleep' }];
  s.widgetPositions = { w1: { x: 10, y: 10 } };
  s.widgetSizes = { w1: { w: 300, h: 200 } };
  s.widgetZ = { w1: 3 };
  s.widgetLayoutW = 1280;
  s.hubSnap = true;
  s.moduleTransparency = { ratings: true };
  s.bgFx = { hub: { dim: 20, blur: 0 } };
  s.calYear = 2026; s.calMonth = 8;
  s.multiSelectedDays = ['2026-09-01'];
  s['awarded_t1_2026-W39'] = true;
  s.__slim = true;
  return s;
}

// ── The bug, reproduced ─────────────────────────────────────────────
// The pre-fix predicate, verbatim in spirit: a fixed list of stores.
function oldHasMeaningful(state) {
  return (
    Object.keys(state.logs || {}).length > 0 || (state.savings || []).length > 0 ||
    Object.keys(state.visions || {}).length > 0 || (state.coins || 0) > 0 ||
    !!state.profile?.name || !!state.profile?.tagline || (state.habits || []).length > 0 ||
    (state.links || []).length > 0 || (state.shopItems || []).length > 0 ||
    (state.achievements || []).some(a => a.completed) || (state.achievements || []).length > 4 ||
    (state.trackers || []).length > 3
  );
}
{
  const whoopOnly = seed();
  whoopOnly.vitalsLog = vitalsLog();
  whoopOnly.burnLog = burnLog();
  whoopOnly.whoopConnected = true;
  ok(!oldHasMeaningful(whoopOnly),
    'REPRODUCED: the old guard saw a year of WHOOP data as nothing to lose');
  ok(hasMeaningfulData(whoopOnly), 'fixed: a WHOOP-only user has meaningful data');
  ok(!looksLikeFactoryDefault(whoopOnly), 'fixed: and their own saves are not mistaken for a wipe');
  ok(meaningfulEvidence(whoopOnly).includes('vitalsLog') && meaningfulEvidence(whoopOnly).includes('burnLog'),
    'evidence names the stores');
}

// ── The seed, bare and booted ───────────────────────────────────────
ok(!hasMeaningfulData(seed()), 'DEFAULT_STATE is not meaningful');
ok(looksLikeFactoryDefault(seed()), 'DEFAULT_STATE looks like factory default');
{
  const b = wipedAndBooted();
  ok(!hasMeaningfulData(b), 'seed + everything the app auto-writes on boot is still not meaningful: '
    + meaningfulEvidence(b).join(', '));
  ok(looksLikeFactoryDefault(b), 'so a wipe in progress is still recognised after effects have run');
}

// ── Every store, alone, is enough ───────────────────────────────────
const alone = {
  vitalsLog: vitalsLog(),
  burnLog: burnLog(),
  bodyLog: days(30, i => ({ waist: 80 + i * 0.1 })),
  moodLog: days(30, i => ({ mood: 3 + (i % 2) })),
  subscriptions: [{ id: 'n', name: 'Netflix', price: 10.99, renews: '2026-10-04' }],
  holidays: [{ id: 'h', dest: 'Lisbon', start: '2026-11-02' }],
  backgrounds: { hub: 'data:image/jpeg;base64,' + 'A'.repeat(20_000) },
  hubWidgets: [{ id: 'hw1', type: 'habits' }],
  mobileWidgets: [{ id: 'mw1', type: 'vitals' }],
  savings: [{ id: 's', name: 'Car', target: 5000, current: 0, contributions: [] }],
  savingsAccounts: [{ id: 'acc', name: 'ISA', balance: 1200 }],
  habits: [{ id: 'h', name: 'No sugar', startTime: T0 }],
  shopItems: [{ id: 'i', name: 'Headphones', price: 200 }],
  recipes: [{ id: 'r', name: 'Chilli', ingredients: [] }],
  mealPlan: { '2026-10-01': { lunch: 'r' } },
  logs: days(3, () => ({ t1: true })),
  links: [{ id: 'l', name: 'GitHub', url: 'https://github.com' }],
  visions: { 'streak-7': { unlockedAt: '2026-09-01T00:00:00Z' } },
  calendarEvents: { '2026-10-02': [{ id: 'e', title: 'Dentist' }] },
  macroHistory: days(10, () => ({ kcal: 2200 })),
  savedMeals: [{ id: 'm', name: 'Breakfast' }],
  visitedExtra: ['PT'],
  marketSymbols: ['AAPL'],
  // An unknown future store, dated like the others. Protected by
  // default — which is the whole point of inverting the list.
  someStoreAddedNextYear: { '2027-01-01': { anything: 1 } },
};
for (const [key, value] of Object.entries(alone)) {
  const s = seed();
  s[key] = value;
  ok(hasMeaningfulData(s), `${key} alone is meaningful`);
  ok(!looksLikeFactoryDefault(s), `${key} alone is not factory default`);
}

// ── Seeded structures and scalars ───────────────────────────────────
{
  const s = seed(); s.coins = 5;
  ok(hasMeaningfulData(s), 'coins > 0 counts');
}
{
  const s = seed(); s.profile = { name: 'Finlay', tagline: '', photo: null };
  ok(hasMeaningfulData(s), 'a profile name counts');
}
{
  const s = seed(); s.profile = { name: '   ', tagline: '', photo: 'data:x' };
  ok(!hasMeaningfulData(s), 'whitespace name and a photo alone do not (the photo lives in its own column)');
}
{
  const s = seed(); s.achievements[0].completed = true;
  ok(hasMeaningfulData(s), 'a completed seed achievement counts');
}
{
  const s = seed(); s.achievements = s.achievements.slice(0, 3).concat([{ id: 'a99', name: 'Mine' }]);
  ok(hasMeaningfulData(s), 'a replaced seed achievement counts even at length 4');
}
{
  const s = seed(); s.trackers = [{ id: 't9', name: 'Steps', type: 'number' }];
  ok(hasMeaningfulData(s), 'a user-made tracker counts even when the seed was deleted');
}
{
  const s = seed(); s.achievements = []; s.trackers = []; s.connections = [];
  ok(!hasMeaningfulData(s), 'deleting the seeds is not data');
}
{
  const s = seed(); s.brainScore = { result: 118, ts: T0, testVersion: 1 };
  ok(hasMeaningfulData(s), 'an IQ result counts');
}
{
  const s = seed(); s.planLedger = { from: '2026-05', months: { '2026-06': { ts: T0, total: 300 } } };
  ok(hasMeaningfulData(s), 'a posted plan month counts though planLedger itself is ignored');
}
{
  const s = seed(); s.theme = 'dark-os'; s.tutorialCompleted = true; s.whoopConnected = true;
  s['awarded_t1_2026-W40'] = true; s.achBoardTransparent = true;
  ok(!hasMeaningfulData(s), 'auto-set and settings scalars are not data');
}

{
  // Multi-day events (lib/calendar/spans.js) are covered by the generic
  // rule — no IGNORE entry, no SQL change.
  const s = seed(); s.calendarSpans = [{ id: 'sp_1', title: 'Away', start: '2026-10-05', end: '2026-10-09' }];
  ok(hasMeaningfulData(s) && meaningfulEvidence(s).includes('calendarSpans'), 'a multi-day event counts');
  const e = seed(); e.calendarSpans = [];
  ok(!hasMeaningfulData(e), 'an empty span list does not');
}

// ── Heavy user ──────────────────────────────────────────────────────
{
  const h = heavyUser();
  ok(hasMeaningfulData(h) && !looksLikeFactoryDefault(h), 'the heavy user is meaningful');
  ok(meaningfulEvidence(h).length >= 10, 'with evidence in many stores');
  const t = Date.now();
  for (let i = 0; i < 50; i++) hasMeaningfulData(h);
  ok(Date.now() - t < 1000, 'and checking it is cheap (it runs on every edit)');
}

// ── Shape guards ────────────────────────────────────────────────────
ok(!hasMeaningfulData(null) && !hasMeaningfulData(undefined) && !hasMeaningfulData('x'), 'non-objects are not meaningful');
ok(!looksLikeFactoryDefault(null), 'and are not "factory default" either (nothing to compare)');
ok(MEANINGFUL_IGNORE.every(k => typeof k === 'string'), 'the ignore list is plain strings (mirrored in SQL)');
for (const k of ['vitalsLog', 'burnLog', 'bodyLog', 'moodLog', 'subscriptions', 'holidays', 'backgrounds',
  'hubWidgets', 'savings', 'habits', 'shopItems', 'recipes', 'mealPlan', 'logs', 'calendarEvents', 'calendarSpans']) {
  ok(!MEANINGFUL_IGNORE.includes(k), `${k} is never on the ignore list`);
}

console.log(`meaningful: ${n} checks passed`);
