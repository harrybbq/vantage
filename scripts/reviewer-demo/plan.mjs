/**
 * Reviewer demo accounts — the pure half (STARTUP_REQUIREMENTS item 122).
 *
 * Everything the seeder decides without touching the network: argument
 * parsing and the allow-list, the refusal rule for an existing
 * user_data row, and the invented-but-realistic data itself. seed.mjs
 * does the I/O; plan.test.mjs checks this file hermetically.
 *
 * The state uses the SAME shape the app writes. Each store was checked
 * against the code that creates it, not copied from a harness:
 *   trackers / achievements      Modals.jsx AddTrackerModal / AddAchievementModal
 *   logs                         { 'YYYY-MM-DD': { trackerId: true | number } }
 *   habits (+ kind 'cut')        Modals.jsx AddHabitModal, lib/habits/cutdown.js
 *   vitalsLog (hand entries)     weight / sleep / rhr only — no band keys
 *                                (lib/coach/wearableProvenance.js), so
 *                                nothing reads as WHOOP/Oura data
 *   savings / savingsAccounts    lib/savings/derive.js header
 *   projection                   lib/savings/derive.js header
 *   subscriptions                lib/money/recurring.js (freq week|month|year)
 *   holidays                     holiday/HolidayFormTabs.jsx emptyHolidayForm
 *   shopItems                    Modals.jsx AddShopModal
 *   bodyGoal / burnProfile       widgets/GoalsWidget.jsx, lib/burn.js
 *   mobileWidgets / hubWidgets   { id, type }
 * Left for the app to derive on first load: ratings, visions (silent
 * backfill), streaks, macroHistory, coach caches. AI consent is left
 * unasked on purpose, so a reviewer sees the consent step (store pack
 * §1.2). Everything is fictional; no real person's data.
 *
 * `demoSeed` marks the row as written by this tool. It is the only thing
 * that lets a re-run overwrite a row that already holds data.
 */
import { hasMeaningfulData, meaningfulEvidence } from '../../src/lib/state/meaningful.js';

export const DEMO_TAG = 'reviewer-demo';
export const ROLES = ['pro', 'free', 'friend'];
const DAY = 86_400_000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ── Arguments ─────────────────────────────────────────────────────── */

const normEmail = (e) => String(e || '').trim().toLowerCase();

/**
 * argv → { ok, opts | error }. Flags:
 *   --allow a@x,b@x      the ONLY addresses this run may touch (required)
 *   --pro a@x            the browsing account (full seed)       (≤ 1)
 *   --free b@x           the purchase-test account (light seed) (≤ 1)
 *   --friend c@x         a demo friend (light seed)             (repeatable, ≤ 4)
 *   --create             create missing auth users (password from env)
 *   --write              actually write; without it, a dry run
 */
export function parseArgs(argv, env = {}) {
  const opts = { allow: [], accounts: [], create: false, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v == null || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === '--allow') opts.allow.push(...val().split(',').map(normEmail).filter(Boolean));
      else if (a === '--pro' || a === '--free' || a === '--friend') opts.accounts.push({ role: a.slice(2), email: normEmail(val()) });
      else if (a === '--create') opts.create = true;
      else if (a === '--write') opts.write = true;
      else return { ok: false, error: `unknown argument: ${a}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  const err = validatePlan(opts, env);
  return err ? { ok: false, error: err } : { ok: true, opts };
}

/** The refusal rules for a run, before any network. → error string | null */
export function validatePlan(opts, env = {}) {
  if (!opts.allow.length) return 'refusing: --allow <emails> is required — the explicit list of demo accounts this run may touch';
  for (const e of opts.allow) if (!EMAIL_RE.test(e)) return `refusing: not an email in --allow: ${e}`;
  if (!opts.accounts.length) return 'nothing to do: name at least one --pro, --free or --friend account';
  const seen = new Set();
  for (const { role, email } of opts.accounts) {
    if (!EMAIL_RE.test(email)) return `refusing: not an email: ${email}`;
    if (!opts.allow.includes(email)) return `refusing: ${email} is not in --allow`;
    if (seen.has(email)) return `refusing: ${email} is named twice`;
    seen.add(email);
    if (!ROLES.includes(role)) return `unknown role ${role}`;
  }
  if (opts.accounts.filter(a => a.role === 'pro').length > 1) return 'refusing: one --pro account per run';
  if (opts.accounts.filter(a => a.role === 'free').length > 1) return 'refusing: one --free account per run';
  if (opts.accounts.filter(a => a.role === 'friend').length > 4) return 'refusing: at most four --friend accounts';
  const owners = String(env.OWNER_EMAIL || env.VITE_OWNER_EMAIL || '').split(',').map(normEmail).filter(Boolean);
  for (const { email } of opts.accounts) {
    if (owners.includes(email)) return `refusing: ${email} is an owner address — demo data never goes on a real account`;
  }
  if (opts.create && opts.write && String(env.DEMO_ACCOUNT_PASSWORD || '').length < 12) {
    return 'refusing: --create needs DEMO_ACCOUNT_PASSWORD (12+ characters) in the environment';
  }
  return null;
}

/* ── The user_data refusal rule ───────────────────────────────────── */

/**
 * May the seeder write this account's state? `row` is the user_data row
 * as read ({ state, updated_at }) or null when there is none.
 * → { write: 'insert' | 'replace' | false, reason }
 *
 * Mirrors the store pack §1.2 rule (vb_state_meaningful): a row is only
 * replaced when it holds nothing a person would miss — no row, an empty
 * state, a state the app's own predicate calls factory-default (what a
 * first sign-in saves) — or when this tool wrote it (`demoSeed`). Any
 * other row is refused, whatever the allow-list says.
 */
export function stateWriteDecision(row) {
  if (!row) return { write: 'insert', reason: 'no row yet' };
  const s = row.state;
  if (s == null || (typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length === 0)) {
    return { write: 'replace', reason: 'row is empty' };
  }
  if (typeof s !== 'object' || Array.isArray(s)) return { write: false, reason: 'refusing: state is not an object' };
  if (s.demoSeed && s.demoSeed.by === DEMO_TAG) return { write: 'replace', reason: 'row was written by this tool' };
  if (!hasMeaningfulData(s)) return { write: 'replace', reason: 'row holds only the first-sign-in defaults' };
  return { write: false, reason: `refusing: row already holds data (${meaningfulEvidence(s).slice(0, 6).join(', ')})` };
}

/* ── Invented data ─────────────────────────────────────────────────── */

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const round1 = (v) => Math.round(v * 10) / 10;

/** Fictional people. Handles are 3–20 [A-Za-z0-9_] (profiles_handle_format). */
export const PERSONAS = {
  pro:    { name: 'Sam Carter',  handle: 'demo_sam',   tagline: 'Half marathon in March. Lisbon in May.', heightCm: 178, age: 32, sex: 'male',   startKg: 84.6, goalKg: 79 },
  free:   { name: 'Alex Reid',   handle: 'demo_alex',  tagline: '', heightCm: 170, age: 27, sex: 'female', startKg: 66.2, goalKg: 63 },
  friend: [
    { name: 'Priya Shah',  handle: 'demo_priya', tagline: 'Couch to 10K, week 6.', heightCm: 165, age: 29, sex: 'female', startKg: 61.5, goalKg: 59 },
    { name: 'Tom Okafor',  handle: 'demo_tom',   tagline: 'Saving for a flat.',    heightCm: 183, age: 35, sex: 'male',   startKg: 91.0, goalKg: 86 },
    { name: 'Jess Morgan', handle: 'demo_jess',  tagline: '',                      heightCm: 168, age: 41, sex: 'female', startKg: 70.4, goalKg: 67 },
    { name: 'Dan Lewis',   handle: 'demo_dan',   tagline: '',                      heightCm: 175, age: 24, sex: 'male',   startKg: 76.0, goalKg: 74 },
  ],
};

export function personaFor(role, friendIndex = 0) {
  return role === 'friend' ? PERSONAS.friend[friendIndex % PERSONAS.friend.length] : PERSONAS[role];
}

const TRACKERS = [
  { id: 't1', name: 'Gym session', type: 'boolean', unit: '', goal: null, dailyGoal: null, color: '#1a7a4a', weeklyTarget: 3, weeklyCoins: 15, category: 'fitness', p: 0.55 },
  { id: 't2', name: 'Hit protein', type: 'boolean', unit: '', goal: null, dailyGoal: null, color: '#2a9e62', weeklyTarget: 5, weeklyCoins: 10, category: 'fitness', p: 0.78 },
  { id: 't3', name: 'Read 20 pages', type: 'boolean', unit: '', goal: null, dailyGoal: null, color: '#3b4fb8', weeklyTarget: 5, weeklyCoins: 10, category: 'brain', p: 0.7 },
  { id: 't4', name: 'Steps', type: 'number', unit: 'steps', goal: 10000, dailyGoal: 10000, color: '#0f5e5a', weeklyTarget: null, weeklyCoins: null, category: 'fitness' },
  { id: 't5', name: 'Spanish practice', type: 'boolean', unit: '', goal: null, dailyGoal: null, color: '#7a1a4a', weeklyTarget: 6, weeklyCoins: 10, category: 'brain', p: 0.85 },
];

function trackerLogs(trackers, days, now, r) {
  const logs = {};
  for (let i = days; i >= 0; i--) {
    const t = now - i * DAY;
    const dow = new Date(t).getDay();
    const L = {};
    for (const tr of trackers) {
      if (tr.type === 'number') {
        if (r() < 0.92) L[tr.id] = Math.round(5200 + r() * 7600);
      } else if (r() < tr.p * (dow === 0 && tr.id === 't1' ? 0.3 : 1)) {
        L[tr.id] = true;
      }
    }
    // Today is half-done, as it would be mid-afternoon.
    if (i === 0) { delete L.t1; delete L.t3; if (L.t4) L.t4 = 4180; }
    if (Object.keys(L).length) logs[ymd(t)] = L;
  }
  return logs;
}

function vitals(days, now, r, startKg, drift) {
  const out = {};
  let w = startKg;
  for (let i = days; i >= 0; i--) {
    w += (r() - 0.5) * 0.35 - drift;
    if (r() < 0.12) continue;   // the odd missed morning
    const row = { weight: round1(w) };
    if (r() < 0.85) row.sleep = round1(6.2 + r() * 2.1);
    if (r() < 0.6) row.rhr = Math.round(54 + r() * 9);
    out[ymd(now - i * DAY)] = row;
  }
  return out;
}

const milestones = (prefix, days) => days.map((d, j) => ({
  id: `${prefix}${j}`, duration: d * DAY, coins: [15, 30, 60, 120, 200][j] || 50, label: `${d} days`, awarded: false,
}));

function habit(id, name, color, sinceDays, relapses, now, extra = {}) {
  const ms = milestones('m' + id, [3, 7, 14, 30, 60]).map(m => ({ ...m, awarded: m.duration <= sinceDays * DAY }));
  return {
    id, name, color, endless: true, startTime: now - sinceDays * DAY - 3 * 3600_000,
    relapseCount: relapses, strikesAllowed: 0, strikesPeriod: 'week', strikeTimes: [], milestones: ms, ...extra,
  };
}

/** The full state for the browsing (Pro) account. */
export function buildProState(now = Date.now(), seed = 1220) {
  const r = rng(seed);
  const p = PERSONAS.pro;
  const trackers = TRACKERS.map(({ p: _p, ...t }) => t);
  const logs = trackerLogs(TRACKERS, 56, now, r);
  const vitalsLog = vitals(56, now, r, p.startKg, 0.06);

  const habits = [
    habit('hb1', 'Late-night snacks', '#1a7a4a', 23, 2, now),
    habit('hb2', 'Doomscrolling after 11pm', '#3b4fb8', 4, 6, now, { strikesAllowed: 1, strikeTimes: [now - 2 * DAY] }),
    habit('hb3', 'Takeaway on weeknights', '#7a3a1a', 11, 3, now),
    {
      ...habit('hb4', 'Energy drinks', '#c8970a', 40, 0, now),
      kind: 'cut', budget: { max: 2, per: 'week' }, budgetSince: ymd(now - 40 * DAY),
      useDays: [ymd(now - 2 * DAY), ymd(now - 9 * DAY), ymd(now - 12 * DAY), ymd(now - 23 * DAY), ymd(now - 31 * DAY)],
      milestones: [2, 4, 8].map((w, j) => ({ id: 'mhb4' + j, duration: w * 7 * DAY, coins: [20, 40, 80][j], label: `${w} weeks`, awarded: w * 7 <= 40 })),
    },
  ];

  const ach = [
    ['Run a 5K without stopping', '🏃', 'fitness', 60, true],
    ['Three-month emergency fund', '🛡️', 'finance', 150, true],
    ['Read 12 books this year', '📚', 'brain', 120, true],
    ['Half marathon under 2 hours', '🏅', 'fitness', 200, false],
    ['Hold a 10-minute Spanish conversation', '🇪🇸', 'brain', 150, false],
    ['Clear the credit card', '💳', 'finance', 120, false],
    ['Cook a new recipe every week for a month', '🍳', 'brain', 60, false],
    ['Weekend in Lisbon', '✈️', 'social', 90, false],
  ];
  const achievements = ach.map(([name, icon, category, coins, completed], i) => ({
    id: 'a' + (101 + i), name, desc: '', icon, category, coins,
    x: 40 + (i % 3) * 330, y: 40 + Math.floor(i / 3) * 170,
    completed, createdAt: now - (70 - i * 4) * DAY,
  }));
  const connections = [['a101', 'a104'], ['a102', 'a106']];

  const coinHistory = [];
  const earn = [['Gym session · weekly target', 15], ['Hit protein · weekly target', 10], ['Spanish practice · weekly target', 10], ['Late-night snacks · 14 days', 60], ['Run a 5K without stopping', 60]];
  for (let i = 0; i < 24; i++) {
    const [label, amount] = earn[i % earn.length];
    coinHistory.push({ type: 'earn', label, amount, ts: now - (i * 2.3 + 0.4) * DAY });
  }
  coinHistory.splice(5, 0, { type: 'spend', label: 'Bought: Cinema night', amount: 120, ts: now - 12 * DAY });
  coinHistory.splice(14, 0, { type: 'spend', label: 'Bought: New running socks', amount: 80, ts: now - 31 * DAY });
  const coins = Math.max(0, coinHistory.reduce((s, c) => s + (c.type === 'earn' ? c.amount : -c.amount), 0));

  const contrib = (prefix, n, amount, everyDays, from) => Array.from({ length: n }, (_, j) => ({
    id: `${prefix}${j}`, amount, note: '', ts: now - (from - j * everyDays) * DAY,
  })).reverse();
  const savings = [
    { id: 'sv1', name: 'Lisbon trip', icon: '✈️', image: null, target: 900, current: 540, targetDate: ymd(now + 150 * DAY), achievementId: 'a108', contributions: contrib('c1', 6, 90, 9, 54), createdAt: new Date(now - 60 * DAY).toISOString() },
    { id: 'sv2', name: 'Emergency fund', icon: '🛡️', image: null, target: 4500, current: 4500, targetDate: null, achievementId: 'a102', contributions: contrib('c2', 3, 1500, 20, 58), createdAt: new Date(now - 62 * DAY).toISOString() },
    { id: 'sv3', name: 'New road bike', icon: '🚲', image: null, target: 1400, current: 310, targetDate: null, achievementId: null, contributions: contrib('c3', 2, 155, 14, 20), createdAt: new Date(now - 25 * DAY).toISOString() },
  ];
  const savingsAccounts = [
    { id: 'ac1', name: 'Easy-access saver', balance: 3120, apy: 3.9, balanceAt: now - 6 * DAY },
    { id: 'ac2', name: 'Stocks & shares ISA', balance: 6840, apy: 0, balanceAt: now - 6 * DAY },
  ];
  const projection = {
    items: [
      { id: 'pi1', kind: 'income', label: 'Salary', amount: 2650, freq: 'month', payDay: 28 },
      { id: 'pi2', kind: 'expense', label: 'Rent', amount: 1050, freq: 'month' },
      { id: 'pi3', kind: 'expense', label: 'Groceries', amount: 280, freq: 'month' },
      { id: 'pi4', kind: 'expense', label: 'Lisbon trip pot', amount: 90, freq: 'month', goalId: 'sv1' },
    ],
    groups: [], horizon: 12, startBalance: 1200,
  };
  const nd = (d) => ymd(now + d * DAY);
  const subscriptions = [
    { id: 's1', name: 'Music streaming', amount: 11.99, freq: 'month', nextDate: nd(4), category: 'entertainment' },
    { id: 's2', name: 'Gym membership', amount: 27.99, freq: 'month', nextDate: nd(11), category: 'health' },
    { id: 's3', name: 'Cloud storage', amount: 2.99, freq: 'month', nextDate: nd(19), category: 'utilities' },
    { id: 's4', name: 'Video streaming', amount: 10.99, freq: 'month', nextDate: nd(23), category: 'entertainment' },
    { id: 's5', name: 'Running app', amount: 59.99, freq: 'year', nextDate: nd(140), category: 'health' },
  ];
  const trip = (id, dest, fromD, toD, status, budget, accom, notes, items = []) => ({
    id, dest, from: nd(fromD), to: nd(toD), accom, flight: '', budget, status, notes, imageUrl: '', items, savingsGoalId: id === 'h1' ? 'sv1' : '',
  });
  const holidays = [
    trip('h1', 'Lisbon, Portugal', 150, 154, 'booked', '£900', 'Guesthouse in Alfama', 'Tram 28 early, before the queues.', [
      { id: 'it1', kind: 'activity', day: nd(151), time: '10:00', title: 'Belém and the tower', note: '' },
      { id: 'it2', kind: 'activity', day: nd(152), time: '09:30', title: 'Day trip to Sintra', note: 'Train from Rossio' },
    ]),
    trip('h2', 'Edinburgh, United Kingdom', -120, -117, 'completed', '£450', 'Old Town apartment', ''),
    trip('h3', 'Barcelona, Spain', -300, -295, 'completed', '£700', 'Hotel near Sant Antoni', ''),
  ];
  const shopItems = [
    ['Cinema night', '£12', 120, true], ['New running socks', '£15', 80, true], ['Foam roller', '£25', 200, false],
    ['Running watch strap', '£20', 180, false], ['Cookbook', '£22', 220, false], ['Spanish course, level 2', '£60', 450, false],
    ['Concert tickets', '£55', 400, false], ['Weekend lie-in pass', '', 60, false], ['Massage', '£45', 350, false], ['Board game', '£30', 250, false],
  ].map(([name, price, coinCost, bought], i) => ({
    id: 's' + (201 + i), name, categoryId: null, price, url: '', imageUrl: '', priority: i < 3 ? 'high' : 'med', notes: '',
    coinCost, bought, addedAt: now - (50 - i * 3) * DAY,
  }));

  const widgets = ['vitals', 'macros', 'calories', 'goals', 'body-goal', 'habits', 'holidays', 'recent-wins'];
  return {
    profile: { name: p.name, tagline: p.tagline, photo: null },
    theme: 'dark-os', colorScheme: 'green', tutorialCompleted: true,
    termsAcceptedAt: new Date(now - 56 * DAY).toISOString(),
    links: [], achievements, connections, trackers, logs, logsAuto: {},
    habits, coins, coinHistory, visions: {}, visionsBackfilled: false,
    vitalsLog, burnProfile: { heightCm: p.heightCm, age: p.age, sex: p.sex, weightKg: p.startKg },
    bodyGoal: { type: 'cut', targetKg: p.goalKg, startKg: p.startKg, startedAt: ymd(now - 56 * DAY), useMacros: true, weeklyWeights: 3, weeklyCardio: 2, gymTrackerId: 't1' },
    savings, savingsAccounts, projection, subscriptions, holidays,
    shopItems, shopCategories: [],
    mobileWidgets: widgets.map((type, i) => ({ id: 'w' + (9001 + i), type })),
    hubWidgets: widgets.slice(0, 6).map((type, i) => ({ id: 'hw' + (9001 + i), type })),
    demoSeed: { by: DEMO_TAG, v: 1, role: 'pro', at: new Date(now).toISOString() },
  };
}

/** A lighter state: the purchase-test account and the demo friends. */
export function buildLightState(role, now = Date.now(), friendIndex = 0) {
  const r = rng(3300 + friendIndex * 17 + (role === 'free' ? 7 : 0));
  const p = personaFor(role, friendIndex);
  const picked = role === 'free' ? TRACKERS.slice(0, 3) : TRACKERS.slice(0, 4);
  const trackers = picked.map(({ p: _p, ...t }) => t);
  const habits = role === 'free'
    // Five active habits: the free cap (src/hooks/useTierLimits.js), so
    // adding a sixth opens the paywall — what the reviewer tests.
    ? [
      habit('hb1', 'Late-night snacks', '#1a7a4a', 9, 1, now),
      habit('hb2', 'Phone in bed', '#3b4fb8', 5, 2, now),
      habit('hb3', 'Skipping breakfast', '#7a3a1a', 14, 0, now),
      habit('hb4', 'Takeaway coffee', '#c8970a', 3, 4, now),
      habit('hb5', 'Online shopping after 10pm', '#7a1a4a', 18, 1, now),
    ]
    : [habit('hb1', 'Late-night snacks', '#1a7a4a', 6 + friendIndex * 5, 1, now)];
  return {
    profile: { name: p.name, tagline: p.tagline, photo: null },
    theme: 'cream-pro', colorScheme: 'green', tutorialCompleted: true,
    termsAcceptedAt: new Date(now - 42 * DAY).toISOString(),
    links: [], trackers, logs: trackerLogs(picked, 42, now, r), logsAuto: {},
    habits, coins: 0, coinHistory: [], visions: {}, visionsBackfilled: false,
    vitalsLog: vitals(42, now, r, p.startKg, 0.03),
    burnProfile: { heightCm: p.heightCm, age: p.age, sex: p.sex, weightKg: p.startKg },
    mobileWidgets: ['vitals', 'habits'].map((type, i) => ({ id: 'w' + (9101 + i), type })),
    demoSeed: { by: DEMO_TAG, v: 1, role, at: new Date(now).toISOString() },
  };
}

/** 14 days of meals for nutrition_log (the Pro account). */
const MEALS = {
  breakfast: [['Porridge with banana', 350, 11, 62, 7], ['Greek yoghurt, berries and granola', 320, 22, 38, 9], ['Scrambled eggs on toast', 410, 24, 30, 21]],
  lunch: [['Chicken salad wrap', 480, 34, 45, 17], ['Tuna jacket potato', 520, 33, 70, 9], ['Lentil soup and bread roll', 430, 21, 66, 8]],
  dinner: [['Salmon, rice and greens', 640, 42, 62, 22], ['Chicken stir-fry with noodles', 610, 45, 68, 15], ['Turkey chilli with rice', 590, 41, 64, 14], ['Veggie lasagne', 560, 24, 58, 23]],
  snack: [['Protein shake', 160, 30, 6, 3], ['Apple and peanut butter', 260, 7, 26, 15], ['Rice cakes with hummus', 180, 6, 24, 7]],
};

export function nutritionRows(userId, now = Date.now(), days = 14) {
  const r = rng(4400);
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = ymd(now - i * DAY);
    for (const meal of ['breakfast', 'lunch', 'dinner', 'snack']) {
      if (meal === 'snack' && r() < 0.35) continue;
      if (i === 0 && meal === 'dinner') continue;   // today's dinner not eaten yet
      const opts = MEALS[meal];
      const [food_name, calories, protein_g, carbs_g, fat_g] = opts[Math.floor(r() * opts.length)];
      rows.push({
        user_id: userId, log_date: day, meal_type: meal, food_name, brand: null, serving_g: 100,
        calories, protein_g, carbs_g, fat_g, fibre_g: 0, sugar_g: 0, sodium_mg: 0,
        additional_nutrients: {}, source: 'demo-seed',
      });
    }
  }
  return rows;
}

/** Friendly DM threads between demo accounts (plain text: the DM filter applies). */
export const THREADS = [
  ['Morning! Did you get your run in?', 'Just about, 5K before work. Legs are not happy.', 'Ha, same. Parkrun on Saturday?', 'Yes, 9am. I will bring the coffee.', 'Deal. Trying to beat 27 minutes.', 'You will smash it.'],
  ['How is the saving going?', 'Slowly! Up to about half of the trip pot.', 'Nice, that is more than me.', 'Cut the takeaways, it adds up fast.', 'Fair. Week three without one.', 'Keep going, nearly there.'],
  ['Book club this week?', 'Yes, Thursday works.', 'Great, I will message the others.', 'Thanks!'],
];

export function messagePlan(pairs, now = Date.now()) {
  const out = [];
  pairs.forEach(([a, b], k) => {
    const lines = THREADS[k % THREADS.length];
    lines.forEach((body, j) => {
      const fromA = j % 2 === 0;
      out.push({
        sender_id: fromA ? a : b, recipient_id: fromA ? b : a, body,
        created_at: new Date(now - (lines.length - j) * 3.5 * 3600_000 - k * DAY).toISOString(),
        read_at: new Date(now - k * DAY).toISOString(),
      });
    });
  });
  return out;
}

/** Invite code in the same alphabet as netlify/functions/groups.js. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function inviteCode(randomBytes) {
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += CODE_ALPHABET[randomBytes[i] % CODE_ALPHABET.length];
  }
  return out;
}
export const DEMO_GROUP = { name: 'Sunday Runners', crest_color: '#1a7a4a' };
