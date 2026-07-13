/**
 * Shared WHOOP helpers — used by both the client-triggered `whoop-sync`
 * function (which RETURNS mapped data for the app to merge) and the
 * scheduled `whoop-cron` function (which merges + writes server-side).
 *
 * Keeping the token refresh + mapping in one place means the passive
 * sync and the on-demand sync can never drift apart.
 */
const API = 'https://api.prod.whoop.com/developer';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const KJ_TO_KCAL = 1 / 4.184;
const dayOf = iso => (iso || '').slice(0, 10);

function sb(path, opts, env) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(opts?.headers || {}),
    },
  });
}

// Returns a valid access token for the user, refreshing (and persisting
// the new token) when the current one is within 2 min of expiry. Null
// when the user has no WHOOP connection.
async function getFreshToken(userId, env) {
  const res = await sb(`whoop_tokens?user_id=eq.${userId}&select=*`, {}, env);
  if (!res.ok) throw new Error('token read failed');
  const row = (await res.json())[0];
  if (!row) return null;

  if (new Date(row.expires_at).getTime() - Date.now() > 120_000) return row.access_token;

  const ref = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
      client_id: env.WHOOP_CLIENT_ID,
      client_secret: env.WHOOP_CLIENT_SECRET,
      scope: 'offline',
    }),
  });
  if (!ref.ok) throw new Error('whoop token refresh failed — reconnect WHOOP');
  const tok = await ref.json();
  await sb(`whoop_tokens?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || row.refresh_token,
      expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  }, env);
  return tok.access_token;
}

// Paginated GET of a WHOOP collection between start/end (ISO strings).
async function whoopList(path, accessToken, start, end) {
  const out = [];
  let nextToken = null;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ start, end, limit: '25' });
    if (nextToken) params.set('nextToken', nextToken);
    const res = await fetch(`${API}${path}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) break; // tolerate partial availability (scope not granted, etc.)
    const json = await res.json().catch(() => ({}));
    out.push(...(json.records || []));
    nextToken = json.next_token || json.nextToken || null;
    if (!nextToken) break;
  }
  return out;
}

// PURE: map raw WHOOP collections → Vantage store shapes. No I/O, so
// it's unit-testable and identical across both sync paths.
//   → { vitals: { 'YYYY-MM-DD': { sleep, rhr, hrv, recovery, strain } },
//       burn:   { 'YYYY-MM-DD': [ { id, label, kcal } ] } }
function mapWhoop({ recoveries = [], sleeps = [], workouts = [], cycles = [] }) {
  const vitals = {};
  const at = d => (vitals[d] = vitals[d] || {});

  for (const s of sleeps) {
    if (s.nap) continue;
    const d = dayOf(s.end);
    if (!d) continue;
    const st = s.score?.stage_summary;
    let hours = null;
    if (st) {
      const asleepMs = (st.total_light_sleep_time_milli || 0) + (st.total_rem_sleep_time_milli || 0) + (st.total_slow_wave_sleep_time_milli || 0);
      if (asleepMs > 0) hours = asleepMs / 3600000;
    }
    if (hours == null && s.start && s.end) hours = (new Date(s.end) - new Date(s.start)) / 3600000;
    if (hours > 0) at(d).sleep = Math.round(hours * 10) / 10;
  }

  for (const r of recoveries) {
    const d = dayOf(r.created_at || r.updated_at);
    if (!d) continue;
    const sc = r.score || {};
    if (sc.resting_heart_rate) at(d).rhr = Math.round(sc.resting_heart_rate);
    if (sc.hrv_rmssd_milli) at(d).hrv = Math.round(sc.hrv_rmssd_milli);
    if (sc.recovery_score != null) at(d).recovery = Math.round(sc.recovery_score);
  }

  for (const c of cycles) {
    const d = dayOf(c.start);
    if (!d) continue;
    const sc = c.score || {};
    if (sc.strain != null) at(d).strain = Math.round(sc.strain * 10) / 10;
    // WHOOP's measured all-day energy expenditure (kJ → kcal). This is
    // the whole-day burn (includes resting), stored on the vitals row
    // so the Calories Burned widget can show it and the macros donut
    // can derive active energy from it.
    if (sc.kilojoule != null) at(d).burnKcal = Math.round(sc.kilojoule * KJ_TO_KCAL);
  }

  const burn = {};
  for (const w of workouts) {
    const d = dayOf(w.start);
    const kj = w.score?.kilojoule;
    if (!d || !kj) continue;
    const kcal = Math.round(kj * KJ_TO_KCAL);
    if (kcal <= 0) continue;
    (burn[d] = burn[d] || []).push({
      id: `whoop-${w.id || d + '-' + (burn[d]?.length || 0)}`,
      label: 'WHOOP workout',
      kcal,
    });
  }

  return { vitals, burn };
}

// Fetch + map the last `days` of WHOOP data for an access token.
async function fetchWhoopData(accessToken, days = 7) {
  const end = new Date().toISOString();
  const start = new Date(Date.now() - days * 86400000).toISOString();
  const [recoveries, sleeps, workouts, cycles] = await Promise.all([
    whoopList('/v2/recovery', accessToken, start, end),
    whoopList('/v2/activity/sleep', accessToken, start, end),
    whoopList('/v2/activity/workout', accessToken, start, end),
    whoopList('/v2/cycle', accessToken, start, end),
  ]);
  return mapWhoop({ recoveries, sleeps, workouts, cycles });
}

// PURE: merge synced WHOOP data into an app state object — the exact
// same merge the client's WhoopPanel does, so the passive write and the
// on-demand write produce identical results. Additive only: it never
// removes user data; workout burn entries replace prior `whoop-` ones.
function mergeWhoopIntoState(state, vitals, burn) {
  const vitalsLog = { ...(state.vitalsLog || {}) };
  for (const [d, v] of Object.entries(vitals || {})) vitalsLog[d] = { ...(vitalsLog[d] || {}), ...v };
  const burnLog = { ...(state.burnLog || {}) };
  for (const [d, entries] of Object.entries(burn || {})) {
    const others = (burnLog[d] || []).filter(a => !String(a.id || '').startsWith('whoop-'));
    burnLog[d] = [...others, ...entries];
  }
  return { ...state, vitalsLog, burnLog, whoopConnected: true };
}

module.exports = { sb, getFreshToken, whoopList, mapWhoop, fetchWhoopData, mergeWhoopIntoState };
