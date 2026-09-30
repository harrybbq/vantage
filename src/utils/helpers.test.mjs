/**
 * getWeekKey keys persisted state (the weekly-coin awards), so the test
 * holds it to the OLD implementation for every day where the old one was
 * right — a changed key mid-year would re-award a week already paid —
 * and to ISO 8601 at the New Year edges where it was wrong.
 *
 * Runs in several time zones (Node re-reads process.env.TZ when it is
 * assigned), so the fix is shown not to depend on where it runs.
 */
import assert from 'node:assert/strict';
import { getWeekKey, trackerWeeklyCoins, WEEKLY_COINS_MAX } from './helpers.js';

let n = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// The previous implementation, verbatim.
function oldWeekKey(dateStr) {
  const d = new Date(dateStr);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d - startOfWeek1;
  const week = Math.floor(diff / 604800000) + 1;
  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
}

const pad = x => String(x).padStart(2, '0');
const ymd = dt => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;

function inZone(tz) {
  process.env.TZ = tz;
  // ── Known ISO weeks ──
  const known = {
    '2026-09-30': '2026-W40',   // the deploy week — must not move
    '2026-09-28': '2026-W40',   // a Monday
    '2026-10-04': '2026-W40',   // a Sunday
    '2027-01-01': '2026-W53',   // Friday → previous ISO year's W53
    '2027-01-03': '2026-W53',
    '2027-01-04': '2027-W01',
    '2025-12-29': '2026-W01',   // Monday → next ISO year's W01
    '2025-12-28': '2025-W52',
    '2026-01-01': '2026-W01',
    '2020-12-31': '2020-W53',
    '2021-01-03': '2020-W53',
    '2024-12-30': '2025-W01',
    '2026-03-30': '2026-W14',   // the Monday after the UK clocks go forward
    '2026-10-26': '2026-W44',   // the Monday after they go back
  };
  for (const [d, w] of Object.entries(known)) eq(getWeekKey(d), w, `${d} is ${w}`);

  // ── Byte-identical to the old keys wherever the old ones were right ──
  // The old version was right in UK time (the owner's) for every day
  // outside the New Year edge weeks; compare only where it was right.
  if (tz === 'Europe/London' || tz === 'UTC') {
    let compared = 0;
    for (let y = 2024; y <= 2027; y++) {
      for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86_400_000) {
        const d = ymd(new Date(t));
        const mo = +d.slice(5, 7), da = +d.slice(8, 10);
        if ((mo === 1 && da <= 7) || (mo === 12 && da >= 25)) continue;
        eq(getWeekKey(d), oldWeekKey(d), `${d}: unchanged from the old key`);
        compared++;
      }
    }
    ok(compared > 1300, 'compared four years of days');
  }

  // ── Every week has exactly seven days ──
  {
    const byKey = new Map();
    for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2027, 11, 27); t += 86_400_000) {
      const k = getWeekKey(ymd(new Date(t)));
      byKey.set(k, (byKey.get(k) || 0) + 1);
    }
    const partial = [...byKey.entries()].filter(([, c]) => c !== 7);
    eq(partial.length, 0, 'every ISO week in range has exactly seven days: ' + partial.map(p => p.join('=')).join(','));
  }

  // ── A Date argument means its local calendar day ──
  eq(getWeekKey(new Date(2027, 0, 1, 23, 30)), '2026-W53', 'a Date is read as its local day');
}
for (const tz of ['Europe/London', 'UTC', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata']) inZone(tz);

// ── Weekly-coin cap ──
eq(WEEKLY_COINS_MAX, 50, 'cap is 50');
eq(trackerWeeklyCoins({ weeklyCoins: 15 }), 15, 'normal values pass');
eq(trackerWeeklyCoins({ weeklyCoins: 5000 }), 50, 'huge values are capped at read time');
eq(trackerWeeklyCoins({ weeklyCoins: '30' }), 30, 'strings from old forms are read');
eq(trackerWeeklyCoins({ weeklyCoins: -10 }), 0, 'negatives pay nothing');
eq(trackerWeeklyCoins({}), 0, 'absent pays nothing');
eq(trackerWeeklyCoins({ weeklyCoins: 12.9 }), 12, 'fractions floor');

console.log(`helpers (week keys in 5 zones, coin cap): ${n} checks passed`);
