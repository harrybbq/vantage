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

/* The last CSS delay must land inside the score, or a panel would still
   be arriving after the class that animates it has been removed — it
   would snap into place instead of flickering in. */
const delays = [...css.matchAll(/animation-delay:\s*calc\((\d+)ms\s*\*\s*var\(--vb-k\)\)/g)]
  .map(m => Number(m[1]));
const longest = Math.max(...delays) + 640;      // + the longest panel duration
const shortest = Math.min(DESKTOP.total, MOBILE.total);

if (longest > shortest) {
  console.error(
    `check-boot-speed: the last panel finishes at ${longest}ms but the score ends at ${shortest}ms.\n` +
    '  Shorten the delay in src/boot.css or lengthen `total` in src/lib/boot/score.js.',
  );
  process.exit(1);
}

console.log(
  `check-boot-speed: ok — speed ${SPEED}, --vb-k ${k}, ` +
  `desktop ${Math.round(durationOf(DESKTOP))}ms, mobile ${Math.round(durationOf(MOBILE))}ms, ` +
  `last panel at ${longest}ms of ${shortest}ms.`,
);
