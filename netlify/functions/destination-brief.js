/**
 * destination-brief — climate + currency context for a trip destination.
 *
 * Two facts the holiday planner can state with confidence, both from
 * key-less sources:
 *
 *   climate — what the weather is ACTUALLY like there in the month
 *             you're going, from Open-Meteo's climate normals (a 20-year
 *             daily average, not a forecast — trips get planned months
 *             out, so a forecast would be useless).
 *   fx      — the live rate from the destination currency to the user's
 *             home currency, so the static cost figures in
 *             src/data/cities.js can be shown in real money.
 *
 * Deliberately NOT here: hotel suggestions or AI-written prose. Hotel
 * inventory needs a partner agreement, and generated "average prices"
 * read as authoritative while being unverifiable. The cost figures ship
 * as vetted static data instead; this function only supplies the two
 * numbers that genuinely have to be live.
 *
 * DB load: none — this function never touches Supabase. A module-scope
 * cache holds climate for a day and FX for an hour, so a warm instance
 * serves repeat opens without re-hitting upstream.
 *
 * GET ?place=Lisbon&month=9&home=GBP  (or &lat=..&lon=.. to skip geocoding)
 * Returns { place, lat, lon, climate: { tempC, tempMinC, rainDays }, fx: { from, to, rate } }
 * Any part that fails is simply omitted — the client renders what it gets.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=3600',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const GEO_CACHE = new Map();     // "lisbon" → { at, loc }
const CLIMATE_CACHE = new Map(); // "38.7,-9.1,9" → { at, data }
const FX_CACHE = new Map();      // "EUR>GBP" → { at, rate }

const TIMEOUT_MS = 4500;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function geocode(place) {
  const key = place.trim().toLowerCase();
  const hit = GEO_CACHE.get(key);
  if (hit && Date.now() - hit.at < 30 * DAY_MS) return hit.loc;

  const url = 'https://geocoding-api.open-meteo.com/v1/search'
    + `?name=${encodeURIComponent(place)}&count=1&language=en&format=json`;
  const j = await getJson(url);
  const r = (j.results || [])[0];
  if (!r) return null;
  const loc = { lat: r.latitude, lon: r.longitude, name: r.name, country: r.country_code || '' };
  GEO_CACHE.set(key, { at: Date.now(), loc });
  return loc;
}

/**
 * Climate normals for one month. Open-Meteo's archive gives daily
 * history; we average the last 10 Septembers (etc.) rather than call the
 * forecast endpoint, which only reaches ~16 days out.
 */
async function climate(lat, lon, month) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)},${month}`;
  const hit = CLIMATE_CACHE.get(key);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.data;

  const thisYear = new Date().getUTCFullYear();
  const start = `${thisYear - 10}-01-01`;
  const end = `${thisYear - 1}-12-31`;
  const url = 'https://archive-api.open-meteo.com/v1/archive'
    + `?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=UTC';
  const j = await getJson(url);
  const d = j.daily || {};
  const times = d.time || [];
  if (!times.length) return null;

  let maxSum = 0, minSum = 0, days = 0, wet = 0;
  for (let i = 0; i < times.length; i++) {
    // "2019-09-04" → month 9
    if (Number(times[i].slice(5, 7)) !== month) continue;
    const hi = d.temperature_2m_max?.[i];
    const lo = d.temperature_2m_min?.[i];
    const mm = d.precipitation_sum?.[i];
    if (typeof hi !== 'number' || typeof lo !== 'number') continue;
    maxSum += hi; minSum += lo; days++;
    if (typeof mm === 'number' && mm >= 1) wet++;
  }
  if (!days) return null;

  const data = {
    tempC: Math.round(maxSum / days),
    tempMinC: Math.round(minSum / days),
    // Wet days scaled to a 30-day month, so "8 rain days" reads plainly.
    rainDays: Math.round((wet / days) * 30),
    years: 10,
  };
  CLIMATE_CACHE.set(key, { at: Date.now(), data });
  return data;
}

async function fxRate(from, to) {
  if (!from || !to || from === to) return null;
  const key = `${from}>${to}`;
  const hit = FX_CACHE.get(key);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.rate;

  const j = await getJson(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
  const rate = j?.rates?.[to];
  if (typeof rate !== 'number') return null;
  FX_CACHE.set(key, { at: Date.now(), rate });
  return rate;
}

const CUR_RE = /^[A-Z]{3}$/;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const q = event.queryStringParameters || {};
  const place = (q.place || '').slice(0, 120).trim();
  const month = Math.min(12, Math.max(1, Number(q.month) || (new Date().getUTCMonth() + 1)));
  const home = CUR_RE.test(q.home || '') ? q.home : 'GBP';
  const from = CUR_RE.test(q.cur || '') ? q.cur : '';
  const latQ = Number(q.lat), lonQ = Number(q.lon);
  const haveCoords = Number.isFinite(latQ) && Number.isFinite(lonQ);

  if (!place && !haveCoords) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'place or lat/lon required' }) };
  }

  const out = { place };
  try {
    let loc = haveCoords ? { lat: latQ, lon: lonQ, name: place } : null;
    if (!loc) loc = await geocode(place).catch(() => null);

    // Climate and FX are independent — one failing must not sink the
    // other, so settle both rather than awaiting in series.
    const [climateRes, fxRes] = await Promise.allSettled([
      loc ? climate(loc.lat, loc.lon, month) : Promise.resolve(null),
      from ? fxRate(from, home) : Promise.resolve(null),
    ]);

    if (loc) { out.lat = loc.lat; out.lon = loc.lon; out.resolved = loc.name || place; }
    if (climateRes.status === 'fulfilled' && climateRes.value) {
      out.climate = { ...climateRes.value, month };
    }
    if (fxRes.status === 'fulfilled' && fxRes.value) {
      out.fx = { from, to: home, rate: fxRes.value };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify(out) };
  } catch (e) {
    // Fail soft: the panel hides whatever it didn't get.
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ...out, error: e.message || 'unavailable' }) };
  }
};
