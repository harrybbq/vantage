/**
 * Web vitals bands — web.dev's thresholds, inclusive at "good".
 */
import assert from 'node:assert/strict';
import { rateVital, fmtVital, vitalTrack, overallRating, VITALS, bucketHeads, bucketRows, vitalSentence } from './vitals.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// LCP 2.5 s / 4 s
eq(rateVital('lcp', 2500), 'good', 'LCP at 2.5 s is good');
eq(rateVital('lcp', 2501), 'ni', 'just over is NI');
eq(rateVital('lcp', 4000), 'ni', 'LCP at 4 s is still NI');
eq(rateVital('lcp', 4001), 'poor', 'over 4 s is poor');
// INP 200 / 500 ms
eq(rateVital('inp', 200), 'good', 'INP 200');
eq(rateVital('inp', 350), 'ni', 'INP 350');
eq(rateVital('inp', 501), 'poor', 'INP 501');
// CLS 0.1 / 0.25
eq(rateVital('cls', 0.1), 'good', 'CLS 0.1');
eq(rateVital('cls', 0.18), 'ni', 'CLS 0.18');
eq(rateVital('cls', 0.3), 'poor', 'CLS 0.3');
// FCP 1.8 / 3 s, TTFB 0.8 / 1.8 s
eq(rateVital('fcp', 1800), 'good', 'FCP 1.8');
eq(rateVital('fcp', 3200), 'poor', 'FCP 3.2');
eq(rateVital('ttfb', 900), 'ni', 'TTFB 0.9');
eq(rateVital('ttfb', 1900), 'poor', 'TTFB 1.9');
// Junk
eq(rateVital('lcp', null), null, 'missing');
eq(rateVital('lcp', -1), null, 'negative');
eq(rateVital('nope', 1), null, 'unknown metric');
eq(rateVital('lcp', '2400'), 'good', 'numeric string');

eq(fmtVital('cls', 0.084), '0.08', 'CLS two dp');
eq(fmtVital('lcp', 2380), '2.4 s', 'LCP seconds');
eq(fmtVital('inp', 180), '180 ms', 'INP ms');
eq(fmtVital('inp', null), '—', 'missing');

{
  const t = vitalTrack('lcp', 3000);
  eq([+t.good.toFixed(3), +t.poor.toFixed(3), +t.at.toFixed(3), t.clipped], [0.417, 0.667, 0.5, false], 'track positions');
  const far = vitalTrack('lcp', 20000);
  eq([far.at, far.clipped], [1, true], 'far value pins to the end');
  eq(vitalTrack('lcp', null).at, null, 'no value, still a track');
  eq(vitalTrack('nope', 1), null, 'unknown metric');
}

eq(overallRating({ lcp: 2000, inp: 150, cls: 0.05 }), 'good', 'all good');
eq(overallRating({ lcp: 2000, inp: 600, cls: 0.05 }), 'poor', 'worst wins');
eq(overallRating({ lcp: 2000, ttfb: 5000 }), 'good', 'diagnostics do not set the verdict');
eq(overallRating({}), null, 'nothing');
eq(VITALS.filter(v => v.core).map(v => v.id), ['lcp', 'inp', 'cls'], 'three Core Web Vitals');

eq(bucketHeads('lcp'), { good: '≤ 2.5 s', ni: '2.5 s – 4 s', poor: '> 4 s' }, 'LCP headers');
eq(bucketHeads('cls'), { good: '≤ 0.10', ni: '0.10 – 0.25', poor: '> 0.25' }, 'CLS headers');
{
  const b = bucketRows('lcp', [{ p: 'a', value: 1200 }, { p: 'b', value: 5000 }, { p: 'c', value: 3000 }, { p: 'd', value: 2000 }, { p: 'e', value: null }]);
  eq([b.good.map(r => r.p), b.ni.map(r => r.p), b.poor.map(r => r.p), b.none.map(r => r.p)], [['d', 'a'], ['c'], ['b'], ['e']], 'buckets, worst first');
}
eq(vitalSentence('lcp', 2870, 0.75), '75% of visits had a great LCP.', 'share 0..1');
eq(vitalSentence('lcp', 2870, 82), '82% of visits had a great LCP.', 'share 0..100');
eq(vitalSentence('lcp', 2870), '3 in 4 visits had LCP of 2.9 s or better: needs improvement (great is ≤ 2.5 s).', 'p75 sentence');
eq(vitalSentence('inp', null), 'No INP data yet.', 'no data');

console.log(`security vitals: ${n} checks passed`);
