/**
 * The score is pure arithmetic over one clock, so it can be checked
 * without a browser. What matters is that every element does arrive —
 * a boot that leaves something at opacity 0 hides part of the app.
 */
import assert from 'node:assert/strict';
import {
  SPEED, CSS_K, DESKTOP, MOBILE, durationOf,
  clamp01, ease, seg, reveal, tiles, consoleAt, STAGES,
} from './score.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++; };

// ── The two clocks agree ──
eq(CSS_K, 1.3333, 'CSS_K is 1 / SPEED to four places');
ok(Math.abs(SPEED * CSS_K - 1) < 0.0002, 'SPEED and CSS_K are reciprocals');
ok(durationOf(DESKTOP) > DESKTOP.total, 'speed below 1 makes the boot longer, not shorter');

// ── Helpers ──
eq(clamp01(-3), 0, 'clamp01 floors');
eq(clamp01(9), 1, 'clamp01 caps');
eq(ease(0), 0, 'ease starts at 0');
eq(ease(1), 1, 'ease ends at 1');
eq(seg(50, [100, 200]), 0, 'seg is 0 before its window');
eq(seg(150, [100, 200]), 0.5, 'seg is linear inside');
eq(seg(500, [100, 200]), 1, 'seg is 1 after');

// ── reveal ──
const before = reveal(0, [100, 200], 300);
eq(before.opacity, 0, 'nothing is visible before its window');
eq(before.anim, 'none', 'and nothing is animating yet');
const during = reveal(150, [100, 200], 300);
ok(during.opacity > 0 && during.opacity < 1.0001, 'mid-window opacity is in range');
ok(during.anim.startsWith('vb-flick'), 'mid-window it flickers');
ok(during.y > 0 && during.y <= 12, 'and is still on its way up');
const after = reveal(999, [100, 200], 300);
eq(after.opacity, 1, 'past the window it is fully there');
eq(after.y, 0, 'and at rest');
eq(after.anim, 'none', 'with nothing left painting');

// ── Tiles: every cell must arrive, and arrive on a diagonal ──
for (const [name, score] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
  const at = t => tiles(t, score);
  eq(at(0).length, score.cols * score.rows, `${name}: one cell per grid slot`);
  ok(at(0).every(c => c.opacity === 0), `${name}: the wall starts dark`);

  const end = at(score.total);
  ok(end.every(c => c.opacity === 1), `${name}: every cell has arrived by the end`);
  ok(end.every(c => c.scale === 1 && c.edge === 0), `${name}: and rests unscaled, unlit`);

  // The far corner must not lead the near one.
  const mid = at(score.bg[0] + (score.bg[1] - score.bg[0]) * 0.45);
  const first = mid[0];
  const last = mid[mid.length - 1];
  ok(first.opacity >= last.opacity, `${name}: the wall fills from the top-left corner`);
  ok(mid.some(c => c.opacity > 0 && c.opacity < 1), `${name}: mid-flight the wall is partly drawn`);
}

// ── The wall finishes before the panels it sits behind stop moving ──
for (const [name, score] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
  ok(score.bg[1] <= score.total, `${name}: the wallpaper lands inside the score`);
  ok(score.console[1] <= score.total, `${name}: so does the console`);
  ok(score.sweep[1] <= score.total, `${name}: and the sweep`);
}

// ── Console ──
eq(consoleAt(0, DESKTOP).pct, 0, 'the console starts at nothing');
eq(consoleAt(DESKTOP.total, DESKTOP).line, 'hub online · boot complete', 'and ends by saying so');
eq(consoleAt(DESKTOP.total, DESKTOP).pct, 100, 'at 100%');
ok(consoleAt(DESKTOP.total, DESKTOP).done, 'and marks itself done');
const seen = new Set();
for (let t = 0; t <= DESKTOP.total; t += 25) seen.add(consoleAt(t, DESKTOP).line);
ok(STAGES.every(s => seen.has(s)), 'every stage is actually shown at some point');

// Progress only ever goes forwards.
let last = -1;
for (let t = 0; t <= DESKTOP.total; t += 17) {
  const p = consoleAt(t, DESKTOP).pct;
  ok(p >= last, 'the console never counts backwards');
  last = p;
  n -= 1; // one assertion for the whole sweep, not one per sample
}
n += 1;

console.log(`boot score: ${n} assertions passed`);
