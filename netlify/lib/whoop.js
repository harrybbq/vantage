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
  if (!ref.ok) {
    // WHOOP rotates refresh tokens on every use, so there is one benign
    // reason this fails: something else refreshed between our read and
    // our POST, leaving us holding a spent token. The daily cron and the
    // app's on-open sync can genuinely collide. Re-read once — if the row
    // now holds a different, still-valid token, the other side won the
    // race and did the work for us.
    const recheck = await sb(`whoop_tokens?user_id=eq.${userId}&select=*`, {}, env).catch(() => null);
    if (recheck?.ok) {
      const fresh = (await recheck.json().catch(() => []))[0];
      if (fresh && fresh.access_token !== row.access_token &&
          new Date(fresh.expires_at).getTime() - Date.now() > 120_000) {
        return fresh.access_token;
      }
    }
    // Otherwise the stored token really is spent or revoked, and no
    // amount of retrying will help — say so, and carry the status.
    const detail = await ref.text().catch(() => '');
    const err = new Error(
      ref.status === 400 || ref.status === 401
        ? 'WHOOP sign-in has expired — reconnect WHOOP below.'
        : `WHOOP refused to refresh the connection (${ref.status}).`
    );
    err.whoopStatus = ref.status;
    err.whoopDetail = detail.slice(0, 200);
    throw err;
  }
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

/**
 * Human-readable cause for a WHOOP HTTP status. The status alone tells
 * the user nothing, and "sync failed" tells them nothing they can act
 * on — 401 and 429 need completely different responses from them.
 */
function whoopReason(status) {
  if (status === 401) return 'WHOOP rejected our access — reconnect WHOOP below.';
  if (status === 403) return 'WHOOP denied access to this data — reconnect and allow all permissions.';
  if (status === 404) return 'WHOOP no longer offers this endpoint — the app needs updating.';
  if (status === 429) return 'WHOOP is rate-limiting us — try again in a few minutes.';
  if (status >= 500) return 'WHOOP is having problems right now — try again later.';
  return `WHOOP returned ${status}.`;
}

/**
 * Paginated GET of a WHOOP collection between start/end (ISO strings).
 *
 * Returns { records, error } rather than a bare array. It used to
 * `break` on any non-OK response and return whatever it had, which
 * collapsed "you didn't grant this scope" and "our token is dead" and
 * "WHOOP is down" into the same answer as "you have no data" — an empty
 * list. With a dead token all four collections came back empty, the
 * sync reported success, and the only symptom anywhere in the system
 * was that nothing ever changed. That is not a failure a user can
 * report accurately, which is the whole problem.
 */
async function whoopList(path, accessToken, start, end) {
  const out = [];
  let nextToken = null;
  let error = null;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ start, end, limit: '25' });
    if (nextToken) params.set('nextToken', nextToken);
    let res;
    try {
      res = await fetch(`${API}${path}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch (e) {
      error = { path, status: 0, reason: `Could not reach WHOOP (${e.message || 'network error'}).` };
      break;
    }
    if (!res.ok) { error = { path, status: res.status, reason: whoopReason(res.status) }; break; }
    const json = await res.json().catch(() => ({}));
    out.push(...(json.records || []));
    nextToken = json.next_token || json.nextToken || null;
    if (!nextToken) break;
  }
  return { records: out, error };
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

/**
 * Fetch + map the last `days` of WHOOP data for an access token.
 *
 * → { vitals, burn, warnings: string[] }
 *
 * One collection failing is survivable — a user who declined the
 * workout scope should still get their sleep — so those become
 * warnings. ALL of them failing is not survivable and is not a quiet
 * empty result: it means the token, the scopes or the API itself is
 * broken, so it throws with a cause the user can act on.
 */
async function fetchWhoopData(accessToken, days = 7) {
  const end = new Date().toISOString();
  const start = new Date(Date.now() - days * 86400000).toISOString();
  const [recoveries, sleeps, workouts, cycles] = await Promise.all([
    whoopList('/v2/recovery', accessToken, start, end),
    whoopList('/v2/activity/sleep', accessToken, start, end),
    whoopList('/v2/activity/workout', accessToken, start, end),
    whoopList('/v2/cycle', accessToken, start, end),
  ]);

  const parts = [recoveries, sleeps, workouts, cycles];
  const errors = parts.map(p => p.error).filter(Boolean);
  if (errors.length === parts.length) {
    // Every collection refused. Report the most actionable status: an
    // auth failure is the one the user can actually fix.
    const auth = errors.find(e => e.status === 401 || e.status === 403);
    const lead = auth || errors[0];
    const err = new Error(lead.reason);
    err.whoopStatus = lead.status;
    throw err;
  }

  const mapped = mapWhoop({
    recoveries: recoveries.records,
    sleeps: sleeps.records,
    workouts: workouts.records,
    cycles: cycles.records,
  });
  return { ...mapped, warnings: [...new Set(errors.map(e => e.reason))] };
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

module.exports = { sb, getFreshToken, whoopList, whoopReason, mapWhoop, fetchWhoopData, mergeWhoopIntoState };
