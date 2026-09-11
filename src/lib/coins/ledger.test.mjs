/**
 * The wallet's recent rows.
 *
 * What can go wrong here is ordering and dates. A list that trusts
 * arrival order shows a March entry above this morning's the first time
 * a writer appends instead of prepends; a "yesterday" computed by
 * subtracting a day of milliseconds is wrong twice a year.
 */
import assert from 'node:assert/strict';
import { ledgerRows, whenLabel, amountLabel, kindLabel } from './ledger.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = new Date(2026, 8, 11, 13, 22);            // Fri 11 Sep 2026, 13:22
const at = (h, mi = 0, dayOffset = 0) =>
  new Date(2026, 8, 11 + dayOffset, h, mi).getTime();

// ── When ──
{
  eq(whenLabel(at(9, 12), NOW), '09:12', 'today reads as a clock');
  eq(whenLabel(at(23, 5, -1), NOW), 'Yest', 'yesterday reads as a word');
  // The month's abbreviation comes from the platform's locale data
  // ("Sep" or "Sept" depending on the ICU build), so assert the shape
  // rather than pinning a spelling that differs between Node and a
  // browser for no behavioural reason.
  ok(/^9 Sept?$/.test(whenLabel(at(10, 0, -2), NOW)), 'earlier this year, a day and a month');
  ok(/^3 Mar 25$/.test(whenLabel(new Date(2025, 2, 3, 10).getTime(), NOW)),
    'a previous year carries the year, or March last reads as March this');
  eq(whenLabel(null, NOW), '—', 'and no timestamp says so rather than guessing');
}

// The clocks change on the last Sunday of October; a "yesterday" built by
// subtracting 86_400_000ms from Sunday lands at 23:00 on Friday.
{
  const sundayAfterChange = new Date(2026, 9, 25, 10, 0);   // Sun 25 Oct 2026
  const saturday = new Date(2026, 9, 24, 23, 30).getTime();
  eq(whenLabel(saturday, sundayAfterChange), 'Yest',
    'the day the clocks go back, yesterday is still yesterday');
}

// ── Amount and kind ──
{
  eq(amountLabel(10), '+10', 'earnings carry a plus');
  eq(amountLabel(-75), '−75', 'spends a true minus sign');
  ok(!amountLabel(-75).includes('-'), 'not a hyphen — it sits on the wrong line beside a plus');
  eq(amountLabel(4000), '+4,000', 'and thousands are grouped');

  eq(kindLabel({ type: 'spend', amount: -75 }), 'Spent', 'type is authoritative');
  eq(kindLabel({ type: 'refund', amount: 75 }), 'Refund', 'including refunds');
  eq(kindLabel({ amount: -75 }), 'Spent', 'and the sign covers an entry that forgot to say');
  eq(kindLabel({ amount: 75 }), 'Earned', 'in both directions');
}

// ── Order ──
{
  const h = [
    { type: 'earn', label: 'Old', amount: 5, ts: at(9, 0, -30) },
    { type: 'earn', label: 'Newest', amount: 10, ts: at(12, 0) },
    { type: 'spend', label: 'Middle', amount: -75, ts: at(9, 0, -1) },
  ];
  eq(ledgerRows(h, NOW).map(r => r.label), ['Newest', 'Middle', 'Old'],
    'newest first, whatever order the writers left it in');
}

{
  const h = [
    { label: 'Undated', amount: 100 },
    { label: 'Dated', amount: 1, ts: at(9) },
  ];
  eq(ledgerRows(h, NOW).map(r => r.label), ['Dated', 'Undated'],
    'an entry we cannot place in time sinks rather than claiming the top');
}

{
  // Two written in the same millisecond keep the order they arrived in,
  // so the list does not shuffle between renders.
  const t = at(9);
  const h = [{ label: 'A', amount: 1, ts: t }, { label: 'B', amount: 2, ts: t }];
  eq(ledgerRows(h, NOW).map(r => r.label), ['A', 'B'], 'same instant, as given');
}

// ── The limit ──
{
  const h = [];
  for (let i = 0; i < 500; i++) h.push({ label: `E${i}`, amount: 1, ts: at(9) - i * 1000 });
  eq(ledgerRows(h, NOW).length, 6, 'six by default');
  eq(ledgerRows(h, NOW, 3).length, 3, 'or as many as asked for');
  eq(ledgerRows(h, NOW, 0).length, 0, 'or none');
  eq(ledgerRows(h, NOW)[0].label, 'E0', 'and they are the newest six');
}

// ── Rubbish in the ledger ──
{
  const h = [
    null,
    { label: 'Fine', amount: 10, ts: at(9) },
    { label: 'No amount', ts: at(10) },
    { label: 'Amount is words', amount: 'loads', ts: at(10) },
    { amount: 20, ts: at(11) },
    { label: '   ', amount: 30, ts: at(11, 30) },
  ];
  const rows = ledgerRows(h, NOW);
  eq(rows.length, 3, 'entries with no usable amount are dropped, not shown as zero');
  eq(rows.map(r => r.label), ['Adjustment', 'Adjustment', 'Fine'],
    'a missing or blank label gets a word rather than an empty row');
  eq(ledgerRows(null, NOW), [], 'and no history at all is not a crash');
}

// ── The shape the popover renders ──
{
  const rows = ledgerRows([{ type: 'spend', label: 'Canvas preset', amount: -75, ts: at(9, 12, -1) }], NOW);
  eq(rows[0].kind, 'Spent', 'kind');
  eq(rows[0].label, 'Canvas preset', 'label');
  eq(rows[0].when, 'Yest', 'when');
  eq(rows[0].amountLabel, '−75', 'amount');
  eq(rows[0].up, false, 'and which way it went, for the colour');
}

console.log(`coin ledger: ${n} assertions passed`);
