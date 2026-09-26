/**
 * Career → Pipeline: applications from Watching to Offer.
 *
 * Every card is checked against the offer guardrails (salary floor,
 * commute, clearance) using its own figures when it has them and the
 * company's researched ones when it doesn't (lib/career/pipeline). The
 * next step and its date drive the Brief; moving a card logs an event,
 * so the detail shows how it got where it is.
 *
 * Owner content: `career.applications`. Companies can be sent here from
 * the Companies tab with "Watch".
 */
import { useMemo, useState } from 'react';
import { Field, Sheet } from '../UpgSheet';
import JsonDrawer from './JsonDrawer';
import { KEYS } from '../../../lib/career/schema';
import { salaryGuard, salaryLabel } from '../../../lib/career/companies';
import {
  STAGES, STAGE_LABEL, CLOSE_REASONS, move, close, dueIn, ageDays, needsYou, checks, isOpen, commuteOf, salaryOf,
} from '../../../lib/career/pipeline';
import { todayIso } from './careerData';

const STAGE_COL = { watching: '#8a8278', applied: '#5b8cff', screen: '#12a5a5', interview: '#d99114', offer: '#1a7a4a' };
const uid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const initials = s => String(s || '?').split(/\s+/).filter(w => /[A-Za-z]/.test(w[0] || '')).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const pretty = iso => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '');

export default function PipelinePanel({ oc, isMobile }) {
  const apps = useMemo(() => oc.data[KEYS.applications] || [], [oc.data]);
  const companies = useMemo(() => oc.data[KEYS.companies] || [], [oc.data]);
  const plan = useMemo(() => oc.data[KEYS.plan] || {}, [oc.data]);
  const guard = useMemo(() => salaryGuard(plan), [plan]);
  const today = todayIso();
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [msg, setMsg] = useState('');

  const coOf = a => companies.find(c => c.id === a.companyId) || null;
  const nameOf = a => a.company || (coOf(a) || {}).name || 'Untitled';
  const open = apps.filter(isOpen);
  const closed = apps.filter(a => !isOpen(a));
  const live = open.filter(a => a.stage !== 'watching').length;
  const needs = needsYou(apps, today).length;
  const sel = apps.find(a => a.id === openId) || null;

  async function write(next) {
    const r = await oc.save(KEYS.applications, next);
    setMsg(r.ok ? '' : r.message);
    return r;
  }

  function saveDraft() {
    const d = draft;
    if (!d.company && !d.companyId) return;
    const clean = {
      ...d,
      salary: d.salary === '' || d.salary == null ? undefined : Number(d.salary),
      commuteMin: d.commuteMin === '' || d.commuteMin == null ? undefined : Number(d.commuteMin),
      next: d.nextText || d.nextDue ? { text: d.nextText || '', due: d.nextDue || undefined } : undefined,
    };
    delete clean.nextText; delete clean.nextDue;
    const exists = apps.some(a => a.id === d.id);
    const next = exists
      ? apps.map(a => (a.id === d.id ? clean : a))
      : [...apps, { ...clean, events: [{ at: today, stage: clean.stage, note: `Added at ${STAGE_LABEL[clean.stage]}` }] }];
    write(next).then(r => { if (r.ok) { setDraft(null); setOpenId(d.id); } });
  }

  const newDraft = () => setDraft({ id: uid(), companyId: '', company: '', role: '', url: '', stage: 'applied', salary: '', commuteMin: '', cvSent: '', nextText: '', nextDue: '', notes: '' });
  const editDraft = a => setDraft({ ...a, salary: a.salary ?? '', commuteMin: a.commuteMin ?? '', nextText: (a.next && a.next.text) || '', nextDue: (a.next && a.next.due) || '' });

  return (
    <div className="cp">
      <header className="cp-sechead">
        <div>
          <span className="cp-eyebrow">// applications · watching to offer</span>
          <h3 className="cp-title">{open.length ? `${live} live · ${needs} need${needs === 1 ? 's' : ''} you this week` : 'Nothing in the pipeline yet'}</h3>
        </div>
        <div className="cp-actions">
          <span className="cp-pill">Guardrails checked on every card</span>
          <button type="button" className="cp-btn is-primary" onClick={newDraft}>+ Add</button>
          <button type="button" className="cp-btn" onClick={() => setEditing(true)}>Edit data</button>
        </div>
      </header>
      {msg && <div className="cp-warn" role="alert">{msg}</div>}

      <div className={`cp-board${isMobile ? ' is-mobile' : ''}`}>
        {STAGES.map(st => {
          const cards = open.filter(a => a.stage === st);
          return (
            <section key={st} className="cp-col" aria-label={STAGE_LABEL[st]}>
              <div className="cp-col-head">
                <span><i style={{ background: STAGE_COL[st] }} />{STAGE_LABEL[st]}</span>
                <b>{cards.length}</b>
              </div>
              <span className="cp-col-bar"><i style={{ width: `${open.length ? (cards.length / open.length) * 100 : 0}%`, background: STAGE_COL[st] }} /></span>
              <div className="cp-col-body">
                {cards.map(a => {
                  const d = dueIn(a, today);
                  const age = ageDays(a, today);
                  return (
                    <article key={a.id} className={`cp-appcard${openId === a.id ? ' is-open' : ''}${d != null && d < 0 ? ' is-hot' : ''}`}
                             onClick={() => setOpenId(a.id)} tabIndex={0}
                             onKeyDown={e => { if (e.key === 'Enter') setOpenId(a.id); }}>
                      <div className="cp-appcard-top">
                        <span className="cp-av" style={{ background: STAGE_COL[st] }}>{initials(nameOf(a))}</span>
                        <span className="cp-appcard-id"><b>{nameOf(a)}</b><span>{a.role || '—'}</span></span>
                        <span className="cp-age">{age != null ? `${age}d` : '—'}</span>
                      </div>
                      <div className="cp-checks">
                        {checks(a, coOf(a), guard).map(c => (
                          <span key={c.key} className={`cp-check is-${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'unk'}`}>
                            {c.label} {c.ok === true ? '✓' : c.ok === false ? '✕' : '?'}
                          </span>
                        ))}
                      </div>
                      <div className="cp-appcard-foot">
                        <span className={d != null && d < 0 ? 'is-bad' : ''}>
                          {a.next && (a.next.text || a.next.due)
                            ? `${a.next.text || 'Next'}${d != null ? ` · ${d < 0 ? `overdue ${-d}d` : d === 0 ? 'today' : pretty(a.next.due)}` : ''}`
                            : 'No next step'}
                        </span>
                        <span className="cp-mv">
                          <button type="button" aria-label="Move back" disabled={st === STAGES[0]}
                                  onClick={e => { e.stopPropagation(); write(move(apps, a.id, -1, today)); }}>←</button>
                          <button type="button" aria-label="Move forward" className="is-fwd" disabled={st === STAGES[STAGES.length - 1]}
                                  onClick={e => { e.stopPropagation(); write(move(apps, a.id, 1, today)); setOpenId(a.id); }}>→</button>
                        </span>
                      </div>
                    </article>
                  );
                })}
                {!cards.length && <span className="cp-col-empty">{st === 'watching' ? 'Watch a company from the Companies tab' : '—'}</span>}
              </div>
            </section>
          );
        })}
      </div>

      {sel && <Detail a={sel} co={coOf(sel)} name={nameOf(sel)} guard={guard} today={today}
                      onEdit={() => editDraft(sel)} onClose={r => write(close(apps, sel.id, r, today))} />}

      {closed.length > 0 && (
        <section className="cp-section">
          <button type="button" className="cp-linkbtn" onClick={() => setShowClosed(v => !v)} aria-expanded={showClosed}>
            // closed · {closed.length} {showClosed ? '▾' : '▸'}
          </button>
          {showClosed && (
            <div className="cp-closed">
              {closed.map(a => (
                <button key={a.id} type="button" className="cp-closed-row" onClick={() => setOpenId(a.id)}>
                  <b>{nameOf(a)}</b><span>{a.role}</span><em>{a.closed ? a.closed.reason : ''}</em>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {draft && (
        <Sheet title={apps.some(a => a.id === draft.id) ? 'Edit application' : 'Add application'}
               onClose={() => setDraft(null)} onSave={saveDraft}
               onDelete={apps.some(a => a.id === draft.id) ? () => { write(apps.filter(a => a.id !== draft.id)); setDraft(null); setOpenId(null); } : null}>
          <Field label="Company">
            <select value={draft.companyId || ''} onChange={e => {
              const co = companies.find(c => c.id === e.target.value);
              setDraft({ ...draft, companyId: e.target.value, company: co ? co.name : draft.company });
            }}>
              <option value="">Not on the list — type it below</option>
              {companies.filter(c => !c.excluded).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {!draft.companyId && <Field label="Company name"><input value={draft.company} onChange={e => setDraft({ ...draft, company: e.target.value })} /></Field>}
          <Field label="Role"><input value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value })} placeholder="SOC Analyst L2…" /></Field>
          <Field label="Stage">
            <div className="upg-chipset">
              {STAGES.map(s => <button key={s} type="button" className={'upg-opt' + (draft.stage === s ? ' is-on' : '')} onClick={() => setDraft({ ...draft, stage: s })}>{STAGE_LABEL[s]}</button>)}
            </div>
          </Field>
          <div className="cp-two is-tight">
            <Field label="Salary (£/year, advertised or offered)"><input type="number" value={draft.salary} onChange={e => setDraft({ ...draft, salary: e.target.value })} /></Field>
            <Field label="Commute (min, if known)"><input type="number" value={draft.commuteMin} onChange={e => setDraft({ ...draft, commuteMin: e.target.value })} /></Field>
          </div>
          <Field label="CV version sent"><input value={draft.cvSent} onChange={e => setDraft({ ...draft, cvSent: e.target.value })} placeholder="e.g. SOC · Sentinel-heavy" /></Field>
          <div className="cp-two is-tight">
            <Field label="Next step"><input value={draft.nextText} onChange={e => setDraft({ ...draft, nextText: e.target.value })} placeholder="Chase, panel, prep…" /></Field>
            <Field label="By"><input type="date" value={draft.nextDue} onChange={e => setDraft({ ...draft, nextDue: e.target.value })} /></Field>
          </div>
          <Field label="Advert link"><input value={draft.url || ''} onChange={e => setDraft({ ...draft, url: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Notes"><textarea rows={3} value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></Field>
        </Sheet>
      )}

      {editing && (
        <JsonDrawer title="Edit applications" contentKey={KEYS.applications} value={apps}
                    onSave={v => oc.save(KEYS.applications, v)} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

function Detail({ a, co, name, guard, today, onEdit, onClose }) {
  const [reason, setReason] = useState(CLOSE_REASONS[0]);
  const sal = salaryOf(a, co);
  const c = commuteOf(a, co);
  const d = dueIn(a, today);
  const rows = [
    ['CV sent', a.cvSent || '—'],
    ['Clearance', (co && co.clearance) || '—'],
    ['Next', a.next ? `${a.next.text || '—'}${a.next.due ? ` · ${pretty(a.next.due)}` : ''}` : '—'],
    ['Salary', sal ? `${salaryLabel(sal)}${sal.own ? '' : ' (company estimate)'}` : '—'],
  ];
  const g = [
    { label: `Salary reaches the ${guard.floor ? '£' + guard.floor / 1000 + 'k' : ''} floor`, ok: !sal || !guard.floor ? null : sal.high >= guard.floor, v: sal ? salaryLabel(sal) : 'unknown' },
    { label: 'Commute ≤ 30 min', ok: c == null ? null : c <= 30, v: c == null ? 'unknown' : `${c} min` },
    { label: 'Clearance', ok: /\bSC\b/.test((co && co.clearance) || '') ? null : true, v: /\bSC\b/.test((co && co.clearance) || '') ? 'SC needed' : 'none noted' },
    { label: 'Next step on time', ok: d == null ? null : d >= 0, v: d == null ? 'no date' : d < 0 ? `${-d}d overdue` : `in ${d}d` },
  ];
  return (
    <section className="cp-card cp-appdetail">
      <div className="cp-appdetail-main">
        <span className="cp-eyebrow">// {a.closed ? `closed · ${a.closed.reason}` : STAGE_LABEL[a.stage].toLowerCase()} · {name}</span>
        <h4 className="cp-h4 is-big">{a.role || name}</h4>
        <div className="cp-kv">
          {rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>
        {(a.events || []).length > 0 && (
          <ol className="cp-events">
            {[...a.events].reverse().slice(0, 6).map((e, i) => <li key={i}><span>{e.at}</span>{e.note}</li>)}
          </ol>
        )}
        <div className="cp-actions">
          <button type="button" className="cp-btn" onClick={onEdit}>Edit</button>
          {a.url && <a className="cp-btn" href={a.url} target="_blank" rel="noreferrer noopener">Advert ↗</a>}
          {a.closed
            ? <button type="button" className="cp-btn" onClick={() => onClose(null)}>Reopen</button>
            : (
              <span className="cp-closebox">
                <select value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason">
                  {CLOSE_REASONS.map(r => <option key={r}>{r}</option>)}
                </select>
                <button type="button" className="cp-btn" onClick={() => onClose(reason)}>Close</button>
              </span>
            )}
        </div>
      </div>
      <div className="cp-appdetail-guard">
        <span className="cp-eyebrow">// offer guardrails</span>
        {g.map(x => (
          <div key={x.label} className="cp-grow">
            <i className={x.ok === true ? 'is-ok' : x.ok === false ? 'is-bad' : 'is-unk'}>{x.ok === true ? '✓' : x.ok === false ? '!' : '?'}</i>
            <span>{x.label}</span>
            <b className={x.ok === false ? 'is-bad' : x.ok === true ? 'is-ok' : ''}>{x.v}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
