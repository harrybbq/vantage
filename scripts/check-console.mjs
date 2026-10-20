/**
 * check:console — the ONE build entry for the whole console redesign.
 *
 * Finds every `*.test.mjs` under src/design/ and src/lib/design/ and runs
 * each with node, one after another, printing a line per file. Any failure
 * (non-zero exit, or a crash) fails the build. No tests found is a pass,
 * so an empty folder can't break the build.
 *
 * To add a test: drop a `<name>.test.mjs` file in either folder. Never
 * edit package.json for it — that long "build" line is where parallel
 * branches kept colliding.
 *
 * Tests must be hermetic: no env vars, no network, no clock dependence
 * (Netlify builds on Node 20).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src/design', 'src/lib/design'];

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

const files = DIRS.map(d => join(ROOT, d)).filter(existsSync).flatMap(d => walk(d, []));
if (!files.length) {
  console.log('check:console — no tests found (pass)');
  process.exit(0);
}

let failed = 0;
for (const f of files) {
  const rel = relative(ROOT, f);
  const r = spawnSync(process.execPath, [f], { cwd: ROOT, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status === 0) {
    const last = out.split('\n').filter(Boolean).pop() || '';
    console.log(`  ok    ${rel}${last ? ` — ${last}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${rel} (exit ${r.status}${r.signal ? `, ${r.signal}` : ''})`);
    if (out) console.log(out.split('\n').map(l => `        ${l}`).join('\n'));
    if (r.error) console.log(`        ${r.error.message}`);
  }
}
console.log(`check:console — ${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
