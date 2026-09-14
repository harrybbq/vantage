/**
 * The shape of the ladder.
 *
 * Every other rating test checks that a source pays what it says it
 * pays. None of them could tell you whether the game is worth playing —
 * and that is the failure this file exists to catch, because it has now
 * happened twice.
 *
 * The first time, RATING_SCALE was 1: a committed year reached OVR 24,
 * three of the four categories froze in the low twenties permanently,
 * and OVR 99 — where Prestige unlocks — was unreachable by anyone, ever.
 * Two thirds of the number the whole app is built around were decorative
 * and every unit test passed.
 *
 * The second time, at 6, the numbers moved but the middle of the ladder
 * took three weeks a level. "I've been on 29 for a fortnight" is the
 * correct reading of that.
 *
 * So: simulate a real person over real time and assert the curve. The
 * bounds are deliberately wide — this is not pinning today's arithmetic,
 * it is refusing to ship a ladder nobody can climb, or one that hands
 * out the top in a month.
 *
 * The profile is a committed user, not a maximal one: trackers in all
 * four categories logged six days in seven, vitals and burn daily, a
 * dozen genuine achievements spaced over the period, a pot being paid
 * into, twelve friends. Someone doing the thing the app asks.
 */
import assert from 'node:assert/strict';
import { deriveRatings } from './derive.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const between = (v, lo, hi, m) => {
  assert.ok(v >= lo && v <= hi, `${m} — got ${v}, wanted ${lo}–${hi}`);
  n++;
};

const DAY = 86_400_000;
const CATS = ['brain', 'finance', 'fitness', 'social'];
const ymd = d => new Date(d).toISOString().slice(0, 10);

function committedFor(days, now = Date.now()) {
  const trackers = CATS.map(c => ({ id: 't-' + c, category: c, type: 'boolean' }));
  const logs = {}, vitalsLog = {}, burnLog = {};
  for (let i = 0; i < days; i++) {
    if (i % 7 === 6) continue;                       // a day off a week
    const key = ymd(now - i * DAY);
    logs[key] = {};
    for (const t of trackers) logs[key][t.id] = true;
    vitalsLog[key] = { weight: 80, sleep: 7.5 };
    burnLog[key] = [{ kcal: 500 }];
  }
  const achievements = [];
  for (let i = 0; i < Math.min(12, Math.floor(days / 25)); i++) {
    achievements.push({
      category: CATS[i % 4],
      completed: true,
      createdAt: now - (days - i * 20) * DAY,
      completedAt: now - (days - i * 20 - 10) * DAY,   // 10 days apart: spacing rule passes
    });
  }
  return {
    trackers, logs, vitalsLog, burnLog, achievements,
    savings: [{ target: 30000, current: Math.min(30000, days * 30) }],
    brainScore: { result: 108 }, financeScore: { result: 104 },
    fitnessScore: { result: 112 }, socialScore: { result: 100 },
    visions: {},
  };
}

const rate = days => deriveRatings(committedFor(days), {
  friendCount: 12,
  macroDays: Math.floor(days * 0.6),
}).ovr;

// ── The climb, at the milestones that matter ──
{
  between(rate(30), 16, 26, 'a first month should feel like it went somewhere');
  between(rate(180), 30, 45, 'six months in, comfortably past the floor');
  between(rate(365), 42, 58, 'a committed year lands in the middle of the scale');
  between(rate(730), 58, 78, 'two years is clearly up the board');
}

// ── The top is earned, not handed out ──
{
  ok(rate(90) < 40, 'three months does not buy the Mid band');
  ok(rate(365) < 80, 'and a year does not buy Elite');
  ok(rate(730) < 99, 'nor does two years buy Prestige');
  between(rate(2555), 95, 99, 'but seven years of it does — 99 has to be reachable, or Prestige is decoration');
}

// ── Nobody waits three weeks for a number to move ──
// This is the one that would have caught the "stuck on 29" report.
{
  let prev = null, start = 0;
  const spans = [];
  for (let d = 1; d <= 900; d += 1) {
    const r = rate(d);
    if (prev === null) { prev = r; start = d; continue; }
    if (r !== prev) { spans.push([prev, d - start]); prev = r; start = d; }
  }
  const mid = spans.filter(([r]) => r >= 25 && r <= 50);
  ok(mid.length > 0, 'the simulation passes through the middle of the ladder');
  const worst = Math.max(...mid.map(s => s[1]));
  const avg = mid.reduce((s, x) => s + x[1], 0) / mid.length;
  ok(avg <= 15, `a level in the 25-50 band should average a fortnight at most — got ${avg.toFixed(1)} days`);
  ok(worst <= 28, `and no single level should take a month — worst was ${worst} days`);
}

// ── Doing nothing earns nothing ──
{
  const idle = deriveRatings({}, {});
  between(idle.ovr, 1, 1, 'an empty state is 1, not a participation score');
  // A day-one profile still scores, because this one has sat all four
  // self-checks and those are a real input — an honest questionnaire is
  // worth something on day one or it is worth nothing ever. What it must
  // not do is land anywhere near the middle of the ladder.
  ok(rate(1) < 20, 'and a single day does not vault anyone up the board');
}

// ── The four categories stay within sight of each other ──
// Fitness measures itself (vitals, burn, macros); the other three need
// you to show up. If that gap grows without limit, OVR — the mean —
// is set by whichever three you are worst at, which is how the ladder
// stalled the first time.
{
  const r = deriveRatings(committedFor(365), { friendCount: 12, macroDays: 219 });
  const slow = Math.min(r.brain, r.finance, r.social);
  ok(r.fitness - slow <= 32,
    `fitness should not run away from the rest — fitness ${r.fitness}, slowest ${slow}`);
}

console.log(`ratings ladder: ${n} assertions passed`);
