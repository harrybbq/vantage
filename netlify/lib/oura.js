/**
 * Shared Oura helpers — the exact counterpart of ../lib/whoop.js, used
 * by both the client-triggered `oura-sync` (which RETURNS mapped data
 * for the app to merge) and the scheduled `oura-cron` (which merges +
 * writes server-side).
 *
 * Keeping the token refresh + mapping in one place means the passive
 * sync and the on-demand sync can never drift apart.
 *
 * ── How Oura differs from WHOOP, and what that costs ────────────────
 * The OAuth flow is the same shape, but the data model isn't:
 *
 *   sleep     ← sleep.total_sleep_duration (seconds, not milli-stages)
 *   rhr       ← sleep.lowest_heart_rate
 *   hrv       ← sleep.average_hrv          (Oura reports RMSSD in ms,
 *                                           same unit WHOOP does)
 *   recovery  ← daily_readiness.score      (0-100, same scale as WHOOP
 *                                           recovery, so it drops into
 *                                           the existing UI unchanged)
 *   burnKcal  ← daily_activity.total_calories
 *   strain    ← nothing. Oura has an activity score and MET minutes but
 *               no strain analogue. Inventing a conversion would put a
 *               made-up number on the same axis as a measured one, so
 *               the field is simply left unset and the chart skips it.
 *
 * Both wearables write into the same vitalsLog rows. Their burn entries
 * are namespaced (`oura-` / `whoop-`) so they never clobber each other.
 * For overlapping vitals fields the later sync wins — see
 * mergeOuraIntoState.
 */
const API = 'https://api.ouraring.com/v2/usercollection';
const TOKEN_URL = 'https://api.ouraring.com/oauth/token';

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
// when the user has no Oura connection.
async function getFreshToken(userId, env) {
  const res = await sb(`oura_tokens?user_id=eq.${userId}&select=*`, {}, env);
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
      client_id: env.OURA_CLIENT_ID,
      client_secret: env.OURA_CLIENT_SECRET,
    }),
  });
  if (!ref.ok) throw new Error('oura token refresh failed — reconnect Oura');
  const tok = await ref.json();
  await sb(`oura_tokens?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      access_token: tok.access_token,
      // Oura rotates refresh tokens; keep the old one if it doesn't.
      refresh_token: tok.refresh_token || row.refresh_token,
      expires_at: new Date(Date.now() + (tok.expires_in || 86400) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  }, env);
  return tok.access_token;
}

const ymd = d => d.toISOString().slice(0, 10);

/** Paginated GET of an Oura v2 collection between start/end (YYYY-MM-DD).
 *  Oura returns { data: [...], next_token }. A non-OK response is
 *  tolerated so one unavailable scope can't fail the whole sync. */
async function ouraList(path, accessToken, startDate, endDate) {
  const out = [];
  let nextToken = null;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
    if (nextToken) params.set('next_token', nextToken);
    const res = await fetch(`${API}${path}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) break;
    const json = await res.json().catch(() => ({}));
    out.push(...(json.data || []));
    nextToken = json.next_token || null;
    if (!nextToken) break;
  }
  return out;
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// PURE: map raw Oura collections → Vantage store shapes. No I/O, so
// it's unit-testable and identical across both sync paths.
//   → { vitals: { 'YYYY-MM-DD': { sleep, rhr, hrv, recovery, burnKcal } },
//       burn:   { 'YYYY-MM-DD': [ { id, label, kcal } ] } }
function mapOura({ sleeps = [], readiness = [], activity = [], workouts = [] }) {
  const vitals = {};
  const at = d => (vitals[d] = vitals[d] || {});

  for (const s of sleeps) {
    // Oura logs naps and plain "rest" as their own records. Only the
    // main nightly sleep should set the day's sleep figure, or a
    // twenty-minute nap overwrites eight hours.
    if (s.type && s.type !== 'long_sleep' && s.type !== 'sleep') continue;
    const d = s.day;
    if (!d) continue;
    const secs = num(s.total_sleep_duration);
    if (secs > 0) at(d).sleep = Math.round((secs / 3600) * 10) / 10;
    const rhr = num(s.lowest_heart_rate);
    if (rhr) at(d).rhr = Math.round(rhr);
    const hrv = num(s.average_hrv);
    if (hrv) at(d).hrv = Math.round(hrv);
  }

  for (const r of readiness) {
    if (!r.day) continue;
    const score = num(r.score);
    if (score != null) at(r.day).recovery = Math.round(score);
  }

  for (const a of activity) {
    if (!a.day) continue;
    // Whole-day energy expenditure including resting — the same thing
    // WHOOP's cycle kilojoule figure represents, so the Calories Burned
    // widget reads it identically.
    const total = num(a.total_calories);
    if (total > 0) at(a.day).burnKcal = Math.round(total);
  }

  const burn = {};
  for (const w of workouts) {
    const d = w.day || (w.start_datetime || '').slice(0, 10);
    const kcal = Math.round(num(w.calories) || 0);
    if (!d || kcal <= 0) continue;
    (burn[d] = burn[d] || []).push({
      id: `oura-${w.id || d + '-' + (burn[d]?.length || 0)}`,
      label: w.activity ? `Oura · ${w.activity}` : 'Oura workout',
      kcal,
    });
  }

  return { vitals, burn };
}

// Fetch + map the last `days` of Oura data for an access token.
async function fetchOuraData(accessToken, days = 7) {
  const end = ymd(new Date());
  // +1 day on the end date: Oura's daily endpoints are inclusive of
  // start_date but a sleep that ends this morning is filed under today,
  // and asking for tomorrow costs nothing while avoiding an off-by-one
  // that silently drops the most recent night.
  const endPlus = ymd(new Date(Date.now() + 86400000));
  const start = ymd(new Date(Date.now() - days * 86400000));
  const [sleeps, readiness, activity, workouts] = await Promise.all([
    ouraList('/sleep', accessToken, start, endPlus),
    ouraList('/daily_readiness', accessToken, start, endPlus),
    ouraList('/daily_activity', accessToken, start, endPlus),
    ouraList('/workout', accessToken, start, endPlus),
  ]);
  void end;
  return mapOura({ sleeps, readiness, activity, workouts });
}

// PURE: merge synced Oura data into an app state object — the exact
// same merge the client's OuraPanel does, so the passive write and the
// on-demand write produce identical results.
//
// Additive only: it never removes user data. Burn entries replace prior
// `oura-` ones and leave `whoop-` (and manual) entries untouched, so a
// user with both devices keeps both sets.
function mergeOuraIntoState(state, vitals, burn) {
  const vitalsLog = { ...(state.vitalsLog || {}) };
  for (const [d, v] of Object.entries(vitals || {})) vitalsLog[d] = { ...(vitalsLog[d] || {}), ...v };
  const burnLog = { ...(state.burnLog || {}) };
  for (const [d, entries] of Object.entries(burn || {})) {
    const others = (burnLog[d] || []).filter(a => !String(a.id || '').startsWith('oura-'));
    burnLog[d] = [...others, ...entries];
  }
  return { ...state, vitalsLog, burnLog, ouraConnected: true };
}

module.exports = { sb, getFreshToken, ouraList, mapOura, fetchOuraData, mergeOuraIntoState };
