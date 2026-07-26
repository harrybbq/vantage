import { useEffect, useState } from 'react';
import Icon from '../Icon';
import { lookupCity } from '../../data/cities';
import { countryForText, COUNTRY_BY_ISO } from '../../lib/holiday/destinations';

/**
 * Destination intelligence for one trip.
 *
 * Costs come from the vetted static table in src/data/cities.js —
 * offline, zero DB load, and stable. Climate and the exchange rate are
 * the only two things that genuinely have to be live, and they come
 * from /destination-brief. Everything degrades independently: an
 * unknown city still shows climate, a failed fetch still shows costs,
 * and a total failure renders nothing rather than an error.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function money(v, cur) {
  if (v == null) return '—';
  const dp = v >= 100 ? 0 : v >= 10 ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: cur, minimumFractionDigits: dp, maximumFractionDigits: dp,
    }).format(v);
  } catch {
    return `${v} ${cur}`;
  }
}

export default function DestinationPanel({ dest, from, home = 'GBP', compact = false }) {
  const [brief, setBrief] = useState(null);
  const [state, setState] = useState('idle');

  const city = lookupCity(dest);
  const iso2 = city?.c || countryForText(dest);
  const country = iso2 ? COUNTRY_BY_ISO[iso2] : null;
  const month = from ? new Date(from).getMonth() + 1 : null;

  useEffect(() => {
    if (!dest || !dest.trim()) { setBrief(null); setState('idle'); return; }
    let alive = true;
    setState('loading');
    const params = new URLSearchParams({ place: dest.trim(), home });
    if (month) params.set('month', String(month));
    if (city) { params.set('lat', String(city.lat)); params.set('lon', String(city.lon)); params.set('cur', city.cur); }
    else if (country?.cur) params.set('cur', country.cur);

    fetch(`/.netlify/functions/destination-brief?${params}`)
      .then(r => r.json())
      .then(j => { if (alive) { setBrief(j && !j.error ? j : null); setState('done'); } })
      .catch(() => { if (alive) { setBrief(null); setState('done'); } });
    return () => { alive = false; };
    // `city`/`country` are derived from `dest`, so `dest` covers them.
  }, [dest, month, home]);

  const climate = brief?.climate;
  const fx = brief?.fx;
  const hasCosts = !!city;
  if (!dest?.trim()) return null;
  if (!hasCosts && !climate && state !== 'loading') return null;

  const conv = v => (fx?.rate ? v * fx.rate : null);

  return (
    <div className={`hol-dest${compact ? ' is-compact' : ''}`}>
      <div className="hol-dest-head">
        <Icon name="compass" size={14} />
        <span>{brief?.resolved || city?.key || dest}</span>
        {country && <span className="hol-dest-country">{country.name}</span>}
      </div>

      {climate && (
        <div className="hol-dest-climate">
          <Icon name="sun" size={14} />
          <b>{climate.tempC}°</b>
          <span className="hol-dest-lo">/ {climate.tempMinC}° low</span>
          <span className="hol-dest-sep">·</span>
          <span>{climate.rainDays} rain days</span>
          <span className="hol-dest-month">in {MONTHS[(climate.month || 1) - 1]}</span>
        </div>
      )}

      {hasCosts && (
        <div className="hol-dest-costs">
          {[
            ['beer', 'Pint', city.pint],
            ['coffee', 'Coffee', city.coffee],
            ['utensils', 'Meal out', city.meal],
            ['bus', 'Transit', city.transit],
          ].map(([icon, label, val]) => (
            <div key={label} className="hol-dest-cost">
              <Icon name={icon} size={13} />
              <span className="hol-dest-cost-label">{label}</span>
              <span className="hol-dest-cost-val">
                {money(val, city.cur)}
                {conv(val) != null && <em>≈ {money(conv(val), home)}</em>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="hol-dest-note">
        {hasCosts && 'Typical tourist-area prices, mid-2026. '}
        {climate && `Climate is a ${climate.years}-year average, not a forecast. `}
        Estimates for orientation.
      </div>
    </div>
  );
}
