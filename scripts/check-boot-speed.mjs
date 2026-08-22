/**
 * The boot sequence is timed in two places that must agree: score.js
 * scales its clock by SPEED, and boot.css multiplies every authored
 * delay by --vb-k, which has to be 1 / SPEED. Nothing at runtime would
 * complain if they drifted — the overlay would simply finish at a
 * different moment from the panels, which reads as a bug nobody can
 * name. So the build refuses the mismatch.
 */
import { readFileSync } from 'node:fs';
import { CSS_K, SPEED, DESKTOP, MOBILE, durationOf } from '../src/lib/boot/score.js';

const css = readFileSync(new URL('../src/boot.css', import.meta.url), 'utf8');
const declared = css.match(/html\.vb-boot\s*\{\s*--vb-k:\s*([\d.]+)\s*;/);

if (!declared) {
  console.error('check-boot-speed: --vb-k is not declared on html.vb-boot in src/boot.css');
  process.exit(1);
}

const k = Number(declared[1]);
// Four decimal places is what the stylesheet carries; anything inside
// that is the same number written two ways.
if (Math.abs(k - CSS_K) > 0.0001) {
  console.error(
    `check-boot-speed: boot.css --vb-k is ${k}, but score.js SPEED ${SPEED} needs ${CSS_K}.\n` +
    '  Change both, or the overlay and the panel stagger run on different clocks.',
  );
  process.exit(1);
}

/* The last staggered element must finish before html.vb-boot comes off,
   or it would be mid-animation when the rule animating it disappears and
   would snap into place instead of arriving.

   Delays and durations are collected separately because the nth-child
   rules override only the delay and inherit their duration from the base
   rule, so they cannot be paired block by block. The sweep is excluded:
   it is a one-shot bar with no delay of its own, and pairing its long
   duration with someone else's delay would invent a deadline that no
   element actually has. */
const K = /calc\((\d+)ms\s*\*\s*var\(--vb-k\)\)/g;
const delays = [];
const durations = [];

// Rule by rule, so a declaration is always judged with its own selector.
for (const block of css.split('}')) {
  const at = block.lastIndexOf('{');
  if (at === -1) continue;
  const selector = block.slice(0, at);
  const body = block.slice(at + 1);
  if (selector.includes('vb-boot-sweep')) continue;
  for (const line of body.split(';')) {
    const nums = [...line.matchAll(K)].map(m => Number(m[1]));
    if (!nums.length) continue;
    if (/animation-delay\s*:/.test(line)) delays.push(...nums);
    else if (/animation(-duration)?\s*:/.test(line)) durations.push(...nums);
  }
}

if (!delays.length || !durations.length) {
  console.error('check-boot-speed: found no --vb-k delays or durations in src/boot.css — has the file moved?');
  process.exit(1);
}

const longest = Math.max(...delays) + Math.max(...durations);
// The class lives for total + 300 of score time (see durationOf).
const deadline = Math.min(DESKTOP.total, MOBILE.total) + 300;

if (longest > deadline) {
  console.error(
    `check-boot-speed: the last staggered element finishes at ${longest}ms, ` +
    `but html.vb-boot is removed at ${deadline}ms.\n` +
    '  Shorten the delay in src/boot.css or lengthen `total` in src/lib/boot/score.js.',
  );
  process.exit(1);
}

console.log(
  `check-boot-speed: ok — speed ${SPEED}, --vb-k ${k}, ` +
  `desktop ${Math.round(durationOf(DESKTOP))}ms, mobile ${Math.round(durationOf(MOBILE))}ms, ` +
  `last staggered element at ${longest}ms of ${deadline}ms.`,
);
