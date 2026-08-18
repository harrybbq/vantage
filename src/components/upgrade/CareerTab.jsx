/**
 * Career tab — certifications, CV, and deliberate practice.
 *
 * Four sections behind a tab row rather than one long scroll: they are
 * used at different moments (a cert goes in once a quarter, a LeetCode
 * problem goes in daily) and stacking them would bury the frequent one
 * under the rare one.
 *
 * The tabs use the app's own `.settings-tabs` convention rather than a
 * bespoke one, at section scale with a count on each. They were four
 * small pills indistinguishable from every other button on the page,
 * which read as a filter row rather than as four places to be.
 *
 * Everything is additive state:
 *   S.certs       [{ id, name, provider, status, date, expires, url }]
 *   S.cv          the main CV — see lib/career/cv.js
 *   S.cvVariants  copies tailored for a specific job
 *   S.cvActive    which of those is open, or null for the main one
 *   S.practice    { progress: {…}, log: [...], snippets: [...] }
 * The uploaded CV FILE is the exception and lives in Supabase Storage —
 * see lib/career/cvFile.js for why, and for how it fails soft before
 * the bucket exists.
 */
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import PracticePanel from './PracticePanel';
import CvEditor from './CvEditor';
import { activeCv } from '../../lib/career/cv';
import { ALL_PROBLEMS, progressOf } from '../../lib/career/problems';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);

const PANELS = [
  { id: 'certs', label: 'Certifications' },
  { id: 'cv', label: 'CV' },
  { id: 'practice', label: 'Practice' },
  { id: 'library', label: 'Library' },
];

/**
 * The count beside each tab.
 *
 * These are the reason the row is worth its height: a tab strip that
 * only says where you are is navigation, and one that also says how much
 * is behind each door is navigation you can plan from. Deliberately
 * cheap to compute — nothing here reaches past state already in memory.
 */
function panelCount(id, S) {
  if (id === 'certs') {
    const list = S.certs || [];
    if (!list.length) return '';
    const passed = list.filter(c => c.status === 'passed').length;
    return `${passed}/${list.length}`;
  }
  if (id === 'cv') {
    const n = activeCv(S).experience.length;
    return n ? `${n} role${n === 1 ? '' : 's'}` : '';
  }
  if (id === 'practice') {
    const solved = ALL_PROBLEMS.filter(p => progressOf(S, p.id).status === 'solved').length;
    return `${solved}/${ALL_PROBLEMS.length}`;
  }
  if (id === 'library') {
    const n = ((S.practice || {}).snippets || []).length;
    return n ? String(n) : '';
  }
  return '';
}

export default function CareerTab({ S, update, userId }) {
  const [panel, setPanel] = useState('certs');
  // `log` is a sub-screen of Practice, not a fifth section — the tab
  // stays lit on Practice while you are in it.
  const lit = panel === 'log' ? 'practice' : panel;
  return (
    <div className="upg-pane">
      {/* Section tabs — the app's tab convention at section scale, so
          this page does not invent a second one. Same classes as
          Settings and Track, which is also what gets it the readable
          inactive colour and the narrow-viewport gutters for free. */}
      <div className="settings-tabs career-tabs" role="tablist" aria-label="Career sections">
        {PANELS.map(p => {
          const n = panelCount(p.id, S);
          return (
            <button key={p.id} type="button" role="tab"
                    aria-selected={lit === p.id}
                    className={'settings-tab' + (lit === p.id ? ' settings-tab-active' : '')}
                    onClick={() => setPanel(p.id)}>
              {p.label}
              {n && <span className="career-tab-n">{n}</span>}
            </button>
          );
        })}
      </div>
      {panel === 'certs' && <Certifications S={S} update={update} />}
      {panel === 'cv' && <CvEditor S={S} update={update} userId={userId} />}
      {panel === 'practice' && (
        <PracticePanel S={S} update={update} onOpenLog={() => setPanel('log')} />
      )}
      {panel === 'log' && <PracticeLog S={S} update={update} onBack={() => setPanel('practice')} />}
      {panel === 'library' && <SnippetLibrary S={S} update={update} />}
    </div>
  );
}

/* ── Certifications ──────────────────────────────────────────────── */

const CERT_STATUS = [
  { id: 'planned', label: 'Planned' },
  { id: 'studying', label: 'Studying' },
  { id: 'booked', label: 'Booked' },
  { id: 'passed', label: 'Passed' },
];

function Certifications({ S, update }) {
  const certs = useMemo(() => S.certs || [], [S.certs]);
  const [draft, setDraft] = useState(null);

  const save = next => update(prev => ({ ...prev, certs: next }));
  const upsert = c => save(certs.some(x => x.id === c.id) ? certs.map(x => (x.id === c.id ? c : x)) : [...certs, c]);
  const remove = id => save(certs.filter(x => x.id !== id));

  // Expiry is the whole reason to track a cert you already hold, so it
  // leads rather than hiding in a detail row.
  const withExpiry = certs.map(c => {
    if (!c.expires) return { ...c, daysLeft: null };
    const days = Math.round((new Date(c.expires + 'T12:00') - Date.now()) / 86400000);
    return { ...c, daysLeft: days };
  });
  const order = { studying: 0, booked: 1, planned: 2, passed: 3 };
  const sorted = [...withExpiry].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  return (
    <>
      <div className="upg-card-head upg-head-row">
        <h3>Certifications</h3>
        <button type="button" className="link-open-btn"
                onClick={() => setDraft({ id: uid(), name: '', provider: '', status: 'planned', date: '', expires: '', url: '' })}>
          + Add
        </button>
      </div>

      {!sorted.length && <div className="upg-empty">Nothing tracked yet. Add the one you&apos;re working towards.</div>}

      <div className="upg-list">
        {sorted.map(c => (
          <div key={c.id} className={`upg-cert is-${c.status}`}>
            <div className="upg-cert-main">
              <div className="upg-cert-name">
                {c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.name || 'Untitled'}</a> : (c.name || 'Untitled')}
              </div>
              <div className="upg-cert-meta">
                {c.provider && <span>{c.provider}</span>}
                {c.date && <span>{c.status === 'passed' ? 'Passed' : 'Target'} {c.date}</span>}
                {c.daysLeft != null && (
                  <span className={c.daysLeft < 0 ? 'is-bad' : c.daysLeft < 90 ? 'is-warn' : ''}>
                    {c.daysLeft < 0 ? `Expired ${-c.daysLeft}d ago` : `Expires in ${c.daysLeft}d`}
                  </span>
                )}
              </div>
            </div>
            <span className={`upg-badge is-${c.status}`}>{CERT_STATUS.find(s => s.id === c.status)?.label || c.status}</span>
            <button type="button" className="upg-textbtn" onClick={() => setDraft(c)}>Edit</button>
          </div>
        ))}
      </div>

      {draft && (
        <Sheet title={certs.some(c => c.id === draft.id) ? 'Edit certification' : 'Add certification'}
               onClose={() => setDraft(null)}
               onDelete={certs.some(c => c.id === draft.id) ? () => { remove(draft.id); setDraft(null); } : null}
               onSave={() => { upsert(draft); setDraft(null); }}>
          <Field label="Name"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="SC-200, AZ-900…" /></Field>
          <Field label="Provider"><input value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })} placeholder="Microsoft, CompTIA…" /></Field>
          <Field label="Status">
            <div className="upg-chipset">
              {CERT_STATUS.map(s => (
                <button key={s.id} type="button" className={'upg-opt' + (draft.status === s.id ? ' is-on' : '')}
                        onClick={() => setDraft({ ...draft, status: s.id })}>{s.label}</button>
              ))}
            </div>
          </Field>
          <Field label={draft.status === 'passed' ? 'Date passed' : 'Target date'}>
            <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
          </Field>
          <Field label="Expires"><input type="date" value={draft.expires} onChange={e => setDraft({ ...draft, expires: e.target.value })} /></Field>
          <Field label="Link"><input value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} placeholder="Exam page or credential" /></Field>
        </Sheet>
      )}
    </>
  );
}

/* ── CV ──────────────────────────────────────────────────────────── */

/* ── Practice log ────────────────────────────────────────────────── */

const KINDS = [{ id: 'leetcode', label: 'LeetCode' }, { id: 'kql', label: 'KQL' }];
const DIFFS = ['Easy', 'Medium', 'Hard'];

function PracticeLog({ S, update, onBack }) {
  const practice = useMemo(() => S.practice || { log: [], snippets: [] }, [S.practice]);
  const log = practice.log || [];
  const [kind, setKind] = useState('leetcode');
  const [draft, setDraft] = useState(null);

  const save = next => update(prev => ({ ...prev, practice: { ...(prev.practice || {}), log: next } }));
  const rows = log.filter(r => r.kind === kind).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Confidence is the whole point of logging rather than counting: a
  // problem you solved by looking at the answer is not done, and the
  // count alone can't tell you that.
  const revisit = rows.filter(r => (r.confidence || 0) <= 2);
  const streak = useMemo(() => {
    const days = new Set(log.map(r => r.date));
    let n = 0;
    const d = new Date();
    for (;;) {
      const iso = d.toISOString().slice(0, 10);
      if (!days.has(iso)) { if (n === 0 && iso === today()) { d.setDate(d.getDate() - 1); continue; } break; }
      n++; d.setDate(d.getDate() - 1);
    }
    return n;
  }, [log]);

  const topics = {};
  rows.forEach(r => { if (r.topic) topics[r.topic] = (topics[r.topic] || 0) + ((r.confidence || 0) <= 2 ? 1 : 0); });
  const weak = Object.entries(topics).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <>
      <div className="upg-subnav is-inner">
        {onBack && <button type="button" className="upg-subtab" onClick={onBack}>← Curriculum</button>}
        {KINDS.map(k => (
          <button key={k.id} type="button" className={'upg-subtab' + (kind === k.id ? ' is-on' : '')}
                  onClick={() => setKind(k.id)}>{k.label}</button>
        ))}
        <button type="button" className="link-open-btn" style={{ marginLeft: 'auto' }}
                onClick={() => setDraft({ id: uid(), kind, name: '', topic: '', difficulty: 'Medium', date: today(), confidence: 3, notes: '', url: '' })}>
          + Log
        </button>
      </div>
      <div className="upg-fine">
        Anything outside the curriculum — a mock interview, a problem from somewhere else.
        Curriculum attempts land here automatically.
      </div>

      <div className="upg-stats is-four">
        <div className="upg-stat"><div className="upg-stat-num">{rows.length}</div><div className="upg-stat-lbl">Logged</div></div>
        <div className="upg-stat"><div className="upg-stat-num">{streak}</div><div className="upg-stat-lbl">Day streak</div></div>
        <div className="upg-stat"><div className="upg-stat-num">{revisit.length}</div><div className="upg-stat-lbl">To revisit</div></div>
        <div className="upg-stat">
          <div className="upg-stat-num">{rows.filter(r => r.date >= today().slice(0, 8) + '01').length}</div>
          <div className="upg-stat-lbl">This month</div>
        </div>
      </div>

      {weak.length > 0 && (
        <div className="upg-note">
          Weakest {kind === 'kql' ? 'operators' : 'topics'}: {weak.map(([t, n]) => `${t} (${n})`).join(' · ')}
        </div>
      )}

      {!rows.length && <div className="upg-empty">Nothing logged yet.</div>}
      <div className="upg-list">
        {rows.map(r => (
          <button key={r.id} type="button" className="upg-prow" onClick={() => setDraft(r)}>
            <span className="upg-prow-name">{r.name || 'Untitled'}</span>
            {r.kind === 'leetcode' && r.difficulty && <span className={`upg-diff is-${r.difficulty.toLowerCase()}`}>{r.difficulty}</span>}
            {r.topic && <span className="upg-topic">{r.topic}</span>}
            <span className="upg-conf" title={`Confidence ${r.confidence}/5`}>
              {'★'.repeat(r.confidence || 0)}{'☆'.repeat(5 - (r.confidence || 0))}
            </span>
            <span className="upg-prow-date">{r.date}</span>
          </button>
        ))}
      </div>

      {draft && (
        <Sheet title={log.some(r => r.id === draft.id) ? 'Edit entry' : 'Log practice'}
               onClose={() => setDraft(null)}
               onDelete={log.some(r => r.id === draft.id) ? () => { save(log.filter(r => r.id !== draft.id)); setDraft(null); } : null}
               onSave={() => {
                 save(log.some(r => r.id === draft.id) ? log.map(r => (r.id === draft.id ? draft : r)) : [...log, draft]);
                 setDraft(null);
               }}>
          <Field label="Name"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                                     placeholder={draft.kind === 'kql' ? 'What the query did' : 'Problem title'} /></Field>
          <Field label={draft.kind === 'kql' ? 'Operator / area' : 'Topic'}>
            <input value={draft.topic} onChange={e => setDraft({ ...draft, topic: e.target.value })}
                   placeholder={draft.kind === 'kql' ? 'join, mv-expand, summarize…' : 'Arrays, DP, Graphs…'} />
          </Field>
          {draft.kind === 'leetcode' && (
            <Field label="Difficulty">
              <div className="upg-chipset">
                {DIFFS.map(d => (
                  <button key={d} type="button" className={'upg-opt' + (draft.difficulty === d ? ' is-on' : '')}
                          onClick={() => setDraft({ ...draft, difficulty: d })}>{d}</button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Date"><input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></Field>
          <Field label={`Confidence — ${draft.confidence}/5`}>
            <div className="upg-chipset">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" className={'upg-opt' + (draft.confidence === n ? ' is-on' : '')}
                        onClick={() => setDraft({ ...draft, confidence: n })}>{n}</button>
              ))}
            </div>
            <div className="upg-fine">2 or below marks it for revisiting.</div>
          </Field>
          <Field label="Notes"><textarea rows={4} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })}
                                         placeholder="The approach, and what you missed first time." /></Field>
          <Field label="Link"><input value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} /></Field>
        </Sheet>
      )}
    </>
  );
}

/* ── Snippet library ─────────────────────────────────────────────── */

function SnippetLibrary({ S, update }) {
  const practice = useMemo(() => S.practice || { log: [], snippets: [] }, [S.practice]);
  const snippets = practice.snippets || [];
  const [kind, setKind] = useState('kql');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState(null);
  const [copied, setCopied] = useState('');

  const save = next => update(prev => ({ ...prev, practice: { ...(prev.practice || {}), snippets: next } }));
  const needle = q.trim().toLowerCase();
  const rows = snippets
    .filter(s => s.kind === kind)
    .filter(s => !needle || `${s.title} ${s.body} ${(s.tags || []).join(' ')}`.toLowerCase().includes(needle));

  return (
    <>
      <div className="upg-subnav is-inner">
        {KINDS.map(k => (
          <button key={k.id} type="button" className={'upg-subtab' + (kind === k.id ? ' is-on' : '')}
                  onClick={() => setKind(k.id)}>{k.label}</button>
        ))}
        <button type="button" className="link-open-btn" style={{ marginLeft: 'auto' }}
                onClick={() => setDraft({ id: uid(), kind, title: '', body: '', tags: [] })}>+ Snippet</button>
      </div>

      <input className="upg-search" value={q} onChange={e => setQ(e.target.value)}
             placeholder={`Search ${kind === 'kql' ? 'queries' : 'patterns'} — title, body or tag`} />

      {!rows.length && <div className="upg-empty">{needle ? 'Nothing matches.' : 'Nothing saved yet.'}</div>}
      {rows.map(s => (
        <div key={s.id} className="upg-snip">
          <div className="upg-snip-head">
            <span className="upg-snip-title">{s.title || 'Untitled'}</span>
            {(s.tags || []).map(t => <span key={t} className="upg-tag">{t}</span>)}
            <button type="button" className="upg-textbtn" style={{ marginLeft: 'auto' }}
                    onClick={() => { navigator.clipboard?.writeText(s.body); setCopied(s.id); setTimeout(() => setCopied(''), 1200); }}>
              {copied === s.id ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="upg-textbtn" onClick={() => setDraft(s)}>Edit</button>
          </div>
          <pre className="upg-snip-body">{s.body}</pre>
        </div>
      ))}

      {draft && (
        <Sheet title={snippets.some(s => s.id === draft.id) ? 'Edit snippet' : 'New snippet'}
               onClose={() => setDraft(null)}
               onDelete={snippets.some(s => s.id === draft.id) ? () => { save(snippets.filter(s => s.id !== draft.id)); setDraft(null); } : null}
               onSave={() => {
                 save(snippets.some(s => s.id === draft.id) ? snippets.map(s => (s.id === draft.id ? draft : s)) : [...snippets, draft]);
                 setDraft(null);
               }}>
          <Field label="Title"><input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="Tags (comma separated)">
            <input value={(draft.tags || []).join(', ')}
                   onChange={e => setDraft({ ...draft, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })} />
          </Field>
          <Field label={draft.kind === 'kql' ? 'Query' : 'Pattern'}>
            <textarea rows={10} className="upg-code" spellCheck={false}
                      value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
          </Field>
        </Sheet>
      )}
    </>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────── */

function Field({ label, children }) {
  return <label className="upg-field"><span className="upg-field-lbl">{label}</span>{children}</label>;
}

function Sheet({ title, children, onClose, onSave, onDelete }) {
  return (
    <div className="modal-overlay open" onClick={onClose} role="presentation">
      <div className="modal upg-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="upg-day-head">
          <div className="upg-day-date">{title}</div>
          <button type="button" className="link-del-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="upg-sheet-body">{children}</div>
        <div className="upg-day-actions">
          {onDelete && <button type="button" className="upg-textbtn" onClick={onDelete}>Delete</button>}
          <button type="button" className="link-open-btn" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
