/**
 * The shape of the ladder.
 *
 * Every other rating test checks that a source pays what it says it
 * pays. None of them could tell you whether the game is worth playing —
 * and that is the failure this file exists to catch, because it has now
 * happened three times.
 *
 * The first time, the scale ended at 42: a committed year reached OVR
 * 24 and OVR 99 — where Prestige unlocks — was unreachable by anyone.
 * The second time the middle of the ladder took three weeks a level.
 * The third time (2026-10-21) the ladder worked as designed and the
 * design was the problem: 99 took six years, and OVR was the mean of
 * four categories, so anyone who skipped one was held under 20 for good.
 * Real profiles had a median OVR of 4.5.
 *
 * What the owner asked for, and what this asserts:
 *   · a committed user reaches a prestige about every three months;
 *   · progress in ANY category raises OVR — none you skip holds it back;
 *   · doing more climbs faster, but doing one thing well is not a
 *     penalty, and no category pays more than another for the same work;
 *   · the climb after a prestige is the one that sets the pace, because
 *     the baseline takes away everything that was only paid once.
 *
 * So: simulate real people over real time, through the real derive.js,
 * across several prestiges. The bounds are deliberately wide — this is
 * not pinning today's arithmetic, it is refusing to ship a ladder
 * nobody can climb, or one that hands out the top in a fortnight.
 */
import assert from 'node:assert/strict';
import { derivePoints, ratingsFromPoints, deriveRatings, pointsToPrestige } from './derive.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const between = (v, lo, hi, m) => {
  assert.ok(v >= lo && v <= hi, `${m} — got ${v}, wanted ${lo}–${hi}`);
  n++;
};

const DAY = 86_400_000;
const NOW = Date.now();
const CATS = ['brain', 'finance', 'fitness', 'social'];
const ymd = d => new Date(d).toISOString().slice(0, 10);

/**
 * `days` of history ending today.
 *   committed  all four categories, six days in seven, weight and
 *              activity logged, an achievement every 25 days, a pot
 *              being paid into, twelve friends — someone doing the thing
 *   fitness    only trains: a fitness tracker six days in seven, weight
 *              and activity logged, food on target most days
 *   brain      only a reading tracker, six days in seven
 *   casual     fitness and brain trackers three days a week
 */
function profile(kind, days) {
  const cats = { committed: CATS, fitness: ['fitness'], brain: ['brain'], casual: ['fitness', 'brain'] }[kind];
  const health = kind === 'committed' || kind === 'fitness';
  const trackers = cats.map(c => ({ id: 't-' + c, category: c, type: 'boolean' }));
  const logs = {}, vitalsLog = {}, burnLog = {};
  for (let i = 0; i < days; i++) {
    if (kind === 'casual' ? i % 7 >= 3 : i % 7 === 6) continue;
    const key = ymd(NOW - i * DAY);
    logs[key] = {};
    for (const t of trackers) logs[key][t.id] = true;
    if (health) { vitalsLog[key] = { weight: 80 }; burnLog[key] = [{ kcal: 450 }]; }
  }
  const every = kind === 'committed' ? 25 : 45;
  const achievements = [];
  for (let i = 0; i < Math.floor(days / every); i++) {
    achievements.push({
      category: cats[i % cats.length],
      completed: true,
      createdAt: NOW - (days - i * every) * DAY,
      completedAt: NOW - (days - i * every - 10) * DAY,   // 10 days apart: spacing rule passes
    });
  }
  const S = {
    trackers, logs, vitalsLog, burnLog, achievements, visions: {},
    savings: kind === 'committed' ? [{ target: 30000, current: Math.min(30000, days * 30) }] : [],
  };
  for (const c of cats) S[c === 'social' ? 'socialScore' : c + 'Score'] = { result: 105 };
  return { S, ctx: {
    friendCount: kind === 'committed' ? 12 : 3,
    macroDays: health ? Math.floor(days * 0.6) : 0,
    createdAt: NOW - (days + 1) * DAY,
  } };
}

const points = (kind, days) => { const { S, ctx } = profile(kind, days); return derivePoints(S, ctx); };
const rate = (kind, days, baseline) => ratingsFromPoints(points(kind, days), baseline);

/** Days to each prestige: [first, P1→P2, P2→P3]. A prestige snapshots
 *  the raw points as the baseline, exactly as prestige-up.js does. */
function cycles(kind) {
  const out = [];
  let at = 0, baseline = {};
  for (let c = 0; c < 3; c++) {
    let d = null;
    for (let x = 1; x <= 900; x++) if (rate(kind, at + x, baseline).ovr >= 99) { d = x; break; }
    out.push(d ?? Infinity);
    if (d == null) break;
    at += d;
    baseline = points(kind, at);
  }
  return out;
}

const C = {};
for (const k of ['committed', 'fitness', 'brain', 'casual']) C[k] = cycles(k);

// ── A committed user prestiges about every three months ──
{
  const [first, second, third] = C.committed;
  between(second, 75, 105, 'the climb after a prestige is the pace — about three months');
  between(third, 75, 105, 'and it holds on the next one');
  between(first, 45, second, 'the first climb may be quicker (self-checks, friends and form are paid once), not slower');
}

// ── The climb itself ──
{
  between(rate('committed', 7).ovr, 15, 40, 'a first week should feel like it went somewhere');
  between(rate('committed', 30).ovr, 45, 80, 'a first month is well up the board');
  ok(rate('committed', 1).ovr < 25, 'a single day does not vault anyone up the board');
  ok(rate('committed', 14).ovr < 60, 'nor does a fortnight buy the top half');
}

// ── Any category moves OVR; none you skip holds it back ──
{
  for (const k of ['fitness', 'brain', 'casual']) {
    ok(Number.isFinite(C[k][1]), `${k}: the ladder has a top — Prestige is reachable without all four`);
    between(rate(k, 90).ovr, 30, 80, `${k}: three months in, comfortably off the floor`);
  }
  between(C.fitness[1], 150, 220, 'one category done well: a prestige about every six months');
  between(C.casual[1], 180, 330, 'two categories three days a week: inside a year');
}

// ── No category pays more than another for the same work ──
// Until 2026-10-21 vitals, burn and macros paid Fitness on top of its
// days, and a fitness-only user climbed three times faster than a
// reading-only one doing the same six days a week.
{
  const f = C.fitness[1], b = C.brain[1];
  ok(Math.abs(f - b) / Math.max(f, b) <= 0.15,
    `a fitness-only and a brain-only user climb at the same pace — ${f} vs ${b} days`);
}

// ── Doing more climbs faster, but focus is not punished ──
{
  ok(C.committed[1] < C.fitness[1], 'all four categories prestige faster than one');
  ok(C.fitness[1] / C.committed[1] <= 2.5,
    `but one category done well is not four times slower — ${C.fitness[1]} vs ${C.committed[1]} days`);
}

// ── Nobody waits for a number to move ──
// The one that would have caught the "stuck on 29" report.
{
  for (const [k, worstAllowed] of [['committed', 4], ['fitness', 7]]) {
    let prev = null, start = 1, worst = 0;
    for (let d = 1; d <= 220; d++) {
      const r = rate(k, d).ovr;
      if (prev !== null && r !== prev) {
        if (prev >= 20 && prev <= 90) worst = Math.max(worst, d - start);
        start = d;
      }
      prev = r;
    }
    ok(worst <= worstAllowed, `${k}: no point between 20 and 90 takes more than ${worstAllowed} days — worst was ${worst}`);
  }
}

// ── A prestige really is a fresh start ──
{
  const at = C.committed[0];
  const baseline = points('committed', at);
  ok(rate('committed', at, baseline).ovr <= 3, 'straight after a prestige OVR is back at the floor');
  between(rate('committed', at + 30, baseline).ovr, 30, 75, 'and a month later it is a month up the next climb');
  ok(pointsToPrestige(points('committed', at), {}) === 0, 'at 99 there is nothing left to earn this climb');
}

// ── Doing nothing earns nothing ──
{
  const idle = deriveRatings({}, {});
  between(idle.ovr, 1, 1, 'an empty state is 1, not a participation score');
  for (const c of CATS) between(idle[c], 1, 1, `${c} is 1 too`);
}

// ── More never lowers OVR ──
// OVR weights your best category in full and the rest less; adding
// points anywhere must still never take OVR down.
{
  const base = points('casual', 60);
  for (const c of CATS) {
    const more = { ...base, [c]: base[c] + 5 };
    ok(ratingsFromPoints(more).ovr >= ratingsFromPoints(base).ovr, `5 more ${c} points never lower OVR`);
  }
}

console.log(`ratings ladder: ${n} assertions passed`);
console.log('  days to prestige (first, then each climb after):');
for (const [k, v] of Object.entries(C)) console.log(`    ${k.padEnd(10)} ${v.join(' · ')}`);
