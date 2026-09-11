/**
 * One boot per app open.
 *
 * The reported bug — plays, stops two seconds in, plays again from the
 * top, finishes — is a reload landing in the middle of the sequence. So
 * the case that matters most here is the reload: whatever the page does,
 * whenever it does it, the user sees the boot once.
 */
import assert from 'node:assert/strict';
import {
  BOOST, RUN_KEY, newRun, elapsedAt, remainingWall, isSpent, boosted,
  readRun, writeRun, clearRun, decide,
} from './run.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const SPEED = 0.8;
const TOTAL = 4200;                  // score.total + tail
const WALL = TOTAL / SPEED;          // 5250ms of real time
const T0 = 1_700_000_000_000;

/** A stand-in for sessionStorage that behaves. */
function store(initial) {
  const m = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _raw: m,
  };
}
/** And one that does not — private browsing throws on every call. */
const hostile = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
};

// ── The clock ──
{
  const run = newRun(T0);
  eq(elapsedAt(run, T0, SPEED), 0, 'a run starts at zero');
  eq(elapsedAt(run, T0 + 1000, SPEED), 800, 'and advances at the score speed');
  eq(elapsedAt(run, T0 - 500, SPEED), 0, 'a clock that went backwards does not go negative');
  eq(elapsedAt(null, T0, SPEED), 0, 'no run, no time');

  eq(Math.round(remainingWall(run, T0, SPEED, TOTAL)), Math.round(WALL),
    'a fresh run has the whole wall-clock duration left');
  eq(remainingWall(run, T0 + WALL + 10, SPEED, TOTAL), 0, 'and a finished one has none');

  ok(!isSpent(run, T0 + WALL - 100, SPEED, TOTAL), 'not spent a tenth of a second early');
  ok(isSpent(run, T0 + WALL, SPEED, TOTAL), 'spent exactly on time');
}

// ── The tap ──
{
  const run = newRun(T0);
  const tapped = boosted(run, T0 + 2000);          // two seconds in
  eq(tapped.boostAt, T0 + 2000, 'the tap is recorded where it happened');
  eq(run.boostAt, null, 'and the original is left alone');

  eq(elapsedAt(tapped, T0 + 2000, SPEED), 1600, 'what was already watched keeps its real duration');
  eq(elapsedAt(tapped, T0 + 2100, SPEED), 1600 + 100 * SPEED * BOOST,
    'and the rest runs BOOST times faster');

  const left = remainingWall(tapped, T0 + 2000, SPEED, TOTAL);
  ok(left > 600 && left < 700, `a tap halfway lands it in about 0.65s (${Math.round(left)}ms)`);
  ok(left < remainingWall(run, T0 + 2000, SPEED, TOTAL) / 4, 'which is a great deal sooner than not tapping');

  // A second tap must not compound: the end of the sequence cannot
  // depend on how fast someone can tap.
  ok(boosted(tapped, T0 + 2500) === tapped, 'tapping again changes nothing');
  eq(boosted(null, T0), null, 'and tapping with no run is not a crash');

  // A boost stamped in the future is not yet in effect.
  const later = { at: T0, boostAt: T0 + 9000 };
  eq(elapsedAt(later, T0 + 1000, SPEED), 800, 'a boost that has not happened yet does nothing');
}

// ── Storage ──
{
  const s = store();
  const run = newRun(T0);
  writeRun(s, run);
  eq(readRun(s), run, 'a run round-trips');
  eq(s._raw.get(RUN_KEY) !== undefined, true, 'under the documented key');
  clearRun(s);
  eq(readRun(s), null, 'and can be cleared');

  eq(readRun(store({ [RUN_KEY]: 'not json' })), null, 'rubbish reads as no run');
  eq(readRun(store({ [RUN_KEY]: '{"at":"soon"}' })), null, 'and so does the wrong shape');
  eq(readRun(store({ [RUN_KEY]: '{"at":null}' })), null, 'and a null instant');
  eq(readRun(store({ [RUN_KEY]: `{"at":${T0},"boostAt":"x"}` })), { at: T0, boostAt: null },
    'a bad boost is dropped rather than taking the run with it');
  eq(readRun(hostile), null, 'private browsing reads as no run rather than throwing');
  writeRun(hostile, run);
  clearRun(hostile);
  ok(true, 'and writing to it is survivable');
  eq(readRun(null), null, 'no storage at all is fine too');
}

// ══════════════════════════════════════════════════════════════════════
// The reload. This is the whole point of the module.
// ══════════════════════════════════════════════════════════════════════
{
  const s = store();

  // Page one opens and starts the boot.
  const first = decide(s, T0, { speed: SPEED, total: TOTAL });
  eq(first.reason, 'started', 'the first open starts a run');
  eq(first.run.at, T0, 'from now');

  // The service worker reloads the page two seconds in — the exact case
  // that used to play the sequence twice.
  const second = decide(s, T0 + 2000, { speed: SPEED, total: TOTAL });
  eq(second.reason, 'resumed', 'the reloaded page RESUMES rather than starting again');
  eq(second.run.at, T0, 'from the same instant');
  eq(elapsedAt(second.run, T0 + 2000, SPEED), 1600,
    'so it picks up where the cut-off one left off, not at zero');

  // And once the run's time is up, nothing plays again for this tab.
  const third = decide(s, T0 + WALL + 1, { speed: SPEED, total: TOTAL });
  eq(third.reason, 'already-played', 'a reload after it finished gets no boot');
  eq(third.run, null, 'and nothing to play');

  // Any number of reloads, at any moment: exactly one run, ever.
  const s2 = store();
  const runs = new Set();
  for (const at of [0, 300, 900, 2000, 2001, 4000, 5000, 5249, 5250, 9000, 60000]) {
    const d = decide(s2, T0 + at, { speed: SPEED, total: TOTAL });
    if (d.run) runs.add(d.run.at);
  }
  eq(runs.size, 1, 'eleven page loads across a minute produce one run between them');
  eq([...runs][0], T0, 'the first one');
}

// A tap survives the reload too — the page that comes back must not
// undo the user's decision to hurry it.
{
  const s = store();
  const { run } = decide(s, T0, { speed: SPEED, total: TOTAL });
  writeRun(s, boosted(run, T0 + 1000));
  const after = decide(s, T0 + 1100, { speed: SPEED, total: TOTAL });
  eq(after.reason, 'resumed', 'the reload resumes');
  eq(after.run.boostAt, T0 + 1000, 'and it is still in a hurry');
}

// ── Refusing ──
{
  const s = store();
  const d = decide(s, T0, { speed: SPEED, total: TOTAL, allowed: false });
  eq(d.reason, 'not-allowed', 'a veto refuses');
  eq(d.run, null, 'with no run');
  // Recorded, so a reload a moment later does not get a second opinion.
  eq(decide(s, T0 + 50, { speed: SPEED, total: TOTAL }).reason, 'already-played',
    'and the refusal sticks across a reload');
}

// ── Clocks that lie ──
{
  // A run stamped in the future — the device clock moved backwards.
  const future = store({ [RUN_KEY]: JSON.stringify({ at: T0 + 60_000, boostAt: null }) });
  eq(decide(future, T0, { speed: SPEED, total: TOTAL }).reason, 'started',
    'a run from the future is not trusted; a fresh one starts');

  // A run from last week — the tab was restored, or the clock jumped.
  const ancient = store({ [RUN_KEY]: JSON.stringify({ at: T0 - 7 * 86400_000, boostAt: null }) });
  eq(decide(ancient, T0, { speed: SPEED, total: TOTAL }).reason, 'started',
    'and neither is one from last week');

  // Private browsing: no memory at all, so every load boots. One boot per
  // load is the old behaviour and is the right failure — a user who can
  // store nothing still gets a working app.
  eq(decide(hostile, T0, { speed: SPEED, total: TOTAL }).reason, 'started',
    'with no storage it simply starts');
}

console.log(`boot run: ${n} assertions passed`);
