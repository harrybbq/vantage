/**
 * Netlify function: oura-sync
 *
 * Pulls the caller's recent Oura data (sleep, readiness, activity,
 * workouts) and RETURNS it mapped to Vantage's store shapes — it never
 * writes user_data.state itself. The client merges via update(), so
 * every write flows through the normal save pipeline and its anti-wipe
 * guards (no server/client write races).
 *
 * POST, Bearer Supabase JWT. Body: { days?: number } (default 7,
 * max 30). Token refresh + mapping live in ../lib/oura (shared with the
 * scheduled oura-cron so the two paths never drift).
 *
 * Returns { ok, vitals:{date:{sleep,rhr,hrv,recovery,burnKcal}},
 *           burn:{date:[{id,label,kcal}]}, warnings:[string] },
 * or 502 { error, reconnect } with a cause the user can act on.
 */
const { pauseGate } = require('../lib/killSwitch');
const { getFreshToken, fetchOuraData } = require('../lib/oura');
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { consentGate } = require('../lib/consentGate');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const pausedRes = pauseGate('sync', CORS);
  if (pausedRes) return pausedRes;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const env = process.env;
  if (!env.OURA_CLIENT_ID || !env.OURA_CLIENT_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Oura is not set up on this site yet.' }) };
  }

  // Identity from the verified token, plus a per-account brake:
  // one sync fans out to four upstream calls, and the endpoint is
  // now open to every user rather than just the owner.
  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const userId = auth.userId;
  if (!underLimit('oura-sync', userId, 6)) return tooMany(CORS);
  // Declined / withdrawn health consent stops the pull here too, not
  // only in the app (item 98). Never-asked accounts keep syncing, as the
  // app does.
  const noConsent = await consentGate(userId, 'health', CORS);
  if (noConsent) return noConsent;

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* fine */ }
  const days = Math.min(30, Math.max(1, parseInt(body.days) || 7));

  try {
    const accessToken = await getFreshToken(userId, env);
    if (!accessToken) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'not connected' }) };
    const { vitals, burn, warnings } = await fetchOuraData(accessToken, days);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, days, vitals, burn, warnings: warnings || [] }) };
  } catch (e) {
    // Item 127 / gap C12: say what went wrong — a revoked grant or a
    // lapsed membership used to come back as "Synced 0 days". `reconnect`
    // = only re-authorising helps (a 403 membership lapse does not need
    // a reconnect, so it is not flagged).
    console.error('oura-sync failed', e.ouraStatus || '', e.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({
        error: e.message || 'oura sync failed',
        reconnect: e.ouraStatus === 400 || e.ouraStatus === 401,
      }),
    };
  }
};
