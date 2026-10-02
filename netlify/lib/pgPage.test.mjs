/**
 * The PostgREST paging helpers, driven by a fake table.
 *
 * The fake answers like PostgREST with max-rows = PAGE: at most PAGE
 * rows whatever `limit` asks for, and a 200 either way — the silent
 * truncation these helpers exist to see past.
 *
 * Run: npm run check:pgpage   (also part of npm run build)
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CommonJS inside a "type": "module" package — copied to .cjs to load,
// the same way ssrfGuard.test.mjs does.
const require = createRequire(import.meta.url);
const tmp = join(tmpdir(), `pgPage.${process.pid}.cjs`);
writeFileSync(tmp, readFileSync(new URL('./pgPage.js', import.meta.url)));
let lib;
try { lib = require(tmp); } finally { try { unlinkSync(tmp); } catch { /* best effort */ } }
const { chunk, pageAll, pageByKey, inChunks, IN_CHUNK } = lib;

const failures = [];
let checked = 0;
const expect = (label, got, want) => {
  checked++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) failures.push(`${label}: got ${g}, want ${w}`);
};

const ok = rows => ({ ok: true, status: 200, json: async () => rows });
const fail = status => ({ ok: false, status, json: async () => ({ message: 'nope' }) });
const quiet = fn => async (...a) => { const w = console.warn; console.warn = () => {}; try { return await fn(...a); } finally { console.warn = w; } };

// ── chunk ──
expect('chunk empty', chunk([]), []);
expect('chunk sizes', chunk(Array.from({ length: 320 }, (_, i) => i)).map(c => c.length), [150, 150, 20]);
expect('chunk exact', chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
expect('IN_CHUNK ≤ 150', IN_CHUNK <= 150, true);

// ── pageAll: reads past the cap, stops on a short page ──
{
  const table = Array.from({ length: 2350 }, (_, i) => ({ id: i }));
  let calls = 0;
  const rows = await pageAll(async (offset, limit) => { calls++; return ok(table.slice(offset, offset + Math.min(limit, 1000))); });
  expect('pageAll row count', rows.length, 2350);
  expect('pageAll calls', calls, 3);
  expect('pageAll no dupes', new Set(rows.map(r => r.id)).size, 2350);
}
{
  // Exactly a page: one more (empty) request, then stop.
  const table = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  let calls = 0;
  const rows = await pageAll(async (o, l) => { calls++; return ok(table.slice(o, o + l)); });
  expect('pageAll exact page count', [rows.length, calls], [1000, 2]);
}
{
  let threw = null;
  try {
    await pageAll(async o => (o === 0 ? ok(Array.from({ length: 1000 }, (_, i) => ({ id: i }))) : fail(500)), { what: 't' });
  } catch (e) { threw = e.status; }
  expect('pageAll throws on a later failed page (no silent partial)', threw, 500);
}
{
  let calls = 0;
  const rows = await quiet(pageAll)(async () => { calls++; return ok(Array.from({ length: 10 }, () => ({}))); }, { pageSize: 10, maxPages: 5 });
  expect('pageAll runaway guard', [calls, rows.length], [5, 50]);
}

// ── pageByKey ──
{
  const table = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(5, '0') }));
  const seen = [];
  const afters = [];
  const total = await pageByKey(async (after, limit) => {
    afters.push(after);
    const from = after == null ? 0 : table.findIndex(r => r.id > after);
    return ok(table.slice(from, from + limit));
  }, { onPage: rows => seen.push(...rows.map(r => r.id)) });
  expect('pageByKey total', total, 2500);
  expect('pageByKey every row once', new Set(seen).size, 2500);
  expect('pageByKey cursor', afters, [null, '00999', '01999']);
}
{
  // A page with no usable key must not loop on itself.
  let calls = 0;
  const total = await quiet(pageByKey)(async () => { calls++; return ok(Array.from({ length: 1000 }, () => ({}))); });
  expect('pageByKey keyless page stops', [calls, total], [1, 1000]);
}
{
  let threw = false;
  try { await pageByKey(async () => fail(503)); } catch { threw = true; }
  expect('pageByKey throws on failure', threw, true);
}

// ── inChunks ──
{
  const ids = Array.from({ length: 400 }, (_, i) => 'u' + i);
  const urls = [];
  const rows = await inChunks(ids, async (csv, offset, limit) => {
    urls.push(csv);
    const part = csv.split(',');
    return ok(part.slice(offset, offset + limit).map(id => ({ id })));
  });
  expect('inChunks request count', urls.length, 3);
  expect('inChunks ≤150 ids per request', urls.every(u => u.split(',').length <= 150), true);
  expect('inChunks all rows', rows.length, 400);
}
{
  // firstPer: 150 users × 8 rows each, oldest-first. Every user's first
  // row is on page one, so the chunk stops there — and the first row
  // per user matches a full read.
  const ids = Array.from({ length: 150 }, (_, i) => 'u' + i);
  const table = [];
  for (let d = 0; d < 8; d++) for (const id of ids) table.push({ user_id: id, day: d });
  let calls = 0;
  const rows = await inChunks(ids, async (csv, offset, limit) => {
    calls++;
    return ok(table.slice(offset, offset + Math.min(limit, 1000)));
  }, { firstPer: 'user_id' });
  const first = new Map();
  for (const r of rows) if (!first.has(r.user_id)) first.set(r.user_id, r.day);
  expect('firstPer stops early', calls, 1);
  expect('firstPer every user found', first.size, 150);
  expect('firstPer first row is day 0', [...first.values()].every(d => d === 0), true);
}
{
  // A user whose first row sits past the cap is still found.
  const ids = ['late', ...Array.from({ length: 99 }, (_, i) => 'u' + i)];
  const table = [];
  for (let d = 0; d < 12; d++) for (const id of ids.slice(1)) table.push({ user_id: id, day: d });
  table.push({ user_id: 'late', day: 12 });
  const rows = await inChunks(ids, async (csv, offset, limit) => ok(table.slice(offset, offset + Math.min(limit, 1000))), { firstPer: 'user_id' });
  expect('firstPer finds a row past the 1000 cap', rows.some(r => r.user_id === 'late'), true);
}
{
  let threw = null;
  const ids = Array.from({ length: 300 }, (_, i) => 'u' + i);
  let n = 0;
  try {
    await inChunks(ids, async () => (++n === 2 ? fail(414) : ok([])));
  } catch (e) { threw = e.status; }
  expect('inChunks throws when any chunk fails', threw, 414);
}

if (failures.length) {
  console.error(`✗ pgPage — ${failures.length} of ${checked} checks failed\n`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ pgPage — ${checked} checks`);
