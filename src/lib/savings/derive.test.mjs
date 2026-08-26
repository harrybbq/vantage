/**
 * The savings arithmetic. Money is the one thing in this app where a
 * wrong number is worse than no number, so the awkward cases get
 * assertions: routed income counted twice, a row that has stopped
 * paying, a pot with no target date, a contribution older than a year.
 */
import assert from 'node:assert/strict';
import {
  toMonthly, clamp01, activeAt, signedMonthly, routedFor, routedToAccount,
  monthsBetween, derivePot, last12Months, cashSeries, savingsSeries,
  potTotals, flowTotals, blendedApy, money, moneyK, monthLabel, potColor,
  accountsForPot, flowSections, sectionColor,
} from './derive.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const near = (a, b, m, tol = 1e-6) => { assert.ok(Math.abs(a - b) < tol, `${m} (got ${a}, want ${b})`); n++; };

const NOW = new Date(2026, 7, 25);          // 25 Aug 2026

// ── Cadence ──
eq(toMonthly('120', 'month'), 120, 'monthly is itself');
eq(toMonthly('1200', 'year'), 100, 'yearly divides by twelve');
near(toMonthly('100', 'week'), 100 * 52 / 12, 'weekly is 52/12, not 4');
eq(toMonthly('', 'month'), 0, 'blank is zero, not NaN');
eq(toMonthly('nonsense', 'month'), 0, 'garbage is zero, not NaN');
eq(clamp01(-1), 0, 'clamp floors');
eq(clamp01(2), 1, 'clamp caps');

// ── from/until windows ──
const windowed = { from: '2026-10', until: '2027-02' };
ok(!activeAt(windowed, 0, NOW), 'a row that has not started yet is not live');
ok(activeAt(windowed, 2, NOW), 'live once it starts');
ok(activeAt(windowed, 6, NOW), 'live in its last month');
ok(!activeAt(windowed, 7, NOW), 'and dead after it ends');
ok(activeAt({}, 99, NOW), 'a row with no window is always live');

// ── Routed income must not be counted twice ──
const salary = { kind: 'income', amount: '3000', freq: 'month' };
const routedIn = { kind: 'income', amount: '500', freq: 'month', goalId: 'g1' };
const rent = { kind: 'expense', amount: '1200', freq: 'month' };
eq(signedMonthly(salary, 0, NOW), 3000, 'plain income adds to cash');
eq(signedMonthly(rent, 0, NOW), -1200, 'expense subtracts');
eq(signedMonthly(routedIn, 0, NOW), 0,
  'income routed into a pot never lands in cash — counting it in both places would inflate every projection');
eq(signedMonthly({ ...routedIn, goalId: null, accountId: 'a1' }, 0, NOW), 0, 'same for income routed to an account');
eq(signedMonthly({ ...rent, goalId: 'g1' }, 0, NOW), -1200, 'a routed EXPENSE still leaves the current account');

// ── Routing totals ──
const items = [
  { id: 'i1', kind: 'expense', amount: '600', freq: 'month', goalId: 'home' },
  { id: 'i2', kind: 'expense', amount: '1200', freq: 'year', goalId: 'home' },
  { id: 'i3', kind: 'expense', amount: '180', freq: 'month', goalId: 'japan' },
  { id: 'i4', kind: 'expense', amount: '99', freq: 'month', goalId: 'home', from: '2027-01' },
  { id: 'i5', kind: 'expense', amount: '400', freq: 'month', accountId: 'a1' },
];
eq(routedFor(items, 'home', [], 0, NOW), 700, 'two live rows into one pot add up (600 + 1200/12)');
eq(routedFor(items, 'home', [], 6, NOW), 799, 'and the future row joins when it starts');
eq(routedFor(items, 'nope', [], 0, NOW), 0, 'an unknown pot gets nothing');
eq(routedFor(items, null, [], 0, NOW), 0, 'so does no pot at all');
eq(routedToAccount(items, 'a1', 0, NOW), 400, 'account routing totals separately');

// ── monthsBetween ──
near(monthsBetween(new Date(2026, 0, 1), new Date(2027, 0, 1)), 12, 'a year is twelve months');
near(monthsBetween(new Date(2026, 0, 1), new Date(2026, 0, 31)), 1, 'and part-months are fractional');

// ── A pot ──
const home = {
  id: 'home', name: 'First Home', target: 40000, current: 20000,
  targetDate: '2027-08-25', createdAt: '2025-08-25T00:00:00.000Z',
};
const d = derivePot(home, items, [], NOW);
near(d.pct, 0.5, 'half saved');
eq(d.done, false, 'not funded');
eq(d.left, 20000, 'twenty thousand to go');
near(d.pace, 0.5, 'and exactly halfway through its run, so on pace');
eq(d.state, 'ontrack', 'which reads as on track');
near(d.needed, 20000 / d.monthsLeft, 'needed is what is left over the months left');
eq(d.routed, 700, 'routed comes from the flow rows');
eq(d.etaMonths, Math.ceil(20000 / 700), 'and the ETA from that rate');

const behind = derivePot({ ...home, current: 4000 }, items, [], NOW);
eq(behind.state, 'behind', 'well short of pace is behind');
const funded = derivePot({ ...home, current: 40000 }, items, [], NOW);
eq(funded.state, 'funded', 'at target it is funded');
eq(funded.etaMonths, null, 'a funded pot has no ETA');
eq(funded.left, 0, 'and nothing left');

// A pot with no target date has no pace to be behind of.
const open = derivePot({ id: 'x', target: 1000, current: 10, createdAt: '2026-01-01' }, [], [], NOW);
eq(open.pace, null, 'no target date, no pace');
eq(open.state, 'open', 'so it is open rather than behind — it was never promised a date');
eq(open.etaMonths, null, 'and with nothing routed, no ETA');

// Divide-by-zero guards.
const zero = derivePot({ id: 'z', target: 0, current: 0 }, [], [], NOW);
eq(zero.pct, 0, 'a pot with no target is 0%, not NaN');
ok(Number.isFinite(zero.left), 'and its remainder is a number');

// ── Contribution buckets ──
const withContribs = {
  id: 'c', target: 100, current: 100,
  contributions: [
    { amount: 100, ts: new Date(2026, 7, 3).toISOString() },   // this month
    { amount: 50, ts: new Date(2026, 6, 3).toISOString() },    // last month
    { amount: 25, ts: new Date(2026, 7, 20).toISOString() },   // also this month
    { amount: 999, ts: new Date(2024, 1, 1).toISOString() },   // long past
    { amount: -30, ts: new Date(2026, 7, 22).toISOString() },  // a withdrawal
  ],
};
const buckets = last12Months(withContribs, NOW);
eq(buckets.length, 12, 'twelve buckets');
eq(buckets[11], 95, 'this month nets the two adds and the withdrawal');
eq(buckets[10], 50, 'last month is its own bucket');
eq(buckets.reduce((s, v) => s + v, 0), 145, 'and anything older than a year is left out');

// ── Series ──
const flow = [
  { id: 'a', kind: 'income', amount: '3000', freq: 'month' },
  { id: 'b', kind: 'expense', amount: '2000', freq: 'month' },
];
const cash = cashSeries('500', flow, 6, NOW);
eq(cash.length, 7, 'a series covers month 0 through the horizon');
eq(cash[0], 500, 'and starts at the opening balance');
eq(cash[6], 500 + 6000, 'accumulating the net each month');

// Month 0 is the opening balance — today's money, already counted — so
// accumulation starts at month 1. A row ending Oct 2026 therefore pays
// in Sep and Oct and then stops.
const stopping = cashSeries('0', [{ id: 's', kind: 'income', amount: '100', freq: 'month', until: '2026-10' }], 6, NOW);
eq(stopping[2], 200, 'it pays while it is live');
eq(stopping[6], 200, 'and a row that has stopped paying stops adding');

const accounts = [{ id: 'a1', name: 'Saver', balance: '1000', apy: '12' }];
const sav = savingsSeries(accounts, [{ id: 'r', kind: 'expense', amount: '100', freq: 'month', accountId: 'a1' }], 12, NOW);
eq(sav[0], 1000, 'savings start at the balance');
ok(sav[12] > 1000 + 1200, 'and end above balance plus deposits, because they compound');
eq(savingsSeries([], [], 12, NOW)[12], 0, 'no accounts is zero, not NaN');

// ── Totals ──
const goals = [
  home,
  { id: 'japan', target: 4800, current: 4800, targetDate: '2027-03-14', createdAt: '2025-10-01' },
  { id: 'kitchen', target: 12000, current: 100, targetDate: '2027-01-01', createdAt: '2026-01-01' },
];
const t = potTotals(goals, items, [], NOW);
eq(t.saved, 24900, 'saved is the sum of currents');
eq(t.target, 56800, 'target the sum of targets');
eq(t.count, 3, 'three pots');
eq(t.doneCount, 1, 'one of them funded');
eq(t.routed, 700 + 180, 'routed totals across pots');
eq(t.behind, 1, 'the kitchen is behind');
ok(t.next && t.next.goal.id === 'home', 'and the next to land is the one with the shortest ETA');
eq(potTotals([], [], [], NOW).pct, 0, 'no pots is 0%, not NaN');

const f = flowTotals([...flow, { id: 'r2', kind: 'expense', amount: '600', freq: 'month', goalId: 'home' }], [], [], NOW);
eq(f.income, 3000, 'income totals');
eq(f.spend, 2600, 'spend totals including routed');
eq(f.net, 400, 'net is the difference');
eq(f.routed, 600, 'routed is what feeds pots');
near(f.rate, 0.2, 'and the saved rate is routed over income');
eq(flowTotals([], [], [], NOW).rate, 0, 'no income means a 0 rate, not a divide by zero');

near(blendedApy([{ balance: '1000', apy: '2' }, { balance: '3000', apy: '6' }]), 5, 'blended APY is balance-weighted');
eq(blendedApy([]), 0, 'no accounts blends to zero');


// ── An account can belong to a pot ───────────────────────────────────
// Spreading one pot across two accounts, and still knowing its rate.
const potAccounts = [
  { id: 'isa', name: 'ISA', balance: '5000', apy: '5', goalId: 'home' },
  { id: 'saver', name: 'Instant saver', balance: '2000', apy: '4', goalId: 'home' },
  { id: 'other', name: 'Not for a pot', balance: '900', apy: '3' },
];
eq(accountsForPot(potAccounts, 'home').map(a => a.id), ['isa', 'saver'], 'both of the pot\'s accounts');
eq(accountsForPot(potAccounts, 'japan'), [], 'and none for a pot that has none');
eq(accountsForPot(potAccounts, null), [], 'a missing pot id asks for nothing');

const viaAccounts = [
  { id: 'x1', kind: 'expense', amount: '300', freq: 'month', accountId: 'isa' },
  { id: 'x2', kind: 'expense', amount: '200', freq: 'month', accountId: 'saver' },
  { id: 'x3', kind: 'expense', amount: '150', freq: 'month', accountId: 'other' },
];
eq(routedFor(viaAccounts, 'home', potAccounts, 0, NOW), 500,
  'money into either of the pot\'s accounts counts toward the pot');
eq(routedFor(viaAccounts, 'home', [], 0, NOW), 0,
  'and without the link it counts toward nothing');

// The trap: a row naming BOTH the pot and one of its accounts.
const both = [{ id: 'b1', kind: 'expense', amount: '400', freq: 'month', goalId: 'home', accountId: 'isa' }];
eq(routedFor(both, 'home', potAccounts, 0, NOW), 400,
  'a row naming the pot AND its account is counted once, not twice — double counting would halve the ETA');

const linkedPot = derivePot({ id: 'home', target: 10000, current: 0 }, viaAccounts, potAccounts, NOW);
eq(linkedPot.routed, 500, 'the pot picks the rate up through its accounts');
eq(linkedPot.etaMonths, 20, 'and dates itself from it');
eq(linkedPot.accounts.map(a => a.id), ['isa', 'saver'], 'and knows which accounts they are');

const linkedFlow = flowTotals(
  [{ id: 'i', kind: 'income', amount: '2000', freq: 'month' }, ...viaAccounts],
  [], potAccounts, NOW,
);
eq(linkedFlow.routed, 500, '"into pots" counts account-routed money too');

// ── Flow sections ────────────────────────────────────────────────────
const secItems = [
  { id: 's1', kind: 'income', amount: '2000', freq: 'month' },
  { id: 's2', kind: 'expense', amount: '500', freq: 'month' },                       // loose
  { id: 's3', kind: 'expense', amount: '12', freq: 'month', groupId: 'subs' },
  { id: 's4', kind: 'expense', amount: '8', freq: 'month', groupId: 'subs' },
  { id: 's5', kind: 'expense', amount: '120', freq: 'year', groupId: 'subs' },       // £10/mo
  { id: 's6', kind: 'expense', amount: '99', freq: 'month', groupId: 'empty-later' },
  { id: 's7', kind: 'expense', amount: '50', freq: 'month', from: '2027-01' },       // not live
];
const secGroups = [
  { id: 'subs', name: 'Subscriptions', color: '#5b8cff' },
  { id: 'empty', name: 'Nothing in here' },
  { id: 'empty-later', name: 'Holds one' },
];
const secs = flowSections(secItems, secGroups, NOW);
eq(secs.length, 3, 'one loose row, two folders that hold something — the empty folder is not a band');
eq(secs[0].label, 'Untitled', 'the loose row comes first, in row order');
eq(secs[0].kind, 'row', 'and is a row band');
const subs = secs.find(x => x.id === 'subs');
eq(subs.label, 'Subscriptions', 'the folder is labelled with its own name');
eq(subs.amount, 30, 'and totals everything inside it, whatever cadence each was entered at');
eq(subs.count, 3, 'reporting how many rows it stands for');
eq(subs.colour, '#5b8cff', 'keeping the colour the user chose');
near(subs.share, 30 / 2000, 'its share is of income, not of spending');
ok(!secs.some(x => x.id === 'empty'), 'an empty folder draws no band');
ok(!secs.some(x => x.id === 's7'), 'and a row that has not started yet is not in the bar');
eq(flowSections([], [], NOW), [], 'nothing in, nothing out');
eq(flowSections(secItems, [], NOW).length, 1,
  'with no folders at all, only the live loose row is a band');

eq(sectionColor({ colour: '#123456' }, 3), '#123456', 'a chosen colour wins');
eq(sectionColor({}, 0), sectionColor({}, 8), 'and the fallback palette wraps stably');
ok(sectionColor({}, 0) !== sectionColor({}, 1), 'adjacent sections do not get the same colour');

// ── Formatting ──
eq(money(1234.56), '£1,235', 'money rounds and groups');
eq(money(-50), '−£50', 'negatives use a real minus sign');
eq(money(12.5, { pence: true }), '£12.50', 'pence where they matter');
eq(moneyK(26400), '£26k', 'big numbers shorten');
eq(moneyK(1250), '£1.3k', 'and mid ones keep a decimal');
eq(moneyK(400), '£400', 'small ones are left alone');
eq(monthLabel(0, NOW), 'now', 'month zero is now');
eq(monthLabel(5, NOW), 'Jan ’27', 'January carries the year');
eq(monthLabel(2, NOW), 'Oct', 'other months do not');
eq(potColor({ color: '#abc123' }, 0), '#abc123', 'a pot keeps its own colour');
eq(potColor({}, 0), potColor({}, 8), 'and the palette wraps stably');

console.log(`savings derive: ${n} assertions passed`);
