/**
 * Netlify scheduled function: whoop-cron
 *
 * Passive WHOOP sync. Runs on a schedule (see netlify.toml) and, for
 * every connected account, pulls the last few days of WHOOP data and
 * merges it straight into user_data.state server-side — so vitals show
 * up without the user ever opening the app.
 *
 * Scheduled for the early-morning window (~06:00 UTC), when:
 *   - WHOOP has finalised the overnight recovery + sleep scores, and
 *   - the app is almost certainly closed, so the read-modify-write of
 *     the state blob can't race a concurrent client save.
 * The merge is additive (mergeWhoopIntoState) — it only ever adds
 * vitals/burn, never removes user data — and we skip the write entirely
 * when there's nothing new, keeping DB writes minimal (Micro-friendly).
 *
 * Intra-day workouts still land via the app's on-open sync; webhooks
 * would be the path to intra-day passive updates.
 */
const { sb, getFreshToken, fetchWhoopData, mergeWhoopIntoState } = require('../lib/whoop');

const DAYS = 3; // enough to catch anything a run or two ago missed

exports.handler = async () => {
  const env = process.env;
  if (!env.WHOOP_CLIENT_ID || !env.WHOOP_CLIENT_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('whoop-cron: missing env');
    return { statusCode: 500 };
  }

  // Every connected account.
  const tokRes = await sb('whoop_tokens?select=user_id', {}, env);
  if (!tokRes.ok) {
    console.error('whoop-cron: token list failed', tokRes.status);
    return { statusCode: 502 };
  }
  const rows = await tokRes.json().catch(() => []);
  let synced = 0, skipped = 0, failed = 0;

  for (const { user_id: userId } of rows) {
    try {
      const accessToken = await getFreshToken(userId, env);
      if (!accessToken) { skipped++; continue; }

      const { vitals, burn } = await fetchWhoopData(accessToken, DAYS);
      if (!Object.keys(vitals).length && !Object.keys(burn).length) { skipped++; continue; }

      // Read current state, merge, write back. Additive merge only.
      const stRes = await sb(`user_data?id=eq.${userId}&select=state`, {}, env);
      if (!stRes.ok) { failed++; continue; }
      const state = (await stRes.json().catch(() => []))[0]?.state;
      if (!state || typeof state !== 'object') { skipped++; continue; } // no app data yet — don't create junk

      const next = mergeWhoopIntoState(state, vitals, burn);
      const wr = await sb(`user_data?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ state: next, updated_at: new Date().toISOString() }),
      }, env);
      if (!wr.ok) { failed++; continue; }
      synced++;
    } catch (e) {
      console.error('whoop-cron: user sync failed', userId, e?.message);
      failed++;
    }
  }

  console.info(`whoop-cron: ${synced} synced, ${skipped} skipped, ${failed} failed of ${rows.length}`);
  return { statusCode: 200 };
};
