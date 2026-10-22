/**
 * Netlify function: whoop-sync
 *
 * Pulls the caller's recent WHOOP data (recovery, sleep, workouts,
 * cycles) and RETURNS it mapped to Vantage's store shapes — it never
 * writes user_data.state itself. The client merges via update(), so
 * every write flows through the normal save pipeline and its
 * anti-wipe guards (no server/client write races).
 *
 * POST, Bearer Supabase JWT. Body: { days?: number, auto?: true }
 * (days default 7, max 30; `auto` marks the app's on-open sync). Token
 * refresh + mapping live in ../lib/whoop (shared with the scheduled
 * whoop-cron so the two paths never drift).
 *
 * Returns { ok, vitals:{date:{sleep,rhr,hrv,recovery,strain}},
 *           burn:{date:[{id,label,kcal}]} }
 *
 * WHOOP's request budget (gap C13; lib/whoop.js syncSkip/rateBackoff):
 *   · an `auto` sync for an account synced in the last hour returns
 *     200 { ok, skipped: 'recent', vitals: {}, burn: {} } without calling
 *     WHOOP. The app ignores it: nothing is merged, no error is recorded.
 *     Manual syncs and the one after a connect send no `auto`, so they
 *     always run — and so does every older client, which never sends it.
 *   · a 429 from WHOOP, or X-RateLimit-Remaining nearly spent, holds this
 *     instance off WHOOP until the reset and answers
 *     429 { error: <calm words>, rateLimited: true, retryAfterSec }.
 *     The app shows the words on a manual sync and stays quiet on a
 *     background one; nothing is written either way.
 * whoop-cron does not come through here, so neither brake can block it.
 */
const { pauseGate } = require('../lib/killSwitch');
const { sb, getFreshToken, fetchWhoopData, whoopReason, syncSkip, rateBackoff } = require('../lib/whoop');
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { consentGate } = require('../lib/consentGate');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// Module scope: when WHOOP says the app is over its limit, this warm
// instance stops asking until the reset instead of spending more calls
// on refusals. Best effort — a cold instance starts at zero and learns
// from its first 429.
let backoffUntil = 0;

function rateLimited(now = Date.now()) {
  const retryAfterSec = Math.max(1, Math.ceil((backoffUntil - now) / 1000));
  return {
    statusCode: 429,
    headers: { ...CORS, 'Retry-After': String(retryAfterSec) },
    body: JSON.stringify({ error: whoopReason(429), rateLimited: true, retryAfterSec }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const pausedRes = pauseGate('sync', CORS);
  if (pausedRes) return pausedRes;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const env = process.env;
  if (!env.WHOOP_CLIENT_ID || !env.WHOOP_CLIENT_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'WHOOP is not set up on this site yet.' }) };
  }

  // Identity from the verified token, plus a per-account brake:
  // one sync fans out to four upstream calls, and the endpoint is
  // now open to every user rather than just the owner.
  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const userId = auth.userId;
  if (!underLimit('whoop-sync', userId, 6)) return tooMany(CORS);
  // Declined / withdrawn health consent stops the pull here too, not
  // only in the app (item 98). Never-asked accounts keep syncing, as the
  // app does.
  const noConsent = await consentGate(userId, 'health', CORS);
  if (noConsent) return noConsent;

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* fine */ }
  const days = Math.min(30, Math.max(1, parseInt(body.days) || 7));
  const auto = body.auto === true;

  // On-open syncs only: when was this account last synced? One small
  // read that saves ~5 WHOOP calls whenever it says "recent".
  let updatedAt = null;
  if (auto && !(backoffUntil > Date.now())) {
    const stampRes = await sb(`whoop_tokens?user_id=eq.${userId}&select=updated_at`, {}, env).catch(() => null);
    if (stampRes && stampRes.ok) {
      const row = (await stampRes.json().catch(() => []))[0];
      if (!row) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'not connected' }) };
      updatedAt = row.updated_at || null;
    }
    // A failed read skips nothing: the sync below runs as it always has.
  }
  const skip = syncSkip({ auto, updatedAt, now: Date.now(), backoffUntil });
  if (skip === 'rate-limited') return rateLimited();
  if (skip === 'recent') {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, skipped: 'recent', days, vitals: {}, burn: {}, warnings: [] }),
    };
  }

  try {
    const accessToken = await getFreshToken(userId, env);
    if (!accessToken) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'not connected' }) };
    const { vitals, burn, warnings, rate } = await fetchWhoopData(accessToken, days);
    // Nearly spent (or a partial 429): this sync keeps what it got, and
    // the next ones wait for the reset.
    if (rate) backoffUntil = Math.max(backoffUntil, rateBackoff({ ...rate, now: Date.now() }));
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, days, vitals, burn, warnings: warnings || [] }),
    };
  } catch (e) {
    if (e.whoopStatus === 429) {
      // WHOOP's app-wide limit: not this user's fault, not a broken
      // connection. Back off and say so calmly; no retry from here.
      backoffUntil = Math.max(backoffUntil, rateBackoff({ ...(e.rate || {}), status: 429, now: Date.now() }));
      console.warn('whoop-sync: WHOOP rate limit — backing off', Math.round((backoffUntil - Date.now()) / 1000), 's');
      return rateLimited();
    }
    // `reconnect` tells the client this is terminal until the user
    // re-authorises, so it can show the Connect button rather than a
    // "try again" that will fail identically every time.
    console.error('whoop-sync failed', userId, e.whoopStatus || '', e.message, e.whoopDetail || '');
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({
        error: e.message || 'whoop sync failed',
        reconnect: e.whoopStatus === 400 || e.whoopStatus === 401 || e.whoopStatus === 403,
      }),
    };
  }
};
