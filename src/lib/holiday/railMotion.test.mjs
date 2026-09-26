/**
 * Trip timeline motion rules. Run: node src/lib/holiday/railMotion.test.mjs
 */
import assert from 'node:assert/strict';
import { classifyWheel, zoomTarget, atZoomLimit, approachZoom, approach, releaseVelocity, glideStep, glideDistance, wheelPixels } from './railMotion.js';
import { MIN_PX_DAY, MAX_PX_DAY } from './timeline.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const near = (a, b, m, tol = 1e-6) => { assert.ok(Math.abs(a - b) < tol, `${m} (got ${a}, want ${b})`); n++; };

// ── Input map ──
eq(classifyWheel({ deltaX: 24, deltaY: 3 }).kind, 'pan', 'a sideways trackpad swipe pans (it used to zoom)');
eq(classifyWheel({ deltaX: 0, deltaY: 100 }).kind, 'zoom', 'a plain wheel zooms, as asked');
eq(classifyWheel({ deltaX: 0, deltaY: 4, ctrlKey: true }).kind, 'pinch', 'a trackpad pinch (ctrl-wheel) zooms');
eq(classifyWheel({ deltaX: 0, deltaY: 100, shiftKey: true }).kind, 'pan', 'shift + wheel pans');
eq(classifyWheel({ deltaX: 0, deltaY: 0 }).kind, null, 'nothing is nothing');
ok(classifyWheel({ deltaY: 100 }).notched, 'a 100px click is a mouse notch');
ok(!classifyWheel({ deltaY: 7.5 }).notched, 'a small fractional delta is a trackpad stream');
ok(classifyWheel({ deltaY: 3, deltaMode: 1 }).notched, 'line mode is a notch');
eq(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }).dy, 48, 'lines become pixels');

// ── Zoom targets and limits ──
near(zoomTarget(6, 100), 6 * Math.exp(-0.16), 'one notch out');
ok(zoomTarget(6, -4, true) > zoomTarget(6, -4, false), 'a pinch delta counts for more than a wheel delta');
eq(zoomTarget(MAX_PX_DAY, -1000), MAX_PX_DAY, 'clamped at the top');
eq(zoomTarget(MIN_PX_DAY, 1000), MIN_PX_DAY, 'clamped at the bottom');
ok(atZoomLimit(MIN_PX_DAY, 100), 'fully zoomed out + wheel down → give it to the page');
ok(!atZoomLimit(MIN_PX_DAY, -100), 'fully zoomed out + wheel up still zooms in');
ok(atZoomLimit(MAX_PX_DAY, -100), 'fully zoomed in + wheel up → page');
ok(!atZoomLimit(6, 100), 'mid-range never gives it away');

// ── Easing ──
{
  let z = 6; const tgt = 24; let t = 0;
  while (z !== tgt && t < 2000) { z = approachZoom(z, tgt, 16); t += 16; }
  eq(z, tgt, 'a zoom arrives exactly');
  ok(t <= 450, `and within ~0.45s (took ${t}ms)`);
  ok(approachZoom(6, 24, 16) > 6 && approachZoom(6, 24, 16) < 24, 'one frame moves part of the way');
  eq(approachZoom(6, 24, 0), 6, 'no time, no movement');
  let s = 0; let u = 0;
  while (s !== 500 && u < 2000) { s = approach(s, 500, 16); u += 16; }
  eq(s, 500, 'a scroll glide arrives exactly');
}

// ── Fling ──
{
  const samples = [{ t: 0, x: 0 }, { t: 16, x: 30 }, { t: 32, x: 60 }, { t: 48, x: 90 }];
  near(releaseVelocity(samples), 90 / 48, 'velocity is distance over time');
  eq(releaseVelocity([{ t: 0, x: 0 }, { t: 16, x: 50 }], 200), 0, 'a drag that paused before release does not fling');
  ok(releaseVelocity([{ t: 0, x: 0 }, { t: 16, x: 50 }], 30) > 0, 'released right after moving → it flings');
  near(releaseVelocity([{ t: 0, x: 0 }, { t: 300, x: 0 }, { t: 316, x: 32 }, { t: 332, x: 64 }], 336), 2, 'only the last 100ms of movement count');
  eq(releaseVelocity([{ t: 0, x: 0 }]), 0, 'one sample is no velocity');
  eq(releaseVelocity([{ t: 0, x: 0 }, { t: 1, x: 100 }]), 6, 'capped at 6 px/ms');
  // integrate the glide frame by frame and compare with the closed form
  let v = 2, travelled = 0, frames = 0;
  while (v && frames < 1000) { const g = glideStep(v, 16); travelled += g.dist; v = g.v; frames++; }
  ok(Math.abs(travelled - glideDistance(2)) < 15, `a 2px/ms fling travels ≈ ${Math.round(glideDistance(2))}px (got ${Math.round(travelled)})`);
  ok(frames < 120, `and settles within 2s (${frames} frames)`);
  eq(glideStep(0, 16), { dist: 0, v: 0 }, 'no velocity, no glide');
}

console.log(`rail motion: ${n} assertions passed`);
