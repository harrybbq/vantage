/**
 * Today's coin movement.
 *
 * The risk here is not the arithmetic, it is the boundaries: an entry
 * from just before midnight counted as today, or a history written
 * before the `ts` field existed being attributed wholesale to this
 * morning. Both would be a number the user knows is wrong.
 */
import assert from 'node:assert/strict';
import { coinsToday, coinsTodayLabel } from './daily.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = new Date(2026, 8, 11, 12, 52);          // Fri 11 Sep 2026, 12:52
const at = (h, mi = 0, dayOffset = 0) =>
  new Date(2026, 8, 11 + dayOffset, h, mi).getTime();

// ── The sum ──
{
  const h = [
    { type: 'earn', label: 'Gym', amount: 15, ts: at(9) },
    { type: 'earn', label: 'Deposit', amount: 20, ts: at(11, 30) },
    { type: 'refund', label: 'Gym reversed', amount: -5, ts: at(12) },
  ];
  eq(coinsToday(h, NOW), 30, 'earned and given back, netted');
  eq(coinsTodayLabel(h, NOW), '+30', 'and shown with a sign');
}

{
  const h = [{ amount: -12, ts: at(10) }];
  eq(coinsToday(h, NOW), -12, 'a day that went backwards');
  eq(coinsTodayLabel(h, NOW), '−12', 'reads with a true minus sign');
  ok(!coinsTodayLabel(h, NOW).includes('-'), 'not a hyphen — it sits on the wrong line beside a plus');
}

// ── Nothing to say ──
{
  eq(coinsToday([], NOW), 0, 'no history, no movement');
  eq(coinsToday(null, NOW), 0, 'and no history at all is not a crash');
  eq(coinsTodayLabel([], NOW), null, 'a flat day has no label rather than "+0"');
  eq(coinsTodayLabel([{ amount: 5, ts: at(9) }, { amount: -5, ts: at(10) }], NOW), null,
    'and neither does one that earned and gave back the same');
}

// ── Boundaries ──
{
  const h = [
    { amount: 100, ts: at(23, 59, -1) },   // one minute before midnight
    { amount: 7, ts: at(0, 0) },           // the stroke of midnight
    { amount: 200, ts: at(0, 0, 1) },      // tomorrow
  ];
  eq(coinsToday(h, NOW), 7, 'only the entries inside today count');

  // Midday is the safest hour to reason about; check the edges directly.
  eq(coinsToday([{ amount: 3, ts: at(23, 59) }], NOW), 3, 'the last minute of today counts');
  eq(coinsToday([{ amount: 3, ts: at(0, 0) }], NOW), 3, 'and the first');
}

// ── Rubbish in the ledger ──
{
  const h = [
    { amount: 10, ts: at(9) },
    { amount: 10 },                        // predates the ts field
    { amount: 10, ts: null },
    { amount: 10, ts: 0 },
    { amount: 10, ts: 'this morning' },
    { amount: 'loads', ts: at(9) },
    null,
    { ts: at(9) },
  ];
  eq(coinsToday(h, NOW), 10, 'an entry with no usable timestamp is skipped, not assumed to be today');
}

// A very long history is summed without complaint.
{
  const h = [];
  for (let i = 0; i < 5000; i++) h.push({ amount: 1, ts: at(0, 0, -i % 30) });
  eq(coinsToday(h, NOW), Math.ceil(5000 / 30), 'only today’s slice of a five-thousand-entry ledger');
}

console.log(`coins today: ${n} assertions passed`);
