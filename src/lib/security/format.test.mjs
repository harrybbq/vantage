/**
 * The console's formatters. The rule that matters most: a value that
 * isn't there reads as "—", never as 0 or NaN.
 */
import assert from 'node:assert/strict';
import { num, fmtInt, fmtCompact, fmtPct, fmtBytes, fmtDuration, fmtMs, ago, fmtAge, clock, shortSha, plural, NONE } from './format.js';

let n = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

// ── Missing is a dash, everywhere ──
for (const bad of [null, undefined, '', 'abc', NaN, Infinity, true]) {
  eq(num(bad), null, `num(${String(bad)})`);
  eq(fmtInt(bad), NONE, `fmtInt(${String(bad)})`);
  eq(fmtCompact(bad), NONE, `fmtCompact(${String(bad)})`);
  eq(fmtPct(bad), NONE, `fmtPct(${String(bad)})`);
  eq(fmtBytes(bad), NONE, `fmtBytes(${String(bad)})`);
  eq(fmtDuration(bad), NONE, `fmtDuration(${String(bad)})`);
  eq(fmtMs(bad), NONE, `fmtMs(${String(bad)})`);
  eq(ago(bad), NONE, `ago(${String(bad)})`);
}
eq(fmtBytes(-1), NONE, 'negative bytes');
eq(fmtDuration(-5), NONE, 'negative duration');
eq(num('42.5'), 42.5, 'numeric string');
eq(num(0), 0, 'zero is a value');
eq(fmtInt(0), '0', 'zero prints as 0');

// ── Numbers ──
eq(fmtInt(1234567), '1,234,567', 'thousands');
eq(fmtCompact(950), '950', 'under 1k');
eq(fmtCompact(1234), '1.2k', 'k');
eq(fmtCompact(1000), '1k', 'no trailing .0');
eq(fmtCompact(123456), '123k', 'three digits drop the decimal');
eq(fmtCompact(999_999), '1M', 'rounds up a unit, not "1000k"');
eq(fmtCompact(4_560_000), '4.6M', 'M');
eq(fmtPct(45.67), '45.7%', 'one dp');
eq(fmtPct(80), '80%', 'whole');
eq(fmtPct(99.95, 2), '99.95%', 'two dp');

// ── Bytes ──
eq(fmtBytes(0), '0 B', 'zero bytes');
eq(fmtBytes(512), '512 B', 'bytes');
eq(fmtBytes(1536), '1.5 KB', 'KB');
eq(fmtBytes(1024 * 1024 * 312), '312 MB', 'MB, no decimal over 100');
eq(fmtBytes(1024 ** 3 * 8.25), '8.3 GB', 'GB');

// ── Durations ──
eq(fmtDuration(42), '42s', 'seconds');
eq(fmtDuration(60), '1m', 'a minute');
eq(fmtDuration(95), '1m 35s', 'min + sec');
eq(fmtDuration(3725), '1h 2m', 'h + m');
eq(fmtDuration(7200), '2h', 'whole hours');
eq(fmtDuration(266400), '3d 2h', 'days');
eq(fmtMs(640), '640 ms', 'ms');
eq(fmtMs(2400), '2.4 s', 's');
eq(fmtMs(3000), '3 s', 'whole s');

// ── Ago ──
{
  const now = Date.parse('2026-10-02T12:00:00Z');
  eq(ago('2026-10-02T12:00:00Z', now), 'just now', 'now');
  eq(ago('2026-10-02T12:00:30Z', now), 'just now', 'future (clock skew) is just now');
  eq(ago('2026-10-02T11:59:48Z', now), '12s ago', 'seconds');
  eq(ago('2026-10-02T11:55:00Z', now), '5m ago', 'minutes');
  eq(ago('2026-10-02T09:00:00Z', now), '3h ago', 'hours');
  eq(ago('2026-09-30T12:00:00Z', now), '2d ago', 'days');
  const old = ago(now - 20 * 86400000, now);
  eq(/^12 Sep/.test(old), true, `old → date (${old})`);
}

{
  const now = Date.parse('2026-10-02T12:00:00Z');
  eq(fmtAge('2026-10-02T11:59:15Z', now), '45s', 'age s');
  eq(fmtAge('2026-10-02T07:00:00Z', now), '5h', 'age h');
  eq(fmtAge('2026-09-29T12:00:00Z', now), '3d', 'age d');
  eq(fmtAge('2026-06-01T12:00:00Z', now), '4mo', 'age mo');
  eq(fmtAge('2024-01-01T00:00:00Z', now), '2y', 'age y');
  eq(fmtAge(null), NONE, 'age missing');
  eq(clock(new Date(2026, 9, 2, 9, 5).getTime()), '09:05', 'clock');
  eq(clock(null), '', 'clock missing');
}

eq(shortSha('a1b2c3d4e5f6'), 'a1b2c3d', 'sha');
eq(shortSha(null), '', 'no sha');
eq(plural(1, 'ticket'), '1 ticket', 'singular');
eq(plural(3, 'ticket'), '3 tickets', 'plural');
eq(plural(null, 'ticket'), '0 tickets', 'missing count is zero tickets');

console.log(`security format: ${n} checks passed`);
