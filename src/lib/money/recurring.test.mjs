/**
 * Recurring dates that maintain themselves.
 *
 * This writes into money the user typed, so the assertions that matter
 * are the ones about restraint: forward only, dates only, and no write
 * at all when there is nothing to move.
 */
import assert from 'node:assert/strict';
import {
  nextRenewal, lastRenewal, rollSubscriptions, subsStats, toMonthly, daysUntil,
} from './recurring.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = new Date(2026, 8, 7, 14, 30);            // Mon 7 Sep 2026, afternoon
// Local, not toISOString: renewals are calendar dates, and a UTC
// conversion would shift them by a day for anyone east of Greenwich.
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── The roll itself ──
{
  eq(iso(nextRenewal({ nextDate: '2026-01-14', freq: 'month' }, NOW)), '2026-09-14',
    'a monthly bill entered in January is due this September');
  eq(iso(nextRenewal({ nextDate: '2025-11-20', freq: 'year' }, NOW)), '2026-11-20',
    'a yearly one rolls a year at a time');
  eq(iso(nextRenewal({ nextDate: '2026-09-02', freq: 'week' }, NOW)), '2026-09-09',
    'and a weekly one a week at a time');
  eq(iso(nextRenewal({ nextDate: '2026-12-01', freq: 'month' }, NOW)), '2026-12-01',
    'a future date is left exactly where it is');
  eq(nextRenewal({ freq: 'month' }, NOW), null, 'no date, no renewal');
  eq(nextRenewal({ nextDate: 'not a date', freq: 'month' }, NOW), null, 'and nonsense is not a date');
  eq(nextRenewal(null, NOW), null, 'nor is nothing');
}

// A bill due today is due today all day — the old comparison against
// the clock flipped it to "in a month" at noon.
{
  const sub = { nextDate: '2026-09-07', freq: 'month' };
  eq(iso(nextRenewal(sub, NOW)), '2026-09-07', 'due today, at half past two');
  eq(iso(nextRenewal(sub, new Date(2026, 8, 7, 23, 59))), '2026-09-07', 'and at one minute to midnight');
  eq(daysUntil(nextRenewal(sub, NOW), NOW), 0, 'which reads as due today');
}

// ── What was last charged ──
{
  eq(iso(lastRenewal({ nextDate: '2026-01-14', freq: 'month' }, NOW)), '2026-08-14',
    'the occurrence the date has just been carried past');
  eq(lastRenewal({ nextDate: '2026-12-01', freq: 'month' }, NOW), null,
    'a bill that has not been charged yet has no last charge');
  eq(lastRenewal({ nextDate: '2026-09-07', freq: 'month' }, NOW), null,
    'and neither does one due today');
}

// ── Rolling state ──
{
  const S = {
    subscriptions: [
      { id: 's1', name: 'Netflix', amount: 12.99, freq: 'month', nextDate: '2026-01-14' },
      { id: 's2', name: 'Insurance', amount: 240, freq: 'year', nextDate: '2026-11-20' },
      { id: 's3', name: 'No date', amount: 5, freq: 'month' },
    ],
  };
  const next = rollSubscriptions(S, NOW);
  ok(next !== S, 'a stale date is a reason to write');
  eq(next.subscriptions[0].nextDate, '2026-09-14', 'the stale one moved forward');
  eq(next.subscriptions[0].lastCharged, '2026-08-14', 'and says when it last went out');
  eq(next.subscriptions[0].amount, 12.99, 'the amount is untouched');
  eq(next.subscriptions[0].name, 'Netflix', 'and so is the name');
  eq(next.subscriptions[1], S.subscriptions[1], 'a future date is the same object, not a copy');
  eq(next.subscriptions[2], S.subscriptions[2], 'and a dateless row is left alone entirely');

  ok(rollSubscriptions(next, NOW) === next, 'running it again writes nothing');
  ok(rollSubscriptions({ subscriptions: [] }, NOW).subscriptions.length === 0, 'an empty list is fine');
  const bare = {};
  ok(rollSubscriptions(bare, NOW) === bare, 'and so is no list at all');
}

// It never moves a date backwards, whatever it is handed.
{
  const S = { subscriptions: [{ id: 's1', freq: 'month', nextDate: '2030-01-01' }] };
  ok(rollSubscriptions(S, NOW) === S, 'a date years out is not dragged back to now');
}

// A cadence it does not understand is left alone rather than guessed at.
{
  const S = { subscriptions: [{ id: 's1', freq: 'fortnight', nextDate: '2020-01-01' }] };
  ok(rollSubscriptions(S, NOW) === S, 'an unknown cadence is not invented');
}

// ── Stats, unchanged in behaviour from the widget's own ──
{
  const S = {
    subscriptions: [
      { id: 's1', amount: 12.99, freq: 'month', nextDate: '2026-09-14' },
      { id: 's2', amount: 240, freq: 'year', nextDate: '2026-11-20' },
      { id: 's3', amount: 5, freq: 'week', nextDate: '2026-09-08' },
      { id: 's4', amount: 9, freq: 'month' },
    ],
  };
  const { monthly, upcoming, all } = subsStats(S, NOW);
  eq(Math.round(monthly * 100) / 100, Math.round((12.99 + 20 + 5 * 52 / 12 + 9) * 100) / 100,
    'monthly burn normalises every cadence');
  eq(upcoming.map(x => x.id), ['s3', 's1', 's2'], 'upcoming is in date order');
  eq(all.length, 4, 'and the full list keeps the undated row so it can still be removed');
  eq(toMonthly(52, 'week'), 52 * 52 / 12, 'weekly to monthly is 52/12, not 4');
}

console.log(`recurring money: ${n} assertions passed`);
