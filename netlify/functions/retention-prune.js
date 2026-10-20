/**
 * Netlify scheduled function: retention-prune (item 96, DPIA G11/G13).
 *
 * Weekly (netlify.toml — Sunday 04:47 UTC, clear of every other cron):
 * deletes old operational rows in small batches through
 * public.retention_prune (supabase/retention_2026_10b.sql):
 *
 *   client_errors        30 days       web_vitals        90 days
 *   rating_snapshots     90 days       coach_nudges      60 days
 *   notifications_queue  30 days after sent (or dead after 5 attempts)
 *   reports              12 months after closing (actioned/dismissed),
 *                        never open ones, never retention_hold = true;
 *                        the evidence snapshot is a column, so it goes
 *                        with the row
 *   function_cache       1 day         ingest_caps       2 days
 *
 * NEVER user content: user_data, nutrition_log, messages, friendships,
 * profiles and the rest are refused by lib/retention.js AND by the SQL
 * function. See that file.
 *
 * Load: ≤ 500 rows a call, oldest first on an index, 250 ms between
 * calls, ≤ 20 calls per table, stop starting at 20 s. Logs one line of
 * counts per run.
 *
 * Kill switch: not in any VANTAGE_PAUSE area (it is not ai/social/sync/
 * push work), but it stops for `VANTAGE_PAUSE=all` or `=retention`:
 * during an incident the rows it would prune — crash reports above
 * all — are evidence, and nothing should be deleting them.
 *
 * Seeing what it would do: run the dry-run query in the header of
 * supabase/retention_2026_10b.sql in the SQL editor (counts only,
 * deletes nothing). Scheduled functions aren't URL-reachable in
 * production (item 48), so `?dry=1` + x-cron-secret only works through
 * `netlify functions:invoke` locally. Until the SQL is run every target
 * reports "retention_prune not installed" and nothing happens.
 */
const sbKeys = require('../lib/sbKeys');
const { requireScheduler } = require('../lib/cronAuth');
const { runRetention } = require('../lib/retention');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function pausedForRetention(raw) {
  return String(raw || '').split(',').map(s => s.trim().toLowerCase())
    .some(v => v === 'all' || v === 'retention');
}

exports.handler = async (event) => {
  const denied = requireScheduler(event, CORS, 'CRON_SECRET');
  if (denied) return denied;
  if (pausedForRetention(process.env.VANTAGE_PAUSE)) {
    console.info('retention-prune: paused by VANTAGE_PAUSE — skipping this run');
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ paused: true }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = sbKeys.serviceKey(process.env);
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'not configured' }) };
  }
  const q = (event && event.queryStringParameters) || {};
  const dryRun = q.dry === '1' || q.dry === 'true';

  const rpc = async (path, body) => {
    const res = await fetch(`${supabaseUrl}${path}`, {
      method: 'POST',
      headers: sbKeys.serviceKeyHeaders(serviceKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const count = await res.json().catch(() => 0);
    return { ok: true, status: res.status, count: Number(count) || 0 };
  };

  const result = await runRetention({ rpc, dryRun });
  const line = Object.entries(result)
    .map(([t, r]) => `${t}=${r.deleted}${r.complete ? '' : r.error ? ` (${r.error})` : r.skipped ? ` (${r.skipped})` : ' (more next run)'}`)
    .join(' ');
  console.info(`retention-prune${dryRun ? ' [dry run: first-batch counts]' : ''}: ${line}`);
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ dryRun, result }) };
};

exports._test = { pausedForRetention };
