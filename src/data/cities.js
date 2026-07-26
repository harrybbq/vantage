/**
 * Destination cost reference.
 *
 * A deliberately STATIC, hand-curated dataset rather than an API call.
 * Numbeo — the obvious source — is paid and its terms forbid scraping,
 * and a live cost API would be a per-open network round trip for data
 * that barely moves year to year. Shipping the numbers means the
 * destination panel works offline, adds zero DB load (Supabase is on
 * Micro), and can't break when someone else's service does.
 *
 * Figures are TYPICAL TOURIST-AREA prices in the local currency, from
 * mid-2026, rounded hard. They are for orientation — "is this a cheap
 * or expensive city" — and the UI labels them as estimates. `pint` is
 * 500ml of domestic draught, `meal` a single mid-range restaurant main,
 * `coffee` a regular cappuccino, `transit` a single city transit fare.
 *
 * Keys are lowercase city names; `aliases` catches the common spellings
 * people actually type into the destination box.
 */

export const CITIES = [
  // ── UK & Ireland ──
  { key: 'london',     c: 'GB', cur: 'GBP', pint: 6.5, coffee: 3.6, meal: 20, transit: 2.8, lat: 51.51, lon: -0.13 },
  { key: 'manchester', c: 'GB', cur: 'GBP', pint: 5.2, coffee: 3.3, meal: 16, transit: 2.2, lat: 53.48, lon: -2.24 },
  { key: 'edinburgh',  c: 'GB', cur: 'GBP', pint: 5.6, coffee: 3.4, meal: 18, transit: 2.0, lat: 55.95, lon: -3.19 },
  { key: 'dublin',     c: 'IE', cur: 'EUR', pint: 6.8, coffee: 3.8, meal: 22, transit: 2.6, lat: 53.35, lon: -6.26 },

  // ── Western Europe ──
  { key: 'paris',      c: 'FR', cur: 'EUR', pint: 7.5, coffee: 3.5, meal: 22, transit: 2.5, lat: 48.86, lon: 2.35 },
  { key: 'lyon',       c: 'FR', cur: 'EUR', pint: 6.5, coffee: 2.8, meal: 18, transit: 2.0, lat: 45.76, lon: 4.86 },
  { key: 'nice',       c: 'FR', cur: 'EUR', pint: 6.5, coffee: 3.0, meal: 20, transit: 1.7, lat: 43.70, lon: 7.27 },
  { key: 'marseille',  c: 'FR', cur: 'EUR', pint: 6.0, coffee: 2.6, meal: 18, transit: 1.8, lat: 43.30, lon: 5.38 },
  { key: 'amsterdam',  c: 'NL', cur: 'EUR', pint: 6.0, coffee: 3.4, meal: 22, transit: 3.4, lat: 52.37, lon: 4.90 },
  { key: 'rotterdam',  c: 'NL', cur: 'EUR', pint: 5.5, coffee: 3.2, meal: 20, transit: 3.0, lat: 51.92, lon: 4.47 },
  { key: 'brussels',   c: 'BE', cur: 'EUR', pint: 5.0, coffee: 3.0, meal: 20, transit: 2.6, lat: 50.85, lon: 4.35 },
  { key: 'bruges',     c: 'BE', cur: 'EUR', pint: 5.0, coffee: 3.0, meal: 21, transit: 2.6, lat: 51.21, lon: 3.22 },
  { key: 'luxembourg', c: 'LU', cur: 'EUR', pint: 6.0, coffee: 3.2, meal: 24, transit: 0,   lat: 49.61, lon: 6.13 },

  // ── Germany, Austria, Switzerland ──
  { key: 'berlin',     c: 'DE', cur: 'EUR', pint: 4.5, coffee: 3.2, meal: 15, transit: 3.5, lat: 52.52, lon: 13.40 },
  { key: 'munich',     c: 'DE', cur: 'EUR', pint: 5.0, coffee: 3.4, meal: 17, transit: 3.9, lat: 48.14, lon: 11.58 },
  { key: 'hamburg',    c: 'DE', cur: 'EUR', pint: 4.8, coffee: 3.3, meal: 16, transit: 3.7, lat: 53.55, lon: 10.00 },
  { key: 'cologne',    c: 'DE', cur: 'EUR', pint: 4.2, coffee: 3.1, meal: 15, transit: 3.4, lat: 50.94, lon: 6.96 },
  { key: 'frankfurt',  c: 'DE', cur: 'EUR', pint: 5.0, coffee: 3.3, meal: 17, transit: 3.6, lat: 50.11, lon: 8.68 },
  { key: 'vienna',     c: 'AT', cur: 'EUR', pint: 4.8, coffee: 3.6, meal: 17, transit: 2.4, lat: 48.21, lon: 16.37 },
  { key: 'salzburg',   c: 'AT', cur: 'EUR', pint: 4.8, coffee: 3.6, meal: 18, transit: 2.1, lat: 47.81, lon: 13.05 },
  { key: 'zurich',     c: 'CH', cur: 'CHF', pint: 8.5, coffee: 5.0, meal: 30, transit: 4.4, lat: 47.38, lon: 8.54 },
  { key: 'geneva',     c: 'CH', cur: 'CHF', pint: 8.0, coffee: 4.8, meal: 28, transit: 3.0, lat: 46.20, lon: 6.14 },
  { key: 'interlaken', c: 'CH', cur: 'CHF', pint: 7.5, coffee: 4.6, meal: 27, transit: 3.0, lat: 46.69, lon: 7.85 },

  // ── Southern Europe ──
  { key: 'rome',       c: 'IT', cur: 'EUR', pint: 5.5, coffee: 1.6, meal: 18, transit: 1.5, lat: 41.90, lon: 12.50 },
  { key: 'milan',      c: 'IT', cur: 'EUR', pint: 6.0, coffee: 1.6, meal: 20, transit: 2.2, lat: 45.46, lon: 9.19 },
  { key: 'venice',     c: 'IT', cur: 'EUR', pint: 6.5, coffee: 2.0, meal: 25, transit: 9.5, lat: 45.44, lon: 12.33 },
  { key: 'florence',   c: 'IT', cur: 'EUR', pint: 5.5, coffee: 1.6, meal: 20, transit: 1.7, lat: 43.77, lon: 11.26 },
  { key: 'naples',     c: 'IT', cur: 'EUR', pint: 4.5, coffee: 1.3, meal: 15, transit: 1.3, lat: 40.85, lon: 14.27 },
  { key: 'barcelona',  c: 'ES', cur: 'EUR', pint: 4.0, coffee: 2.0, meal: 15, transit: 2.4, lat: 41.39, lon: 2.17 },
  { key: 'madrid',     c: 'ES', cur: 'EUR', pint: 3.5, coffee: 1.9, meal: 14, transit: 1.5, lat: 40.42, lon: -3.70 },
  { key: 'seville',    c: 'ES', cur: 'EUR', pint: 3.0, coffee: 1.7, meal: 13, transit: 1.4, lat: 37.39, lon: -5.98 },
  { key: 'valencia',   c: 'ES', cur: 'EUR', pint: 3.2, coffee: 1.8, meal: 13, transit: 1.5, lat: 39.47, lon: -0.38 },
  { key: 'malaga',     c: 'ES', cur: 'EUR', pint: 3.2, coffee: 1.8, meal: 14, transit: 1.4, lat: 36.72, lon: -4.42, aliases: ['málaga'] },
  { key: 'palma',      c: 'ES', cur: 'EUR', pint: 4.0, coffee: 2.0, meal: 16, transit: 1.5, lat: 39.57, lon: 2.65, aliases: ['mallorca', 'majorca'] },
  { key: 'lisbon',     c: 'PT', cur: 'EUR', pint: 3.0, coffee: 1.0, meal: 13, transit: 1.8, lat: 38.72, lon: -9.14, aliases: ['lisboa'] },
  { key: 'porto',      c: 'PT', cur: 'EUR', pint: 2.5, coffee: 0.9, meal: 12, transit: 1.4, lat: 41.15, lon: -8.61 },
  { key: 'athens',     c: 'GR', cur: 'EUR', pint: 4.5, coffee: 3.2, meal: 14, transit: 1.2, lat: 37.98, lon: 23.73 },
  { key: 'santorini',  c: 'GR', cur: 'EUR', pint: 6.0, coffee: 4.0, meal: 22, transit: 2.0, lat: 36.39, lon: 25.46 },
  { key: 'split',      c: 'HR', cur: 'EUR', pint: 3.5, coffee: 2.2, meal: 15, transit: 1.5, lat: 43.51, lon: 16.44 },
  { key: 'dubrovnik',  c: 'HR', cur: 'EUR', pint: 4.5, coffee: 2.6, meal: 20, transit: 2.0, lat: 42.65, lon: 18.09 },

  // ── Central & Eastern Europe ──
  { key: 'prague',     c: 'CZ', cur: 'CZK', pint: 60,  coffee: 70,  meal: 300, transit: 40,  lat: 50.08, lon: 14.44, aliases: ['praha'] },
  { key: 'budapest',   c: 'HU', cur: 'HUF', pint: 900, coffee: 950, meal: 4500, transit: 450, lat: 47.50, lon: 19.04 },
  { key: 'krakow',     c: 'PL', cur: 'PLN', pint: 16,  coffee: 15,  meal: 55,  transit: 6,   lat: 50.06, lon: 19.94, aliases: ['kraków'] },
  { key: 'warsaw',     c: 'PL', cur: 'PLN', pint: 18,  coffee: 16,  meal: 60,  transit: 4.4, lat: 52.23, lon: 21.01 },
  { key: 'ljubljana',  c: 'SI', cur: 'EUR', pint: 4.0, coffee: 2.2, meal: 15,  transit: 1.3, lat: 46.06, lon: 14.51 },
  { key: 'belgrade',   c: 'RS', cur: 'RSD', pint: 300, coffee: 250, meal: 1200, transit: 100, lat: 44.82, lon: 20.46 },
  { key: 'sofia',      c: 'BG', cur: 'BGN', pint: 4.0, coffee: 3.5, meal: 20,  transit: 1.6, lat: 42.70, lon: 23.32 },
  { key: 'bucharest',  c: 'RO', cur: 'RON', pint: 12,  coffee: 12,  meal: 60,  transit: 3,   lat: 44.43, lon: 26.10 },
  { key: 'tallinn',    c: 'EE', cur: 'EUR', pint: 5.0, coffee: 3.2, meal: 16,  transit: 2.0, lat: 59.44, lon: 24.75 },
  { key: 'riga',       c: 'LV', cur: 'EUR', pint: 4.0, coffee: 3.0, meal: 15,  transit: 1.5, lat: 56.95, lon: 24.11 },
  { key: 'vilnius',    c: 'LT', cur: 'EUR', pint: 4.0, coffee: 2.8, meal: 14,  transit: 1.0, lat: 54.69, lon: 25.28 },
  { key: 'istanbul',   c: 'TR', cur: 'TRY', pint: 180, coffee: 130, meal: 500, transit: 27,  lat: 41.01, lon: 28.98 },

  // ── Nordics ──
  { key: 'copenhagen', c: 'DK', cur: 'DKK', pint: 60,  coffee: 42,  meal: 200, transit: 24,  lat: 55.68, lon: 12.57 },
  { key: 'stockholm',  c: 'SE', cur: 'SEK', pint: 85,  coffee: 45,  meal: 165, transit: 42,  lat: 59.33, lon: 18.07 },
  { key: 'oslo',       c: 'NO', cur: 'NOK', pint: 110, coffee: 48,  meal: 250, transit: 42,  lat: 59.91, lon: 10.75 },
  { key: 'bergen',     c: 'NO', cur: 'NOK', pint: 110, coffee: 48,  meal: 250, transit: 42,  lat: 60.39, lon: 5.32 },
  { key: 'helsinki',   c: 'FI', cur: 'EUR', pint: 7.5, coffee: 4.2, meal: 20,  transit: 3.1, lat: 60.17, lon: 24.94 },
  { key: 'reykjavik',  c: 'IS', cur: 'ISK', pint: 1400, coffee: 650, meal: 3500, transit: 630, lat: 64.15, lon: -21.94, aliases: ['reykjavík'] },

  // ── Further afield ──
  { key: 'new york',   c: 'US', cur: 'USD', pint: 9.0, coffee: 5.0, meal: 28, transit: 2.9, lat: 40.71, lon: -74.01, aliases: ['nyc', 'new york city'] },
  { key: 'los angeles',c: 'US', cur: 'USD', pint: 8.0, coffee: 5.2, meal: 25, transit: 1.8, lat: 34.05, lon: -118.24, aliases: ['la'] },
  { key: 'toronto',    c: 'CA', cur: 'CAD', pint: 8.5, coffee: 4.5, meal: 27, transit: 3.4, lat: 43.65, lon: -79.38 },
  { key: 'dubai',      c: 'AE', cur: 'AED', pint: 45,  coffee: 22,  meal: 80, transit: 5,   lat: 25.20, lon: 55.27 },
  { key: 'bangkok',    c: 'TH', cur: 'THB', pint: 90,  coffee: 85,  meal: 200, transit: 30, lat: 13.76, lon: 100.50 },
  { key: 'tokyo',      c: 'JP', cur: 'JPY', pint: 600, coffee: 500, meal: 1200, transit: 200, lat: 35.68, lon: 139.69 },
  { key: 'singapore',  c: 'SG', cur: 'SGD', pint: 14,  coffee: 6.0, meal: 20, transit: 1.6, lat: 1.35,  lon: 103.82 },
  { key: 'sydney',     c: 'AU', cur: 'AUD', pint: 12,  coffee: 5.0, meal: 30, transit: 3.5, lat: -33.87, lon: 151.21 },
  { key: 'cape town',  c: 'ZA', cur: 'ZAR', pint: 45,  coffee: 40,  meal: 200, transit: 15, lat: -33.92, lon: 18.42 },
  { key: 'marrakesh',  c: 'MA', cur: 'MAD', pint: 40,  coffee: 20,  meal: 90, transit: 5,   lat: 31.63, lon: -7.99, aliases: ['marrakech'] },
];

const INDEX = (() => {
  const m = new Map();
  for (const city of CITIES) {
    m.set(city.key, city);
    for (const a of city.aliases || []) m.set(a, city);
  }
  return m;
})();

/**
 * Resolve free-text from the destination field to a known city.
 * Handles "Rome, Italy" and "Paris (France)" by testing the leading
 * token as well as the whole string — people rarely type a bare city.
 */
export function lookupCity(text) {
  if (!text) return null;
  const raw = String(text).trim().toLowerCase();
  if (INDEX.has(raw)) return INDEX.get(raw);
  const head = raw.split(/[,(\-–—/]/)[0].trim();
  if (INDEX.has(head)) return INDEX.get(head);
  // Last resort: a known city name appearing anywhere in the string.
  for (const [name, city] of INDEX) {
    if (name.length >= 4 && raw.includes(name)) return city;
  }
  return null;
}
