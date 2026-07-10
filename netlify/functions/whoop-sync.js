/**
 * Netlify function: whoop-sync
 *
 * Pulls the caller's recent WHOOP data (recovery, sleep, workouts,
 * cycles) and RETURNS it mapped to Vantage's store shapes — it never
 * writes user_data.state itself. The client merges via update(), so
 * every write flows through the normal save pipeline and its
 * anti-wipe guards (no server/client write races).
 *
 * POST, Bearer Supabase JWT. Body: { days?: number } (default 7,
 * max 30). Refreshes the WHOOP token when needed.
 *
 * Returns { ok, vitals:{date:{sleep,rhr,hrv,recovery,strain}},
 *           burn:{date:[{id,label,kcal}]} }
 */
const API = 'https://api.prod.whoop.com/developer';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const KJ_TO_KCAL = 1 / 4.184;
const dayOf = iso => (iso || '').slice(0, 10);

async function sb(path, opts, env) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(opts?.headers || {}),
    },
  });
}

async function getFreshToken(userId, env) {
  const res = await sb(`whoop_tokens?user_id=eq.${userId}&select=*`, {}, env);
  if (!res.ok) throw new Error('token read failed');
  const row = (await res.json())[0];
  if (!row) return null;

  if (new Date(row.expires_at).getTime() - Date.now() > 120_000) return row.access_token;

  // Refresh
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

// Paginated GET of a WHOOP collection between start/end.
async function whoopList(path, accessToken, start, end) {
  const out = [];
  let nextToken = null;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ start, end, limit: '25' });
    if (nextToken) params.set('nextToken', nextToken);
    const res = await fetch(`${API}${path}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) break; // tolerate partial availability (e.g. scope not granted)
    const json = await res.json().catch(() => ({}));
    out.push(...(json.records || []));
    nextToken = json.next_token || json.nextToken || null;
    if (!nextToken) break;
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const env = process.env;
  if (!env.WHOOP_CLIENT_ID || !env.WHOOP_CLIENT_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'WHOOP env missing' }) };
  }

  const jwt = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const userId = (await userRes.json())?.id;
  if (!userId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* fine */ }
  const days = Math.min(30, Math.max(1, parseInt(body.days) || 7));
  const end = new Date().toISOString();
  const start = new Date(Date.now() - days * 86400000).toISOString();

  try {
    const accessToken = await getFreshToken(userId, env);
    if (!accessToken) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'not connected' }) };

    const [recoveries, sleeps, workouts, cycles] = await Promise.all([
      whoopList('/v2/recovery', accessToken, start, end),
      whoopList('/v2/activity/sleep', accessToken, start, end),
      whoopList('/v2/activity/workout', accessToken, start, end),
      whoopList('/v2/cycle', accessToken, start, end),
    ]);

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
      if (c.score?.strain != null) at(d).strain = Math.round(c.score.strain * 10) / 10;
    }

    // Workouts → measured burn entries (replace prior whoop- entries client-side).
    const burn = {};
    for (const w of workouts) {
      const d = dayOf(w.start);
      const kj = w.score?.kilojoule;
      if (!d || !kj) continue;
      const kcal = Math.round(kj * KJ_TO_KCAL);
      if (kcal <= 0) continue;
      (burn[d] = burn[d] || []).push({
        id: `whoop-${w.id || d + '-' + (burn[d]?.length || 0)}`,
        label: `WHOOP workout`,
        kcal,
      });
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, days, vitals, burn }) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message || 'whoop sync failed' }) };
  }
};
