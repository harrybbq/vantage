/**
 * Export pagination: every row exactly once, stop on the short page,
 * and an error surfaces instead of producing a silently short export.
 */
import assert from 'node:assert/strict';
import { fetchAllPages } from './paginate.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

function source(total) {
  const all = Array.from({ length: total }, (_, i) => i);
  const calls = [];
  const fetchPage = async (from, to) => { calls.push([from, to]); return { data: all.slice(from, to + 1), error: null }; };
  return { fetchPage, calls };
}

{
  const s = source(2500);
  const rows = await fetchAllPages(s.fetchPage);
  eq(rows.length, 2500, 'all rows');
  eq(new Set(rows).size, 2500, 'no duplicates');
  eq(s.calls, [[0, 999], [1000, 1999], [2000, 2999]], 'inclusive ranges of 1000');
}
{
  const s = source(2000);
  const rows = await fetchAllPages(s.fetchPage);
  eq(rows.length, 2000, 'exact multiple');
  eq(s.calls.length, 3, 'one extra empty page confirms the end');
}
{
  const s = source(0);
  eq(await fetchAllPages(s.fetchPage), [], 'empty table');
}
{
  let threw = false;
  try {
    await fetchAllPages(async () => ({ data: null, error: { message: 'relation does not exist' } }));
  } catch { threw = true; }
  eq(threw, true, 'an error is thrown, not swallowed into a short export');
}
{
  const s = source(50);
  eq((await fetchAllPages(s.fetchPage, { pageSize: 10, maxPages: 2 })).length, 20, 'maxPages bounds the loop');
}

console.log(`paginate: ${n} checks passed`);
