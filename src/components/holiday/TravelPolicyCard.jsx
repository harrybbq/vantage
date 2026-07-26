import { useMemo, useState } from 'react';
import Icon from '../Icon';
import { ALL_COUNTRIES } from '../../lib/holiday/destinations';
import { getPolicy, setCountryLevel, POLICY_LEVELS } from '../../lib/holiday/policy';

/**
 * Travel policy editor — your own country clearance lists.
 *
 * Lives on the PRIVACY tab, not Holiday, because that's what it is:
 * knowing someone maintains a restricted-country list implies something
 * about their job. Nothing here is shared, synced to friends, sent to
 * the leaderboard, or included in any AI prompt — it's read only by the
 * map overlay and the trip-card warnings, both of which render locally.
 *
 * The lists are USER-ENTERED by design. Restriction lists come from an
 * employer's vetting team and change over time; a list shipped in the
 * app would be wrong for everyone else and impossible to correct
 * without a deploy.
 */
export default function TravelPolicyCard({ S, update }) {
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('restricted');
  const policy = useMemo(() => getPolicy(S), [S]);

  const assigned = useMemo(() => {
    const rows = [];
    for (const key of ['restricted', 'notify', 'cleared']) {
      for (const iso2 of policy[key]) {
        const c = ALL_COUNTRIES.find(x => x.iso2 === iso2);
        rows.push({ iso2, level: key, name: c?.name || iso2 });
      }
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [policy]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return ALL_COUNTRIES
      .filter(c => c.name.toLowerCase().includes(term) || c.iso2.toLowerCase() === term)
      .slice(0, 8);
  }, [q]);

  function apply(iso2, lvl) {
    update(prev => ({ ...prev, travelPolicy: setCountryLevel(getPolicy(prev), iso2, lvl) }));
    setQ('');
  }
  function clear(iso2) {
    update(prev => ({ ...prev, travelPolicy: setCountryLevel(getPolicy(prev), iso2, null) }));
  }
  function setNote(note) {
    update(prev => ({ ...prev, travelPolicy: { ...getPolicy(prev), enabled: true, note } }));
  }
  function toggleEnabled() {
    update(prev => {
      const p = getPolicy(prev);
      return { ...prev, travelPolicy: { ...p, enabled: !p.enabled } };
    });
  }

  const count = assigned.length;

  return (
    <div className="card" style={{ padding: '22px' }}>
      <div className="set-card-title">
        <Icon name="shield" size={15} />
        Travel policy
      </div>
      <p className="set-card-sub">
        Colour-code countries by whether you need permission to travel there.
        The Holiday map can show these, and trips to a flagged country get a
        warning on their card.
      </p>

      <div className="tp-privacy">
        <Icon name="lock" size={13} />
        Private to you. Never shared with friends, the leaderboard, or any AI feature.
      </div>

      <label className="tp-enable">
        <input type="checkbox" checked={policy.enabled} onChange={toggleEnabled} />
        <span>Show clearance colours{count > 0 ? ` (${count} ${count === 1 ? 'country' : 'countries'})` : ''}</span>
      </label>

      <div className="tp-levels">
        {Object.values(POLICY_LEVELS).map(l => (
          <button
            key={l.key}
            type="button"
            className={`tp-level tp-level-${l.tone}${level === l.key ? ' is-active' : ''}`}
            onClick={() => setLevel(l.key)}
          >{l.label}</button>
        ))}
      </div>

      <div className="tp-search">
        <Icon name="search" size={14} />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={`Add a country as "${POLICY_LEVELS[level].label}"`}
          aria-label="Search countries"
        />
      </div>
      {results.length > 0 && (
        <div className="tp-results">
          {results.map(c => (
            <button key={c.iso2} type="button" className="tp-result" onClick={() => apply(c.iso2, level)}>
              {c.name}<span>{c.iso2}</span>
            </button>
          ))}
        </div>
      )}

      {count > 0 && (
        <div className="tp-list">
          {assigned.map(row => (
            <div key={row.iso2} className={`tp-row tp-row-${POLICY_LEVELS[row.level].tone}`}>
              <span className="tp-row-dot" />
              <span className="tp-row-name">{row.name}</span>
              <span className="tp-row-level">{POLICY_LEVELS[row.level].label}</span>
              <button type="button" onClick={() => clear(row.iso2)} aria-label={`Remove ${row.name}`}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="fg" style={{ marginTop: '14px' }}>
        <label>Reference note (optional)</label>
        <input
          type="text"
          placeholder="e.g. Per vetting brief, reviewed March 2026"
          value={policy.note}
          onChange={e => setNote(e.target.value)}
        />
      </div>

      <p className="tp-disclaimer">
        This is a personal reminder built from lists you enter yourself — it is
        not an authoritative source. Always confirm with your vetting or security
        team before booking.
      </p>
    </div>
  );
}
