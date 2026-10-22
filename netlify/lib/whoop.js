/**
 * Shared WHOOP helpers — used by both the client-triggered `whoop-sync`
 * function (which RETURNS mapped data for the app to merge) and the
 * scheduled `whoop-cron` function (which merges + writes server-side).
 *
 * Keeping the token refresh + mapping in one place means the passive
 * sync and the on-demand sync can never drift apart.
 */
const { serviceHeaders } = require('./sbKeys');

const API = 'https://api.prod.whoop.com/developer';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const KJ_TO_KCAL = 1 / 4.184;
const dayOf = iso => (iso || '').slice(0, 10);

// ── The app-wide request budget (gap C13) ───────────────────────────
// WHOOP allows 100 requests/minute and 10,000/day for the WHOOP app as a
// whole — every user's on-open sync and the morning cron share it. Two
// brakes, both pure so they can be tested:
//   · syncSkip: an on-open sync for an account synced in the last hour
//     returns without calling WHOOP. The stamp is whoop_tokens.updated_at,
//     which getFreshToken bumps on every refresh: WHOOP access tokens last
//     an hour (expires_in 3600) and are refreshed inside their last two
//     minutes, so any sync an hour or more after the stamp refreshes and
//     re-stamps. The stamp therefore tracks the last sync that reached
//     WHOOP, with no extra write. (A connect stamps it too; the sync the
//     connect itself starts is not an on-open one, so it still runs.)
//   · rateBackoff: a 429, or X-RateLimit-Remaining at or under a small
//     floor, stops further syncs until WHOOP's reset (or a minute when it
//     gives none). Which window Remaining counts is not assumed — the
//     smallest value seen is treated as the one that binds.
const ON_OPEN_WINDOW_MS = 60 * 60_000;
const RATE_FLOOR = 5;
const DEFAULT_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

/**
 * PURE: should this sync return without calling WHOOP?
 * → 'rate-limited' | 'recent' | null.
 * Only an on-open (`auto`) sync is skipped as recent; a manual one, and
 * the one a connect starts, always runs. A backoff stops both.
 */
function syncSkip({ auto = false, updatedAt = null, now = Date.now(), windowMs = ON_OPEN_WINDOW_MS, backoffUntil = 0 } = {}) {
  if (backoffUntil > now) return 'rate-limited';
  if (!auto) return null;
  const t = Date.parse(updatedAt || '');
  if (!Number.isFinite(t)) return null;
  const age = now - t;
  // A stamp from the future (clock skew) is not trusted to skip.
  return age >= 0 && age < windowMs ? 'recent' : null;
}

/** First integer in a header — some APIs send "98" and some a
 *  per-window list ("98, 9876"); for a list the smallest binds. */
function headerInt(v) {
  if (v == null || v === '') return null;
  const nums = String(v).split(',').map(x => parseInt(x, 10)).filter(Number.isFinite);
  return nums.length ? Math.min(...nums) : null;
}

/** PURE: WHOOP's rate headers → { remaining, resetSec } (nulls when absent). */
function parseRateLimit(headers) {
  const get = k => (headers && typeof headers.get === 'function' ? headers.get(k) : headers && headers[k]);
  return {
    remaining: headerInt(get('x-ratelimit-remaining')),
    resetSec: headerInt(get('x-ratelimit-reset')) ?? headerInt(get('retry-after')),
  };
}

/**
 * PURE: until when to hold off, as a ms timestamp (0 = no backoff).
 * Bounded both ways, so a missing or absurd reset can neither retry
 * immediately nor park syncing for a day.
 */
function rateBackoff({ status = 200, remaining = null, resetSec = null, now = Date.now(), floor = RATE_FLOOR } = {}) {
  const limited = status === 429 || (remaining != null && remaining <= floor);
  if (!limited) return 0;
  const wait = resetSec != null && resetSec > 0
    ? Math.min(MAX_BACKOFF_MS, Math.max(1000, resetSec * 1000))
    : DEFAULT_BACKOFF_MS;
  return now + wait;
}

/** Fold one response's rate headers into a running summary. */
function noteRate(acc, status, headers) {
  const r = parseRateLimit(headers);
  if (r.remaining != null && (acc.remaining == null || r.remaining < acc.remaining)) acc.remaining = r.remaining;
  if (r.resetSec != null && (acc.resetSec == null || r.resetSec > acc.resetSec)) acc.resetSec = r.resetSec;
  if (status === 429) acc.status = 429;
  return acc;
}

// 'YYYY-MM-DDTHH:MM' wall clock where the workout happened, from WHOOP's
// UTC start plus its timezone_offset ('+01:00'); UTC when no offset.
function localStart(iso, offset) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(offset || ''));
  const shift = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000 : 0;
  return new Date(t + shift).toISOString().slice(0, 16);
}

function sb(path, opts, env) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: serviceHeaders(env, opts?.headers || {}),
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
        : ref.status === 429 ? whoopReason(429)
        : `WHOOP refused to refresh the connection (${ref.status}).`
    );
    err.whoopStatus = ref.status;
    err.whoopDetail = detail.slice(0, 200);
    // A 429 here is WHOOP's app-wide limit, not this connection failing;
    // the stored refresh token was not spent, so nothing is lost.
    if (ref.status === 429) err.rate = noteRate({ status: 429, remaining: null, resetSec: null }, 429, ref.headers);
    throw err;
  }
  const tok = await ref.json();
  /* Persist the rotated refresh token BEFORE anything else happens —
     the old one is already spent, so losing this write disconnects the
     user. The result used to go unchecked; now a failure is retried
     once and then logged loudly (the access token still works for this
     run, so the sync itself carries on). */
  const persist = () => sb(`whoop_tokens?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || row.refresh_token,
      expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }),
  }, env);
  let saved = await persist().catch(() => null);
  if (!saved?.ok) saved = await persist().catch(() => null);
  if (!saved?.ok) console.error('whoop: ROTATED TOKEN NOT STORED — user will need to reconnect', saved?.status || 'network');
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
  if (status === 429) return 'WHOOP is busy right now — your data will catch up on the next sync.';
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
  const rate = { status: 200, remaining: null, resetSec: null };
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
    noteRate(rate, res.status, res.headers);
    // Never retried here: a 429 stops this collection at once, and the
    // caller backs off rather than coming straight back.
    if (!res.ok) { error = { path, status: res.status, reason: whoopReason(res.status) }; break; }
    const json = await res.json().catch(() => ({}));
    out.push(...(json.records || []));
    nextToken = json.next_token || json.nextToken || null;
    if (!nextToken) break;
  }
  return { records: out, error, rate };
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
    // Steps: WHOOP added a nullable top-level `Cycle.step_count` on
    // 2026-09-23 under the read:cycles scope we already hold (API
    // changelog; confirmed by two independent integrations — the
    // developer site itself is not reachable from the build machine).
    // Read defensively — top level first, inside `score` as a fallback —
    // and skip null/0, which WHOOP uses when the band wasn't worn all day.
    // Stored under its own key so a user with WHOOP AND Oura (or Apple
    // Health) keeps both counts; the tracker rule takes the highest.
    const steps = Number(c.step_count ?? sc.step_count);
    if (Number.isFinite(steps) && steps > 0) at(d).stepsWhoop = Math.round(steps);
  }

  const burn = {};
  for (const w of workouts) {
    const d = dayOf(w.start);
    const kj = w.score?.kilojoule;
    if (!d || !kj) continue;
    const kcal = Math.round(kj * KJ_TO_KCAL);
    if (kcal <= 0) continue;
    const start = localStart(w.start, w.timezone_offset);
    (burn[d] = burn[d] || []).push({
      id: `whoop-${w.id || d + '-' + (burn[d]?.length || 0)}`,
      label: 'WHOOP workout',
      kcal,
      // Local wall clock it started at, so a 3:30am session after a night
      // shift can count for the shift's day (src/lib/rotation/trainingDay.js).
      ...(start ? { start } : {}),
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
  // The tightest rate picture any of the four calls reported.
  const rate = { status: 200, remaining: null, resetSec: null };
  for (const p of parts) {
    if (!p.rate) continue;
    if (p.rate.status === 429) rate.status = 429;
    if (p.rate.remaining != null && (rate.remaining == null || p.rate.remaining < rate.remaining)) rate.remaining = p.rate.remaining;
    if (p.rate.resetSec != null && (rate.resetSec == null || p.rate.resetSec > rate.resetSec)) rate.resetSec = p.rate.resetSec;
  }
  const errors = parts.map(p => p.error).filter(Boolean);
  if (errors.length === parts.length) {
    // Every collection refused. Report the most actionable status: an
    // auth failure is the one the user can actually fix.
    const auth = errors.find(e => e.status === 401 || e.status === 403);
    const lead = auth || errors[0];
    const err = new Error(lead.reason);
    err.whoopStatus = lead.status;
    err.rate = rate;
    throw err;
  }

  const mapped = mapWhoop({
    recoveries: recoveries.records,
    sleeps: sleeps.records,
    workouts: workouts.records,
    cycles: cycles.records,
  });
  return { ...mapped, warnings: [...new Set(errors.map(e => e.reason))], rate };
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

module.exports = {
  sb, getFreshToken, whoopList, whoopReason, mapWhoop, fetchWhoopData, mergeWhoopIntoState, localStart,
  syncSkip, parseRateLimit, rateBackoff, ON_OPEN_WINDOW_MS, RATE_FLOOR,
};
