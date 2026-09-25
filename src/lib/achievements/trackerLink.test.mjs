/**
 * Tracker-linked achievements: the counting rules, pinned.
 * Run: node src/lib/achievements/trackerLink.test.mjs
 */
import assert from 'node:assert/strict';
import { linkProgress, linkProgressMap, readLink, weekStart } from './trackerLink.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const gym = { id: 'gym', name: 'Gym', type: 'boolean' };
const water = { id: 'w', name: 'Water', type: 'number', goal: 90 };
const logsFor = (id, days, val = true) => Object.fromEntries(days.map(t => [ymd(new Date(t)), { [id]: val }]));
// Mon 2026-09-07 .. Sun 09-13, Mon 09-14 ..., Mon 09-21 ...
const MON = [at(2026, 9, 7), at(2026, 9, 14), at(2026, 9, 21), at(2026, 9, 28)];
const days = (mon, k) => Array.from({ length: k }, (_, i) => mon + i * 86400000);

// ── No link, bad link ──
eq(linkProgress({ id: 'a' }, [gym], {}), null, 'no link → null');
eq(readLink({ link: { mode: 'weekly' } }), null, 'a link with no tracker is no link');
const gone = linkProgress({ link: { trackerId: 'x', since: MON[0] } }, [gym], {}, MON[1]);
ok(gone.missing && !gone.met, 'a deleted tracker reads as missing, never met');

// ── weekStart is Monday ──
eq(ymd(weekStart(at(2026, 9, 10))), '2026-09-07', 'Thursday belongs to the Monday before');
eq(ymd(weekStart(at(2026, 9, 13))), '2026-09-07', 'Sunday belongs to the Monday before');
eq(ymd(weekStart(at(2026, 9, 14))), '2026-09-14', 'Monday starts its own week');

// ── Weekly: 5x a week for 3 weeks, linked on a Monday ──
{
  const ach = { link: { trackerId: 'gym', mode: 'weekly', perWeek: 5, weeks: 3, since: MON[0] } };
  const logs = logsFor('gym', [...days(MON[0], 5), ...days(MON[1], 5), ...days(MON[2], 5)]);
  const p = linkProgress(ach, [gym], logs, at(2026, 9, 26));
  ok(p.met && p.done === 3 && p.pct === 100, 'three full weeks meets a three-week goal');

  const mid = linkProgress(ach, [gym], logsFor('gym', [...days(MON[0], 5), ...days(MON[1], 2)]), at(2026, 9, 16));
  eq([mid.done, mid.met, mid.thisWeek.hits], [1, false, 2], 'the week in progress is never a miss');

  const broken = linkProgress(ach, [gym], logsFor('gym', [...days(MON[0], 5), ...days(MON[1], 3), ...days(MON[2], 5)]), at(2026, 9, 27));
  eq([broken.done, broken.met], [1, false], 'a missed full week resets the run — weekly is strict');
}

// ── Weekly, linked mid-week: the first part-week is grace ──
{
  const thu = at(2026, 9, 10, 9);
  const ach = { link: { trackerId: 'gym', mode: 'weekly', perWeek: 5, weeks: 2, since: thu } };
  const logs = logsFor('gym', [thu, ...days(MON[1], 5), ...days(MON[2], 5)]);
  const p = linkProgress(ach, [gym], logs, at(2026, 9, 27));
  ok(p.met, 'a part-week at the start is not a miss');
  const early = logsFor('gym', [at(2026, 9, 8)]);           // Tuesday, before the link
  const q = linkProgress(ach, [gym], early, at(2026, 9, 12));
  eq(q.thisWeek.hits, 0, 'logs before the link was made do not count');
}

// ── Count: any pattern ──
{
  const ach = { link: { trackerId: 'gym', mode: 'count', count: 8, since: MON[0] } };
  const logs = logsFor('gym', [...days(MON[0], 2), ...days(MON[2], 3), ...days(MON[3], 3)]);
  const p = linkProgress(ach, [gym], logs, at(2026, 10, 4));
  ok(p.met && p.done === 8, 'eight logs spread over a month meets a count of eight');
  const q = linkProgress(ach, [gym], logsFor('gym', days(MON[0], 3)), at(2026, 9, 20));
  eq([q.done, q.pct, q.met], [3, 38, false], 'count progress is logs over target');
  const over = linkProgress(ach, [gym], logsFor('gym', days(MON[0], 20)), at(2026, 10, 4));
  eq(over.done, 8, 'done never reads above the target');
}

// ── Number trackers count any amount as a day done ──
{
  const ach = { link: { trackerId: 'w', mode: 'count', count: 3, since: MON[0] } };
  const logs = { ...logsFor('w', days(MON[0], 2), 1.5), [ymd(new Date(MON[0] + 2 * 86400000))]: { w: 0 } };
  eq(linkProgress(ach, [water], logs, MON[1]).done, 2, 'zero is not a log; any positive amount is');
}

// ── Unticking takes progress back (derived, not stored) ──
{
  const ach = { link: { trackerId: 'gym', mode: 'count', count: 5, since: MON[0] } };
  const logs = logsFor('gym', days(MON[0], 5));
  ok(linkProgress(ach, [gym], logs, MON[1]).met, 'five logs meet five');
  delete logs[ymd(new Date(MON[0]))];
  ok(!linkProgress(ach, [gym], logs, MON[1]).met, 'untick one day and it is no longer met');
}

// ── The map skips completed and unlinked ──
{
  const map = linkProgressMap([
    { id: 'a', link: { trackerId: 'gym', since: MON[0] } },
    { id: 'b' },
    { id: 'c', completed: true, link: { trackerId: 'gym', since: MON[0] } },
  ], [gym], {}, MON[1]);
  eq(Object.keys(map), ['a'], 'only open, linked achievements are derived');
}

// ── Clamps ──
eq(readLink({ link: { trackerId: 'g', perWeek: 12, weeks: 0 } }).perWeek, 7, 'perWeek caps at 7');
eq(readLink({ link: { trackerId: 'g', perWeek: 12, weeks: 0 } }).weeks, 4, 'a zero week count falls back to the default');

console.log(`tracker links: ${n} assertions passed`);
