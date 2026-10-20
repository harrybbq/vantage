/**
 * weather — current conditions for the greeting-header chip.
 *
 * Zero-config and key-less: Open-Meteo (https://open-meteo.com) is free
 * and needs no API key. We never ask the user for a location permission
 * and nothing calls navigator.geolocation — the app "just works".
 *
 * ── Location: Netlify's own geo, no third party (item 95) ──────────────
 * Netlify's edge geolocates every request itself and hands functions the
 * answer in the `x-nf-geo` header (base64 JSON — plain JSON in some
 * local dev builds — with city, country, subdivision, and usually
 * latitude/longitude). We read that. The caller's IP is no longer sent
 * anywhere: ipwho.is, which used to receive it on every request, is
 * gone (docs/STORE_PRIVACY_LABELS.md Q3 — "switching to Netlify's own
 * geo header removes the question").
 *   · header has lat/lon → use them (rounded to ~11 km below);
 *   · header has a city but no lat/lon → Open-Meteo's geocoder, which
 *     receives the CITY NAME only (cached a day per city);
 *   · no usable header → `{ error: 'location unavailable' }`, and the
 *     client hides the chip, exactly as it does for any failure. Logged
 *     once per instance so a platform change shows up in the log.
 *
 * Privacy: only a coarse lat/lon (rounded to ~11 km) or a city name
 * leaves this function, and nothing is stored. No user id is read for
 * the answer; a session only lifts the rate limit.
 *
 * ── Limits ──────────────────────────────────────────────────────────────
 * Per IP (lib/ipLimit.js, per instance): the first ANON_PER_HOUR an hour
 * are served to anyone; up to SIGNED_IN_PER_HOUR need a valid Supabase
 * session (lib/sessionCache.js — the token is checked only once an IP is
 * past the anonymous allowance, and the verdict is cached, so a normal
 * user costs zero Auth calls). The client caches 30 minutes in
 * localStorage, so a real user makes ~2 calls an hour. Over the limit →
 * 429. The chip is only rendered signed in (PageHeader); the sign-in
 * screen never calls this.
 *
 * DB load: none. Upstream load: a module-scope cache keyed by the
 * rounded coordinates holds each answer for CACHE_TTL_MS.
 *
 * GET. Returns { tempC, tempF, code, isDay, city }.
 */
const { createIpLimiter, clientIp } = require('../lib/ipLimit');
const { sessionUserId } = require('../lib/sessionCache');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  // Errors and anything that is not the caller's own answer: never cached.
  'Cache-Control': 'no-store',
};
/* Success only, and PRIVATE: the answer is geolocated from the caller's
   request, so a shared (CDN) cache would hand one person's city and
   weather to the next. The browser may keep its own copy for 15 minutes. */
const OK_HEADERS = { ...CORS, 'Cache-Control': 'private, max-age=900' };

const CACHE_TTL_MS = 30 * 60 * 1000;      // weather per ~11 km cell
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000; // city → coordinates
const MAX_CACHE = 2000;
const CACHE = new Map();   // "lat,lon" → { at, data }
const GEOCODE = new Map(); // "city|CC" → { at, loc|null }

const ANON_PER_HOUR = 12;
const SIGNED_IN_PER_HOUR = 60;
const limiter = createIpLimiter([
  { ms: 60_000, max: 10 },                   // burst brake for everyone
  { ms: 60 * 60_000, max: SIGNED_IN_PER_HOUR },
]);

const json = (statusCode, body, headers = CORS) => ({ statusCode, headers, body: JSON.stringify(body) });

function setBounded(map, key, value) {
  map.set(key, value);
  if (map.size > MAX_CACHE) map.delete(map.keys().next().value);
}

/**
 * Netlify's geo header → { latitude?, longitude?, city, country } or null.
 * Accepts base64 JSON (production) or plain JSON (some dev builds).
 */
function geoFromHeaders(headers) {
  const h = headers || {};
  const raw = h['x-nf-geo'] || h['X-Nf-Geo'] || h['X-NF-Geo'];
  if (!raw || typeof raw !== 'string' || raw.length > 4096) return null;
  let g = null;
  for (const decode of [s => Buffer.from(s, 'base64').toString('utf8'), s => s]) {
    try { const v = JSON.parse(decode(raw)); if (v && typeof v === 'object') { g = v; break; } } catch { /* next */ }
  }
  if (!g) return null;
  const num = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const lat = num(g.latitude);
  const lon = num(g.longitude);
  const city = typeof g.city === 'string' ? g.city.trim().slice(0, 80) : '';
  const country = String((g.country && (g.country.code || g.country)) || '').slice(0, 2).toUpperCase();
  const out = { city, country: /^[A-Z]{2}$/.test(country) ? country : '' };
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) {
    out.latitude = lat; out.longitude = lon;
  }
  return (out.latitude != null || out.city) ? out : null;
}

/** City name → coordinates via Open-Meteo's geocoder (city name only). */
async function geocodeCity(city, country, { fetchImpl = fetch, now = Date.now() } = {}) {
  const key = `${city.toLowerCase()}|${country}`;
  const hit = GEOCODE.get(key);
  if (hit && now - hit.at < GEOCODE_TTL_MS) return hit.loc;
  let loc = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
      + (country ? `&countryCode=${country}` : ''), { signal: ctrl.signal });
    clearTimeout(t);
    const j = res.ok ? await res.json().catch(() => ({})) : {};
    const r = Array.isArray(j.results) ? j.results[0] : null;
    if (r && typeof r.latitude === 'number' && typeof r.longitude === 'number') loc = { latitude: r.latitude, longitude: r.longitude };
  } catch { /* fall through */ }
  setBounded(GEOCODE, key, { at: now, loc });
  return loc;
}

async function currentWeather(lat, lon, fetchImpl = fetch) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,weather_code,is_day&temperature_unit=celsius`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  const res = await fetchImpl(url, { signal: ctrl.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = await res.json();
  const c = j.current || {};
  return {
    code: typeof c.weather_code === 'number' ? c.weather_code : 0,
    tempC: Math.round(c.temperature_2m),
    isDay: c.is_day !== 0,
  };
}

let loggedNoGeo = false;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'method not allowed' });

  // ── Per-IP limit; past the anonymous allowance a session is required.
  const ip = clientIp(event);
  const lim = limiter.hit(ip);
  if (!lim.allowed) return json(429, { error: 'rate limited' });
  if (lim.counts[1] > ANON_PER_HOUR) {
    const uid = await sessionUserId(event);
    if (!uid) return json(429, { error: 'rate limited' });
  }

  try {
    const geo = geoFromHeaders(event.headers);
    let loc = null;
    if (geo && geo.latitude != null) loc = { latitude: geo.latitude, longitude: geo.longitude };
    else if (geo && geo.city) loc = await geocodeCity(geo.city, geo.country);
    if (!loc) {
      if (!loggedNoGeo) {
        loggedNoGeo = true;
        // Header NAMES only — never values (they're the caller's location).
        console.warn('weather: no usable x-nf-geo on this request; chip hidden. Headers present:',
          Object.keys(event.headers || {}).filter(k => /geo|country|city/i.test(k)).join(',') || 'none');
      }
      return json(200, { error: 'location unavailable' });
    }

    const lat = Number(loc.latitude.toFixed(1));
    const lon = Number(loc.longitude.toFixed(1));
    const key = `${lat},${lon}`;
    const now = Date.now();
    const hit = CACHE.get(key);
    const city = (geo && geo.city) || '';
    if (hit && now - hit.at < CACHE_TTL_MS) {
      return json(200, { ...hit.data, city }, OK_HEADERS);
    }
    const wx = await currentWeather(lat, lon);
    const data = { tempC: wx.tempC, tempF: Math.round(wx.tempC * 9 / 5 + 32), code: wx.code, isDay: wx.isDay };
    setBounded(CACHE, key, { at: now, data });
    return json(200, { ...data, city }, OK_HEADERS);
  } catch (e) {
    // Fail soft — the client hides the chip on any error.
    console.error('weather:', e?.message);
    return json(200, { error: 'weather unavailable' });
  }
};

// For efficiency.test.mjs.
exports._test = { geoFromHeaders, geocodeCity, CACHE, GEOCODE, ANON_PER_HOUR, SIGNED_IN_PER_HOUR };
