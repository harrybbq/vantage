/**
 * Server-side writes to user_data.state, done the way the client does
 * them: compare-and-set on updated_at.
 *
 * health-sync, whoop-cron and oura-cron each read the whole state,
 * merged a day of vitals into it and PATCHed the whole thing back with
 * no check. A client save landing between that read and that write was
 * silently overwritten — the same class of loss as the 2026-05-03 wipe,
 * just smaller and quieter.
 *
 * Now the PATCH carries `updated_at=eq.<the value we read>`. If a save
 * got there first, zero rows match: we re-read, re-merge onto the newer
 * state and try once more. If that ALSO conflicts, this run skips the
 * user rather than forcing — the data arrives on the next run or the
 * app's own on-open sync, and nothing the user wrote is lost.
 *
 * The write bumps updated_at to now, exactly as saveToCloud in
 * src/hooks/useVisionBoardState.js does, so a client holding the older
 * version gets a conflict on ITS next save and three-way merges instead
 * of overwriting what we just wrote.
 */

function headers(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

/** → { state, updatedAt } | null (no row) ; throws on a failed read. */
async function readStateRow(userId, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_data?id=eq.${userId}&select=state,updated_at`,
    { headers: headers(env) });
  if (!res.ok) throw new Error(`state read ${res.status}`);
  const row = (await res.json().catch(() => []))[0];
  if (!row) return null;
  return { state: row.state, updatedAt: row.updated_at ?? null };
}

/** One compare-and-set PATCH. → 'written' | 'conflict'; throws on error. */
async function casWrite(userId, nextState, baseUpdatedAt, env) {
  const guard = baseUpdatedAt == null
    ? 'updated_at=is.null'
    : `updated_at=eq.${encodeURIComponent(baseUpdatedAt)}`;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_data?id=eq.${userId}&${guard}&select=updated_at`, {
      method: 'PATCH',
      headers: headers(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ state: nextState, updated_at: new Date().toISOString() }),
    });
  if (!res.ok) throw new Error(`state write ${res.status}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? 'written' : 'conflict';
}

/**
 * Read → merge → conditional write, with one re-read-and-retry.
 *
 * `merge(state)` returns the next state, or null for "nothing to
 * write" (also used to refuse a missing/non-object state). It must be
 * additive and safe to run twice. `first` is an already-read row
 * ({ state, updatedAt }) to save a round trip on the first attempt.
 *
 * → 'written' | 'unchanged' | 'missing' | 'conflict'. Throws only on a
 * failed read/write, never after a partial write.
 */
async function mergeStateCAS(userId, merge, env, first = null) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = attempt === 0 && first ? first : await readStateRow(userId, env);
    if (!row || !row.state || typeof row.state !== 'object') return 'missing';
    const next = merge(row.state);
    if (!next) return 'unchanged';
    const outcome = await casWrite(userId, next, row.updatedAt, env);
    if (outcome === 'written') return 'written';
  }
  return 'conflict';
}

module.exports = { readStateRow, casWrite, mergeStateCAS };
