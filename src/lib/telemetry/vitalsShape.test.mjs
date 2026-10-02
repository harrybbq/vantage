/**
 * Web-vitals arithmetic and the beacon's shape.
 * Run: npm run check:vitals   (also part of npm run build)
 */
import { shouldSample, clsFromShifts, makeInpTracker, deviceClass, shapeBeacon } from './vitalsShape.js';

const failures = [];
let checked = 0;
const expect = (label, got, want) => {
  checked++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) failures.push(`${label}: got ${g}, want ${w}`);
};
const near = (label, got, want, eps = 1e-9) => {
  checked++;
  if (!(Math.abs(got - want) <= eps)) failures.push(`${label}: got ${got}, want ${want}`);
};

// ── sampling: 1 in 5 ──
expect('sample 0', shouldSample(0), true);
expect('sample 0.199', shouldSample(0.199), true);
expect('sample 0.2', shouldSample(0.2), false);
expect('sample 0.9', shouldSample(0.9), false);
expect('sample NaN', shouldSample(NaN), false);
{
  // Deterministic LCG: about 20 % of 10,000 draws.
  let s = 42, hits = 0;
  for (let i = 0; i < 10000; i++) { s = (s * 1664525 + 1013904223) % 4294967296; if (shouldSample(s / 4294967296)) hits++; }
  checked++;
  if (hits < 1800 || hits > 2200) failures.push(`sample rate: ${hits}/10000`);
}

// ── CLS session windows ──
expect('cls empty', clsFromShifts([]), 0);
near('cls one window', clsFromShifts([
  { value: 0.05, startTime: 100 }, { value: 0.05, startTime: 600 }, { value: 0.02, startTime: 1200 },
]), 0.12);
// gap ≥ 1 s starts a new window; the larger window wins
near('cls two windows', clsFromShifts([
  { value: 0.05, startTime: 100 }, { value: 0.05, startTime: 500 },
  { value: 0.2, startTime: 3000 },
]), 0.2);
// windows cap at 5 s even with no gap
const steady = Array.from({ length: 20 }, (_, i) => ({ value: 0.01, startTime: i * 500 }));
near('cls 5s cap', clsFromShifts(steady), 0.1, 1e-9);
// recent input excluded
near('cls hadRecentInput', clsFromShifts([
  { value: 0.5, startTime: 100, hadRecentInput: true }, { value: 0.03, startTime: 200 },
]), 0.03);

// ── INP ──
{
  const t = makeInpTracker();
  expect('inp none', t.value(), null);
  t.add({ interactionId: 1, duration: 80 });
  t.add({ interactionId: 1, duration: 120 });   // same interaction, longer event
  t.add({ interactionId: 2, duration: 300 });
  t.add({ interactionId: 0, duration: 999 });   // not an interaction
  expect('inp worst', t.value(), 300);
}
{
  // 100 interactions: the worst two are outliers, the third is INP.
  const t = makeInpTracker();
  for (let i = 1; i <= 100; i++) t.add({ interactionId: i, duration: i });
  expect('inp p98', t.value(), 98);
}

// ── device class ──
expect('mobile', deviceClass(390, true), 'mobile');
expect('tablet', deviceClass(820, true), 'tablet');
expect('desktop', deviceClass(820, false), 'desktop');
expect('desktop wide', deviceClass(1440, false), 'desktop');
expect('unknown', deviceClass(undefined, false), null);

// ── beacon shape ──
expect('beacon', shapeBeacon({ pathname: '/hub', lcp: 1234.56, inp: 88.4, cls: 0.123456, ttfb: 210.2, fcp: 900.9, nav: 'navigate', device: 'mobile' }),
  { path: '/hub', lcp: 1235, inp: 88, cls: 0.1235, ttfb: 210, fcp: 901, nav: 'navigate', device: 'mobile' });
expect('beacon strips query', shapeBeacon({ pathname: '/x?token=abc#f', lcp: 1 }).path, '/x');
expect('beacon nothing measured', shapeBeacon({ pathname: '/' }), null);
expect('beacon negative dropped', shapeBeacon({ pathname: '/', lcp: -5, fcp: 10 }).lcp, null);
expect('beacon has no user fields', Object.keys(shapeBeacon({ pathname: '/', lcp: 1 })).sort(),
  ['cls', 'device', 'fcp', 'inp', 'lcp', 'nav', 'path', 'ttfb']);

if (failures.length) {
  console.error(`check:vitals — ${failures.length} of ${checked} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check:vitals — ${checked} checks passed`);
