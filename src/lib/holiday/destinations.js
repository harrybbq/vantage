/**
 * Turning the free-text destination field into structured facts.
 *
 * The destination box has always been free text ("Rome", "Rome, Italy",
 * "Amalfi Coast 🇮🇹") and it stays that way — resolving is best-effort
 * and every consumer degrades to showing nothing. Nobody is ever asked
 * to re-enter a trip they already saved.
 */
import COUNTRIES from '../../data/countries.json';
import { lookupCity } from '../../data/cities';

// Antarctica is in the ISO list but nobody is planning a holiday there,
// and it's excluded from the drawn map too — keeping it would put an
// unclickable row in the visited list and the policy picker.
const USABLE = COUNTRIES.filter(c => c.iso2 !== 'AQ');

export const COUNTRY_BY_ISO = Object.fromEntries(USABLE.map(c => [c.iso2, c]));
export const ALL_COUNTRIES = USABLE;

const BY_LOWER_NAME = (() => {
  const m = new Map();
  for (const c of COUNTRIES) m.set(c.name.toLowerCase(), c);
  // The names people actually type.
  const extra = {
    'uk': 'GB', 'u.k.': 'GB', 'britain': 'GB', 'great britain': 'GB', 'england': 'GB',
    'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
    'usa': 'US', 'u.s.a.': 'US', 'america': 'US', 'united states of america': 'US',
    'uae': 'AE', 'holland': 'NL', 'czechia': 'CZ', 'czech republic': 'CZ',
    'south korea': 'KR', 'russia': 'RU', 'vietnam': 'VN', 'turkey': 'TR',
  };
  for (const [name, iso] of Object.entries(extra)) {
    const c = COUNTRIES.find(x => x.iso2 === iso);
    if (c) m.set(name, c);
  }
  return m;
})();

/** Best-effort ISO2 for a destination string. Null when unrecognised. */
export function countryForText(text) {
  if (!text) return null;
  const raw = String(text).trim().toLowerCase();
  if (!raw) return null;

  // A known city is the strongest signal ("Rome" → IT).
  const city = lookupCity(raw);
  if (city) return city.c;

  // Then an exact country name, whole or as a comma-separated part.
  if (BY_LOWER_NAME.has(raw)) return BY_LOWER_NAME.get(raw).iso2;
  for (const part of raw.split(/[,(/]|\s+-\s+/)) {
    const p = part.trim();
    if (p && BY_LOWER_NAME.has(p)) return BY_LOWER_NAME.get(p).iso2;
  }
  // Finally a country name appearing anywhere, longest first so
  // "Guinea-Bissau" wins over "Guinea".
  const names = [...BY_LOWER_NAME.keys()].filter(n => n.length >= 4).sort((a, b) => b.length - a.length);
  for (const n of names) {
    if (raw.includes(n)) return BY_LOWER_NAME.get(n).iso2;
  }
  return null;
}

/** The country a saved trip is in — explicit field first, then inferred. */
export function countryForTrip(trip) {
  if (!trip) return null;
  if (trip.countryCode && COUNTRY_BY_ISO[trip.countryCode]) return trip.countryCode;
  return countryForText(trip.dest);
}

/**
 * Countries the user has been to: every completed trip, plus anything
 * ticked manually on the map. Manual entries are kept separate from
 * trips so deleting a trip can't silently erase a visit the user added
 * by hand.
 *
 *   → { GB: { iso2, name, trips: [trip], manual: bool, years: [2024] } }
 */
export function visitedCountries(S) {
  const out = {};
  const add = iso2 => {
    if (!iso2 || !COUNTRY_BY_ISO[iso2]) return null;
    if (!out[iso2]) {
      out[iso2] = { iso2, name: COUNTRY_BY_ISO[iso2].name, trips: [], manual: false, years: [] };
    }
    return out[iso2];
  };

  for (const trip of S.holidays || []) {
    if (trip.status !== 'completed') continue;
    const entry = add(countryForTrip(trip));
    if (!entry) continue;
    entry.trips.push(trip);
    const y = trip.from ? new Date(trip.from).getFullYear() : null;
    if (y && !Number.isNaN(y) && !entry.years.includes(y)) entry.years.push(y);
  }

  for (const iso2 of S.visitedExtra || []) {
    const entry = add(iso2);
    if (entry) entry.manual = true;
  }

  for (const e of Object.values(out)) e.years.sort();
  return out;
}

/** Percentage of the world's countries visited, to one decimal. */
export function visitedPct(count) {
  return Math.round((count / ALL_COUNTRIES.length) * 1000) / 10;
}
