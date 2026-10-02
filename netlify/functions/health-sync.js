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
 * the token in the `x-health-token` header (preferred — a query string
 * lands in access logs; `?token=` and a body `token` are still accepted
 * so existing Shortcuts keep working); we resolve it to the user via a
 * JSONB filter on user_data and merge one day of samples into
 * vitalsLog + burnLog.
 *
 * ── Hardening (2026-09-30, items 49/50) ─────────────────────────────
 *   · Rate-limited per IP as well as per token. Keying only on the
 *     caller-chosen token meant a script could try a fresh token every
 *     request, and every unknown token is a full-table JSONB scan.
 *     (The real fix is a hashed, indexed token table — item 49; the
 *     lead's SQL adds an expression index on state->>'healthToken'.)
 *   · The write is compare-and-set on updated_at (lib/stateWrite.js):
 *     a client save that lands between our read and our write is no
 *     longer overwritten. On a double conflict we answer 503 and the
 *     Shortcut's next run delivers the same samples.
 *   · Error bodies are generic; detail goes to the function log.
 *
 * Why the WHOLE state is still read and written: PostgREST can only
 * replace the `state` column, not one key inside it. Reading just
 * vitalsLog/burnLog would need a Postgres function that patches keys
 * in place (jsonb_set) — a schema change for the lead, noted in the
 * report. Until then the conditional write is what makes it safe.
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
  // Keys include caller-chosen tokens, so bound the map.
  if (rateLimits.size > 5000) {
    for (const [k, v] of rateLimits) if (now - v.t > 60_000) rateLimits.delete(k);
  }
  return e.count <= max;
}

const num = (v, lo, hi) => {
  // Tolerate what Shortcuts tends to send: arrays (take first), and
  // strings with commas/units ("8,234 steps", "72.4 kg").
  if (Array.isArray(v)) v = v[0];
  if (typeof v === 'string') v = v.replace(/[^0-9.-]/g, '');
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

const { mergeStateCAS } = require('../lib/stateWrite');

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip']
    || String(h['x-forwarded-for'] || '').split(',')[0].trim()
    || 'unknown';
}

const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method not allowed' });

  const env = process.env;
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return reply(500, { error: 'not configured' });

  // Per IP first: this is checked before anything touches the database,
  // so rotating tokens does not rotate the limit. A Shortcut runs a few
  // times a day; 30 a minute from one address is already generous.
  if (!checkRate('ip:' + clientIp(event), 30)) return reply(429, { error: 'rate limited' });

  const q = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* tolerate empty */ }

  // Header first; query string and body kept for Shortcuts already set up.
  const token = event.headers?.['x-health-token'] || body.token || q.token;
  if (!token) return reply(401, { error: 'missing sync token' });
  if (typeof token !== 'string' || !/^[A-Za-z0-9]{16,64}$/.test(token)) return reply(400, { error: 'bad token' });
  if (!checkRate('tok:' + token, 60)) return reply(429, { error: 'rate limited' });

  const lookup = await fetch(
    `${supabaseUrl}/rest/v1/user_data?state->>healthToken=eq.${token}&select=id,state,updated_at`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!lookup.ok) {
    console.error('health-sync: lookup failed', lookup.status);
    return reply(500, { error: 'sync failed' });
  }
  const row = (await lookup.json())[0];
  if (!row?.id) return reply(403, { error: 'unknown token' });
  const userId = row.id;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : todayISO();
  const weight = num(body.weight, 20, 400);
  const sleep = num(body.sleep, 0, 24);
  const rhr = num(body.rhr, 20, 250);
  const steps = num(body.steps, 0, 200000);

  // Additive and idempotent, so it is safe to run again on a re-read.
  const merge = (state) => {
    // The token may have been revoked between the lookup and a re-read.
    if (state.healthToken !== token) return null;
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
    return { ...state, vitalsLog, burnLog };
  };

  let outcome;
  try {
    outcome = await mergeStateCAS(userId, merge, env, { state: row.state, updatedAt: row.updated_at ?? null });
  } catch (e) {
    console.error('health-sync: write failed', e?.message);
    return reply(500, { error: 'sync failed' });
  }
  if (outcome === 'unchanged' || outcome === 'missing') return reply(403, { error: 'unknown token' });
  if (outcome === 'conflict') {
    // Never forced. The app saved twice while we worked — the next run
    // brings the same samples.
    return reply(503, { error: 'busy — try again shortly' });
  }

  return reply(200, { ok: true, date, wrote: { weight, sleep, rhr, steps } });
};
