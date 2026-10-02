/**
 * Read every page of a PostgREST query. Pure (no client import) so
 * paginate.test.mjs can drive it with a fake page source.
 */
export const PAGE = 1000;

/**
 * Pull every page. `fetchPage(from, to)` resolves { data, error } like a
 * supabase query with .range(from, to). Stops on a short page; throws on
 * an error; `maxPages` bounds a runaway loop.
 */
export async function fetchAllPages(fetchPage, { pageSize = PAGE, maxPages = 200 } = {}) {
  const rows = [];
  for (let i = 0; i < maxPages; i++) {
    const from = i * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  return rows;
}
