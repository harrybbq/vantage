/**
 * Books pure library: money, categories, ledger validation, reports,
 * recurring bills, CSV import/export — and parity with the server's
 * CommonJS copy (netlify/lib/booksCore.js).
 *
 * Every figure, name and file here is INVENTED test data.
 *
 * Run: npm run check:books   (also part of npm run build)
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { toPence, fromPence, fmtGBP, fmtMoney, fmtGBPShort } from './money.js';
import { CATEGORIES, categorise, isCategory, categoryLabel } from './categories.js';
import { KINDS, SOURCES, EDITABLE, normaliseEntry, validateEntry, isIsoDate } from './ledger.js';
import { summarise, calendarPeriod, customPeriod } from './reports.js';
import { addCadence, normaliseRecurring, validateRecurring, postingsFor, MAX_POSTINGS } from './recurring.js';
import {
  parseCsv, detectFormat, findHeaderRow, toEntries, applyFx, parseDate, stableHash,
  NATIVE_HEADERS, toCsv, nativeCsv,
} from './importers.js';

const require = createRequire(import.meta.url);
const core = require('../../../netlify/lib/booksCore.js');

let n = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
const deq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// ══ money ═══════════════════════════════════════════════════════════
for (const [input, want] of [
  ['£1,234.56', 123456], ['1234.56', 123456], ['-12', -1200], [12.5, 1250], [0.1, 10], [1.005, 101],
  ['(12.00)', -1200], ['12.00 DR', -1200], ['12.00 CR', 1200], ['\u2212£3', -300], ['£-3.5', -350], ['12-', -1200],
  ['+7', 700], ['.5', 50], ['5.', 500], ['0.999', 100], ['1.004', 100], ['-0', 0], ['$12', 1200], ['€3.50 EUR', 350],
  ['GBP 1,000', 100000], [' 1 234.00 ', 123400], ['1,234,567.89', 123456789], [-0.07, -7], [1e21, null],
  ['1,23', null], ['1.234,56', null], ['abc', null], ['', null], ['   ', null], [null, null], [undefined, null],
  [NaN, null], [Infinity, null], ['--12', null], ['1e3', null], ['12.3.4', null], [{}, null], [true, null],
]) eq(toPence(input), want, `toPence(${JSON.stringify(input)})`);

eq(fmtGBP(123456), '£1,234.56', 'fmtGBP thousands');
eq(fmtGBP(-1200), '\u2212£12.00', 'fmtGBP negative uses U+2212');
eq(fmtGBP(0), '£0.00', 'fmtGBP zero');
eq(fmtGBP(5), '£0.05', 'fmtGBP pence');
eq(fmtGBP(123456789012), '£1,234,567,890.12', 'fmtGBP big');
eq(fmtGBP(NaN), '—', 'fmtGBP NaN');
eq(fmtGBP(null), '—', 'fmtGBP null');
eq(fmtMoney(1234, 'USD'), '$12.34', 'fmtMoney USD');
eq(fmtMoney(-350, 'EUR'), '\u2212€3.50', 'fmtMoney EUR negative');
eq(fmtMoney(1234, 'SEK'), '12.34 SEK', 'fmtMoney suffix currency');
eq(fromPence(123456), '1234.56', 'fromPence');
eq(fromPence(-5), '-0.05', 'fromPence negative');
eq(fromPence(null), '', 'fromPence null');
eq(fmtGBPShort(124000), '£1,240', 'short');
eq(fmtGBPShort(-124049), '\u2212£1,240', 'short negative rounds');
for (const p of [0, 1, 99, 100, 123456, 987654321]) eq(toPence(fromPence(p)), p, `round trip ${p}`);

// ══ categories ══════════════════════════════════════════════════════
for (const id of ['hosting', 'software', 'store-fees', 'professional', 'bank', 'equipment', 'marketing', 'travel', 'office', 'subscriptions', 'other']) {
  ok(isCategory('expense', id), `expense ${id}`);
}
for (const id of ['app-store', 'google-play', 'web', 'other-income']) ok(isCategory('income', id), `income ${id}`);
ok(!isCategory('income', 'hosting'), 'hosting is not income');
ok(!isCategory('dividend', 'x'), 'no dividend kind');
for (const kind of Object.keys(CATEGORIES)) {
  const ids = CATEGORIES[kind].map(c => c.id);
  eq(new Set(ids).size, ids.length, `${kind} ids unique`);
  for (const c of CATEGORIES[kind]) ok(c.label && c.hint, `${kind}/${c.id} has label + hint`);
}
eq(categoryLabel('expense', 'store-fees'), 'Store fees', 'label');
eq(categoryLabel('expense', 'made-up'), 'Made up', 'label fallback');

const cat = (description, direction) => categorise({ description, direction });
deq(cat('SUPABASE INC', 'out'), { kind: 'expense', category: 'hosting', confidence: 'high' }, 'Supabase');
eq(cat('NETLIFY*PRO 123', 'out').category, 'hosting', 'Netlify');
eq(cat('ANTHROPIC, PBC', 'out').category, 'software', 'Anthropic');
eq(cat('APPLE.COM/BILL ITUNES.COM', 'out').category, 'store-fees', 'APPLE.COM/BILL');
eq(cat('Apple Developer Program', 'out').category, 'store-fees', 'Apple Developer');
eq(cat('GOOGLE *Play Console', 'out').category, 'store-fees', 'Play Console');
eq(cat('ICO DATA PROTECTION FEE', 'out').category, 'professional', 'ICO');
eq(cat('MEDICO SUPPLIES LTD', 'out').category, 'other', 'ICO needs a word boundary');
eq(cat('APPLE SEARCH ADS', 'out').category, 'marketing', 'Search Ads before Apple bill');
eq(cat('UBER EATS', 'out').category, 'other', 'Uber Eats is not travel');
eq(cat('UBER TRIP', 'out').category, 'travel', 'Uber is travel');
deq(cat('APPLE DISTRIBUTION INTL PAYOUT', 'in'), { kind: 'transfer', category: 'store-payout', confidence: 'high' }, 'Apple payout → transfer');
deq(cat('GOOGLE PAYMENT IRELAND LTD', 'in'), { kind: 'transfer', category: 'store-payout', confidence: 'high' }, 'Google payout → transfer');
eq(cat('STRIPE PAYMENTS UK', 'in').category, 'web', 'Stripe credit → web income');
eq(cat('STRIPE PAYMENTS UK', 'in').confidence, 'medium', 'Stripe is medium confidence');
deq(cat('SOMETHING ODD', 'in'), { kind: 'income', category: 'other-income', confidence: 'low' }, 'unknown credit');
deq(cat('SOMETHING ODD', 'out'), { kind: 'expense', category: 'other', confidence: 'low' }, 'unknown debit');
eq(categorise({ description: 'SUPABASE', amountPence: -2500 }).category, 'hosting', 'direction from sign');
eq(categorise({ description: 'MONTHLY ACCOUNT FEE', amountPence: -500 }).category, 'bank', 'monthly account fee');
eq(categorise({ description: 'ACCOUNT FEE', amountPence: -500 }).category, 'bank', 'account fee');
eq(categorise({}).kind, 'income', 'empty input does not throw');
// Every rule lands on a real category.
for (const d of ['SUPABASE', 'ANTHROPIC', 'APPLE.COM/BILL', 'ICO', 'TFL TRAVEL', 'CURRYS', 'ROYAL MAIL', 'ACCOUNT FEE', 'APPLE SEARCH ADS', 'TRANSFER TO SAVINGS']) {
  for (const dir of ['in', 'out']) {
    const c = cat(d, dir);
    ok(isCategory(c.kind, c.category), `${d}/${dir} → ${c.kind}/${c.category} exists`);
  }
}

// ══ ledger ══════════════════════════════════════════════════════════
const good = { occurred_on: '2026-03-04', kind: 'expense', category: 'hosting', amount_pence: 2500, description: '  Database plan  ' };
deq(validateEntry(good), { ok: true, errors: {} }, 'valid manual GBP');
const ng = normaliseEntry(good);
eq(ng.gbp_pence, 2500, 'GBP: gbp_pence = amount');
eq(ng.currency, 'GBP', 'currency default');
eq(ng.source, 'manual', 'source default');
eq(ng.description, 'Database plan', 'trimmed');
eq(ng.fx_rate, null, 'no fx for GBP');
ok(!('row' in normaliseEntry({ ...good, row: 3, confidence: 'high' })), 'projection drops UI fields');
eq(normaliseEntry({ ...good, amount_pence: undefined, amount: '£25.00' }).amount_pence, 2500, 'amount string accepted');
eq(normaliseEntry({ ...good, occurred_on: '2026-03-04T10:00:00Z' }).occurred_on, '2026-03-04', 'ISO datetime trimmed');
eq(normaliseEntry({ ...good, gbp_pence: 1 }).gbp_pence, 2500, 'GBP ignores a stray gbp_pence');
eq(normaliseEntry({ ...good, id: 'ABCDEF01-2345-6789-ABCD-EF0123456789' }).id, 'abcdef01-2345-6789-abcd-ef0123456789', 'id kept, lowercased');
ok(!('id' in normaliseEntry({ ...good, id: 'nope' })), 'bad id dropped');

const usd = { ...good, currency: 'usd', amount_pence: 1000 };
eq(validateEntry(usd).errors.gbp_pence !== undefined, true, 'USD needs a GBP value');
eq(normaliseEntry({ ...usd, fx_rate: 0.79 }).gbp_pence, 790, 'fx derives gbp');
ok(validateEntry({ ...usd, fx_rate: 0.79 }).ok, 'USD with fx is valid');
ok(validateEntry({ ...usd, gbp_pence: 800 }).ok, 'USD with explicit gbp is valid');
ok(!validateEntry({ ...usd, fx_rate: -1 }).ok, 'negative fx refused');

const errs = x => Object.keys(validateEntry(x).errors).sort();
deq(errs({ ...good, amount_pence: 0 }), ['amount_pence'], 'zero refused');
deq(errs({ ...good, amount_pence: -5 }), ['amount_pence'], 'negative refused');
deq(errs({ ...good, amount_pence: 1.5e13 }), ['amount_pence'], 'too large');
deq(errs({ ...good, amount_pence: 'x' }), ['amount_pence'], 'junk amount');
deq(errs({ ...good, kind: 'dividend' }), ['kind'], 'dividend is not a kind');
deq(errs({ ...good, kind: 'tax' }), ['kind'], 'tax is not a kind');
deq(errs({ ...good, kind: 'income' }), ['category'], 'hosting is not an income category');
deq(errs({ ...good, occurred_on: '2026-02-30' }), ['occurred_on'], 'impossible date');
deq(errs({ ...good, occurred_on: '2026-02-29' }), ['occurred_on'], '2026 is not a leap year');
deq(errs({ ...good, occurred_on: '2028-02-29' }), [], '2028 is a leap year');
deq(errs({ ...good, occurred_on: '1999-12-31' }), ['occurred_on'], 'before 2000');
deq(errs({ ...good, occurred_on: '04/03/2026' }), ['occurred_on'], 'non-ISO date refused at the ledger');
deq(errs({ ...good, vat_pence: 2600 }), ['vat_pence'], 'VAT above amount');
deq(errs({ ...good, vat_pence: 500 }), [], 'VAT ok');
deq(errs({ ...good, currency: 'POUNDS' }), ['currency'], 'currency code');
deq(errs({ ...good, source: 'revenuecat', source_ref: 'rc:1' }), ['source'], 'RevenueCat is never booked');
deq(errs({ ...good, source: 'bank_csv' }), ['source_ref'], 'imports need a ref');
deq(errs({ ...good, source: 'bank_csv', source_ref: 'bank:abc 123' }), ['source_ref'], 'ref charset');
deq(errs({ ...good, source: 'bank_csv', source_ref: 'bank:abc123' }), [], 'bank with ref ok');
deq(errs({ ...good, source: 'paypal' }), ['source'], 'unknown source');
deq(errs({ ...good, description: 'x'.repeat(500) }), [], 'long text is truncated, not refused');
eq(normaliseEntry({ ...good, description: 'x'.repeat(500) }).description.length, 300, 'truncated to 300');
eq(normaliseEntry({ ...good, note: 'a\u0000b\u0007c' }).note, 'abc', 'control chars dropped');
ok(isIsoDate('2024-02-29') && !isIsoDate('2023-02-29') && !isIsoDate('2026-13-01') && !isIsoDate(20260101), 'isIsoDate');

// ══ reports ═════════════════════════════════════════════════════════
const E = (occurred_on, kind, category, gbp_pence, extra = {}) => ({ occurred_on, kind, category, gbp_pence, amount_pence: gbp_pence, currency: 'GBP', ...extra });
const ledger = [
  E('2026-01-05', 'income', 'app-store', 10000),
  E('2026-01-20', 'expense', 'hosting', 2500),
  E('2026-01-21', 'transfer', 'store-payout', 9000),
  E('2026-03-02', 'income', 'google-play', 4000, { currency: 'USD', amount_pence: 5000 }),
  E('2026-03-03', 'expense', 'software', 1800),
  E('2026-03-04', 'expense', 'hosting', 99999, { deleted_at: '2026-03-05T00:00:00Z' }),
  E('2025-12-31', 'income', 'web', 7000),
  E('2026-04-01', 'income', 'web', 300),
  { occurred_on: 'garbage', kind: 'income', category: 'web', gbp_pence: 5 },
];
const s1 = summarise(ledger, { from: '2026-01-01', to: '2026-03-31' });
eq(s1.incomePence, 14000, 'income in range (gbp_pence used)');
eq(s1.expensePence, 4300, 'expense excludes deleted');
eq(s1.profitPence, 9700, 'profit');
eq(s1.transferPence, 9000, 'transfers shown separately');
deq(s1.byCategory, { income: { 'app-store': 10000, 'google-play': 4000 }, expense: { hosting: 2500, software: 1800 } }, 'byCategory');
deq(s1.byMonth, [
  { month: '2026-01', income: 10000, expense: 2500, profit: 7500 },
  { month: '2026-02', income: 0, expense: 0, profit: 0 },
  { month: '2026-03', income: 4000, expense: 1800, profit: 2200 },
], 'byMonth zero-filled, transfers excluded');
eq(s1.count, 5, 'count includes transfers, not deleted/out-of-range');
const s2 = summarise(ledger);
eq(s2.byMonth[0].month, '2025-12', 'no range: span of entries');
eq(s2.byMonth.length, 5, 'Dec..Apr');
eq(summarise([], {}).byMonth.length, 0, 'empty');
eq(summarise(null).profitPence, 0, 'null-safe');
eq(summarise(ledger, { from: '2020-01-01', to: '2040-12-31' }).byMonth.length, 120, 'byMonth capped');

deq(calendarPeriod('month', '2028-02-10'), { from: '2028-02-01', to: '2028-02-29', label: 'Feb 2028' }, 'leap February');
deq(calendarPeriod('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28', label: 'Feb 2026' }, 'common February');
deq(calendarPeriod('last-month', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31', label: 'Dec 2025' }, 'last month across a year');
deq(calendarPeriod('last-month', '2028-03-31'), { from: '2028-02-01', to: '2028-02-29', label: 'Feb 2028' }, 'last month leap');
deq(calendarPeriod('year', '2026-10-05'), { from: '2026-01-01', to: '2026-12-31', label: '2026' }, 'year');
deq(calendarPeriod('last-year', '2026-10-05'), { from: '2025-01-01', to: '2025-12-31', label: '2025' }, 'last year');
deq(calendarPeriod('ytd', '2026-10-05'), { from: '2026-01-01', to: '2026-10-05', label: '2026 to date' }, 'ytd');
eq(calendarPeriod('accounting-year', '2026-10-05'), null, 'no accounting periods');
eq(calendarPeriod('month', 'nope'), null, 'bad date');
deq(customPeriod('2026-01-15', '2026-02-14'), { from: '2026-01-15', to: '2026-02-14', label: '15 Jan 2026 \u2013 14 Feb 2026' }, 'custom');
eq(customPeriod('2026-02-14', '2026-01-15'), null, 'custom reversed');

// ══ recurring ═══════════════════════════════════════════════════════
eq(addCadence('2026-01-31', 'monthly'), '2026-02-28', '31 Jan → 28 Feb');
eq(addCadence('2026-02-28', 'monthly', 31), '2026-03-31', 'anchor returns to the 31st');
eq(addCadence('2028-01-31', 'monthly', 31), '2028-02-29', 'leap February');
eq(addCadence('2026-12-15', 'monthly'), '2027-01-15', 'December rolls the year');
eq(addCadence('2028-02-29', 'yearly'), '2029-02-28', 'yearly from 29 Feb');
eq(addCadence('2031-02-28', 'yearly', 29), '2032-02-29', 'yearly anchor back to 29 Feb');
eq(addCadence('2026-01-31', 'weekly'), null, 'unknown cadence');
eq(addCadence('bad', 'monthly'), null, 'bad date');

const BILL_ID = '11111111-2222-4333-8444-555555555555';
const bill = { id: BILL_ID, name: 'Hosting plan', kind: 'expense', category: 'hosting', amount_pence: 2000, cadence: 'monthly', next_due: '2026-01-31' };
deq(validateRecurring(bill), { ok: true, errors: {} }, 'valid bill');
eq(normaliseRecurring(bill).anchor_day, 31, 'anchor from next_due');
deq(Object.keys(validateRecurring({ ...bill, currency: 'USD' }).errors), ['gbp_pence'], 'non-GBP bill needs GBP value');
deq(Object.keys(validateRecurring({ ...bill, cadence: 'weekly', kind: 'transfer' }).errors).sort(), ['cadence', 'kind'], 'bad cadence + kind');
const p1 = postingsFor(bill, '2026-04-30');
deq(p1.entries.map(x => x.occurred_on), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'], 'month-end postings');
eq(p1.nextDue, '2026-05-31', 'next due');
eq(p1.entries[1].source_ref, `recurring:${BILL_ID}:2026-02-28`, 'ref format');
ok(p1.entries.every(x => validateEntry(x).ok), 'postings validate');
deq(postingsFor({ ...bill, next_due: p1.nextDue }, '2026-04-30').entries, [], 'nothing left to post');
deq(postingsFor({ ...bill, active: false }, '2026-04-30').entries, [], 'inactive posts nothing');
deq(postingsFor({ ...bill, id: undefined }, '2026-04-30').entries, [], 'unsaved bill posts nothing');
eq(postingsFor({ ...bill, next_due: '2000-01-01' }, '2026-04-30').entries.length, MAX_POSTINGS, 'capped');
const yb = postingsFor({ ...bill, cadence: 'yearly', currency: 'USD', gbp_pence: 1500, next_due: '2024-02-29' }, '2028-03-01');
deq(yb.entries.map(x => x.occurred_on), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'], 'yearly leap anchor');
eq(yb.entries[0].gbp_pence, 1500, 'non-GBP bill posts its GBP value');

// ══ CSV parsing ═════════════════════════════════════════════════════
deq(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']], 'CRLF');
deq(parseCsv('\uFEFFa,b\n1,2'), [['a', 'b'], ['1', '2']], 'BOM, no trailing newline');
deq(parseCsv('a,b\r1,2\r'), [['a', 'b'], ['1', '2']], 'CR only');
deq(parseCsv('a,b\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']], 'quotes and escapes');
deq(parseCsv('a,b\n"line1\nline2",2\n'), [['a', 'b'], ['line1\nline2', '2']], 'newline inside quotes');
deq(parseCsv('a;b;c\n1,50;2;3\n'), [['a', 'b', 'c'], ['1,50', '2', '3']], 'semicolon sniffed');
deq(parseCsv('a\tb\n1\t2\n'), [['a', 'b'], ['1', '2']], 'tab sniffed');
deq(parseCsv('a,b\n\n1,2\n,\n'), [['a', 'b'], ['1', '2']], 'blank rows dropped');
deq(parseCsv('a,b\n1,\n'), [['a', 'b'], ['1', '']], 'empty last field');
deq(parseCsv('x|y', { delimiter: '|' }), [['x', 'y']], 'explicit delimiter');
deq(parseCsv(''), [], 'empty');
deq(parseCsv(null), [], 'null');

eq(parseDate('05/10/2026'), '2026-10-05', 'dd/mm/yyyy');
eq(parseDate('05/10/2026', 'mdy'), '2026-05-10', 'mm/dd/yyyy');
eq(parseDate('5-10-26'), '2026-10-05', 'd-m-yy');
eq(parseDate('05.10.2026'), '2026-10-05', 'dotted');
eq(parseDate('2026-10-05T13:45:00Z'), '2026-10-05', 'ISO time');
eq(parseDate('05 Oct 2026'), '2026-10-05', 'dd Mon yyyy');
eq(parseDate('5 September 2026'), '2026-09-05', 'full month');
eq(parseDate('5 Sept 2026'), '2026-09-05', 'Sept');
eq(parseDate('Oct 1, 2026'), '2026-10-01', 'Mon d, yyyy');
eq(parseDate('31/02/2026'), null, 'impossible');
eq(parseDate('29/02/2028'), '2028-02-29', 'leap day');
eq(parseDate('hello'), null, 'junk');
eq(stableHash('abc'), stableHash('abc'), 'hash stable');
ok(stableHash('abc') !== stableHash('abd'), 'hash differs');
eq(stableHash('x').length, 28, 'hash length');

// ══ Fixtures (all invented) ═════════════════════════════════════════
const BANK_A = [
  'Date,Description,Money out,Money in,Balance',
  '01/03/2026,SUPABASE INC,25.00,,974.00',
  '02/03/2026,APPLE DISTRIBUTION INTL PAYOUT,,412.37,1386.37',
  '03/03/2026,COFFEE SHOP,4.99,,1381.38',
  '03/03/2026,COFFEE SHOP,4.99,,1376.39',
  '04/03/2026,"ANTHROPIC, PBC",18.00,,1358.39',
  '05/03/2026,ZERO LINE,0.00,,1358.39',
  '31/02/2026,BAD DATE,1.00,,1357.39',
  '06/03/2026,NO AMOUNT,,,1357.39',
].join('\r\n');

const rowsA = parseCsv(BANK_A);
eq(detectFormat(rowsA[0]), 'bank-generic', 'bank detected');
const ia = toEntries(null, rowsA);
eq(ia.format, 'bank-generic', 'format echoed');
eq(ia.entries.length, 5, 'five bank entries');
eq(ia.skipped, 1, 'zero line skipped');
deq(ia.invalid.map(x => x.row), [8, 9], 'invalid rows by file line');
ok(/date/i.test(ia.invalid[0].reason), 'bad date reason');
const [sup, payout, c1, c2, anth] = ia.entries;
deq([sup.kind, sup.category, sup.amount_pence, sup.occurred_on, sup.source], ['expense', 'hosting', 2500, '2026-03-01', 'bank_csv'], 'Supabase line');
deq([payout.kind, payout.category, payout.amount_pence], ['transfer', 'store-payout', 41237], 'payout is a transfer');
eq(anth.description, 'ANTHROPIC, PBC', 'quoted comma kept');
ok(c1.source_ref !== c2.source_ref, 'identical lines get distinct refs');
ok(ia.entries.every(x => validateEntry(x).ok), 'all bank entries validate');
ok(ia.entries.every(x => /^bank:[0-9a-f]{28}$/.test(x.source_ref)), 'ref shape');
// Re-import of the same text → identical refs.
deq(toEntries(null, parseCsv(BANK_A)).entries.map(x => x.source_ref), ia.entries.map(x => x.source_ref), 'refs stable across re-imports');
// An overlapping later export (different balance column, extra line) → same refs for the overlap.
const BANK_A2 = [
  'Date,Description,Money out,Money in,Balance',
  '03/03/2026,COFFEE SHOP,4.99,,9.99',
  '03/03/2026,COFFEE SHOP,4.99,,5.00',
  '04/03/2026,ANTHROPIC,  PBC,18.00,,1.00',
].join('\n');
const ia2 = toEntries(null, parseCsv(BANK_A2));
deq(ia2.entries.slice(0, 2).map(x => x.source_ref), [c1.source_ref, c2.source_ref], 'overlap de-duplicates');
// Account label separates identical lines in two accounts.
ok(toEntries(null, rowsA, { account: 'Savings' }).entries[0].source_ref !== sup.source_ref, 'account folds into refs');

const BANK_B = 'Transaction Date;Details;Amount (GBP);Currency\n2026-03-07;NETLIFY;-£19.00;GBP\n2026-03-08;STRIPE PAYMENTS UK;"£1,204.50";GBP\n2026-03-09;FIGMA;(12.00);USD\n';
const ib = toEntries(null, parseCsv(BANK_B));
eq(ib.format, 'bank-generic', 'semicolon bank with Amount (GBP)');
deq(ib.entries.map(x => [x.kind, x.category, x.amount_pence, x.currency]), [
  ['expense', 'hosting', 1900, 'GBP'], ['income', 'web', 120450, 'GBP'], ['expense', 'software', 1200, 'USD'],
], 'signed amounts, currency column');
eq(ib.entries[2].needs_fx, true, 'USD line needs a rate');
eq(ib.entries[2].gbp_pence, null, 'no GBP guessed');
ok(!validateEntry(ib.entries[2]).ok, 'cannot commit without a rate');
const fixed = applyFx(ib.entries, { USD: 0.8 });
eq(fixed[2].gbp_pence, 960, 'applyFx fills gbp');
eq(fixed[2].fx_rate, 0.8, 'applyFx sets rate');
ok(fixed.every(x => validateEntry(x).ok), 'valid after fx');
eq(toEntries(null, parseCsv(BANK_B), { fx: { USD: 0.75 } }).entries[2].gbp_pence, 900, 'fx option at import');

const BANK_C = 'Date,Payee,Credit,Debit\n05 Oct 2026,TFL TRAVEL CHARGE,,3.40\n06 Oct 2026,INTEREST PAID,0.12,\n';
deq(toEntries(null, parseCsv(BANK_C)).entries.map(x => [x.occurred_on, x.category]), [['2026-10-05', 'travel'], ['2026-10-06', 'other-income']], 'Credit/Debit pair, month names');

// Manual mapping.
const ODD = 'Posted,Payee name,Value\n2026-03-01,SUPABASE,-25.00\n';
eq(detectFormat(parseCsv(ODD)[0]), null, 'unknown headers');
const unm = toEntries(null, parseCsv(ODD));
eq(unm.entries.length, 0, 'unrecognised → nothing');
ok(/map/i.test(unm.invalid[0].reason), 'asks for a mapping');
const mapped = toEntries(null, parseCsv(ODD), { mapping: { date: 'Posted', description: 'Payee name', amount: 'Value' } });
deq(mapped.entries.map(x => [x.category, x.amount_pence]), [['hosting', 2500]], 'manual mapping works');
const badMap = toEntries(null, parseCsv(ODD), { mapping: { date: 'Nope', description: 'Payee name', amount: 'Value' } });
eq(badMap.entries.length, 0, 'bad mapping → nothing');
eq(badMap.invalid.length, 1, 'bad mapping explained');
// Object rows work too.
eq(toEntries('bank-generic', [{ Date: '2026-03-01', Description: 'SUPABASE', Amount: '-25' }]).entries[0].amount_pence, 2500, 'object rows');

// Apple (tab-separated, trailer rows).
const APPLE = [
  ['Start Date', 'End Date', 'UPC', 'ISRC/ISBN', 'Vendor Identifier', 'Quantity', 'Partner Share', 'Extended Partner Share', 'Partner Share Currency', 'Sales or Return', 'Apple Identifier', 'Artist/Show/Developer/Author', 'Title', 'Label/Studio/Network/Developer/Publisher', 'Grid', 'Product Type Identifier', 'ISAN/Other Identifier', 'Country Of Sale', 'Pre-order Flag', 'Promo Code', 'Customer Price', 'Customer Currency'],
  ['09/01/2026', '09/30/2026', '', '', 'demo.pro.monthly', '12', '2.79', '33.48', 'GBP', 'S', '1000000001', 'Example Dev', 'Demo Pro Monthly', '', '', 'IAY', '', 'GB', '', '', '3.99', 'GBP'],
  ['09/01/2026', '09/30/2026', '', '', 'demo.pro.monthly', '5', '3.49', '17.45', 'USD', 'S', '1000000001', 'Example Dev', 'Demo Pro Monthly', '', '', 'IAY', '', 'US', '', '', '4.99', 'USD'],
  ['09/01/2026', '09/30/2026', '', '', 'demo.pro.monthly', '-1', '2.79', '-2.79', 'GBP', 'R', '1000000001', 'Example Dev', 'Demo Pro Monthly', '', '', 'IAY', '', 'GB', '', '', '3.99', 'GBP'],
  ['09/01/2026', '09/30/2026', '', '', 'demo.trial', '40', '0', '0', 'GBP', 'S', '1000000002', 'Example Dev', 'Demo Trial', '', '', 'IAY', '', 'GB', '', '', '0', 'GBP'],
  ['Total_Rows', '4'], ['Total_Amount', '48.14'], ['Total_Units', '56'],
].map(r => r.join('\t')).join('\n');
const appleRows = parseCsv(APPLE);
eq(detectFormat(appleRows[0]), 'apple-financial', 'Apple detected');
const ap = toEntries(null, appleRows, { fx: { USD: 0.78 } });
eq(ap.entries.length, 3, 'three Apple rows (zero + trailers skipped)');
eq(ap.skipped, 4, 'zero row + 3 trailers skipped');
deq(ap.entries.map(x => [x.kind, x.category, x.amount_pence, x.currency, x.occurred_on]), [
  ['income', 'app-store', 3348, 'GBP', '2026-09-30'],
  ['income', 'app-store', 1745, 'USD', '2026-09-30'],
  ['expense', 'refunds', 279, 'GBP', '2026-09-30'],
], 'Apple rows → entries at period end');
eq(ap.entries[1].gbp_pence, Math.round(1745 * 0.78), 'Apple USD via fx map');
ok(ap.entries.every(x => validateEntry(x).ok && x.source === 'apple' && /^apple:/.test(x.source_ref)), 'Apple entries valid');
eq(toEntries(null, appleRows).entries[1].needs_fx, true, 'Apple USD without fx left to confirm');
deq(toEntries(null, parseCsv(APPLE)).entries.map(x => x.source_ref), toEntries(null, appleRows).entries.map(x => x.source_ref), 'Apple refs stable');
// Preamble lines before the header are tolerated.
eq(findHeaderRow(parseCsv(`Some report title\nGenerated for an example\n${APPLE}`)), 2, 'header found after preamble');
eq(toEntries(null, parseCsv(`Some report title\n${APPLE}`), { fx: { USD: 0.78 } }).entries.length, 3, 'preamble import');

// Google Play earnings.
const GOOGLE = [
  'Description,Transaction Date,Transaction Time,Tax Type,Transaction Type,Refund Type,Product Title,Product id,Product Type,Sku Id,Hardware,Buyer Country,Buyer State,Buyer Postal Code,Buyer Currency,Amount (Buyer Currency),Currency Conversion Rate,Merchant Currency,Amount (Merchant Currency)',
  'GPA.0000-0000-0000-00001,"Sep 3, 2026",10:01:02 PDT,,Charge,,Demo Pro (Example),com.example.demo,subscription,pro_monthly,phone,GB,,,GBP,3.99,1,GBP,3.32',
  'GPA.0000-0000-0000-00001,"Sep 3, 2026",10:01:02 PDT,,Google fee,,Demo Pro (Example),com.example.demo,subscription,pro_monthly,phone,GB,,,GBP,-0.50,1,GBP,-0.50',
  'GPA.0000-0000-0000-00002,"Sep 9, 2026",08:00:00 PDT,,Charge refund,Full,Demo Pro (Example),com.example.demo,subscription,pro_monthly,phone,GB,,,GBP,-3.99,1,GBP,-3.32',
  'GPA.0000-0000-0000-00002,"Sep 9, 2026",08:00:00 PDT,,Google fee refund,Full,Demo Pro (Example),com.example.demo,subscription,pro_monthly,phone,GB,,,GBP,0.50,1,GBP,0.50',
  'GPA.0000-0000-0000-00003,"Sep 10, 2026",09:00:00 PDT,,Charge,,Demo Pro (Example),com.example.demo,subscription,pro_monthly,phone,DE,,,EUR,4.99,0.86,GBP,3.56',
  'GPA.0000-0000-0000-00004,"not a date",09:00:00 PDT,,Charge,,Demo Pro (Example),com.example.demo,subscription,pro_monthly,phone,DE,,,EUR,4.99,0.86,GBP,3.56',
].join('\n');
const gRows = parseCsv(GOOGLE);
eq(detectFormat(gRows[0]), 'google-earnings', 'Google detected');
const gp = toEntries(null, gRows);
deq(gp.entries.map(x => [x.kind, x.category, x.amount_pence, x.occurred_on]), [
  ['income', 'google-play', 332, '2026-09-03'],
  ['expense', 'store-fees', 50, '2026-09-03'],
  ['expense', 'refunds', 332, '2026-09-09'],
  ['income', 'google-play', 50, '2026-09-09'],
  ['income', 'google-play', 356, '2026-09-10'],
], 'Google rows → entries');
eq(gp.invalid.length, 1, 'bad Google date flagged');
ok(gp.entries.every(x => validateEntry(x).ok && x.source === 'google'), 'Google entries valid');
eq(new Set(gp.entries.map(x => x.source_ref)).size, 5, 'Google refs distinct');

// books-native round trip (and the formula guard).
const native = [
  { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', occurred_on: '2026-03-01', kind: 'expense', category: 'hosting', amount_pence: 2500, currency: 'GBP', fx_rate: null, gbp_pence: 2500, vat_pence: 417, counterparty: 'Example Host', description: '=HYPERLINK("http://example.invalid")', source: 'manual', source_ref: null, note: 'Line one\nline "two"' },
  { id: 'aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff', occurred_on: '2026-03-02', kind: 'income', category: 'app-store', amount_pence: 1745, currency: 'USD', fx_rate: 0.78, gbp_pence: 1361, vat_pence: null, counterparty: 'Apple', description: '-5 promo, units', source: 'apple', source_ref: 'apple:0123abcd', note: null },
];
const csv = nativeCsv(native);
ok(csv.includes("\"'=HYPERLINK(\"\"http://example.invalid\"\")\""), 'formula cell guarded');
ok(csv.startsWith(NATIVE_HEADERS.join(',')), 'native headers first');
const nRows = parseCsv(csv);
eq(detectFormat(nRows[0]), 'books-native', 'native detected');
const back = toEntries(null, nRows);
eq(back.invalid.length, 0, 'native round trip has no invalid rows');
deq(back.entries.map(x => normaliseEntry(x)), native.map(x => normaliseEntry({ ...x, source_ref: x.source_ref || `native:${x.id}` })), 'native round trip preserves every field');
eq(back.entries[0].description, '=HYPERLINK("http://example.invalid")', 'guard stripped on import');
eq(toCsv([['-12.50', '+x']]), "-12.50,'+x\r\n", 'numbers are not guarded, text is');

// ══ Parity with the server copy (netlify/lib/booksCore.js) ══════════
deq(core.KINDS, KINDS, 'KINDS parity');
deq(core.SOURCES, SOURCES, 'SOURCES parity');
deq(core.EDITABLE, EDITABLE, 'EDITABLE parity');
deq(core.NATIVE_HEADERS, NATIVE_HEADERS, 'NATIVE_HEADERS parity');
for (const kind of Object.keys(CATEGORIES)) deq(core.CATEGORY_IDS[kind], CATEGORIES[kind].map(c => c.id), `${kind} category parity`);
deq(Object.keys(core.CATEGORY_IDS), Object.keys(CATEGORIES), 'category kinds parity');

// Seeded generator: the same cases every run.
let seed = 20261005;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = list => list[Math.floor(rand() * list.length)];
const moneyPool = ['£1,234.56', '1234.56', '-12', 12.5, '(12.00)', '12.00 DR', '\u2212£3', '1,23', 'abc', '', null, 0.1, 1.005, '1e3', ' 7 ', '+5', '.5', '0.999', 1e21, NaN];
for (const v of moneyPool) eq(core.toPence(v), toPence(v), `toPence parity ${String(v)}`);
for (const p of [0, 5, -5, 123456, NaN, null]) eq(core.fromPence(p), fromPence(p), `fromPence parity ${p}`);

const pools = {
  occurred_on: ['2026-03-04', '2026-02-29', '2028-02-29', '1999-01-01', '2026-03-04T08:00:00Z', 'garbage', null, ''],
  kind: ['income', 'expense', 'transfer', 'dividend', 'INCOME', null],
  category: ['hosting', 'app-store', 'store-payout', 'other', 'nope', 'Hosting', null],
  amount_pence: [2500, 0, -1, 1.5e13, '2500', 'x', null, 99.6],
  amount: [undefined, '£12.34', 'junk'],
  currency: ['GBP', 'usd', 'EUR', 'POUNDS', null],
  fx_rate: [null, 0.79, '0.8', -1, 'x', 20000],
  gbp_pence: [null, 1000, -5, '700', 'x'],
  vat_pence: [null, 0, 100, 1e14, 'x'],
  vat: [undefined, '1.00'],
  source: ['manual', 'bank_csv', 'revenuecat', 'recurring', 'paypal', null],
  source_ref: [null, 'bank:abc', 'bad ref!', 'x'.repeat(250)],
  description: [null, '  hi  ', 'x'.repeat(400)],
  note: [null, 'a\u0001b'],
  id: [undefined, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'nope'],
};
for (let i = 0; i < 3000; i++) {
  const c = {};
  for (const [k, list] of Object.entries(pools)) { const v = pick(list); if (v !== undefined) c[k] = v; }
  deq(core.normaliseEntry(c), normaliseEntry(c), `normaliseEntry parity #${i}`);
  deq(core.validateEntry(c), validateEntry(c), `validateEntry parity #${i}`);
}

const billPools = {
  id: [BILL_ID, undefined],
  name: ['Plan', '', null, '  Padded  '],
  kind: ['expense', 'income', 'transfer', null],
  category: ['hosting', 'web', 'nope', null],
  amount_pence: [2000, 0, '300', 'x', null],
  amount: [undefined, '£9.99'],
  currency: ['GBP', 'USD', 'x'],
  gbp_pence: [null, 1500, 0],
  cadence: ['monthly', 'yearly', 'weekly', null],
  next_due: ['2026-01-31', '2028-02-29', '2026-02-30', null],
  anchor_day: [null, 31, 0, '15'],
  active: [undefined, true, false, 'yes'],
};
for (let i = 0; i < 1500; i++) {
  const c = {};
  for (const [k, list] of Object.entries(billPools)) { const v = pick(list); if (v !== undefined) c[k] = v; }
  deq(core.normaliseRecurring(c), normaliseRecurring(c), `normaliseRecurring parity #${i}`);
  deq(core.validateRecurring(c), validateRecurring(c), `validateRecurring parity #${i}`);
  const upTo = pick(['2026-06-30', '2030-01-01', 'bad']);
  deq(core.postingsFor(c, upTo), postingsFor(c, upTo), `postingsFor parity #${i}`);
}
// addCadence over every day of 2024–2029, both cadences, a spread of anchors.
for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2029, 11, 31); t += 86400_000) {
  const d = new Date(t).toISOString().slice(0, 10);
  for (const cad of ['monthly', 'yearly']) {
    for (const a of [undefined, 1, 28, 29, 30, 31]) {
      assert.equal(core.addCadence(d, cad, a), addCadence(d, cad, a), `addCadence parity ${d} ${cad} ${a}`);
    }
  }
}
n++;
eq(core.nativeCsv(native), nativeCsv(native), 'nativeCsv parity');
eq(core.nativeCsv([...ia.entries, ...ap.entries, ...gp.entries].map(normaliseEntry)), nativeCsv([...ia.entries, ...ap.entries, ...gp.entries].map(normaliseEntry)), 'nativeCsv parity on imports');

console.log(`books: ${n} checks passed`);
