/**
 * Career → Companies: target employers, the offer guardrails, and where
 * each one is easy to reach from.
 *
 * Pick an area and the table sorts by the commute from it and highlights
 * that column. Commutes are estimates (peak public transport) and say so;
 * anything not confirmed from a current source is marked unverified. No
 * vacancies are listed — the careers link is where those are checked.
 *
 * The candidate areas and the location notes are DATA (career.plan →
 * areas, locationNotes), not code: where someone plans to live is exactly
 * the kind of thing that must not ship in the public bundle.
 *
 * Each employer can carry a difficulty rating (1 very achievable – 5 very
 * hard, with the reason) and a base-salary estimate with its source and
 * basis; the salary is coloured against the floor and target from the
 * guardrails (lib/career/companies).
 */
import { useMemo, useState } from 'react';
import JsonDrawer from './JsonDrawer';
import { KEYS } from '../../../lib/career/schema';
import { salaryGuard, salaryVerdict, orderCompanies, salaryLabel } from '../../../lib/career/companies';

const VERDICT = { meets: 'meets target', spans: 'can reach target', floor: 'above floor', below: 'below floor', unknown: '' };
const BASIS = { company: 'company data', market: 'market rate', 'pay-scale': 'pay scale' };

const lowOf = v => { const m = /^(\d+)/.exec(String(v || '')); return m ? Number(m[1]) : 999; };
const fitsGuardrail = v => lowOf(v) <= 30;

export default function CompaniesPanel({ oc, isMobile }) {
  const list = useMemo(() => oc.data[KEYS.companies] || [], [oc.data]);
  const plan = useMemo(() => oc.data[KEYS.plan] || {}, [oc.data]);
  const guardrails = plan.guardrails || [];
  const AREAS = plan.areas || [];
  const notes = plan.locationNotes || [];
  const [area, setArea] = useState('');
  const [order, setOrder] = useState('listed');
  const guard = useMemo(() => salaryGuard(plan), [plan]);
  const [editing, setEditing] = useState(false);

  // Picking an area sorts by commute from it unless an explicit order is chosen.
  const rows = useMemo(() => {
    const live = list.filter(c => !c.excluded);
    return orderCompanies(live, order !== 'listed' ? order : area || 'listed', lowOf);
  }, [list, area, order]);
  const meets = rows.filter(c => ['meets', 'spans'].includes(salaryVerdict(c.salary, guard))).length;
  const rated = rows.some(c => c.difficulty || c.salary);
  const excluded = list.filter(c => c.excluded);
  const verified = list.filter(c => c.verified && !c.excluded).length;

  return (
    <div className="cp">
      <header className="cp-head">
        <div>
          <span className="cp-eyebrow">// target companies</span>
          <h3 className="cp-title">{rows.length} employers · {verified} verified{rated ? ` · ${meets} can reach the target` : ''}</h3>
        </div>
        <button type="button" className="upg-textbtn cp-edit" onClick={() => setEditing(true)}>Edit data</button>
      </header>

      {guardrails.length > 0 && (
        <section className="cp-card cp-guard">
          <span className="cp-eyebrow">// offer guardrails</span>
          <dl>
            {guardrails.map(g => <div key={g.label}><dt>{g.label}</dt><dd>{g.value}</dd></div>)}
          </dl>
        </section>
      )}

      <section className="cp-card cp-where">
        <span className="cp-eyebrow">// where from</span>
        {notes.length > 0 && <ul>{notes.map(n => <li key={n}>{n}</li>)}</ul>}
        <div className="cp-filters" role="radiogroup" aria-label="Sort by commute from">
          <button type="button" role="radio" aria-checked={!area} className={`cp-chip is-plain${!area ? ' is-on' : ''}`} onClick={() => setArea('')}>Any area</button>
          {AREAS.map(a => (
            <button key={a.id} type="button" role="radio" aria-checked={area === a.id}
                    className={`cp-chip is-plain${area === a.id ? ' is-on' : ''}`} onClick={() => setArea(a.id)}>{a.label}</button>
          ))}
        </div>
      </section>

      {rated && (
        <div className="cp-filters" role="radiogroup" aria-label="Order">
          <span className="cp-sub cp-order-lbl">Order</span>
          {[['listed', area ? 'By commute' : 'As listed'], ['easiest', 'Easiest first'], ['salary', 'Highest salary']].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={order === id}
                    className={`cp-chip is-plain${order === id ? ' is-on' : ''}`} onClick={() => setOrder(id)}>{label}</button>
          ))}
        </div>
      )}

      {isMobile ? (
        <div className="cp-co-cards">
          {rows.map(c => <CompanyCard key={c.id} c={c} area={area} areas={AREAS} guard={guard} />)}
        </div>
      ) : (
        <div className="cp-table-wrap cp-card is-flush">
          <table className="cp-co">
            <thead>
              <tr>
                <th>Company</th><th>Roles · clearance</th>
                {rated && <><th>Est. salary</th><th>Difficulty</th></>}
                {AREAS.map(a => <th key={a.id} className={`is-num${area === a.id ? ' is-area' : ''}`}>{a.label.split(' /')[0]}</th>)}
                <th>Best from</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td>
                    <b>{c.careersUrl ? <a href={c.careersUrl} target="_blank" rel="noreferrer noopener">{c.name} ↗</a> : c.name}</b>
                    <span className="cp-sub">{c.sector} · {c.office}</span>
                    {c.fit && <span className="cp-fit">{c.fit}</span>}
                  </td>
                  <td><span>{c.roles}</span><span className="cp-sub">{c.clearance}</span></td>
                  {rated && <><td><Salary s={c.salary} guard={guard} /></td><td><Difficulty d={c.difficulty} /></td></>}
                  {AREAS.map(a => (
                    <td key={a.id} className={`is-num${area === a.id ? ' is-area' : ''}${fitsGuardrail(c.commute?.[a.id]) ? ' is-ok' : ''}`}>
                      {c.commute?.[a.id] || '—'}
                    </td>
                  ))}
                  <td><span className="cp-best">{c.bestAreas}</span></td>
                  <td><Verified c={c} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="upg-fine">
        Commute: estimated minutes by public transport at peak, door to door. Green = within the ~30 min guardrail.
        {rated && <> Salary: estimated base pay for the role shown, from the source named on each (hover it); not an offer.
        Difficulty: 1 very achievable – 5 very hard, for your profile.</>}
        {' '}No vacancies are listed — check each careers page.
      </div>

      {excluded.length > 0 && (
        <section className="cp-section">
          <span className="cp-eyebrow">// excluded</span>
          {excluded.map(c => <div key={c.id} className="cp-excl"><b>{c.name}</b> — {c.excluded}</div>)}
        </section>
      )}

      {editing && (
        <JsonDrawer title="Edit companies" contentKey={KEYS.companies} value={list}
                    onSave={v => oc.save(KEYS.companies, v)} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

function Verified({ c }) {
  return c.verified
    ? <span className="cp-ver is-ok" title={c.notes || ''}>Verified {c.verifiedOn}</span>
    : <span className="cp-ver" title={c.notes || ''}>Unverified</span>;
}

/** Base-salary estimate, coloured against the guardrails, with its basis and source. */
function Salary({ s, guard }) {
  if (!s) return <span className="cp-sub">—</span>;
  const v = salaryVerdict(s, guard);
  return (
    <span className={`cp-sal is-${v}`} title={[s.role, s.source && `Source: ${s.source}`, s.asOf && `as of ${s.asOf}`].filter(Boolean).join(' · ')}>
      <b>{salaryLabel(s)}</b>
      <span className="cp-sub">
        {VERDICT[v]}{s.basis ? ` · ${BASIS[s.basis] || s.basis}` : ''}
        {s.url && <> · <a href={s.url} target="_blank" rel="noreferrer noopener">source ↗</a></>}
      </span>
      {s.role && <span className="cp-sub">{s.role}</span>}
    </span>
  );
}

/** Five pips, with the reason under them. */
function Difficulty({ d }) {
  if (!d || !Number.isFinite(d.score)) return <span className="cp-sub">—</span>;
  const label = ['', 'Very achievable', 'Achievable', 'Moderate', 'Hard', 'Very hard'][d.score] || '';
  return (
    <span className={`cp-diff is-${d.score}`}>
      <span className="cp-pips" role="img" aria-label={`Difficulty ${d.score} of 5, ${label.toLowerCase()}`}>
        {[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= d.score ? 'is-on' : ''} />)}
        <b>{label}</b>
      </span>
      {d.why && <span className="cp-sub cp-diff-why">{d.why}</span>}
    </span>
  );
}

function CompanyCard({ c, area, areas: AREAS, guard }) {
  return (
    <article className="cp-co-card">
      <div className="cp-co-top">
        <b>{c.careersUrl ? <a href={c.careersUrl} target="_blank" rel="noreferrer noopener">{c.name} ↗</a> : c.name}</b>
        <Verified c={c} />
      </div>
      <span className="cp-sub">{c.sector} · {c.office}</span>
      <span>{c.roles}</span>
      <span className="cp-sub">{c.clearance}</span>
      {c.fit && <span className="cp-fit">{c.fit}</span>}
      {(c.salary || c.difficulty) && (
        <div className="cp-co-rate">
          <Salary s={c.salary} guard={guard} />
          <Difficulty d={c.difficulty} />
        </div>
      )}
      <div className="cp-co-commute">
        {AREAS.map(a => (
          <span key={a.id} className={`${area === a.id ? 'is-area' : ''}${fitsGuardrail(c.commute?.[a.id]) ? ' is-ok' : ''}`}>
            <em>{a.label.split(' /')[0]}</em>{c.commute?.[a.id] || '—'}
          </span>
        ))}
      </div>
      <span className="cp-best">Best from: {c.bestAreas}</span>
    </article>
  );
}
