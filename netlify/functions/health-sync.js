/**
 * Netlify function: health-sync
 *
 * Live Apple Health → Vantage bridge for the owner (and anyone else
 * we later enable). An iOS Shortcut reads today's Health samples and
 * POSTs them here on a schedule; we write them straight into the
 * user's synced state (user_data.state) — same shape the manual
 * export importer and the Vitals widget use.
 *
 * The user enables sync in-app, which stores a random token in their
 * synced state (state.healthToken). The Shortcut then POSTs here with
 * ?token=…; we resolve it to the user via a JSONB filter on user_data
 * (no schema change needed) and merge one day of samples into
 * vitalsLog + burnLog.
 *
 * Payload (ingest) — all fields optional; run daily so `date` defaults
 * to the server's today:
 *   { "date":"2026-07-08", "steps":8234, "weight":72.4, "sleep":7.3, "rhr":57 }
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-health-token',
  'Content-Type': 'application/json',
};

const rateLimits = new Map();
function checkRate(key, max = 60) {
  const now = Date.now();
  const e = rateLimits.get(key) || { count: 0, t: now };
  if (now - e.t > 60_000) { e.count = 0; e.t = now; }
  e.count++;
  rateLimits.set(key, e);
  return e.count <= max;
}

const num = (v, lo, hi) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const STEPS_KCAL_PER_KG = 0.0005; // mirrors src/lib/burn.js stepsKcal

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function latestWeight(vitalsLog) {
  const days = Object.keys(vitalsLog || {}).sort();
  for (let i = days.length - 1; i >= 0; i--) if (vitalsLog[days[i]]?.weight != null) return vitalsLog[days[i]].weight;
  return null;
}

async function sbFetch(url, opts, serviceKey) {
  return fetch(url, {
    ...opts,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...(opts.headers || {}) },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'supabase env missing' }) };

  const q = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* tolerate empty */ }

  // Resolve the sync token → user via a JSONB filter on user_data
  // (state.healthToken), so no dedicated column/table is required.
  const token = q.token || event.headers['x-health-token'] || body.token;
  if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing sync token' }) };
  if (!/^[A-Za-z0-9]{16,64}$/.test(token)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad token' }) };
  if (!checkRate(token, 60)) return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'rate limited' }) };

  const lookup = await sbFetch(`${supabaseUrl}/rest/v1/user_data?state->>healthToken=eq.${token}&select=id,state`, {}, serviceKey);
  if (!lookup.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'lookup failed' }) };
  const row = (await lookup.json())[0];
  if (!row?.id) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'unknown token' }) };
  const userId = row.id;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : todayISO();
  const weight = num(body.weight, 20, 400);
  const sleep = num(body.sleep, 0, 24);
  const rhr = num(body.rhr, 20, 250);
  const steps = num(body.steps, 0, 200000);

  const state = row.state || {};

  const vitalsLog = { ...(state.vitalsLog || {}) };
  const dayVitals = { ...(vitalsLog[date] || {}) };
  if (weight != null) dayVitals.weight = Math.round(weight * 10) / 10;
  if (sleep != null) dayVitals.sleep = Math.round(sleep * 10) / 10;
  if (rhr != null) dayVitals.rhr = Math.round(rhr);
  if (Object.keys(dayVitals).length) vitalsLog[date] = dayVitals;

  const burnLog = { ...(state.burnLog || {}) };
  if (steps != null && steps > 0) {
    const w = weight ?? dayVitals.weight ?? latestWeight(vitalsLog) ?? 70;
    const kcal = Math.round(steps * w * STEPS_KCAL_PER_KG);
    const others = (burnLog[date] || []).filter(a => !String(a.id || '').startsWith('ah-steps-') && a.label !== 'Apple Health');
    burnLog[date] = [...others, { id: 'ah-steps-' + date, label: `${Math.round(steps).toLocaleString('en-GB')} steps`, kcal }];
  }

  const newState = { ...state, vitalsLog, burnLog };
  const write = await sbFetch(`${supabaseUrl}/rest/v1/user_data?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ state: newState, updated_at: new Date().toISOString() }),
  }, serviceKey);
  if (!write.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'write failed', detail: await write.text().catch(() => '') }) };

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, date, wrote: { weight, sleep, rhr, steps } }) };
};
