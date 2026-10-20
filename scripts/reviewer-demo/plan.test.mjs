/**
 * Item 122: the reviewer demo seeder's pure half — refusals, the
 * user_data rule, and that the invented data has the shapes the app's
 * own code reads (checked by running the app's pure libs over it).
 * Hermetic: no network; SUPABASE_*, REVENUECAT_*, APPLE_*, OWNER_* and
 * DEMO_* are cleared.
 */
import assert from 'node:assert/strict';

for (const k of Object.keys(process.env)) {
  if (/^(SUPABASE_|VITE_SUPABASE_|REVENUECAT_|APPLE_|REVIEW_|OWNER_|VITE_OWNER_|DEMO_)/.test(k)) delete process.env[k];
}

const P = await import('./plan.mjs');
const { DEFAULT_STATE } = await import('../../src/data/initialState.js');
const { hasMeaningfulData } = await import('../../src/lib/state/meaningful.js');
const { subsStats } = await import('../../src/lib/money/recurring.js');
const { derivePot } = await import('../../src/lib/savings/derive.js');
const { periods, isCut } = await import('../../src/lib/habits/cutdown.js');
const { countdown, STATUS_ORDER } = await import('../../src/lib/holiday/timeline.js');
const { checkMessageText } = await import('../../src/lib/moderation/messageFilter.js');
const { checkPublicText } = await import('../../src/lib/moderation/nameFilter.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// ── Arguments and the allow-list ──
const A = ['--allow', 'pro@co.example,free@co.example,f1@co.example'];
const parse = (args, env = {}) => P.parseArgs(args, env);
ok(/--allow/.test(parse(['--pro', 'pro@co.example']).error), 'no --allow → refused');
ok(/not in --allow/.test(parse([...A, '--pro', 'someone@else.example']).error), 'account outside the allow-list → refused');
ok(/not in --allow/.test(parse([...A, '--pro', 'PRO@co.example ', '--friend', 'f2@co.example']).error), 'every account checked, case-insensitively');
ok(/nothing to do/.test(parse(A).error), 'no accounts named');
ok(/named twice/.test(parse([...A, '--pro', 'pro@co.example', '--friend', 'pro@co.example']).error), 'same address twice');
ok(/one --pro/.test(parse([...A, '--pro', 'pro@co.example', '--pro', 'free@co.example']).error), 'one pro');
ok(/owner address/.test(parse([...A, '--pro', 'pro@co.example'], { OWNER_EMAIL: 'x@y.example, pro@co.example' }).error), 'owner address refused');
ok(/DEMO_ACCOUNT_PASSWORD/.test(parse([...A, '--pro', 'pro@co.example', '--create', '--write']).error), '--create --write needs a password');
eq(parse([...A, '--pro', 'pro@co.example', '--create']).ok, true, 'dry-run --create needs no password');
ok(/unknown argument/.test(parse([...A, '--pro', 'pro@co.example', '--force']).error), 'unknown flag refused');
ok(/needs a value/.test(parse(['--allow']).error), 'flag without value');
{
  const r = parse([...A, '--pro', 'Pro@Co.Example', '--free', 'free@co.example', '--friend', 'f1@co.example', '--write']);
  eq(r.ok, true, 'valid run');
  eq(r.opts.accounts, [{ role: 'pro', email: 'pro@co.example' }, { role: 'free', email: 'free@co.example' }, { role: 'friend', email: 'f1@co.example' }], 'normalised');
  eq([r.opts.write, r.opts.create], [true, false], 'flags');
}

// ── The user_data rule ──
eq(P.stateWriteDecision(null).write, 'insert', 'no row → insert');
eq(P.stateWriteDecision({ state: null }).write, 'replace', 'null state → replace');
eq(P.stateWriteDecision({ state: {} }).write, 'replace', 'empty state → replace');
eq(P.stateWriteDecision({ state: { ...DEFAULT_STATE } }).write, 'replace', 'first-sign-in defaults → replace');
eq(P.stateWriteDecision({ state: { profile: { name: 'x' }, demoSeed: { by: 'reviewer-demo' }, logs: { '2026-10-01': { t1: true } } } }).write, 'replace', 'our own row → replace');
{
  const real = P.stateWriteDecision({ state: { ...DEFAULT_STATE, logs: { '2026-10-01': { t1: true } } } });
  eq(real.write, false, 'real logs → refused');
  ok(/logs/.test(real.reason), 'refusal names the evidence');
}
eq(P.stateWriteDecision({ state: { ...DEFAULT_STATE, profile: { name: 'Real Person' } } }).write, false, 'a typed name → refused');
eq(P.stateWriteDecision({ state: { profile: {}, demoSeed: { by: 'someone-else' }, logs: { d: { t: 1 } } } }).write, false, 'a foreign tag does not count');
eq(P.stateWriteDecision({ state: [1, 2] }).write, false, 'array state refused');

// ── The Pro state ──
const NOW = new Date(2026, 9, 20, 15, 0, 0).getTime();
const S = P.buildProState(NOW);
const S2 = P.buildProState(NOW);
eq(S, S2, 'deterministic');
ok('profile' in S && S.profile.name, 'carries profile (the loader treats a state without it as empty)');
ok(hasMeaningfulData(S), 'the app reads it as real data');
eq(P.stateWriteDecision({ state: S }).write, 'replace', 're-run on our own row is allowed');
const logDays = Object.keys(S.logs).sort();
ok(logDays.length >= 50, '8 weeks of tracker logs');
ok((Date.parse(logDays.at(-1)) - Date.parse(logDays[0])) / 86_400_000 >= 42, 'spans 6+ weeks');
eq(S.trackers.length, 5, 'five trackers');
for (const t of S.trackers) ok(/^t\d+$/.test(t.id) && ['boolean', 'number'].includes(t.type) && !('p' in t), `tracker ${t.id} shape`);
for (const [day, row] of Object.entries(S.logs)) {
  ok(/^\d{4}-\d{2}-\d{2}$/.test(day), `log key ${day}`);
  for (const [id, v] of Object.entries(row)) ok(S.trackers.some(t => t.id === id) && (v === true || typeof v === 'number'), `log ${day}/${id}`);
}
const vitalKeys = new Set(Object.values(S.vitalsLog).flatMap(Object.keys));
eq([...vitalKeys].sort(), ['rhr', 'sleep', 'weight'], 'hand-entered vitals only — no band keys');
ok(Object.keys(S.vitalsLog).length >= 40, '6+ weeks of vitals');
{
  const { countWeekLogs } = await import('../../src/utils/helpers.js');
  const flags = Object.keys(S).filter(k => k.startsWith('awarded_'));
  ok(flags.length > 10, `weekly award flags seeded (${flags.length})`);
  for (const k of flags) {
    const [, tid, week] = /^awarded_(t\d+)_(\d{4}-W\d{2})$/.exec(k) || [];
    ok(tid && week, `flag key ${k}`);
    const t = S.trackers.find(x => x.id === tid);
    const day = Object.keys(S.logs).find(d => P.weekOf(d) === week);
    ok(t && countWeekLogs(S.logs, tid, day, t) >= t.weeklyTarget, `${k}: that week really met its target`);
  }
  ok(!flags.some(k => k.startsWith('awarded_t4_')), 'no flag for a tracker without a weekly target');
}
eq(S.habits.length, 4, 'four habits');
ok(S.habits.filter(isCut).length === 1 && periods(S.habits.find(isCut), NOW).length > 0, 'cut-down habit reads through lib/habits/cutdown');
for (const h of S.habits) ok(Number.isFinite(h.startTime) && h.startTime < NOW && Array.isArray(h.milestones), `habit ${h.id}`);
eq(S.achievements.length, 8, 'eight achievements');
eq(S.achievements.filter(a => a.completed).length, 3, 'three completed');
eq(S.shopItems.length, 10, 'ten wish-list items');
eq(S.shopItems.filter(i => i.bought).length, 2, 'two bought');
ok(S.shopItems.every(i => Number.isInteger(i.coinCost) && typeof i.price === 'string'), 'shop item shape (AddShopModal)');
{
  const st = subsStats(S, new Date(NOW));
  ok(st.monthly > 50 && st.monthly < 80, `subscriptions total through lib/money/recurring (${st.monthly.toFixed(2)}/mo)`);
  ok(S.subscriptions.every(s => ['week', 'month', 'year'].includes(s.freq)), 'freq values the roller knows');
}
{
  const pot = derivePot(S.savings[0], S.projection.items, S.savingsAccounts, new Date(NOW));
  ok(pot && Number.isFinite(pot.current ?? pot.saved ?? 0), 'savings pot derives through lib/savings/derive');
  for (const g of S.savings) eq(g.contributions.reduce((s, c) => s + c.amount, 0), g.current, `pot ${g.id}: contributions add up to current`);
  ok(S.savingsAccounts.every(a => 'apy' in a && 'balanceAt' in a), 'account shape (apy, balanceAt)');
}
{
  ok(S.holidays.every(h => STATUS_ORDER.includes(h.status) && h.dest && h.from && h.to), 'trip shape (emptyHolidayForm)');
  const up = S.holidays.find(h => h.status === 'booked');
  ok(countdown(up, new Date(NOW)), 'upcoming trip has a countdown');
  eq(S.holidays.filter(h => h.status === 'completed').length, 2, 'two past trips');
}
ok(S.bodyGoal.targetKg < S.bodyGoal.startKg && S.bodyGoal.type === 'cut', 'body goal');
ok(!('consent' in S), 'AI consent left unasked (store pack §1.2)');
ok(!('ratings' in S) && S.visionsBackfilled === false, 'ratings and visions left for the app to derive');
eq(S.demoSeed.by, 'reviewer-demo', 'tagged');
ok(['dark-os', 'cream-pro'].includes(S.theme), 'a current theme id');
ok(JSON.stringify(S).length < 200_000, `modest size (${JSON.stringify(S).length} bytes)`);
ok(!/whoop|oura|apple health/i.test(JSON.stringify(S)), 'no wearable or Apple Health mentions');

// ── Light states ──
const B = P.buildLightState('free', NOW);
eq(B.habits.length, 5, 'free account: five habits = the free cap, so a sixth opens the paywall');
ok(B.trackers.length <= 5, 'free account within the tracker cap');
ok(hasMeaningfulData(B) && B.demoSeed.role === 'free', 'free account tagged');
const F0 = P.buildLightState('friend', NOW, 0);
const F1 = P.buildLightState('friend', NOW, 1);
ok(F0.profile.name !== F1.profile.name, 'friends are different people');
ok(Object.keys(F0.logs).length >= 30, 'friends have weeks of logs');

// ── Personas pass the public-text filter and the handle format ──
for (const p of [P.PERSONAS.pro, P.PERSONAS.free, ...P.PERSONAS.friend]) {
  ok(/^[a-zA-Z0-9_]{3,20}$/.test(p.handle), `handle ${p.handle}`);
  ok(checkPublicText(p.handle).ok && checkPublicText(p.name).ok, `${p.name} passes the filter`);
  ok(p.name.length <= 40, 'display_name ≤ 40');
}
ok(P.DEMO_GROUP.name.length >= 2 && P.DEMO_GROUP.name.length <= 32 && checkPublicText(P.DEMO_GROUP.name).ok, 'group name');

// ── Food log rows ──
{
  const rows = P.nutritionRows('00000000-0000-4000-8000-000000000001', NOW);
  const days = new Set(rows.map(r => r.log_date));
  eq(days.size, 14, '14 days of meals');
  ok(rows.every(r => ['breakfast', 'lunch', 'dinner', 'snack'].includes(r.meal_type) && r.calories > 0 && r.source === 'demo-seed'), 'row shape');
  ok(!rows.some(r => r.log_date === P.ymd(NOW) && r.meal_type === 'dinner'), "today's dinner not logged yet");
}

// ── Messages ──
{
  const m = P.messagePlan([['a', 'b'], ['a', 'c']], NOW);
  ok(m.length >= 10, 'two threads');
  ok(m.every(x => checkMessageText(x.body).ok && x.body.length <= 2000), 'every line passes the DM filter');
  ok(m.every(x => Date.parse(x.created_at) < NOW - 60_000), 'all in the past (the 30-a-minute throttle counts the last minute)');
  ok(m.some(x => x.sender_id === 'a') && m.some(x => x.sender_id === 'b'), 'both sides speak');
}

// ── Invite code ──
{
  const code = P.inviteCode(Buffer.from([0, 1, 2, 3, 4, 5, 6, 255]));
  ok(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code), `invite code format ${code}`);
}

console.log(`reviewer-demo plan: ${n} checks passed`);
