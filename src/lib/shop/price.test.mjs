/**
 * The wishlist's one price reader.
 *
 * What goes wrong here is free text. The three parsers this replaced
 * read "1.299,99 €" as £1.30, "£20–£30" as £2,030, "Was £50 now £30" as
 * £50 and "2 for £10" as £2, and added dollars and euros into a pound
 * total. Every one of those is written down below, with the junk a
 * real list contains.
 *
 * All data is invented.
 */
import assert from 'node:assert/strict';
import { parsePrice, itemPrice, totalsFor, fmtGBP, effectivePrice, isSuspectMove } from './price.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const read = s => { const p = parsePrice(s); return [p.value, p.currency, p.kind]; };

// ── The contract's examples ──
eq(read('£1,299.99'), [1299.99, 'GBP', 'exact'], '£1,299.99');
eq(read('1.299,99 €'), [1299.99, 'EUR', 'exact'], '1.299,99 € (European separators)');
eq(read('£20–£30'), [20, 'GBP', 'from'], '£20–£30 (en dash range → lowest)');
eq(read('from £20'), [20, 'GBP', 'from'], 'from £20');
eq(read('Was £50 now £30'), [30, 'GBP', 'exact'], 'Was £50 now £30 → now');
eq(read('2 for £10'), [10, 'GBP', 'multi'], '2 for £10');
eq(read('Free'), [0, null, 'free'], 'Free');
eq(read(''), [null, null, 'unknown'], 'empty');
eq(read(null), [null, null, 'unknown'], 'null');
eq(read(undefined), [null, null, 'unknown'], 'undefined');
eq(read('TBC'), [null, null, 'unknown'], 'TBC');

// ── More formats seen on real lists ──
eq(read('£149.99'), [149.99, 'GBP', 'exact'], 'plain pounds');
eq(read('£ 49.99'), [49.99, 'GBP', 'exact'], 'space after the symbol');
eq(read('149.99'), [149.99, null, 'exact'], 'no symbol → currency unknown');
eq(read('$49'), [49, 'USD', 'exact'], 'dollars');
eq(read('€12,99'), [12.99, 'EUR', 'exact'], 'euro decimal comma');
eq(read('1 299,99 €'), [1299.99, 'EUR', 'exact'], 'space-grouped euros');
eq(read('1\u202f299,99\u00a0€'), [1299.99, 'EUR', 'exact'], 'narrow no-break space grouping');
eq(read('49.99 GBP'), [49.99, 'GBP', 'exact'], 'ISO code after');
eq(read('USD 1,050'), [1050, 'USD', 'exact'], 'ISO code before');
eq(read('GBP49'), [49, 'GBP', 'exact'], 'code glued to the number');
eq(read('£12,345,678'), [12345678, 'GBP', 'exact'], 'several thousands groups');
eq(read('£1,299'), [1299, 'GBP', 'exact'], 'comma thousands without pence');
eq(read('£12.5'), [12.5, 'GBP', 'exact'], 'single decimal digit');
eq(read('99p'), [0.99, 'GBP', 'exact'], 'pence');
eq(read('£20 - 30'), [20, 'GBP', 'from'], 'range with the symbol on one end');
eq(read('£30 to £20'), [20, 'GBP', 'from'], 'range written high to low');
eq(read('£25—£40'), [25, 'GBP', 'from'], 'em dash range');
eq(read('From £1,000'), [1000, 'GBP', 'from'], 'From with thousands');
eq(read('Was £50, now £30.00'), [30, 'GBP', 'exact'], 'was/now with punctuation');
eq(read('£30 (was £50)'), [30, 'GBP', 'exact'], 'was in brackets after');
eq(read('RRP £80 now £64.99'), [64.99, 'GBP', 'exact'], 'RRP … now');
eq(read('3 for £12'), [12, 'GBP', 'multi'], '3 for £12');
eq(read('FREE'), [0, null, 'free'], 'FREE, shouted');
eq(read('Free with code, else £5'), [5, 'GBP', 'exact'], 'a number beats the word free');
eq(read('£0'), [0, 'GBP', 'exact'], '£0 is a price, not unknown');
eq(read('Model X200 £45'), [45, 'GBP', 'exact'], 'model numbers are not prices');
eq(read('4K TV £399'), [399, 'GBP', 'exact'], '4K is not £4');
eq(read(1299.5), [1299.5, null, 'exact'], 'numbers pass through');
eq(read(-5), [null, null, 'unknown'], 'negative number is junk');
eq(read(NaN), [null, null, 'unknown'], 'NaN is junk');

// ── Junk ──
for (const junk of ['£', '—', 'n/a', 'ask in store', '   ', '£.', '..', 'price', '£abc', '{}', '[object Object]']) {
  eq(parsePrice(junk).value, null, `junk: ${JSON.stringify(junk)}`);
}
ok(parsePrice({}).value === null, 'an object does not throw');
eq(parsePrice('  £5  ').raw, '£5', 'raw is the trimmed input, not rewritten');
eq(parsePrice('Was £50 now £30').raw, 'Was £50 now £30', 'raw keeps the whole text');

// ── itemPrice: typed text + the checked price ──
{
  const i1 = itemPrice({ price: 'From £20', livePrice: { p: 18, at: '2026-10-04T12:00:00.000Z' } });
  eq([i1.value, i1.kind], [20, 'from'], 'value from the typed text');
  eq(i1.now, { value: 18, at: '2026-10-04T12:00:00.000Z', currency: 'GBP' }, 'now from livePrice');
  eq(itemPrice({ price: '£20' }).now, null, 'no livePrice → now is null (old items unchanged)');
  eq(itemPrice({ price: '£300', livePrice: { p: 3, at: 'x' } }).now, null, 'a believable misread is not shown as Now');
  eq(itemPrice({ price: '', livePrice: { p: 3, at: 'x' } }).now.value, 3, 'with no typed price, any checked price is shown');
  eq(itemPrice({ price: '£50', livePrice: { p: 'junk' } }).now, null, 'malformed livePrice ignored');
  eq(itemPrice(null).value, null, 'null item does not throw');
  eq(itemPrice({ price: '1.299,99 €', livePrice: { p: 1100, at: 'x', c: 'EUR' } }).now.currency, 'EUR', 'live currency carried');
}

// ── effectivePrice: typed wins, live fills a blank ──
eq(effectivePrice({ price: '£40', livePrice: { p: 35 } }), { value: 40, currency: 'GBP' }, 'typed wins');
eq(effectivePrice({ price: '', livePrice: { p: 35 } }), { value: 35, currency: 'GBP' }, 'live fills a blank');
eq(effectivePrice({ price: 'TBC' }), { value: null, currency: null }, 'nothing at all');

// ── totalsFor: pounds only, the rest counted ──
{
  const items = [
    { price: '£1,299.99' },
    { price: '1.299,99 €' },
    { price: '£20–£30' },
    { price: 'Was £50 now £30' },
    { price: '2 for £10' },
    { price: 'Free' },
    { price: '$49' },
    { price: '' },
    { price: 'TBC' },
    { price: '149.99' },          // no symbol: counted as pounds
    { price: '', livePrice: { p: 12.5, at: 'x' } },
    null,
  ];
  const t = totalsFor(items);
  eq(t, { sum: 1299.99 + 20 + 30 + 10 + 0 + 149.99 + 12.5, count: 11, priced: 7, unpriced: 2, otherCurrency: 2 }, 'mixed list');
  eq(t.count, t.priced + t.unpriced + t.otherCurrency, 'count adds up');
  eq(totalsFor([]), { sum: 0, count: 0, priced: 0, unpriced: 0, otherCurrency: 0 }, 'empty');
  eq(totalsFor(undefined).count, 0, 'undefined');
  // Float drift: 0.1 + 0.2 must not print as £0.30000000000000004.
  eq(totalsFor([{ price: '£0.10' }, { price: '£0.20' }]).sum, 0.3, 'rounded to pence');
}

// ── fmtGBP ──
eq(fmtGBP(12854.2), '£12,854.20', 'pennies shown when they matter');
eq(fmtGBP(12854), '£12,854', 'whole pounds otherwise');
eq(fmtGBP(12854, { pence: 'always' }), '£12,854.00', 'pence: always');
eq(fmtGBP(12854.6, { pence: 'never' }), '£12,855', 'pence: never rounds');
eq(fmtGBP(0), '£0', 'zero');
eq(fmtGBP(-5.5), '-£5.50', 'negative');
eq(fmtGBP(0.999), '£1', 'rounds to a whole pound when the pence round away');
eq(fmtGBP(null), '', 'null');
eq(fmtGBP(NaN), '', 'NaN');

// ── isSuspectMove: the bad-read bounds ──
ok(isSuspectMove(100, 5), '95% drop is suspect');
ok(!isSuspectMove(100, 10), '90% drop is the edge, believed');
ok(isSuspectMove(100, 401), '>300% rise is suspect');
ok(!isSuspectMove(100, 400), '300% rise is the edge, believed');
ok(!isSuspectMove(0, 50) && !isSuspectMove(null, 50), 'no base → never suspect');

// ── list.js goes through the same reader ──
{
  const { totalFor, fmtMoney, sortItems } = await import('./list.js');
  const items = [
    { id: '1', name: 'A', price: '£20–£30' },
    { id: '2', name: 'B', price: '1.299,99 €' },
    { id: '3', name: 'C', price: '' },
    { id: '4', name: 'D', price: '£1,299.99' },
  ];
  eq(totalFor(items), { sum: 1319.99, counted: 2, unknown: 2, unpriced: 1, otherCurrency: 1 }, 'legacy totalFor shape, new maths');
  eq(fmtMoney(1319.99), '£1,319.99', 'fmtMoney is fmtGBP for pounds');
  eq(sortItems(items, 'priceHi').map(i => i.id), ['4', '1', '2', '3'], 'price sort: € and blank sink, not read as £1.30');

  // "Recently added": addedAt when present (newest first), list position
  // for older items, which always sit below anything dated.
  const order = [
    { id: 'old1', name: 'x' },
    { id: 'old2', name: 'y' },
    { id: 'new1', name: 'z', addedAt: Date.UTC(2026, 8, 1) },
    { id: 'new2', name: 'w', addedAt: Date.UTC(2026, 9, 1) },
  ];
  eq(sortItems(order, 'added').map(i => i.id), ['new2', 'new1', 'old2', 'old1'], 'added: dated first, then list order');
  const shuffled = [order[2], order[0], order[3], order[1]];           // e.g. after a merge
  eq(sortItems(shuffled, 'added', order).map(i => i.id), ['new2', 'new1', 'old2', 'old1'], 'stable against a shuffled array');
  eq(sortItems([order[0], order[1]], 'added', order).map(i => i.id), ['old2', 'old1'], 'no addedAt anywhere → exactly today\'s order');

  // Drops sort uses priceMovement, so a misread doesn't top the list.
  const drops = [
    { id: 'real', name: 'r', priceHistory: [{ at: 'a', p: 100 }, { at: 'b', p: 80 }] },
    { id: 'misread', name: 'm', priceHistory: [{ at: 'a', p: 100 }, { at: 'b', p: 2 }] },
  ];
  eq(sortItems(drops, 'drops').map(i => i.id), ['real', 'misread'], 'a 98% "drop" is a misread, not the best deal');
}

console.log(`price: ${n} checks passed`);
