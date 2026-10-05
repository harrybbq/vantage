/**
 * Upgrade → Books view arithmetic: periods, the chart's month axis, the
 * monthly running cost, category rows, FX application and payload reading.
 * Invented data only — this file is public. Run: npm run check:homelines
 */
import assert from 'node:assert/strict';
import {
  addMonths, monthEnd, monthLabel, dateLabel, periodRange, monthsBetween, fetchWindow, chartMonths,
  runningCost, runningRef, categoryLabel, categoriesFor, categoryRows, signedPence, ratesFrom, chunks,
  currenciesNeedingRate, fmtMajor, readOverview, readBills, readPage, readPreview, mergePreviews, PERIODS,
} from './booksView.js';
import { CATEGORIES } from '../books/categories.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const TODAY = '2026-10-05';

t('month arithmetic across years and leap Februaries', () => {
  assert.equal(addMonths('2026-10', 3), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-03', -14), '2025-01');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(monthEnd('2026-12'), '2026-12-31');
  assert.equal(monthLabel('2026-10'), 'Oct 26');
  assert.equal(monthLabel('2026-10', true), 'Oct 2026');
  assert.equal(dateLabel('2026-10-05'), '5 Oct 2026');
  assert.equal(dateLabel('nope'), 'nope');
});
t('periods: calendar months and years via the library, custom swaps backwards input', () => {
  assert.deepEqual(PERIODS.map(p => p.id), ['month', 'last-month', 'year', 'last-year', 'custom']);
  assert.deepEqual(periodRange('month', TODAY), { from: '2026-10-01', to: '2026-10-31', label: 'Oct 2026' });
  assert.deepEqual(periodRange('last-month', TODAY), { from: '2026-09-01', to: '2026-09-30', label: 'Sep 2026' });
  assert.deepEqual(periodRange('last-month', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31', label: 'Dec 2025' });
  assert.deepEqual(periodRange('year', TODAY), { from: '2026-01-01', to: TODAY, label: '2026 to date' });
  assert.deepEqual(periodRange('last-year', TODAY), { from: '2025-01-01', to: '2025-12-31', label: '2025' });
  assert.deepEqual(periodRange('custom', TODAY, { from: '2026-06-30', to: '2026-04-01' }),
    { from: '2026-04-01', to: '2026-06-30', label: '1 Apr 2026 \u2013 30 Jun 2026' });
  assert.equal(periodRange('custom', TODAY, { from: 'bad' }).from, '2026-10-01');
  assert.equal(periodRange('banana', TODAY).from, '2026-10-01');
});
t('monthsBetween and the fetch window (always 12 months for the chart)', () => {
  assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(fetchWindow(periodRange('month', TODAY)), { from: '2025-11-01', to: '2026-10-31' });
  assert.deepEqual(fetchWindow(periodRange('year', TODAY)), { from: '2025-11-01', to: TODAY });
  const ly = periodRange('last-year', TODAY);
  assert.deepEqual(fetchWindow(ly), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(fetchWindow({ from: '2024-01-01', to: '2026-10-05' }), { from: '2024-01-01', to: '2026-10-05' });
});
t('chartMonths: dense, zero-filled, marks the period', () => {
  const rows = chartMonths([{ month: '2026-10', income: 500, expense: 200 }, { month: '2026-01', income: -5, expense: 'x' }],
    periodRange('month', TODAY));
  assert.equal(rows.length, 12);
  assert.equal(rows[0].month, '2025-11');
  assert.deepEqual(rows[11], { month: '2026-10', income: 500, expense: 200, inPeriod: true });
  assert.equal(chartMonths([], periodRange('year', TODAY)).filter(r => r.inPeriod).length, 10, 'Jan–Oct of a year to date');
  assert.equal(rows[10].inPeriod, false);
  assert.deepEqual(rows.find(r => r.month === '2026-01'), { month: '2026-01', income: 0, expense: 0, inPeriod: false });
  const long = chartMonths([], { from: '2025-04-01', to: '2026-10-05' });
  assert.equal(long.length, 19, 'a long custom range keeps its own months');
  assert.ok(long.every(r => r.inPeriod));
});
t('running cost: the three complete months before the reference month', () => {
  const by = [
    { month: '2026-06', expense: 99999 }, { month: '2026-07', expense: 30000 },
    { month: '2026-08', expense: 0 }, { month: '2026-09', expense: 60001 }, { month: '2026-10', expense: 99999 },
  ];
  assert.deepEqual(runningCost(by, '2026-10'), { pence: 30000, months: ['2026-07', '2026-08', '2026-09'] });
  assert.deepEqual(runningCost([], '2026-01'), { pence: 0, months: ['2025-10', '2025-11', '2025-12'] });
  assert.equal(runningRef(periodRange('month', TODAY), TODAY), '2026-10');
  assert.equal(runningRef(periodRange('last-month', TODAY), TODAY), '2026-10', 'ends with September');
  assert.equal(runningRef(periodRange('last-year', TODAY), TODAY), '2026-01', 'ends with December');
  assert.equal(runningRef({ from: '2026-01-01', to: '2026-08-15' }, TODAY), '2026-08', 'a part month is not counted');
  assert.equal(runningRef({ from: '2026-01-01', to: '2027-03-01' }, TODAY), '2026-10', 'a future end clamps to now');
});
t('categories: labels by kind, per-kind lists, sorted rows with shares', () => {
  const lbl = (k, id) => CATEGORIES[k].find(c => c.id === id).label;
  assert.equal(categoryLabel('expense', 'hosting'), lbl('expense', 'hosting'));
  assert.equal(categoryLabel('income', 'app-store'), lbl('income', 'app-store'));
  assert.equal(categoryLabel('transfer', 'store-payout'), lbl('transfer', 'store-payout'));
  assert.equal(categoryLabel('expense', 'weird-new-thing'), 'Weird new thing');
  assert.ok(categoriesFor('expense').some(c => c.id === 'software'));
  assert.ok(categoriesFor('income').some(c => c.id === 'google-play'));
  assert.ok(categoriesFor('transfer').some(c => c.id === 'store-payout'));
  const by = { expense: { hosting: 3000, software: 1000, bank: 0 }, income: { 'app-store': 9000 } };
  assert.deepEqual(categoryRows(by).map(r => [r.id, r.pence, r.share]), [['hosting', 3000, 0.75], ['software', 1000, 0.25]]);
  assert.deepEqual(categoryRows({}), []);
  assert.deepEqual(categoryRows(null), []);
  assert.equal(categoryRows(by, 'income')[0].label, lbl('income', 'app-store'));
});
t('signedPence: expenses negative, income and transfers as-is', () => {
  assert.equal(signedPence({ kind: 'expense', gbp_pence: 500 }), -500);
  assert.equal(signedPence({ kind: 'income', gbp_pence: 500 }), 500);
  assert.equal(signedPence({ kind: 'transfer', gbp_pence: 500 }), 500);
  assert.equal(signedPence({ kind: 'income', gbp_pence: null }), 0);
  assert.equal(signedPence(null), 0);
});
t('rates: which currencies still need one, and the boxes read as numbers', () => {
  const rows = [
    { currency: 'GBP', needs_fx: false }, { currency: 'USD', needs_fx: true },
    { currency: 'EUR', needs_fx: true }, { currency: 'USD', needs_fx: true }, { currency: 'CAD', needs_fx: false },
  ];
  assert.deepEqual(currenciesNeedingRate(rows), ['EUR', 'USD']);
  assert.deepEqual(ratesFrom({ USD: '0.75', EUR: '', CAD: 'x', JPY: '-1', usd: '1' }), { USD: 0.75 });
});
t('chunks: at most 2,000 rows per request', () => {
  const rows = Array.from({ length: 4501 }, (_, i) => i);
  assert.deepEqual(chunks(rows).map(c => c.length), [2000, 2000, 501]);
  assert.deepEqual(chunks([]), []);
});
t('fmtMajor: RevenueCat figures in their own currency', () => {
  assert.equal(fmtMajor(412.5, 'USD'), 'US$412.50');
  assert.equal(fmtMajor(1234.4, 'GBP'), '£1,234');
  assert.equal(fmtMajor('x', 'USD'), '—');
  assert.equal(fmtMajor(null), '—', 'a metric RevenueCat did not send is a dash, not £0');
  assert.match(fmtMajor(5, 'NOPE'), /5\.00 NOPE/);
});
t('payload readers never crash on a missing key', () => {
  assert.deepEqual(readOverview(null), { entries: [], recurring: [], prefs: {} });
  assert.deepEqual(readOverview({ entries: [{ id: 1 }], recurring: 'x', prefs: { fx: { USD: 0.8 } } }),
    { entries: [{ id: 1 }], recurring: [], prefs: { fx: { USD: 0.8 } } });
  assert.deepEqual(readBills({ bills: [1] }), [1]);
  assert.deepEqual(readBills({ recurring: [2] }), [2]);
  assert.deepEqual(readBills(null), []);
  assert.deepEqual(readPage({ entries: [], nextBefore: 'c1' }), { entries: [], next: 'c1' });
  assert.deepEqual(readPage({ next: '' }), { entries: [], next: null });
  assert.deepEqual(readPreview({ add: [1], invalid: [{ row: 2, reason: 'x' }] }), { add: [1], duplicates: [], invalid: [{ row: 2, reason: 'x' }] });
  assert.deepEqual(mergePreviews([{ add: [1], duplicates: [], invalid: [] }, { add: [2], duplicates: [3], invalid: [4] }]),
    { add: [1, 2], duplicates: [3], invalid: [4] });
});

console.log(`booksView: ${n} tests passed`);
