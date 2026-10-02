/**
 * Chart scaling: zero-based, clean tops, nothing dropped.
 */
import assert from 'node:assert/strict';
import { niceMax, ticks, tickCount, stack, sparkPath, labelEvery, barWidth, bucketLabel, RANGES, rangeHours, rangeText } from './chart.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

eq(niceMax(0), 1, 'zero → 1');
eq(niceMax(null), 1, 'missing → 1');
eq(niceMax(7), 10, '7 → 10');
eq(niceMax(10), 10, 'exact stays');
eq(niceMax(11), 20, '11 → 20');
eq(niceMax(23), 25, '23 → 25');
eq(niceMax(240), 250, '240 → 250');
eq(niceMax(3800), 5000, '3800 → 5000');
eq(niceMax(0.3), 0.5, 'fractions');

eq(ticks(100, 4), [0, 25, 50, 75, 100], 'ticks');
eq(ticks(0), [0], 'no range');
eq(ticks(5000, tickCount(5000)), [0, 1000, 2000, 3000, 4000, 5000], 'round steps for 5×');
eq(ticks(2000, tickCount(2000)), [0, 500, 1000, 1500, 2000], 'round steps for 2×');
eq(ticks(250, tickCount(250)), [0, 50, 100, 150, 200, 250], 'round steps for 2.5×');
eq(ticks(10, tickCount(10)), [0, 2, 4, 6, 8, 10], 'round steps for 1×');

{
  const s = stack([
    { t: 'a', rest: 10, auth: 2, storage: null, realtime: 1 },
    { t: 'b', rest: '30', auth: -4, storage: 5, realtime: 0 },
    null,
    { t: 'c' },
  ], ['rest', 'auth', 'storage', 'realtime']);
  eq(s.rows.length, 3, 'junk rows skipped, empty rows kept');
  eq(s.rows.map(r => r.total), [13, 35, 0], 'totals (negatives count 0)');
  eq(s.rows[1].segs.map(x => [x.y0, x.y1]), [[0, 30], [30, 30], [30, 35], [35, 35]], 'segments stack from zero');
  eq(s.max, 50, 'axis top is nice max of tallest stack');
  eq(s.totals, { rest: 40, auth: 2, storage: 5, realtime: 1 }, 'per-key totals');
  eq(s.grand, 48, 'grand total');
  eq(stack(undefined, ['rest']).rows, [], 'no series');
}

{
  const p = sparkPath([0, 5, 10], 100, 20, 10, 0);
  eq(p.line, 'M0.0,20.0L50.0,10.0L100.0,0.0', 'zero-based line to scale');
  ok(p.area.endsWith('Z'), 'area closed');
  eq(p.last, { x: 100, y: 0 }, 'last point');
  const gap = sparkPath([1, null, 1], 100, 20, 2, 0);
  eq((gap.line.match(/M/g) || []).length, 2, 'null starts a new sub-path');
  eq(sparkPath([], 10, 10).line, '', 'empty');
  eq(sparkPath([5], 10, 10, 10, 0).last.x, 5, 'single point centred');
  const over = sparkPath([20], 10, 10, 10, 0);
  eq(over.last.y, 0, 'over-max clamps to the top');
}

eq(labelEvery(4, 6), [0, 1, 2, 3], 'few buckets: all labelled');
const le = labelEvery(24, 6);
ok(le.length <= 6 && le[le.length - 1] === 23, `many buckets: ≤6 labels, last included (${le})`);
eq(labelEvery(0), [], 'none');
eq(barWidth(40), 24, 'capped at 24');
eq(barWidth(10), 8, 'band minus the 2px gap');
eq(barWidth(1), 1, 'never below 1');
eq(bucketLabel(null), '', 'no time');
ok(/^\d\d:00$/.test(bucketLabel('2026-10-02T14:00:00Z', 24)), 'hourly label');
ok(/Oct/.test(bucketLabel('2026-10-02T14:00:00Z', 168)), 'daily label');

ok(/^\d\d:\d\d$/.test(bucketLabel('2026-10-02T14:25:00Z', 1)) && !bucketLabel('2026-10-02T14:25:00Z', 1).endsWith(':00'), 'minute label for short ranges');
eq(RANGES.map(r => r.id), ['15min', '1hr', '3hr', '1day', '7day'], 'exact Supabase interval enum');
eq(rangeHours('3hr'), 3, 'range hours');
eq(rangeHours('bogus'), 24, 'unknown range → 1 day');
{
  const now = new Date(2026, 9, 2, 14, 22).getTime();
  eq(rangeText('1hr', now), '2 Oct 13:22 – 14:22', 'same-day range');
  ok(/^25 Sept? 14:22 – 2 Oct 14:22$/.test(rangeText('7day', now)), `multi-day range (${rangeText('7day', now)})`);
}

console.log(`security chart: ${n} checks passed`);
