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
const { sb, getFreshToken, fetchOuraData, mergeOuraIntoState } = require('../lib/oura');

const DAYS = 3; // enough to catch anything a run or two ago missed

exports.handler = async () => {
  const env = process.env;
  if (!env.OURA_CLIENT_ID || !env.OURA_CLIENT_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    // Not an error worth alerting on: the integration is simply not
    // configured on this site yet.
    console.info('oura-cron: not configured, nothing to do');
    return { statusCode: 200 };
  }

  const tokRes = await sb('oura_tokens?select=user_id', {}, env);
  if (!tokRes.ok) {
    // 404 here means the table hasn't been created yet — the SQL in
    // supabase/oura_schema.sql is approval-gated and run by hand.
    console.error('oura-cron: token list failed', tokRes.status);
    return { statusCode: 502 };
  }
  const rows = await tokRes.json().catch(() => []);
  let synced = 0, skipped = 0, failed = 0;

  for (const { user_id: userId } of rows) {
    try {
      const accessToken = await getFreshToken(userId, env);
      if (!accessToken) { skipped++; continue; }

      const { vitals, burn } = await fetchOuraData(accessToken, DAYS);
      if (!Object.keys(vitals).length && !Object.keys(burn).length) { skipped++; continue; }

      const stRes = await sb(`user_data?id=eq.${userId}&select=state`, {}, env);
      if (!stRes.ok) { failed++; continue; }
      const state = (await stRes.json().catch(() => []))[0]?.state;
      if (!state || typeof state !== 'object') { skipped++; continue; } // no app data yet — don't create junk

      const next = mergeOuraIntoState(state, vitals, burn);
      const wr = await sb(`user_data?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ state: next, updated_at: new Date().toISOString() }),
      }, env);
      if (!wr.ok) { failed++; continue; }
      synced++;
    } catch (e) {
      console.error('oura-cron: user sync failed', userId, e?.message);
      failed++;
    }
  }

  console.info(`oura-cron: ${synced} synced, ${skipped} skipped, ${failed} failed of ${rows.length}`);
  return { statusCode: 200 };
};
