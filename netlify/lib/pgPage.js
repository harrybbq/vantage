/**
 * Reading PostgREST past its two silent limits.
 *
 * 1. Rows. Supabase caps every response at 1000 rows (`max-rows`) and
 *    says nothing: a 1,200-row answer arrives as 1000 rows and a 200.
 *    global-trending read `user_data` in one request, so user 1,001
 *    onwards simply did not exist to it.
 * 2. URLs. `id=in.(uuid,uuid,…)` costs ~37 bytes an id. A thousand ids
 *    is a 37 kB query string, past what proxies and PostgREST accept,
 *    and the failure is a 414/400 that callers here had been reading as
 *    "no rows".
 *
 * So: ids go out in chunks of IN_CHUNK, and every multi-row read pages
 * until a short page says there is no more. Pages and chunks run one
 * after another, never in parallel — the database is a Micro instance
 * and a burst of concurrent scans is exactly what it cannot absorb.
 *
 * Every helper throws on a non-OK response rather than returning what
 * it has so far. Whether a failed read means "serve nothing", "serve
 * the last good copy" or "stop before writing anything" is the
 * caller's decision, and a silently partial list removes that choice.
 *
 * Pure apart from the `fetchPage` callback, so pgPage.test.mjs can drive
 * it offline.
 */

const IN_CHUNK = 150;
const PAGE_SIZE = 1000;
/** A runaway guard, not a budget: 200 pages is 200k rows. */
const MAX_PAGES = 200;

function chunk(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function readRows(res, what) {
  if (!res || !res.ok) {
    const err = new Error(`${what} read failed`);
    err.status = res ? res.status : 0;
    throw err;
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/**
 * Offset paging. `fetchPage(offset, limit)` → a fetch Response for that
 * slice (the caller appends `&limit=&offset=` and a STABLE `order=` —
 * without a total order, rows can repeat or vanish between pages).
 *
 * `done(rowsSoFar)` may end the read early: a "first row per user"
 * reader stops as soon as it has seen every user it asked about.
 */
async function pageAll(fetchPage, { pageSize = PAGE_SIZE, maxPages = MAX_PAGES, done, what = 'paged' } = {}) {
  const rows = [];
  for (let i = 0; i < maxPages; i++) {
    const page = await readRows(await fetchPage(i * pageSize, pageSize), what);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    if (done && done(rows)) return rows;
  }
  console.warn(`[pgPage] ${what}: stopped at ${maxPages} pages`);
  return rows;
}

/**
 * Keyset paging on a unique, ordered column (default `id`).
 * `fetchPage(after, limit)` → Response; `after` is null for the first
 * page, else the last key seen (caller adds `&<key>=gt.<after>` and
 * `&order=<key>.asc`). Cheaper than offset for a large table: every page
 * is an index range scan, not "skip N rows then read".
 *
 * `onPage(rows)` is called per page so a caller can fold rows into an
 * aggregate instead of holding the whole table in memory.
 */
async function pageByKey(fetchPage, { key = 'id', pageSize = PAGE_SIZE, maxPages = MAX_PAGES, onPage, what = 'keyset' } = {}) {
  let after = null;
  let total = 0;
  for (let i = 0; i < maxPages; i++) {
    const page = await readRows(await fetchPage(after, pageSize), what);
    total += page.length;
    if (onPage) onPage(page);
    if (page.length < pageSize) return total;
    const last = page[page.length - 1]?.[key];
    if (last == null || last === after) {
      // No key to continue from — refusing to loop on the same page.
      console.warn(`[pgPage] ${what}: page ended without a usable "${key}"`);
      return total;
    }
    after = last;
  }
  console.warn(`[pgPage] ${what}: stopped at ${maxPages} pages`);
  return total;
}

/**
 * `ids` in chunks of IN_CHUNK, each chunk read to the end with pageAll.
 * `fetchChunk(idsCsv, offset, limit)` → Response. Returns every row.
 *
 * `firstPer` (a column name, e.g. 'user_id') ends a chunk as soon as
 * every id in it has appeared at least once — for the "newest/oldest
 * row per user" readers, whose answer is the first row per id in the
 * requested order, so the rest of the chunk cannot change it.
 */
async function inChunks(ids, fetchChunk, { size = IN_CHUNK, pageSize = PAGE_SIZE, maxPages = MAX_PAGES, firstPer, what = 'in-chunk' } = {}) {
  const out = [];
  for (const part of chunk(ids, size)) {
    const csv = part.join(',');
    const want = firstPer ? new Set(part) : null;
    const done = want
      ? rows => { for (const r of rows) want.delete(r[firstPer]); return want.size === 0; }
      : undefined;
    const rows = await pageAll((offset, limit) => fetchChunk(csv, offset, limit), { pageSize, maxPages, done, what });
    out.push(...rows);
  }
  return out;
}

module.exports = { IN_CHUNK, PAGE_SIZE, MAX_PAGES, chunk, pageAll, pageByKey, inChunks };
