/**
 * Add exercises (or swap one): search, filter chips (All, Recent, then
 * the muscle groups), a list to tick — the running "Add N exercises"
 * button sits at the foot of the sheet — and "+ Create" for a lift that
 * isn't there yet: name, Bodyweight (→ bodyweight + added) or a
 * per-dumbbell toggle, and muscle targets.
 *
 * mode 'swap' picks exactly one and returns straight away.
 * Lifts already in the workout are shown but can't be picked.
 */
import { useMemo, useRef, useState } from 'react';
import { Sheet } from '../security/parts';
import Icon from '../../Icon';
import { musclesOf, MUSCLES } from '../../../lib/lifts/workout';
import { LOAD_LABEL } from '../../../lib/lifts/lifts';

const initials = name => String(name || '').split(/[\s,-]+/).filter(w => /^[a-z]/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('');

export default function ExercisePicker({ mode = 'add', lifts, recent, exclude = [], onPick, onCreate, onClose, title }) {
  const [q, setQ] = useState('');
  const [chip, setChip] = useState('All');
  const [picked, setPicked] = useState([]);
  const [creating, setCreating] = useState(false);
  const searchRef = useRef(null);

  const recentSet = useMemo(() => new Set(recent), [recent]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = lifts.filter(l => !l.archived);
    if (chip === 'Recent') list = recent.map(id => list.find(l => l.id === id)).filter(Boolean);
    else if (chip !== 'All') list = list.filter(l => musclesOf(l).includes(chip));
    if (needle) list = list.filter(l => l.name.toLowerCase().includes(needle) || musclesOf(l).some(m => m.toLowerCase().includes(needle)));
    if (chip !== 'Recent') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [lifts, recent, chip, q]);
  const chips = ['All', 'Recent', ...MUSCLES.filter(m => m !== 'Other' && lifts.some(l => !l.archived && musclesOf(l).includes(m)))];

  const toggle = id => {
    if (mode === 'swap') { onPick([id]); return; }
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  };

  if (creating) {
    return (
      <CreateForm onCancel={() => setCreating(false)} onClose={onClose} initialName={q}
                  onCreate={f => {
                    const out = onCreate(f);
                    if (out && out.ok) {
                      setCreating(false); setQ(''); setChip('All');
                      if (mode === 'swap') onPick([out.id]); else setPicked(p => [...p, out.id]);
                    }
                    return out;
                  }} />
    );
  }

  return (
    <Sheet title={title || (mode === 'swap' ? 'Swap exercise' : 'Add exercises')} eyebrow="// Workout" onClose={onClose} className="lifts wk-pick-sheet">
      <div className="wk-pick-top">
        <label className="wk-search">
          <Icon name="search" size={15} />
          <span className="sr-only">Search exercises</span>
          <input ref={searchRef} type="search" value={q} placeholder="Search exercises…" onChange={e => setQ(e.target.value)} autoComplete="off" data-testid="wk-search" />
          {q && <button type="button" className="wk-search-x" onClick={() => { setQ(''); searchRef.current && searchRef.current.focus(); }} aria-label="Clear search"><Icon name="x" size={14} /></button>}
        </label>
        <button type="button" className="sec-btn wk-btn wk-create-btn" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> Create</button>
      </div>
      <div className="wk-chips" role="group" aria-label="Filter">
        {chips.map(c => (
          <button key={c} type="button" className={`wk-chip${chip === c ? ' is-on' : ''}`} aria-pressed={chip === c} onClick={() => setChip(c)}>{c}</button>
        ))}
      </div>
      <ul className="wk-pick-list" aria-label="Exercises">
        {shown.map(l => {
          const n = picked.indexOf(l.id);
          const off = exclude.includes(l.id);
          const ms = musclesOf(l);
          return (
            <li key={l.id}>
              <button type="button" className={`wk-pick-row${n >= 0 ? ' is-on' : ''}`} disabled={off} onClick={() => toggle(l.id)}
                      aria-pressed={mode === 'swap' ? undefined : n >= 0} data-testid="wk-pick-row">
                <span className="wk-avatar" aria-hidden="true">{initials(l.name)}</span>
                <span className="wk-pick-main">
                  <span className="wk-pick-name">{l.name}</span>
                  <span className="wk-pick-sub">
                    {ms.length ? ms.join(' · ') : 'No muscle tags'}
                    {l.load !== 'weight' ? ` · ${LOAD_LABEL[l.load]}` : ''}
                    {off ? ' · in this workout' : recentSet.has(l.id) && chip !== 'Recent' ? ' · recent' : ''}
                  </span>
                </span>
                {mode !== 'swap' && <span className={`wk-tick${n >= 0 ? ' is-on' : ''}`} aria-hidden="true">{n >= 0 ? n + 1 : ''}</span>}
                {mode === 'swap' && !off && <Icon name="chevron-right" size={16} />}
              </button>
            </li>
          );
        })}
        {!shown.length && (
          <li className="wk-pick-empty">
            <p className="lf-muted">Nothing matches{q ? ` “${q}”` : ''}.</p>
            <button type="button" className="sec-btn wk-btn" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> Create {q ? `“${q.trim()}”` : 'an exercise'}</button>
          </li>
        )}
      </ul>
      {mode !== 'swap' && (
        <div className="wk-pick-foot">
          <button type="button" className="sec-btn is-primary wk-btn wk-pick-add" disabled={!picked.length} onClick={() => onPick(picked)} data-testid="wk-pick-add">
            {picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'exercise' : 'exercises'}` : 'Pick exercises to add'}
          </button>
        </div>
      )}
    </Sheet>
  );
}

function CreateForm({ onCreate, onCancel, onClose, initialName = '' }) {
  const [name, setName] = useState(initialName.trim());
  const [bw, setBw] = useState(false);
  const [perHand, setPerHand] = useState(false);
  const [muscles, setMuscles] = useState([]);
  const [err, setErr] = useState(null);
  const submit = e => {
    e.preventDefault();
    const load = bw ? 'bodyweight_plus' : perHand ? 'per_hand' : 'weight';
    const out = onCreate({ name, load, muscles });
    if (out && out.ok === false) setErr(out.error);
  };
  const flip = m => setMuscles(ms => (ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m]));
  return (
    <Sheet title="Create exercise" eyebrow="// Workout" onClose={onClose} className="lifts wk-pick-sheet">
      <form className="lf-form wk-create" onSubmit={submit} noValidate>
        <label className={`lf-field is-wide${err ? ' has-error' : ''}`} htmlFor="wk-c-name">
          <span className="lf-field-lbl">Exercise name</span>
          <input id="wk-c-name" value={name} maxLength={60} placeholder="Enter exercise name" onChange={e => setName(e.target.value)} autoComplete="off" />
          {err && <span className="lf-field-err" role="alert">{err}</span>}
        </label>
        <label className="wk-switch">
          <span className="wk-switch-text">
            <b>Bodyweight exercise</b>
            <span>Log the weight you add (0 for bodyweight only).</span>
          </span>
          <input type="checkbox" role="switch" checked={bw} onChange={e => { setBw(e.target.checked); if (e.target.checked) setPerHand(false); }} />
          <span className="wk-switch-ui" aria-hidden="true" />
        </label>
        {!bw && (
          <label className="wk-switch">
            <span className="wk-switch-text">
              <b>Dumbbells — weight per hand</b>
              <span>Log one dumbbell; volume counts both.</span>
            </span>
            <input type="checkbox" role="switch" checked={perHand} onChange={e => setPerHand(e.target.checked)} />
            <span className="wk-switch-ui" aria-hidden="true" />
          </label>
        )}
        <fieldset className="wk-targets">
          <legend className="lf-field-lbl">Muscle targets</legend>
          <div className="wk-chips is-wrap">
            {MUSCLES.map(m => (
              <button key={m} type="button" className={`wk-chip${muscles.includes(m) ? ' is-on' : ''}`} aria-pressed={muscles.includes(m)} onClick={() => flip(m)}>
                {muscles.includes(m) && <Icon name="check" size={12} />} {m}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="lf-form-acts">
          <button type="submit" className="sec-btn is-primary lf-btn-lg">Create</button>
          <button type="button" className="sec-btn is-quiet lf-btn-lg" onClick={onCancel}>Back</button>
        </div>
      </form>
    </Sheet>
  );
}
