/**
 * Near-miss edge matching on resize. Run: node src/lib/hub/edgeMatch.test.mjs
 */
import assert from 'node:assert/strict';
import { matchEdge, THRESHOLD } from './edgeMatch.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// A widget above at x 0..300, one being resized below it.
const above = { x: 0, y: 0, w: 300, h: 200 };
const below = (w, x = 0) => ({ x, y: 220, w, h: 180 });

// ── Right grip: widths within the threshold match the widget above ──
eq(matchEdge(below(294), 'r', [above]).rect.w, 300, '6px short of the widget above → matches it');
eq(matchEdge(below(308), 'r', [above]).rect.w, 300, '8px past it → matches it');
eq(matchEdge(below(300 + THRESHOLD + 1), 'r', [above]).rect.w, 311, 'one px past the threshold → left alone');
eq(matchEdge(below(250), 'r', [above]).rect.w, 250, 'a deliberate difference is never touched');
ok(matchEdge(below(296), 'r', [above]).guide.axis === 'x', 'a match reports a vertical guide line');
eq(matchEdge(below(250), 'r', [above]).guide, null, 'no match, no guide');

// ── Left grip matches the left edge ──
{
  const r = matchEdge({ x: 7, y: 220, w: 293, h: 180 }, 'l', [above]).rect;
  eq([r.x, r.w], [0, 300], 'left edge 7px in → snaps out to 0, right edge unmoved');
}

// ── Only neighbours in the same column count ──
eq(matchEdge(below(294), 'r', [{ x: 320, y: 0, w: 280, h: 200 }]).rect.w, 294, 'a widget up and to the side is not "above"');
eq(matchEdge(below(294), 'r', [{ x: 0, y: 220, w: 300, h: 180 }]).rect.w, 294, 'one overlapping it vertically is not "above"');
eq(matchEdge(below(294), 'r', [{ x: 0, y: -600, w: 300, h: 100 }]).rect.w, 294, 'one far up the canvas is a different group');

// ── Bottom grip lines up with widgets beside it ──
{
  const left = { x: 0, y: 0, w: 300, h: 240 };
  const r = matchEdge({ x: 320, y: 0, w: 280, h: 233 }, 'b', [left]).rect;
  eq(r.h, 240, 'bottom 7px short of the widget beside → lines up');
  eq(matchEdge({ x: 320, y: 0, w: 280, h: 233 }, 'b', [{ x: 0, y: 400, w: 300, h: 240 }]).rect.h, 233,
    'a widget below is not beside it');
  ok(matchEdge({ x: 320, y: 0, w: 280, h: 236 }, 'b', [left]).guide.axis === 'y', 'bottom matches draw a horizontal guide');
}

// ── Top grip lines up with the top of widgets beside it ──
{
  const left = { x: 0, y: 100, w: 300, h: 240 };
  const r = matchEdge({ x: 320, y: 106, w: 280, h: 300 }, 't', [left]).rect;
  eq([r.y, r.h], [100, 306], 'top 6px low → moves up to match, bottom edge unmoved');
  eq(matchEdge({ x: 320, y: 130, w: 280, h: 300 }, 't', [left]).rect.y, 130, '30px low is a choice, left alone');
}

// ── Closest wins; equal distance → the nearer widget ──
{
  const a = { x: 0, y: 0, w: 305, h: 100 };
  const b = { x: 0, y: 420, w: 297, h: 100 };
  eq(matchEdge(below(299), 'r', [a, b]).rect.w, 297, 'the nearer edge (2px) beats the further (6px)');
}

// ── Floors are respected ──
eq(matchEdge({ x: 0, y: 220, w: 290, h: 180 }, 'r', [{ x: 0, y: 0, w: 282, h: 200 }], { minW: 288 }).rect.w, 290,
  'a match that would go below the minimum width is refused');

// ── Already aligned stays aligned, no jitter ──
eq(matchEdge(below(300), 'r', [above]).rect.w, 300, 'exactly aligned is left as is');

// ── Robust to junk ──
eq(matchEdge(below(294), 'r', [null, { x: 0, y: 0, w: 0, h: 0 }]).rect.w, 294, 'empty and missing rects are ignored');
eq(matchEdge(below(294), 'r', []).guide, null, 'no neighbours, no match');

console.log(`edge match: ${n} assertions passed`);
