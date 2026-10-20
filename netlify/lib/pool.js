/**
 * Bounded-concurrency pool with a start deadline (item 93).
 *
 * pool(items, n, fn, { deadline, now, canStart })
 *   · runs fn(item, index) for items in order, never more than `n` at once;
 *   · stops STARTING new items once now() >= deadline, or once canStart()
 *     says no — items already in flight are awaited and finish normally
 *     (the caller's deadline must leave room for them);
 *   · one item throwing never stops the others.
 * → { results: [{ item, index, ok, value?, error? }] (started items, in
 *     input order), started, notReached }
 *
 * fn is called synchronously right after canStart() returns true, so a
 * caller can reserve shared budget in fn's first (synchronous) line and
 * the next canStart() already sees it.
 *
 * Pure apart from calling fn: no fetch, no env.
 */
async function pool(items, n, fn, { deadline = Infinity, now = Date.now, canStart = () => true } = {}) {
  const list = Array.isArray(items) ? items : [];
  const width = Math.max(1, Math.floor(Number(n) || 1));
  const results = new Array(list.length);
  let next = 0;
  let stopped = false;

  async function worker() {
    while (!stopped && next < list.length) {
      if (now() >= deadline || !canStart()) { stopped = true; break; }
      const index = next++;
      const item = list[index];
      try {
        results[index] = { item, index, ok: true, value: await fn(item, index) };
      } catch (error) {
        results[index] = { item, index, ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, list.length) }, worker));
  const done = results.filter(Boolean);
  return { results: done, started: done.length, notReached: list.length - done.length };
}

module.exports = { pool };
