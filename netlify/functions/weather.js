/**
 * weather — current conditions for the greeting-header chip.
 *
 * Zero-config and key-less: Open-Meteo (https://open-meteo.com) is free
 * and needs no API key. Location is derived server-side from the caller's
 * IP so the browser never talks to a third-party geolocation service and
 * we never ask the user for a location permission — the app "just works".
 *
 * Privacy: only a coarse lat/lon (rounded to ~11km) leaves this function,
 * and nothing is stored. The IP → coordinates lookup happens here, not in
 * the client.
 *
 * DB load: none. A module-scope cache keyed by the rounded coordinates
 * holds each result for CACHE_TTL_MS so repeated opens don't re-hit the
 * upstream APIs on a warm instance.
 *
 * GET. Returns { tempC, tempF, code, isDay, city }.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  // Let the browser/CDN cache the response briefly too.
  'Cache-Control': 'public, max-age=900',
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE = new Map(); // "lat,lon" → { at, data }
const LONDON = { latitude: 51.5074, longitude: -0.1278, city: 'London' };

function clientIp(event) {
  const h = event.headers || {};
  return (h['x-nf-client-connection-ip']
    || (h['x-forwarded-for'] || '').split(',')[0]
    || '').trim();
}

async function geolocate(ip) {
  // No usable IP (local dev / stripped header) → default location.
  if (!ip || ip.startsWith('127.') || ip.startsWith('::1') || ip.startsWith('192.168.')) return LONDON;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,latitude,longitude,city`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await res.json().catch(() => ({}));
    if (j && j.success && typeof j.latitude === 'number' && typeof j.longitude === 'number') {
      return { latitude: j.latitude, longitude: j.longitude, city: j.city || '' };
    }
  } catch { /* fall through */ }
  return LONDON;
}

async function currentWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,weather_code,is_day&temperature_unit=celsius`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  const res = await fetch(url, { signal: ctrl.signal });
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  try {
    const loc = await geolocate(clientIp(event));
    const key = `${loc.latitude.toFixed(1)},${loc.longitude.toFixed(1)}`;
    const now = Date.now();
    const hit = CACHE.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify(hit.data) };
    }
    const wx = await currentWeather(loc.latitude, loc.longitude);
    const data = { tempC: wx.tempC, tempF: Math.round(wx.tempC * 9 / 5 + 32), code: wx.code, isDay: wx.isDay, city: loc.city || '' };
    CACHE.set(key, { at: now, data });
    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
  } catch (e) {
    // Fail soft — the client hides the chip on any error.
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: e.message || 'weather unavailable' }) };
  }
};
