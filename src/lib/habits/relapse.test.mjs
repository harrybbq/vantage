/**
 * Logging a relapse.
 *
 * The risk is not the arithmetic — it is what a relapse quietly takes
 * with it. It restarts a timer somebody may have been watching for
 * months, and it re-arms milestones that pay coins. Both are one-way.
 * So the cases worth pinning are the ones where it should do NOTHING,
 * and the one where it must not touch what the user decided.
 */
import assert from 'node:assert/strict';
import { applyRelapse } from './relapse.js';
import { periodStart } from './strikes.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = Date.now();
const DAY = 86_400_000;

const base = () => ({
  coins: 400,
  habits: [
    {
      id: 'h1',
      name: 'No nicotine',
      startTime: NOW - 30 * DAY,
      relapseCount: 2,
      strikesPeriod: 'week',
      strikesAllowed: 1,
      strikeTimes: [],
      milestones: [
        { id: 'm1', label: '1 week', duration: 7 * DAY, coins: 50, awarded: true },
        { id: 'm2', label: '1 month', duration: 30 * DAY, coins: 200, awarded: true },
        { id: 'm3', label: '1 year', duration: 365 * DAY, coins: 1000, awarded: false },
      ],
    },
    { id: 'h2', name: 'Someone else’s habit', startTime: NOW - DAY, relapseCount: 0 },
  ],
});

// ── The write ──
{
  const at = NOW - 3600_000;                       // an hour ago
  const next = applyRelapse(base(), 'h1', at);
  const h = next.habits.find(x => x.id === 'h1');
  eq(h.startTime, at, 'the timer restarts from when it happened, not from when it was admitted');
  eq(h.relapseCount, 3, 'and the count goes up by one');
  eq(h.strikeTimes, [at], 'the strike is banked, so a 1-a-week card reads 1/1 rather than 0/1');
  ok(h.milestones.every(m => !m.awarded), 'every milestone is re-armed — a week clean has to pay again');
  eq(h.milestones.map(m => m.label), ['1 week', '1 month', '1 year'], 'but the milestones themselves are untouched');
  eq(h.milestones.map(m => m.coins), [50, 200, 1000], 'including what they pay');
  eq(h.name, 'No nicotine', 'and so is the name');
  eq(h.strikesAllowed, 1, 'and the allowance the user set');

  eq(next.habits.find(x => x.id === 'h2'), base().habits[1], 'no other habit is touched');
  eq(next.coins, 400, 'and nothing outside habits is either — a relapse pays no coins and takes none');
}

// ── Strikes: this period's, not every period's ──
{
  const s = base();
  const thisPeriod = periodStart('week', Date.now()) + 3600_000;
  s.habits[0].strikeTimes = [NOW - 40 * DAY, NOW - 21 * DAY, thisPeriod];
  const at = NOW - 60_000;
  const h = applyRelapse(s, 'h1', at).habits[0];
  eq(h.strikeTimes, [thisPeriod, at],
    'strikes from spent periods are dropped — they can never count again and the state blob is already ~1MB');
}

{
  // 'ever' never replenishes, so nothing is ever dropped.
  const s = base();
  s.habits[0].strikesPeriod = 'ever';
  s.habits[0].strikeTimes = [NOW - 400 * DAY];
  const h = applyRelapse(s, 'h1', NOW).habits[0];
  eq(h.strikeTimes.length, 2, 'an "ever" allowance keeps the lot');
}

// ── Doing nothing, by identity ──
{
  const s = base();
  ok(applyRelapse(s, 'nope', NOW) === s, 'a habit that does not exist changes nothing');
  ok(applyRelapse(s, null, NOW) === s, 'and neither does no id at all');
  ok(applyRelapse(s, 'h1', null) === s, 'a missing timestamp is not "now" — it is nothing');
  ok(applyRelapse(s, 'h1', 'yesterday') === s, 'nor is a timestamp that is not a number');
  ok(applyRelapse(s, 'h1', 0) === s, 'nor the epoch, which is what a failed parse looks like');
  const empty = {};
  ok(applyRelapse(empty, 'h1', NOW) === empty, 'a state with no habits is handed back untouched');
  ok(applyRelapse(null, 'h1', NOW) === null, 'and no state at all is not a crash');
  // Identity matters: the save pipeline treats an unchanged object as a
  // no-op, so a misfired click must not queue a write of the whole blob.
  ok(applyRelapse(s, 'h1', NOW) !== s, 'a real relapse DOES produce a new object');
}

// ── A habit with nothing set up on it ──
{
  const bare = { habits: [{ id: 'b1', name: 'Bare' }] };
  const h = applyRelapse(bare, 'b1', NOW).habits[0];
  eq(h.relapseCount, 1, 'a first relapse counts from zero, not from undefined');
  eq(h.strikeTimes, [NOW], 'and starts the strike list');
  eq(h.milestones, [], 'with no milestones to re-arm');
}

console.log(`habit relapse: ${n} assertions passed`);
