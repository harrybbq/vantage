/**
 * Where the bytes in a user's state JSON go.
 *
 *   node scripts/state-size.mjs path/to/state.json [--top 25]
 *
 * The file is either the bare `user_data.state` object or a row shaped
 * `{ "state": { … } }` (both are accepted). Prints each top-level key's
 * serialised size, largest first, and how much of the total is held in
 * `data:` URIs (photos, backgrounds, recipe images) — with where each
 * one lives — so the owner can decide what is worth moving to Storage
 * (STARTUP_REQUIREMENTS items 25–26 and 59). Read-only: it never writes
 * anything and is not part of the build.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const topArg = args.indexOf('--top');
const TOP = topArg >= 0 ? Number(args[topArg + 1]) || 25 : 25;

if (!file) {
  console.error('usage: node scripts/state-size.mjs <state.json> [--top N]');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`could not read ${file}: ${e.message}`);
  process.exit(1);
}
const S = parsed && typeof parsed.state === 'object' && parsed.state !== null && !Array.isArray(parsed.state)
  ? parsed.state : parsed;
if (!S || typeof S !== 'object' || Array.isArray(S)) {
  console.error('expected a JSON object (the state, or { state })');
  process.exit(1);
}

const bytes = v => Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8');
const kb = n => `${(n / 1024).toFixed(1)} kB`;
const pct = (n, of) => `${of ? ((n / of) * 100).toFixed(1) : '0.0'}%`;

const total = bytes(S);

// Every string that is a data: URI, with its JSON path.
const uris = [];
(function walk(v, path) {
  if (typeof v === 'string') {
    if (v.startsWith('data:')) uris.push({ path, size: Buffer.byteLength(v, 'utf8'), type: v.slice(5, v.indexOf(';')) || '?' });
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => walk(x, `${path}[${i}]`));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  }
})(S, '');

const uriBytesByKey = {};
for (const u of uris) {
  const key = u.path.split(/[.[]/)[0];
  uriBytesByKey[key] = (uriBytesByKey[key] || 0) + u.size;
}

const rows = Object.entries(S)
  .map(([k, v]) => ({ k, size: bytes(v), uri: uriBytesByKey[k] || 0 }))
  .sort((a, b) => b.size - a.size);

const w = Math.max(10, ...rows.slice(0, TOP).map(r => r.k.length));
console.log(`state: ${kb(total)} across ${rows.length} top-level keys\n`);
console.log(`${'key'.padEnd(w)}  ${'size'.padStart(10)}  ${'share'.padStart(6)}  ${'in data:'.padStart(10)}`);
for (const r of rows.slice(0, TOP)) {
  console.log(`${r.k.padEnd(w)}  ${kb(r.size).padStart(10)}  ${pct(r.size, total).padStart(6)}  ${(r.uri ? kb(r.uri) : '').padStart(10)}`);
}
if (rows.length > TOP) {
  const rest = rows.slice(TOP).reduce((n, r) => n + r.size, 0);
  console.log(`${`(${rows.length - TOP} more)`.padEnd(w)}  ${kb(rest).padStart(10)}  ${pct(rest, total).padStart(6)}`);
}

const uriTotal = uris.reduce((n, u) => n + u.size, 0);
console.log(`\ndata: URIs: ${uris.length}, ${kb(uriTotal)} (${pct(uriTotal, total)} of the state)`);
for (const u of uris.sort((a, b) => b.size - a.size).slice(0, TOP)) {
  console.log(`  ${kb(u.size).padStart(10)}  ${u.type.padEnd(12)}  ${u.path}`);
}
