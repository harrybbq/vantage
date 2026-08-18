/**
 * The CV editor — Direction A: the document IS the editor.
 *
 * ── The problem this replaces ────────────────────────────────────────
 * The old panel was three stacked cards of form fields, 2200px tall in a
 * 1100px viewport, with no rendering of the document anywhere on screen.
 * Every judgement a CV actually needs — is it a page, is that bullet too
 * long, do the roles balance — had to be made in your head, and
 * "Print / PDF" printed the form, boxes and all.
 *
 * ── How this one works ───────────────────────────────────────────────
 * The document renders as the finished page. Click any part of it to
 * select that part; the panel beside it holds the fields for whatever is
 * selected. There is no gap between what you edit and what comes out,
 * because they are the same thing.
 *
 * Consequences worth stating, because they are the reason for the shape:
 *   · No separator conventions. Skills are chips, education is a row per
 *     entry, bullets are list items with their own controls. The old
 *     panel had three different invisible formats (commas, "·",
 *     newlines) and none of them were discoverable.
 *   · Print means something. The document is already the print target,
 *     so the stylesheet hides everything else and the PDF is the same
 *     layout you were looking at.
 *   · Versions fall out of it. Tailoring for a job is what you actually
 *     do when applying, and it was previously "overwrite the one you
 *     have".
 *
 * ── Mobile ───────────────────────────────────────────────────────────
 * A 390px screen cannot hold a document and an inspector side by side,
 * so below the breakpoint the inspector becomes a sheet that slides up
 * over the document. Same fields, same state; only the container moves.
 *
 * The document deliberately does NOT follow the app theme. It is a paper
 * document — it is cream with black text in every theme, because that is
 * what comes out of the printer.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { useIsMobile } from '../../hooks/useIsMobile';
import { listCvFiles, uploadCv, cvOpenUrl, deleteCv } from '../../lib/career/cvFile';
import {
  activeCv, activeId, addVariant, cvText, emptyEdu, emptyRole,
  isBlank, lengthOf, moved, patchActive, removeVariant, renameVariant,
  selectCv, variants,
} from '../../lib/career/cv';

/* ══ The document ═════════════════════════════════════════════════════ */

/**
 * One selectable region.
 *
 * A button rather than a div with onClick: the whole document has to be
 * reachable from a keyboard, and a real button gets focus, Enter and
 * Space for free rather than needing three ARIA attributes to fake them.
 */
function Zone({ id, sel, onSelect, children, label, className = '' }) {
  const on = sel === id;
  return (
    <button
      type="button"
      className={`cvz ${className}${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      onClick={e => { e.stopPropagation(); onSelect(id); }}
    >
      {children}
    </button>
  );
}

function CvDocument({ cv, sel, onSelect, onAdd }) {
  const h = cv.header;
  const contact = [h.title, h.location, h.email, h.phone, h.link].filter(Boolean);
  return (
    <div className="cvdoc" onClick={() => onSelect(null)}>
      <Zone id="header" sel={sel} onSelect={onSelect} label="Edit name and contact details" className="cvz-block">
        <div className="cvdoc-name">{h.name || <em className="cvdoc-ph">Your name</em>}</div>
        <div className="cvdoc-contact">
          {contact.length ? contact.join(' · ') : <em className="cvdoc-ph">Title · location · email</em>}
        </div>
      </Zone>

      <div className="cvdoc-rule" />

      <div className="cvdoc-sec">Summary</div>
      <Zone id="summary" sel={sel} onSelect={onSelect} label="Edit summary" className="cvz-block">
        {cv.summary
          ? <p className="cvdoc-p">{cv.summary}</p>
          : <p className="cvdoc-p"><em className="cvdoc-ph">Two or three lines: what you do, and what you are moving towards.</em></p>}
      </Zone>

      <div className="cvdoc-rule" />
      <div className="cvdoc-sec">Experience</div>
      {cv.experience.map(r => (
        <Zone key={r.id} id={`role:${r.id}`} sel={sel} onSelect={onSelect}
              label={`Edit ${r.role || 'this role'}`} className="cvz-block cvdoc-role">
          <div className="cvdoc-roletop">
            <b>{r.role || <em className="cvdoc-ph">Role title</em>}</b>
            <span>{[r.from, r.to].filter(Boolean).join(' — ')}</span>
          </div>
          {r.org && <div className="cvdoc-org">{r.org}</div>}
          {r.bullets.length > 0 && (
            <ul className="cvdoc-bullets">
              {r.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
        </Zone>
      ))}
      <button type="button" className="cvdoc-add" onClick={e => { e.stopPropagation(); onAdd('role'); }}>
        <Icon name="plus" size={11} /> Add a role
      </button>

      <div className="cvdoc-rule" />
      <div className="cvdoc-sec">Skills</div>
      <Zone id="skills" sel={sel} onSelect={onSelect} label="Edit skills" className="cvz-block">
        {cv.skills.length ? (
          <div className="cvdoc-skills">
            {cv.skills.map((s, i) => <i key={i}>{s}</i>)}
          </div>
        ) : <p className="cvdoc-p"><em className="cvdoc-ph">The tools and languages you would be hired for.</em></p>}
      </Zone>

      <div className="cvdoc-rule" />
      <div className="cvdoc-sec">Education</div>
      <Zone id="education" sel={sel} onSelect={onSelect} label="Edit education" className="cvz-block">
        {cv.education.length ? cv.education.map(e => (
          <div key={e.id} className="cvdoc-edu">
            <b>{e.what}</b>
            <span>{[e.where, e.when].filter(Boolean).join(' · ')}</span>
          </div>
        )) : <p className="cvdoc-p"><em className="cvdoc-ph">Degrees, then anything else worth the line.</em></p>}
      </Zone>
    </div>
  );
}

/* ══ Small field parts ════════════════════════════════════════════════ */

function F({ label, children }) {
  return (
    <label className="cvi-field">
      <span className="cvi-lbl">{label}</span>
      {children}
    </label>
  );
}

/**
 * A text input that keeps its own value while focused.
 *
 * Writing straight through to the debounced synced state on every
 * keystroke made the caret jump to the end mid-word — the value came
 * back from a re-render one character behind. Local while you type,
 * committed on change out.
 */
function Text({ value, onCommit, ...rest }) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(value); }, [value]);
  return (
    <input
      {...rest}
      value={v}
      onFocus={() => { focused.current = true; }}
      onChange={e => { setV(e.target.value); onCommit(e.target.value); }}
      onBlur={() => { focused.current = false; setV(value); }}
    />
  );
}

/**
 * Grows to fit what is in it.
 *
 * A fixed `rows` clipped bullets mid-word on a phone — the box was two
 * lines tall and the text was three, and "…and a dwell-time guard"
 * simply was not there. Resizable is not a fix for a field the user
 * cannot see the contents of.
 */
function Area({ value, onCommit, rows = 3, ...rest }) {
  const [v, setV] = useState(value);
  const focused = useRef(false);
  const el = useRef(null);
  useEffect(() => { if (!focused.current) setV(value); }, [value]);

  const fit = () => {
    const n = el.current;
    if (!n) return;
    n.style.height = 'auto';
    // scrollHeight is the CONTENT height and excludes the border, but
    // these are border-box, so height:scrollHeight leaves the box two
    // pixels short and the last line clipped. Measured, not guessed —
    // the first version of this was off by exactly the two borders.
    const cs = getComputedStyle(n);
    const chrome = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    n.style.height = `${n.scrollHeight + chrome}px`;
  };
  // On mount, on every value change, and on resize — a narrower column
  // needs more lines for the same text.
  useEffect(fit, [v]);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  return (
    <textarea
      {...rest}
      ref={el}
      rows={rows}
      value={v}
      onFocus={() => { focused.current = true; }}
      onChange={e => { setV(e.target.value); onCommit(e.target.value); }}
      onBlur={() => { focused.current = false; setV(value); }}
    />
  );
}

/* ══ Inspector ════════════════════════════════════════════════════════ */

function Inspector({ cv, sel, setSel, patch, onAdd }) {
  if (!sel) {
    return (
      <div className="cvi-card cvi-hint">
        <div className="cvi-lbl">Nothing selected</div>
        <p className="cvi-p">Click any part of the document to edit it.</p>
      </div>
    );
  }

  const set = p => patch(p);

  if (sel === 'header') {
    const h = cv.header;
    const setH = p => set({ header: { ...h, ...p } });
    return (
      <div className="cvi-card">
        <div className="cvi-lbl">Editing · heading</div>
        <F label="Name"><Text value={h.name} onCommit={v => setH({ name: v })} placeholder="Harry Mitchell" /></F>
        <F label="Title"><Text value={h.title} onCommit={v => setH({ title: v })} placeholder="Security Analyst" /></F>
        <div className="cvi-row2">
          <F label="Location"><Text value={h.location} onCommit={v => setH({ location: v })} placeholder="Portsmouth" /></F>
          <F label="Phone"><Text value={h.phone} onCommit={v => setH({ phone: v })} placeholder="Optional" /></F>
        </div>
        <F label="Email"><Text value={h.email} onCommit={v => setH({ email: v })} placeholder="you@example.com" /></F>
        <F label="Link"><Text value={h.link} onCommit={v => setH({ link: v })} placeholder="linkedin.com/in/…" /></F>
      </div>
    );
  }

  if (sel === 'summary') {
    return (
      <div className="cvi-card">
        <div className="cvi-lbl">Editing · summary</div>
        <Area value={cv.summary} rows={7} onCommit={v => set({ summary: v })}
              placeholder="Two or three lines. What you do, and what you're moving towards." />
        <div className="cvi-fine">{cv.summary.length} characters</div>
      </div>
    );
  }

  if (sel === 'skills') {
    const add = raw => {
      // One paste of "KQL, Sentinel, Python" should become three chips,
      // not one — pasting a list is the common case and splitting it is
      // free.
      const parts = String(raw).split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      if (!parts.length) return;
      const next = [...cv.skills];
      for (const p of parts) if (!next.some(s => s.toLowerCase() === p.toLowerCase())) next.push(p);
      set({ skills: next });
    };
    return (
      <div className="cvi-card">
        <div className="cvi-lbl">Editing · skills</div>
        <div className="cvi-chips">
          {cv.skills.map((s, i) => (
            <span key={s + i} className="cvi-chip">
              {s}
              <button type="button" aria-label={`Remove ${s}`}
                      onClick={() => set({ skills: cv.skills.filter((_, n) => n !== i) })}>
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
        </div>
        <SkillAdd onAdd={add} />
        <div className="cvi-fine">Enter adds it. Paste a comma-separated list and it splits.</div>
      </div>
    );
  }

  if (sel === 'education') {
    const setE = (id, p) => set({ education: cv.education.map(e => (e.id === id ? { ...e, ...p } : e)) });
    return (
      <div className="cvi-card">
        <div className="cvi-lbl">Editing · education</div>
        {!cv.education.length && <p className="cvi-p">Nothing here yet.</p>}
        {cv.education.map((e, i) => (
          <div key={e.id} className="cvi-sub">
            <div className="cvi-subhead">
              <span className="cvi-fine">Entry {i + 1}</span>
              <button type="button" className="cvi-icon" aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => set({ education: moved(cv.education, e.id, -1) })}><Icon name="chevron-up" size={13} /></button>
              <button type="button" className="cvi-icon" aria-label="Move down"
                      disabled={i === cv.education.length - 1}
                      onClick={() => set({ education: moved(cv.education, e.id, 1) })}><Icon name="chevron-down" size={13} /></button>
              <button type="button" className="cvi-icon is-del" aria-label="Remove entry"
                      onClick={() => set({ education: cv.education.filter(x => x.id !== e.id) })}><Icon name="trash-2" size={13} /></button>
            </div>
            <Text value={e.what} onCommit={v => setE(e.id, { what: v })} placeholder="BSc Computer Science, 2:1" />
            <div className="cvi-row2">
              <Text value={e.where} onCommit={v => setE(e.id, { where: v })} placeholder="Institution" />
              <Text value={e.when} onCommit={v => setE(e.id, { when: v })} placeholder="Year" />
            </div>
          </div>
        ))}
        <button type="button" className="cvi-btn" onClick={() => onAdd('education')}>
          <Icon name="plus" size={12} /> Add entry
        </button>
      </div>
    );
  }

  if (sel.startsWith('role:')) {
    const id = sel.slice(5);
    const i = cv.experience.findIndex(r => r.id === id);
    const r = cv.experience[i];
    // The selected role can vanish under you — deleted in another tab, or
    // the variant switched. Saying so beats rendering a blank panel.
    if (!r) {
      return (
        <div className="cvi-card cvi-hint">
          <div className="cvi-lbl">Gone</div>
          <p className="cvi-p">That role is no longer here. Pick another part of the document.</p>
        </div>
      );
    }
    const setR = p => set({ experience: cv.experience.map(x => (x.id === id ? { ...x, ...p } : x)) });
    const setB = (n, v) => setR({ bullets: r.bullets.map((b, k) => (k === n ? v : b)) });

    return (
      <div className="cvi-card">
        <div className="cvi-lbl">Editing · role {i + 1} of {cv.experience.length}</div>
        <F label="Title"><Text value={r.role} onCommit={v => setR({ role: v })} placeholder="Security Analyst (Tier 2)" /></F>
        <F label="Organisation"><Text value={r.org} onCommit={v => setR({ org: v })} placeholder="Contoso" /></F>
        <div className="cvi-row2">
          <F label="From"><Text value={r.from} onCommit={v => setR({ from: v })} placeholder="Mar 2024" /></F>
          <F label="To"><Text value={r.to} onCommit={v => setR({ to: v })} placeholder="Present" /></F>
        </div>

        <div className="cvi-lbl" style={{ marginTop: 4 }}>Achievements</div>
        {!r.bullets.length && <p className="cvi-p">What changed because you were there.</p>}
        {r.bullets.map((b, n) => (
          <div key={n} className="cvi-bullet">
            <Area value={b} rows={2} onCommit={v => setB(n, v)}
                  placeholder="Cut false positives by 62% with a VPN allowlist." />
            <div className="cvi-bullet-acts">
              <button type="button" className="cvi-icon" aria-label="Move up" disabled={n === 0}
                      onClick={() => { const o = r.bullets.slice(); [o[n - 1], o[n]] = [o[n], o[n - 1]]; setR({ bullets: o }); }}>
                <Icon name="chevron-up" size={12} />
              </button>
              <button type="button" className="cvi-icon" aria-label="Move down" disabled={n === r.bullets.length - 1}
                      onClick={() => { const o = r.bullets.slice(); [o[n + 1], o[n]] = [o[n], o[n + 1]]; setR({ bullets: o }); }}>
                <Icon name="chevron-down" size={12} />
              </button>
              <button type="button" className="cvi-icon is-del" aria-label="Remove"
                      onClick={() => setR({ bullets: r.bullets.filter((_, k) => k !== n) })}>
                <Icon name="x" size={12} />
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="cvi-btn" onClick={() => setR({ bullets: [...r.bullets, ''] })}>
          <Icon name="plus" size={12} /> Achievement
        </button>

        <div className="cvi-acts">
          <button type="button" className="cvi-btn" disabled={i === 0}
                  onClick={() => set({ experience: moved(cv.experience, id, -1) })}>
            <Icon name="chevron-up" size={12} /> Up
          </button>
          <button type="button" className="cvi-btn" disabled={i === cv.experience.length - 1}
                  onClick={() => set({ experience: moved(cv.experience, id, 1) })}>
            <Icon name="chevron-down" size={12} /> Down
          </button>
          <button type="button" className="cvi-btn is-del"
                  onClick={() => {
                    if (!window.confirm(`Delete ${r.role || 'this role'}?`)) return;
                    set({ experience: cv.experience.filter(x => x.id !== id) });
                    setSel(null);
                  }}>
            <Icon name="trash-2" size={12} /> Delete
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function SkillAdd({ onAdd }) {
  const [v, setV] = useState('');
  return (
    <input
      className="cvi-skilladd"
      value={v}
      placeholder="Add a skill…"
      onChange={e => setV(e.target.value)}
      onKeyDown={e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        onAdd(v);
        setV('');
      }}
      onBlur={() => { if (v.trim()) { onAdd(v); setV(''); } }}
    />
  );
}

/* ══ The panel ════════════════════════════════════════════════════════ */

export default function CvEditor({ S, update, userId }) {
  const isMobile = useIsMobile();
  const cv = activeCv(S);
  const vs = variants(S);
  const vid = activeId(S);
  const [sel, setSel] = useState(null);
  const [showFile, setShowFile] = useState(false);

  const patch = p => update(prev => patchActive(prev, p));

  function add(kind) {
    if (kind === 'role') {
      const r = emptyRole();
      update(prev => patchActive(prev, { experience: [...activeCv(prev).experience, r] }));
      setSel(`role:${r.id}`);
      return;
    }
    if (kind === 'education') {
      const e = emptyEdu();
      update(prev => patchActive(prev, { education: [...activeCv(prev).education, e] }));
      setSel('education');
    }
  }

  const len = lengthOf(cv);

  return (
    <div className="cvx">
      {/* Action bar. Export first because it is the point of the page. */}
      <div className="cvx-bar">
        <button type="button" className="cvx-btn is-pri" onClick={() => window.print()}>
          <Icon name="printer" size={13} /> Export PDF
        </button>
        <button type="button" className="cvx-btn" onClick={() => {
          const name = window.prompt('Name this version — the job or the company:', '');
          if (name === null) return;
          update(prev => addVariant(prev, name));
          setSel(null);
        }}>
          <Icon name="copy" size={13} /> Duplicate for a job
        </button>
        <button type="button" className={'cvx-btn' + (showFile ? ' is-on' : '')} onClick={() => setShowFile(v => !v)}>
          <Icon name="notebook-pen" size={13} /> Attached file
        </button>
        <span className="cvx-spacer" />
        <button type="button" className="cvx-btn" onClick={() => {
          navigator.clipboard?.writeText(cvText(cv));
        }}>Copy as text</button>
      </div>

      {/* Versions. Hidden entirely until there is more than one, because
          a picker with one option in it is furniture. */}
      {vs.length > 0 && (
        <div className="cvx-versions">
          <span className="cvi-lbl">Version</span>
          <button type="button" className={'cvx-ver' + (!vid ? ' is-on' : '')}
                  onClick={() => { update(prev => selectCv(prev, null)); setSel(null); }}>Main</button>
          {vs.map(v => (
            <span key={v.id} className={'cvx-ver-wrap' + (vid === v.id ? ' is-on' : '')}>
              <button type="button" className={'cvx-ver' + (vid === v.id ? ' is-on' : '')}
                      onClick={() => { update(prev => selectCv(prev, v.id)); setSel(null); }}>{v.name}</button>
              {vid === v.id && (
                <>
                  <button type="button" className="cvi-icon" aria-label="Rename version"
                          onClick={() => {
                            const n = window.prompt('Rename this version:', v.name);
                            if (n !== null) update(prev => renameVariant(prev, v.id, n));
                          }}><Icon name="pencil" size={12} /></button>
                  <button type="button" className="cvi-icon is-del" aria-label="Delete version"
                          onClick={() => {
                            if (!window.confirm(`Delete the "${v.name}" version? The main CV is untouched.`)) return;
                            update(prev => removeVariant(prev, v.id));
                            setSel(null);
                          }}><Icon name="trash-2" size={12} /></button>
                </>
              )}
            </span>
          ))}
        </div>
      )}

      {showFile && <MasterFile userId={userId} />}

      <div className="cvx-grid">
        <div className="cvx-docwrap">
          {isBlank(cv) && (
            <div className="cvx-first">
              Empty. Click the name at the top to start, or add a role.
            </div>
          )}
          <CvDocument cv={cv} sel={sel} onSelect={setSel} onAdd={add} />
        </div>

        {!isMobile && (
          <aside className="cvx-side">
            <Inspector cv={cv} sel={sel} setSel={setSel} patch={patch} onAdd={add} />
            <div className="cvi-card">
              <div className="cvi-lbl">Length</div>
              <div className="cvx-bar-meter"><i style={{ width: `${Math.round(len.fill * 100)}%` }} /></div>
              <div className="cvi-fine">
                {len.pages === 1
                  ? `About one page — room for roughly ${Math.max(0, len.roomLeft)} more lines.`
                  : `About ${len.pages} pages — ${len.overBy} lines onto the last one.`}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Mobile: the same inspector, as a sheet over the document. */}
      {isMobile && sel && (
        <div className="cvx-sheet" role="dialog" aria-label="Edit">
          <div className="cvx-sheet-grab" />
          <button type="button" className="cvx-sheet-x" onClick={() => setSel(null)} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
          <div className="cvx-sheet-body">
            <Inspector cv={cv} sel={sel} setSel={setSel} patch={patch} onAdd={add} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The uploaded original.
 *
 * Kept, but folded behind a toggle: it is a file you keep somewhere, not
 * the CV you are writing. Calling it "Master file" next to a "Working
 * copy" was the naming that made the old panel confusing — neither name
 * said which one you were editing.
 */
function MasterFile({ userId }) {
  const [files, setFiles] = useState([]);
  const [msg, setMsg] = useState('');
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { files: f, error } = await listCvFiles(userId);
      if (!alive) return;
      if (error) { setSetupNeeded(error.setup); setMsg(error.message); }
      else setFiles(f);
    })();
    return () => { alive = false; };
  }, [userId]);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setMsg('');
    const { error } = await uploadCv(userId, file);
    if (error) { setSetupNeeded(error.setup); setMsg(error.message); }
    else {
      const { files: f } = await listCvFiles(userId);
      setFiles(f); setMsg('Uploaded.'); setSetupNeeded(false);
    }
    setBusy(false);
  }

  return (
    <div className="cvi-card cvx-file">
      <div className="cvi-lbl">Attached file — the original you keep, not the one you edit here</div>
      <input ref={input} type="file" hidden accept=".pdf,.doc,.docx,.txt,.md" onChange={pick} />
      {setupNeeded ? (
        <div className="cvi-fine"><Icon name="triangle-alert" size={12} /> {msg} The editor works regardless.</div>
      ) : (
        <>
          {files.map(f => (
            <div key={f.name} className="cvx-filerow">
              <span className="cvx-filename">{f.name.replace(/^[\d-]+__/, '')}</span>
              <span className="cvi-fine">{(f.created_at || '').slice(0, 10)}</span>
              <button type="button" className="cvi-btn" onClick={async () => {
                const { url, error } = await cvOpenUrl(userId, f.name);
                if (error) return setMsg(error.message);
                if (url) window.open(url, '_blank', 'noopener');
              }}>Open</button>
              <button type="button" className="cvi-btn is-del" onClick={async () => {
                if (!window.confirm(`Delete ${f.name}? The CV here is untouched.`)) return;
                const { error } = await deleteCv(userId, f.name);
                if (error) return setMsg(error.message);
                const { files: g } = await listCvFiles(userId);
                setFiles(g);
              }}>Delete</button>
            </div>
          ))}
          <button type="button" className="cvi-btn" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : files.length ? 'Upload another' : 'Upload a file'}
          </button>
          {msg && <div className="cvi-fine">{msg}</div>}
        </>
      )}
    </div>
  );
}
