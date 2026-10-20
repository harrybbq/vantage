/**
 * Retention policy + runner (item 96, DPIA G11/G13).
 *
 * Deletes OLD OPERATIONAL ROWS — logs, telemetry, delivered
 * notifications, expired caches, closed moderation reports — in small
 * batches through one SQL function, public.retention_prune
 * (supabase/retention_2026_10b.sql). The windows live in that function;
 * TARGETS below mirrors them for logging, and efficiency.test.mjs fails
 * the build if the two ever disagree.
 *
 * ── NEVER user content ──────────────────────────────────────────────────
 * user_data, user_data_history, nutrition_log, messages, friendships,
 * profiles, push_tokens, blocks, groups and every other table holding
 * what a user made are NOT retention targets and can't become one by
 * accident: buildPruneCall refuses any name outside TARGETS, refuses the
 * NEVER list outright even if someone adds it to TARGETS, and the SQL
 * function raises for any target it doesn't name. User content goes
 * only when the user deletes it or their account (item 20 cascade).
 *
 * Load: each call deletes at most BATCH rows, chosen oldest-first on an
 * index; the runner sleeps between batches, caps batches per target, and
 * stops starting new work at the time budget. The first run after the
 * SQL lands may take a few weekly runs to clear a backlog — by design.
 */

const TARGETS = [
  { target: 'client_errors',       days: 30,  what: 'crash reports' },
  { target: 'web_vitals',          days: 90,  what: 'anonymous page-speed samples' },
  { target: 'rating_snapshots',    days: 90,  what: 'daily rating snapshots (readers need ≤ 21 days)' },
  { target: 'notifications_queue', days: 30,  what: 'sent / dead push queue rows' },
  { target: 'coach_nudges',        days: 60,  what: 'AI coach nudges' },
  { target: 'reports',             days: 365, what: 'CLOSED moderation reports (+ evidence snapshot), not on legal hold' },
  { target: 'function_cache',      days: 1,   what: 'expired shared caches' },
  { target: 'ingest_caps',         days: 2,   what: 'hourly ingest counters' },
];

/** Tables that hold user content. Never a target, whatever TARGETS says. */
const NEVER = new Set([
  'user_data', 'user_data_history', 'nutrition_log', 'messages', 'friendships',
  'profiles', 'push_tokens', 'blocks', 'groups', 'group_members', 'tracker_streaks',
  'food_contributions', 'whoop_connections', 'oura_connections', 'bank_connections',
  'ai_usage', 'public_stats',
]);

const BATCH = 500;
const MAX_BATCHES_PER_TARGET = 20; // ≤ 10k rows per target per run
const PAUSE_MS = 250;
const BUDGET_MS = 20_000;          // Netlify scheduled functions get ~30 s

/** → { path, body } for one batch, or throws for anything not allowed. */
function buildPruneCall(target, { limit = BATCH, dryRun = false } = {}) {
  const t = String(target || '');
  if (NEVER.has(t)) throw new Error(`retention: ${t} holds user content — never a retention target`);
  if (!TARGETS.some(x => x.target === t)) throw new Error(`retention: ${t} is not a retention target`);
  const lim = Math.max(1, Math.min(2000, Math.floor(Number(limit) || BATCH)));
  return { path: '/rest/v1/rpc/retention_prune', body: { p_target: t, p_limit: lim, p_dry_run: !!dryRun } };
}

/**
 * Run every target. `rpc(path, body)` → { ok, status, count } (count =
 * rows deleted, or would-be-deleted on a dry run). Never throws; each
 * target's outcome is in the result.
 */
async function runRetention({
  rpc, dryRun = false, batch = BATCH, maxBatches = MAX_BATCHES_PER_TARGET,
  pauseMs = PAUSE_MS, budgetMs = BUDGET_MS, now = () => Date.now(),
  sleep = ms => new Promise(r => setTimeout(r, ms)), targets = TARGETS,
} = {}) {
  const started = now();
  const out = {};
  for (const { target } of targets) {
    const res = { deleted: 0, batches: 0, complete: false };
    out[target] = res;
    if (now() - started > budgetMs) { res.skipped = 'time budget'; continue; }
    let call;
    try { call = buildPruneCall(target, { limit: batch, dryRun }); } catch (e) { res.error = e.message; continue; }
    // A dry run asks once: "how many would the first batch take".
    const cap = dryRun ? 1 : maxBatches;
    while (res.batches < cap) {
      let r;
      try { r = await rpc(call.path, call.body); } catch { r = { ok: false, status: 0 }; }
      res.batches++;
      if (!r || !r.ok) {
        // 404 = SQL not run yet (no function); 400 = its table is missing.
        res.error = r && r.status === 404 ? 'retention_prune not installed' : `failed (${r ? r.status : 0})`;
        break;
      }
      const c = Number(r.count) || 0;
      res.deleted += c;
      if (c < call.body.p_limit) { res.complete = true; break; }
      if (now() - started > budgetMs) { res.skipped = 'time budget'; break; }
      await sleep(pauseMs);
    }
  }
  return out;
}

module.exports = { TARGETS, NEVER, BATCH, MAX_BATCHES_PER_TARGET, buildPruneCall, runRetention };
