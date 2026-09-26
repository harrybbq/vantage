/**
 * Career → Certs: the certification roadmap, merged with the old cert log.
 *
 * ── The merge ──
 * Certs used to live in `S.certs` (the user's own state). The roadmap
 * lives in owner content. On first load, anything in `S.certs` that the
 * roadmap does not already have (by id or by name) is COPIED in, and its
 * id is remembered in `career.meta.importedCertIds` so deleting it from
 * the roadmap later does not bring it back. `S.certs` itself is never
 * touched — additive, like every other state change.
 *
 * ── The rule ──
 * Any exam in the same month as a house-purchase milestone warns. The
 * collision check is lib/career/planTimeline#examCollisions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, Sheet } from '../UpgSheet';
import JsonDrawer from './JsonDrawer';
import { KEYS } from '../../../lib/career/schema';
import { examCollisions } from '../../../lib/career/planTimeline';
import { monthLabel, isMonth } from '../../../lib/career/money';

const META = 'career.meta';
export const CERT_STATUS = [
  { id: 'planned', label: 'Planned' },
  { id: 'studying', label: 'Studying' },
  { id: 'booked', label: 'Booked' },
  { id: 'passed', label: 'Passed' },
];
const FUNDING = { likely: 'Employer likely funds', maybe: 'Employer might fund', no: 'Self-funded', unknown: 'Funding: ask', 'n/a': '' };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isDone = c => c.completed || c.status === 'passed';

/** What `S.certs` has that the roadmap does not — as roadmap entries. */
export function certsToImport(roadmap, appCerts, imported = []) {
  const ids = new Set(roadmap.map(c => c.id));
  const names = new Set(roadmap.map(c => norm(c.name)));
  const seen = new Set(imported);
  return (appCerts || [])
    .filter(c => c && c.name && !ids.has(c.id) && !names.has(norm(c.name)) && !seen.has(c.id))
    .map((c, i) => ({
      id: c.id || uid(), order: 50 + i, name: c.name, provider: c.provider || '',
      status: c.status || 'planned', completed: c.status === 'passed' || undefined,
      target: c.date ? c.date.slice(0, 7) : '', passedOn: c.status === 'passed' ? c.date || '' : undefined,
      expires: c.expires || '', priceUrl: c.url || '', why: '', source: 'cert log',
    }));
}

export default function CertRoadmap({ oc, S }) {
  const certs = useMemo(() => oc.data[KEYS.certs] || [], [oc.data]);
  const plan = oc.data[KEYS.plan];
  const meta = oc.data[META] || {};
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState('');

  // One-time copy of the old cert log into the roadmap.
  const merged = useRef(false);
  useEffect(() => {
    if (merged.current || oc.state !== 'ready' || !oc.data[KEYS.certs]) return;
    merged.current = true;
    const add = certsToImport(certs, S.certs, meta.importedCertIds);
    if (!add.length) return;
    (async () => {
      const r = await oc.save(KEYS.certs, [...certs, ...add]);
      if (r.ok) await oc.save(META, { ...meta, importedCertIds: [...(meta.importedCertIds || []), ...add.map(c => c.id)] });
      else setMsg(r.message);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oc.state]);

  const clashes = useMemo(() => examCollisions(certs, (plan && plan.items) || []), [certs, plan]);
  const clashFor = id => clashes.filter(c => c.certId === id);
  const active = certs.filter(c => !isDone(c)).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  const done = certs.filter(isDone);

  async function write(next) {
    const r = await oc.save(KEYS.certs, next);
    setMsg(r.ok ? '' : r.message);
    return r;
  }
  const upsert = c => write(certs.some(x => x.id === c.id) ? certs.map(x => (x.id === c.id ? c : x)) : [...certs, c]);

  return (
    <div className="cp">
      <header className="cp-head">
        <div>
          <span className="cp-eyebrow">// certification roadmap</span>
          <h3 className="cp-title">{active.length} ahead · {done.length} done</h3>
        </div>
        <button type="button" className="link-open-btn"
                onClick={() => setDraft({ id: uid(), order: (active.at(-1)?.order ?? 0) + 1, name: '', provider: '', status: 'planned', target: '', targetEnd: '', studyHours: '', priceUrl: '', fundedBy: 'unknown', why: '' })}>
          + Add
        </button>
        <button type="button" className="upg-textbtn cp-edit" onClick={() => setEditing(true)}>Edit data</button>
      </header>

      {clashes.length > 0 && (
        <div className="cp-warn" role="alert">
          <b>⚠ Exam in a house-milestone month</b>
          {clashes.map(c => (
            <span key={c.certId + c.month}>{c.cert} — {monthLabel(c.month)} clashes with {c.house.join(', ')}</span>
          ))}
        </div>
      )}
      {msg && <div className="cp-warn" role="alert">{msg}</div>}

      <ol className="cp-certs">
        {active.map((c, i) => {
          const cl = clashFor(c.id);
          return (
            <li key={c.id} className={`cp-cert is-${c.status}${cl.length ? ' is-clash' : ''}`}>
              <span className="cp-cert-n">{String(i + 1).padStart(2, '0')}</span>
              <div className="cp-cert-body">
                <div className="cp-cert-top">
                  <h4>{c.name}</h4>
                  <span className={`upg-badge is-${c.status}`}>{CERT_STATUS.find(s => s.id === c.status)?.label || c.status}</span>
                </div>
                {c.why && <p>{c.why}</p>}
                <div className="cp-cert-meta">
                  <span>{isMonth(c.target) ? `Target ${monthLabel(c.target)}${isMonth(c.targetEnd) ? `–${monthLabel(c.targetEnd)}` : ''}` : c.later ? `Later · ${c.later}` : 'No date yet'}</span>
                  {c.studyHours ? <span>~{c.studyHours} h study (est.)</span> : null}
                  {FUNDING[c.fundedBy] ? <span className={`cp-fund is-${c.fundedBy}`}>{FUNDING[c.fundedBy]}</span> : null}
                  {c.provider && <span>{c.provider}</span>}
                  {c.source && <span className="cp-sub">from your {c.source}</span>}
                </div>
                {cl.length > 0 && <div className="cp-clash">⚠ {cl.map(x => monthLabel(x.month)).join(', ')} — house milestone that month</div>}
                <div className="cp-cert-acts">
                  {c.priceUrl
                    ? <a href={c.priceUrl} target="_blank" rel="noreferrer noopener">Check current price ↗</a>
                    : <span className="cp-sub">No price link yet</span>}
                  <button type="button" className="upg-textbtn" onClick={() => setDraft({ ...c })}>Edit</button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {done.length > 0 && (
        <section className="cp-section">
          <span className="cp-eyebrow">// completed</span>
          <ul className="cp-done">
            {done.map(c => (
              <li key={c.id}>
                <span className="cp-done-tick" aria-hidden="true">✓</span>
                <span>{c.name}</span>
                {c.passedOn && <span className="cp-sub">{c.passedOn}</span>}
                {c.expires && <span className="cp-sub">expires {c.expires}</span>}
                <button type="button" className="upg-textbtn" onClick={() => setDraft({ ...c })}>Edit</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {draft && (
        <Sheet title={certs.some(c => c.id === draft.id) ? 'Edit certification' : 'Add certification'}
               onClose={() => setDraft(null)}
               onDelete={certs.some(c => c.id === draft.id) ? async () => { await write(certs.filter(c => c.id !== draft.id)); setDraft(null); } : null}
               onSave={async () => {
                 if (!draft.name.trim()) return;
                 const clean = { ...draft, studyHours: draft.studyHours === '' ? undefined : Number(draft.studyHours), completed: draft.status === 'passed' || undefined };
                 const r = await upsert(clean);
                 if (r.ok) setDraft(null);
               }}>
          <Field label="Name"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Provider"><input value={draft.provider || ''} onChange={e => setDraft({ ...draft, provider: e.target.value })} /></Field>
          <Field label="Why it fits"><textarea rows={3} value={draft.why || ''} onChange={e => setDraft({ ...draft, why: e.target.value })} /></Field>
          <Field label="Status">
            <div className="upg-chipset">
              {CERT_STATUS.map(s => (
                <button key={s.id} type="button" className={'upg-opt' + (draft.status === s.id ? ' is-on' : '')}
                        onClick={() => setDraft({ ...draft, status: s.id })}>{s.label}</button>
              ))}
            </div>
          </Field>
          <div className="cp-two is-tight">
            <Field label="Target month"><input type="month" value={draft.target || ''} onChange={e => setDraft({ ...draft, target: e.target.value })} /></Field>
            <Field label="…or a window to"><input type="month" value={draft.targetEnd || ''} onChange={e => setDraft({ ...draft, targetEnd: e.target.value })} /></Field>
          </div>
          <div className="cp-two is-tight">
            <Field label="Study hours (est.)"><input type="number" value={draft.studyHours ?? ''} onChange={e => setDraft({ ...draft, studyHours: e.target.value })} /></Field>
            <Field label="Would work fund it?">
              <select value={draft.fundedBy || 'unknown'} onChange={e => setDraft({ ...draft, fundedBy: e.target.value })}>
                <option value="likely">Likely</option><option value="maybe">Maybe</option>
                <option value="unknown">Not asked</option><option value="no">No</option><option value="n/a">n/a</option>
              </select>
            </Field>
          </div>
          <Field label="Check-current-price link"><input value={draft.priceUrl || ''} placeholder="https://…" onChange={e => setDraft({ ...draft, priceUrl: e.target.value })} /></Field>
        </Sheet>
      )}

      {editing && (
        <JsonDrawer title="Edit certifications" contentKey={KEYS.certs} value={certs}
                    onSave={v => oc.save(KEYS.certs, v)} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}
