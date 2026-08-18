/**
 * Does the server's vision table still match the app's?
 *
 * `netlify/lib/visionXp.js` is a hand-kept copy of the id/xp/category
 * of every vision, because the Netlify functions cannot import the
 * definitions module. A copy that nothing checks is a bug with a
 * delay on it: the last one shipped a leaderboard reporting roughly
 * half of every user's real OVR, and it sat there for weeks because
 * nothing compared the two files.
 *
 * So this compares them, and prints the exact lines to paste when they
 * disagree. Run by `npm run check:visions`; part of `npm run build`.
 *
 * Exit 0 = identical. Exit 1 = drift, with the diff.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);

// definitions.js is ESM and self-contained (no imports), so it loads
// directly. The mirror is CommonJS in a "type": "module" package, so it
// is copied to a .cjs path to be required.
const { VISIONS } = await import(join(root, 'src/lib/visions/definitions.js'));

const tmp = join(tmpdir(), `visionXp.${process.pid}.cjs`);
writeFileSync(tmp, readFileSync(join(root, 'netlify/lib/visionXp.js')));
let VISION_XP;
try {
  ({ VISION_XP } = require(tmp));
} finally {
  try { unlinkSync(tmp); } catch { /* best effort */ }
}

const line = v => `  ${JSON.stringify(v.id)}: { xp: ${v.xp}${v.category ? `, category: '${v.category}'` : ''} },`;

const problems = [];
for (const v of VISIONS) {
  const m = VISION_XP[v.id];
  if (!m) { problems.push([`missing from the mirror: ${v.id}`, line(v)]); continue; }
  if (m.xp !== v.xp) problems.push([`xp differs for ${v.id}: app ${v.xp}, server ${m.xp}`, line(v)]);
  if ((m.category || null) !== (v.category || null)) {
    problems.push([`category differs for ${v.id}: app ${v.category || 'none'}, server ${m.category || 'none'}`, line(v)]);
  }
}
for (const id of Object.keys(VISION_XP)) {
  if (!VISIONS.some(v => v.id === id)) problems.push([`in the mirror but not in the app: ${id}`, '  (delete that line)']);
}

if (!problems.length) {
  const total = VISIONS.reduce((s, v) => s + (v.xp || 0), 0);
  console.log(`✓ vision XP mirror matches — ${VISIONS.length} visions, ${total} xp total`);
  process.exit(0);
}

console.error(`✗ netlify/lib/visionXp.js is out of step with src/lib/visions/definitions.js\n`);
for (const [what, fix] of problems) console.error(`  ${what}\n  →${fix}\n`);
console.error('The leaderboard reads the mirror, so until it is fixed the board\nwill quietly report the wrong OVR. Paste the lines above.');
process.exit(1);
