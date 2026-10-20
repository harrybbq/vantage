/**
 * Netlify scheduled function: whoop-cron
 *
 * Passive WHOOP sync. Runs on a schedule (see netlify.toml) and, for
 * every connected account, pulls the last few days of WHOOP data and
 * merges it straight into user_data.state server-side — so vitals show
 * up without the user ever opening the app.
 *
 * Scheduled for the early-morning window (06:00–08:50 UTC), when:
 *   - WHOOP has finalised the overnight recovery + sleep scores, and
 *   - the app is almost certainly closed, so the read-modify-write of
 *     the state blob rarely meets a concurrent client save (and when it
 *     does, the compare-and-set write in lib/stateWrite.js refuses to
 *     overwrite it).
 * The merge is additive (mergeWhoopIntoState) — it only ever adds
 * vitals/burn, never removes user data — and we skip the write entirely
 * when there's nothing new, keeping DB writes minimal (Micro-friendly).
 *
 * ── Reaching every user (item 93) ───────────────────────────────────
 * It used to sync accounts one by one inside a 20 s budget: ~10–20 a
 * night, and everyone after that never got a passive sync. Now:
 *   · a bounded pool (CONCURRENCY at once, lib/pool.js), oldest token
 *     `updated_at` first;
 *   · it stops STARTING accounts at the deadline and lets in-flight ones
 *     finish (still well inside Netlify's 30 s scheduled limit);
 *   · WHOOP's limits are 100 requests/minute and 10,000/day per app
 *     (developer.whoop.com → Rate Limiting; shared with the app's own
 *     on-open sync). An account costs ~5 WHOOP calls (token refresh +
 *     four collections), so one run spends at most WHOOP_BUDGET (60) —
 *     well under 100/min even with clients syncing at the same time;
 *   · so it runs several times each morning (netlify.toml: every 10 min
 *     from 06:00 to 08:50 UTC, skipping :30 when oura-cron runs), and
 *     each run skips accounts whose token was touched in the last
 *     RECENT_MS — i.e. already synced this morning (a sync refreshes the
 *     one-hour WHOOP token and bumps updated_at), or synced by the app.
 *     15 runs × 12 accounts ≈ 180 accounts a morning for ~900 WHOOP calls,
 *     under a tenth of the daily limit. Past that, ask WHOOP to raise the
 *     limit (developer dashboard) before raising WHOOP_BUDGET.
 * Per account, the order is unchanged: getFreshToken persists the
 * rotated refresh token FIRST (item 53), then the data fetch, then the
 * CAS state write.
 *
 * Intra-day workouts still land via the app's on-open sync; webhooks
 * would be the path to intra-day passive updates.
 */
const { pausedCron } = require('../lib/killSwitch');
const sbKeys = require('../lib/sbKeys');
const { sb, getFreshToken, fetchWhoopData, mergeWhoopIntoState } = require('../lib/whoop');
const { requireScheduler } = require('../lib/cronAuth');
const { mergeStateCAS } = require('../lib/stateWrite');
const { pool } = require('../lib/pool');

const DAYS = 3;                 // enough to catch anything a run or two ago missed
const CONCURRENCY = 4;
const START_BUDGET_MS = 20_000; // stop starting accounts after this; in-flight ones finish
const WHOOP_BUDGET = 60;        // WHOOP requests per run (limit: 100/min, 10,000/day)
const COST_PER_ACCOUNT = 5;     // token refresh + recovery, sleep, workout, cycle
const RECENT_MS = 3 * 3600_000; // token touched this recently → already synced this morning

/** One account, exactly as the serial loop did it. → outcome string. */
async function syncOne(userId, env, spend) {
  spend(1);                     // counted before the call: a dead token still costs one
  const accessToken = await getFreshToken(userId, env);
  if (!accessToken) return 'skipped';

  spend(4);
  const { vitals, burn, warnings } = await fetchWhoopData(accessToken, DAYS);
  if (warnings?.length) console.warn('whoop-cron: partial data for', userId, warnings.join(' | '));
  // A genuinely empty result now means WHOOP had nothing new, not
  // that it refused us — fetchWhoopData throws in that case, so this
  // "skipped" count finally means what it says.
  if (!Object.keys(vitals).length && !Object.keys(burn).length) return 'skipped';

  // Read, merge, compare-and-set write (lib/stateWrite.js): a client
  // save that lands between our read and our write is never
  // overwritten. Additive merge only; no state yet → no junk row.
  const outcome = await mergeStateCAS(userId, st => mergeWhoopIntoState(st, vitals, burn), env);
  if (outcome === 'missing') return 'skipped';
  if (outcome === 'conflict') return 'conflicted';
  return 'synced';
}

exports.handler = async (event) => {
  // Service-role loop over every connected account — not something a
  // web request should be able to start.
  const denied = requireScheduler(event, { 'Content-Type': 'application/json' }, 'CRON_SECRET');
  if (denied) return denied;
  if (pausedCron('sync', 'whoop-cron')) return { statusCode: 200, body: JSON.stringify({ paused: true, area: 'sync' }) };

  const env = process.env;
  if (!env.WHOOP_CLIENT_ID || !env.WHOOP_CLIENT_SECRET || !env.SUPABASE_URL || !sbKeys.serviceKey(env)) {
    console.error('whoop-cron: missing env');
    return { statusCode: 500 };
  }

  // Connected accounts not touched in the last RECENT_MS, least-recently
  // touched first, so a run that stops early resumes with the accounts
  // it did not reach rather than starving them behind the same head.
  const since = encodeURIComponent(new Date(Date.now() - RECENT_MS).toISOString());
  const tokRes = await sb(`whoop_tokens?select=user_id&updated_at=lt.${since}&order=updated_at.asc`, {}, env);
  if (!tokRes.ok) {
    console.error('whoop-cron: token list failed', tokRes.status);
    return { statusCode: 502 };
  }
  const rows = await tokRes.json().catch(() => []);

  // Budget: reserve an account's full cost when it starts, then give
  // back what it did not use (a dead token fails after one call), so
  // revoked accounts at the head of the list cannot crowd out the rest.
  let reserved = 0;
  const { results, notReached } = await pool(rows, CONCURRENCY, ({ user_id: userId }) => {
    reserved += COST_PER_ACCOUNT;               // synchronous: the next canStart() sees it
    let used = 0;
    const spend = k => { used += k; };
    return syncOne(userId, env, spend).finally(() => { reserved -= COST_PER_ACCOUNT - Math.min(used, COST_PER_ACCOUNT); });
  }, {
    deadline: Date.now() + START_BUDGET_MS,
    canStart: () => reserved + COST_PER_ACCOUNT <= WHOOP_BUDGET,
  });

  const count = { synced: 0, skipped: 0, conflicted: 0, failed: 0 };
  for (const r of results) {
    if (r.ok) count[r.value] = (count[r.value] || 0) + 1;
    else {
      const e = r.error;
      console.error('whoop-cron: user sync failed', r.item.user_id, e?.whoopStatus || '', e?.message, e?.whoopDetail || '');
      count.failed++;
    }
  }

  console.info(`whoop-cron: ${count.synced} synced, ${count.skipped} skipped, ${count.failed} failed, ${count.conflicted} busy (retry next run), ${notReached} not reached (next run), of ${rows.length} due; ~${reserved} WHOOP calls`);
  return { statusCode: 200 };
};

module.exports.CONFIG = { CONCURRENCY, START_BUDGET_MS, WHOOP_BUDGET, COST_PER_ACCOUNT, RECENT_MS };
