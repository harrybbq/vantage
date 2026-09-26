/**
 * Career plan maths. Every figure here is invented: this file is in a
 * public repo, and the real plan lives only in Supabase.
 */
import assert from 'node:assert/strict';
import {
  addMonths, monthDiff, monthsFrom, monthLabel, isMonth, lbtt, cashNeeded, project,
  firstMonthAtLeast, readiness, budgetSummary,
} from './money.js';
import { columns, span, statusOf, examCollisions, monthsOfItem, shifted, bonusShift } from './planTimeline.js';
import { validate, KEYS } from './schema.js';
import { parseMoney, salaryGuard, salaryVerdict, orderCompanies, salaryLabel } from './companies.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };

/* months */
t('addMonths crosses years both ways', () => {
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2027-01', -1), '2026-12');
});
t('monthDiff and monthsFrom', () => {
  assert.equal(monthDiff('2026-10', '2027-03'), 5);
  assert.deepEqual(monthsFrom('2026-11', '2027-01'), ['2026-11', '2026-12', '2027-01']);
});
t('monthLabel and isMonth', () => {
  assert.equal(monthLabel('2027-03'), 'Mar 27');
  assert.equal(isMonth('2027-13'), false);
  assert.equal(isMonth('2027-1'), false);
});

/* LBTT */
t('LBTT first-time buyer: nil to 175k', () => {
  assert.equal(lbtt(170000), 0);
  assert.equal(lbtt(175000), 0);
});
t('LBTT first-time buyer: 2% from 175k to 250k', () => {
  assert.equal(lbtt(200000), 500);
  assert.equal(lbtt(250000), 1500);
});
t('LBTT first-time buyer: 5% band above 250k', () => {
  assert.equal(lbtt(300000), 1500 + 2500);
});
t('LBTT without relief uses the 145k nil band', () => {
  assert.equal(lbtt(200000, { firstTimeBuyer: false }), 1100);
});
t('LBTT of nothing is nothing', () => {
  assert.equal(lbtt(0), 0);
  assert.equal(lbtt(undefined), 0);
});

/* cash needed */
const M = { legal: 1000, buffer: 2000, ltvDefault: 0.9 };
t('cash needed when valuation equals price', () => {
  const c = cashNeeded({ price: 200000, valuation: 200000 }, M);
  assert.equal(c.deposit, 20000);
  assert.equal(c.lbtt, 500);
  assert.equal(c.total, 20000 + 500 + 1000 + 2000);
});
t('an overbid above valuation comes out of cash', () => {
  const c = cashNeeded({ price: 200000, valuation: 190000 }, M);
  assert.equal(c.deposit, 200000 - 171000);
});
t('a higher LTV lowers the deposit', () => {
  const c = cashNeeded({ price: 200000, valuation: 190000, ltv: 0.95 }, M);
  assert.equal(c.deposit, 200000 - 180500);
});
t('valuation above price lends only against price', () => {
  const c = cashNeeded({ price: 200000, valuation: 210000 }, M);
  assert.equal(c.deposit, 20000);
});

/* projection */
const money = {
  start: { month: '2026-09', balance: 10000 },
  transfers: [{ from: '2026-10', to: '2026-11', monthly: 500 }, { from: '2026-12', monthly: 1000 }],
  oneOffs: [{ month: '2026-10', amount: 700, label: 'one-off' }, { month: '2027-03', amount: 900, bonus: true }],
  legal: 1000, buffer: 2000, keysLagMonths: 2, contractEnd: '2027-06',
};
t('projection adds transfers and one-offs per month', () => {
  const s = project(money, { to: '2027-01' });
  assert.deepEqual(s.map(p => p.balance), [10000, 11200, 11700, 12700, 13700]);
});
t('projection without the bonus leaves bonus one-offs out', () => {
  const a = project(money, { to: '2027-03', bonus: true }).at(-1).balance;
  const b = project(money, { to: '2027-03', bonus: false }).at(-1).balance;
  assert.equal(a - b, 900);
});
t('projection needs a start', () => {
  assert.deepEqual(project({}), []);
});
t('firstMonthAtLeast finds the crossing or null', () => {
  const s = project(money, { to: '2027-06' });
  assert.equal(firstMonthAtLeast(s, 12700), '2026-12');
  assert.equal(firstMonthAtLeast(s, 1e9), null);
});
t('readiness: bonus brings the month forward and keys follow by the lag', () => {
  // need: 10% of 160k = 16000 + 0 LBTT + 3000 = 19000
  const r = readiness(money, { price: 160000, valuation: 160000 }, { to: '2027-12' });
  assert.equal(r.need.total, 19000);
  assert.equal(r.ready, '2027-07');       // 13700 in Jan + 1000/mo → 18700 Jun, 19700 Jul
  assert.equal(r.readyBonus, '2027-06');  // +900 from Mar → 19600 in Jun
  assert.equal(r.keys, '2027-09');
  assert.equal(r.afterContract, true);
});
t('readiness never reached stays null', () => {
  const r = readiness({ ...money, transfers: [] }, { price: 900000 }, { to: '2027-12' });
  assert.equal(r.ready, null);
  assert.equal(r.keys, null);
});
t('budget: lines summed as a range; bonus adds a third of the net bonus', () => {
  const b = budgetSummary({ budget: { left: 500, bonusNet: 900, lines: [{ low: 100, high: 150 }, { high: 50 }] } });
  assert.equal(b.low, 150);
  assert.equal(b.high, 200);
  assert.equal(b.leftWithBonus, 800);
});

/* timeline */
const range = { from: '2026-10', to: '2027-03' };
const cols = columns(range);
t('columns end with "after"', () => {
  assert.equal(cols.length, 7);
  assert.equal(cols.at(-1), 'after');
});
t('span places a month, a range, and clamps early starts to the first column', () => {
  assert.deepEqual(span({ start: '2026-11' }, cols), [1, 1]);
  assert.deepEqual(span({ start: '2026-11', end: '2027-01' }, cols), [1, 3]);
  assert.deepEqual(span({ start: '2026-08' }, cols), [0, 0]);
});
t('span puts anything past the range in "after"', () => {
  assert.deepEqual(span({ start: '2028-06' }, cols), [6, 6]);
  assert.deepEqual(span({ start: '2027-02', end: '2028-01' }, cols), [4, 6]);
});
t('post-completion follows the keys month given', () => {
  assert.deepEqual(span({ start: 'post-completion' }, cols, '2027-02'), [4, 4]);
  assert.equal(span({ start: 'post-completion' }, cols, null), null);
});
t('statusOf prefers the saved status, then the seed, then planned', () => {
  assert.equal(statusOf({ id: 'a', status: 'done' }, { a: { status: 'at_risk' } }), 'at_risk');
  assert.equal(statusOf({ id: 'a', status: 'done' }, {}), 'done');
  assert.equal(statusOf({ id: 'a', status: 'bogus' }, { a: { status: 'nope' } }), 'planned');
});
t('monthsOfItem spans a range', () => {
  assert.deepEqual(monthsOfItem({ start: '2027-04', end: '2027-06' }), ['2027-04', '2027-05', '2027-06']);
});
const items = [
  { id: 'h1', stream: 'HOUSE', start: '2027-01', title: 'AIP' },
  { id: 'h2', stream: 'HOUSE', start: '2027-04', end: '2027-06', title: 'Offers' },
  { id: 'h3', stream: 'HOUSE', start: 'post-completion', title: 'Paint' },
  { id: 'j1', stream: 'JOB', start: '2027-05', title: 'Job' },
];
t('any exam in a house month warns, ranges included', () => {
  const c = examCollisions([
    { id: 'a', name: 'A', target: '2026-12' },
    { id: 'b', name: 'B', target: '2027-01' },
    { id: 'c', name: 'C', target: '2027-03', targetEnd: '2027-04' },
    { id: 'd', name: 'D', target: '2027-05', completed: true },
  ], items);
  assert.deepEqual(c.map(x => `${x.certId}@${x.month}`), ['b@2027-01', 'c@2027-04']);
});
t('non-house streams and post-completion do not count as house months', () => {
  assert.deepEqual(examCollisions([{ id: 'x', name: 'X', target: '2027-05' }], [items[2], items[3]]), []);
});
t('shifted moves only cash-dependent items', () => {
  const s = shifted([{ id: 'a', start: '2027-02', cashDependent: true }, { id: 'b', start: '2027-02' }], 1);
  assert.deepEqual(s.map(x => [x.id, x.start, x.from]), [['a', '2027-03', '2027-02']]);
  assert.deepEqual(shifted(items, 0), []);
});

t('bonusShift uses each item\'s own scenario, and skips ones the bonus cannot move', () => {
  const m2 = { ...money, scenarios: [{ id: 'early', price: 100000 }, { id: 'late', price: 160000 }] };
  const out = bonusShift([
    { id: 'a', start: '2026-12', cashDependent: true, scenario: 'early', title: 'A' },   // before any bonus: no move
    { id: 'b', start: '2027-06', cashDependent: true, scenario: 'late', title: 'B' },    // Jun (bonus) vs Jul
    { id: 'c', start: '2027-04', end: '2027-05', cashDependent: true, title: 'C' },      // no scenario: fallback
    { id: 'd', start: '2027-04', title: 'D' },
  ], m2, 1);
  assert.deepEqual(out.map(x => [x.id, x.to, x.delta]), [['b', '2027-07', 1], ['c', '2027-05', 1]]);
  assert.equal(out[1].end, '2027-06');
});

/* schema */
t('a valid plan passes', () => {
  assert.deepEqual(validate(KEYS.plan, {
    range, streams: [{ id: 'HOUSE', color: '#aabbcc' }],
    items: [{ id: 'x', stream: 'HOUSE', start: '2027-01', title: 'T' }],
  }), []);
});
t('plan errors name the path', () => {
  const e = validate(KEYS.plan, {
    range, streams: [{ id: 'HOUSE' }],
    items: [{ id: 'x', stream: 'CAR', start: 'soon', title: '' }, { id: 'x', stream: 'HOUSE', start: '2027-01', title: 'T' }],
  });
  assert.ok(e.some(s => s.startsWith('items[0].stream')));
  assert.ok(e.some(s => s.startsWith('items[0].start')));
  assert.ok(e.some(s => s.startsWith('items[0].title')));
  assert.ok(e.some(s => s.includes('used twice')));
});
t('money needs a start and positive prices', () => {
  const e = validate(KEYS.money, { transfers: [], scenarios: [{ id: 's', price: -1 }] });
  assert.ok(e.some(s => s.startsWith('start')));
  assert.ok(e.some(s => s.startsWith('scenarios[0].price')));
});
t('certs and companies check links and dates', () => {
  assert.ok(validate(KEYS.certs, [{ id: 'a', name: 'A', priceUrl: 'not a link' }]).length === 1);
  assert.ok(validate(KEYS.companies, [{ id: 'a', name: 'A', verifiedOn: '26/09/2026' }]).length === 1);
  assert.deepEqual(validate(KEYS.companies, [{ id: 'a', name: 'A', careersUrl: 'https://x.test/jobs', verifiedOn: '2026-09-26' }]), []);
});
t('status map values are checked', () => {
  assert.deepEqual(validate(KEYS.status, { a: { status: 'done' } }), []);
  assert.equal(validate(KEYS.status, { a: { status: 'finished' } }).length, 1);
  assert.equal(validate('nope', {}).length, 1);
});

/* companies */
t('parseMoney reads k, commas and pounds', () => {
  assert.equal(parseMoney('£42k'), 42000);
  assert.equal(parseMoney('≥ £48.5k (matches current)'), 48500);
  assert.equal(parseMoney('£45,000'), 45000);
  assert.equal(parseMoney('within 30 min'), null);
});
t('salaryGuard prefers numbers, falls back to guardrail rows', () => {
  const plan = { guardrails: [{ label: 'Salary floor', value: '£30k' }, { label: 'Target', value: '≥ £35k' }] };
  assert.deepEqual(salaryGuard(plan), { floor: 30000, target: 35000 });
  assert.deepEqual(salaryGuard({ ...plan, salaryGuard: { floor: 31000, target: 36000 } }), { floor: 31000, target: 36000 });
  assert.deepEqual(salaryGuard({}), { floor: null, target: null });
});
t('salaryVerdict against a 30k floor and 35k target', () => {
  const g = { floor: 30000, target: 35000 };
  assert.equal(salaryVerdict({ low: 36000, high: 40000 }, g), 'meets');
  assert.equal(salaryVerdict({ low: 32000, high: 37000 }, g), 'spans');
  assert.equal(salaryVerdict({ low: 30000, high: 34000 }, g), 'floor');
  assert.equal(salaryVerdict({ low: 25000, high: 29000 }, g), 'below');
  assert.equal(salaryVerdict(null, g), 'unknown');
});
t('orderCompanies: easiest, highest salary, commute; unknowns last', () => {
  const L = [
    { id: 'a', difficulty: { score: 4 }, salary: { low: 30000, high: 40000 }, commute: { x: '20–25' } },
    { id: 'b', difficulty: { score: 2 }, salary: { low: 40000, high: 50000 }, commute: { x: '10–15' } },
    { id: 'c', commute: { x: '—' } },
  ];
  const low = v => { const m = /^(\d+)/.exec(String(v || '')); return m ? Number(m[1]) : null; };
  assert.deepEqual(orderCompanies(L, 'easiest').map(c => c.id), ['b', 'a', 'c']);
  assert.deepEqual(orderCompanies(L, 'salary').map(c => c.id), ['b', 'a', 'c']);
  assert.deepEqual(orderCompanies(L, 'x', low).map(c => c.id), ['b', 'a', 'c']);
  assert.deepEqual(orderCompanies(L, 'listed').map(c => c.id), ['a', 'b', 'c']);
});
t('salaryLabel', () => {
  assert.equal(salaryLabel({ low: 40000, high: 52500 }), '£40k–52.5k');
  assert.equal(salaryLabel({ low: 45000, high: 45000 }), '£45k');
  assert.equal(salaryLabel({}), '—');
});

console.log(`career plan: ${n} passed`);
