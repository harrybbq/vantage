/**
 * Netlify scheduled function: oura-cron
 *
 * Passive Oura sync, the counterpart of whoop-cron. Runs on a schedule
 * (see netlify.toml) and, for every connected account, pulls the last
 * few days of Oura data and merges it straight into user_data.state
 * server-side — so vitals show up without the user opening the app.
 *
 * Scheduled at ~06:30 UTC, half an hour after whoop-cron. Two reasons:
 *   - Oura finalises the night's readiness score after wake, so the
 *     early-morning window is when the number is actually there, and
 *   - staggering the two crons means an account with BOTH devices never
 *     has two functions read-modify-writing the same state blob at once.
 *     The state save is a whole-object PATCH, so overlapping writes
 *     would be a lost update, not a merge.
 *
 * The merge is additive (mergeOuraIntoState) — it only ever adds
 * vitals/burn, never removes user data — and we skip the write entirely
 * when there's nothing new, keeping DB writes minimal (Micro-friendly).
 */
const { pausedCron } = require('../lib/killSwitch');
const sbKeys = require('../lib/sbKeys');
const { sb, getFreshToken, fetchOuraData, mergeOuraIntoState } = require('../lib/oura');
const { requireScheduler } = require('../lib/cronAuth');
const { mergeStateCAS } = require('../lib/stateWrite');

const { pool } = require('../lib/pool');

const DAYS = 3;                 // enough to catch anything a run or two ago missed
const CONCURRENCY = 4;
const START_BUDGET_MS = 20_000; // stop starting accounts after this; in-flight ones finish

/** One account, exactly as the serial loop did it. → outcome string. */
async function syncOne(userId, env) {
  const accessToken = await getFreshToken(userId, env);
  if (!accessToken) return 'skipped';

  const { vitals, burn } = await fetchOuraData(accessToken, DAYS);
  if (!Object.keys(vitals).length && !Object.keys(burn).length) return 'skipped';

  // Read, merge, compare-and-set write (lib/stateWrite.js): a client
  // save that lands between our read and our write is never
  // overwritten. Additive merge only; no state yet → no junk row.
  const outcome = await mergeStateCAS(userId, st => mergeOuraIntoState(st, vitals, burn), env);
  if (outcome === 'missing') return 'skipped';
  if (outcome === 'conflict') return 'conflicted';
  return 'synced';
}

exports.handler = async (event) => {
  const denied = requireScheduler(event, { 'Content-Type': 'application/json' }, 'CRON_SECRET');
  if (denied) return denied;
  if (pausedCron('sync', 'oura-cron')) return { statusCode: 200, body: JSON.stringify({ paused: true, area: 'sync' }) };

  const env = process.env;
  if (!env.OURA_CLIENT_ID || !env.OURA_CLIENT_SECRET || !env.SUPABASE_URL || !sbKeys.serviceKey(env)) {
    // Not an error worth alerting on: the integration is simply not
    // configured on this site yet.
    console.info('oura-cron: not configured, nothing to do');
    return { statusCode: 200 };
  }

  // Least-recently-touched first, so a run that hits the time
  // budget resumes with the accounts it did not reach rather than
  // starving them forever behind the same head of the list.
  const tokRes = await sb('oura_tokens?select=user_id&order=updated_at.asc', {}, env);
  if (!tokRes.ok) {
    // 404 here means the table hasn't been created yet — the SQL in
    // supabase/oura_schema.sql is approval-gated and run by hand.
    console.error('oura-cron: token list failed', tokRes.status);
    return { statusCode: 502 };
  }
  const rows = await tokRes.json().catch(() => []);

  // A bounded pool (item 93), like whoop-cron: CONCURRENCY accounts at
  // once, oldest first; stop STARTING at the deadline and let in-flight
  // accounts finish — 20 s leaves them room inside Netlify's 30 s
  // scheduled limit. A run killed mid-account can die between Oura
  // rotating a refresh token and us storing it, which disconnects that
  // user; stopping early only costs a deferral to the next run.
  // Oura's limit (5,000 requests per 5 minutes, per Oura's API terms as
  // summarised by integrators) is far above what one run can spend
  // (~5 calls an account), so there is no request budget here, and one
  // run a day stays enough until the log shows accounts "not reached" —
  // then add runs as whoop-cron does.
  const { results, notReached } = await pool(rows, CONCURRENCY,
    ({ user_id: userId }) => syncOne(userId, env),
    { deadline: Date.now() + START_BUDGET_MS });

  const count = { synced: 0, skipped: 0, conflicted: 0, failed: 0 };
  for (const r of results) {
    if (r.ok) count[r.value] = (count[r.value] || 0) + 1;
    else {
      console.error('oura-cron: user sync failed', r.item.user_id, r.error?.message);
      count.failed++;
    }
  }

  console.info(`oura-cron: ${count.synced} synced, ${count.skipped} skipped, ${count.failed} failed, ${count.conflicted} busy (retry next run), ${notReached} not reached (next run), of ${rows.length}`);
  return { statusCode: 200 };
};
