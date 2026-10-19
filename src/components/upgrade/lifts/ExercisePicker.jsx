/**
 * Add exercises (or swap one) — brief §3.6 on the shared Sheet.
 *
 *   header   sticky: search (flex) + [+ Create]; chips All · Recent · In plan
 *            · Muscle ▾ (a checklist sheet; active → "Muscle · 2"). The chip
 *            row wraps — never clipped mid-word (A14).
 *   rows     60 px: 36 px initials avatar · name 15/600, two lines · meta
 *            "QUADS · DXC" (the gym tag only for a machine) · history line
 *            "last 6d · 200 × 8" · a 44 px check showing the selection
 *            ORDER number. In the workout already: an IN WORKOUT tag at full
 *            contrast (not dimmed); tapping says so (one exercise per lift —
 *            add sets in its block). Archived lifts are hidden.
 *   footer   "Add 2 exercises" (disabled: "Pick exercises to add") + the
 *            chosen names in one 12 px mono line.
 *   empty    "No match for 'trice…'" + [+ Create 'trice…'].
 *   Create   Name · Loaded as [Weight | Per dumbbell | Bodyweight + added] ·
 *            Machine: compare within each gym (switch — ADDED, A8) · Muscle
 *            targets (chips that wrap) · "Create and add".
 *
 * mode 'swap' picks exactly one and returns straight away.
 * Desktop: the Sheet is a 560 px right drawer; ↑ / ↓ move between rows,
 * Space / Enter pick.
 *
 * Props: mode, lifts (incl. pending virtual lifts), log, recent (ids),
 * exclude (ids in the workout), today, gym, gymName, onPick(ids),
 * onCreate({ name, load, muscles, perGym }) → { ok, id, error }, onClose,
 * onNotice(text) (the "already in this workout" line).
 */
import { useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import { Sheet, Segmented, Button, Chip } from './ui';
import { musclesOf, MUSCLES, PROGRAMME_TEMPLATES } from '../../../lib/lifts/workout';
import { perGymOf, dayNo, num } from '../../../lib/lifts/lifts';
import { realSetText } from '../../../lib/lifts/ui';
import { norm } from '../../../lib/lifts/muscles';

const initials = name => String(name || '').split(/[\s,-]+/).filter(w => /^[a-z]/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '·';
const PLAN_NAMES = new Set(PROGRAMME_TEMPLATES.flatMap(t => t.exercises.map(x => norm(x.name))));
const LOADS = [{ value: 'weight', label: 'Weight' }, { value: 'per_hand', label: 'Per dumbbell' }, { value: 'bodyweight_plus', label: 'Bodyweight + added' }];

/** lift id → { date, weight, reps } of its last time's top working set. */
function lastTimes(log) {
  const last = new Map();
  for (const e of Array.isArray(log) ? log : []) {
    if (!e || !e.liftId || e.type === 'W') continue;
    const cur = last.get(e.liftId);
    const key = e.sessionId ? `s:${e.sessionId}` : `d:${e.date}`;
    if (!cur || e.date > cur.date || (e.date === cur.date && key !== cur.key)) {
      last.set(e.liftId, { date: e.date, key, weight: num(e.weight), reps: num(e.reps) });
    } else if (key === cur.key && (num(e.weight) > cur.weight || (num(e.weight) === cur.weight && num(e.reps) > cur.reps))) {
      last.set(e.liftId, { ...cur, weight: num(e.weight), reps: num(e.reps) });
    }
  }
  return last;
}
const agoShort = (iso, today) => {
  const d = dayNo(today) - dayNo(iso);
  if (!Number.isFinite(d)) return '';
  if (d <= 0) return 'today';
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.round(d / 7)}w`;
  return `${Math.round(d / 30)}mo`;
};

export default function ExercisePicker({
  mode = 'add', lifts, log = [], recent = [], exclude = [], today = '', gym = null, gymName = id => id, onPick, onCreate, onClose, onNotice, title,
}) {
  const [q, setQ] = useState('');
  const [chip, setChip] = useState('all');
  const [muscles, setMuscles] = useState([]);
  const [muscleSheet, setMuscleSheet] = useState(false);
  const [picked, setPicked] = useState([]);
  const [creating, setCreating] = useState(false);
  const listRef = useRef(null);

  const lasts = useMemo(() => lastTimes(log), [log]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = lifts.filter(l => !l.archived && !l.pending);
    if (chip === 'recent') out = recent.map(id => out.find(l => l.id === id)).filter(Boolean);
    else if (chip === 'plan') out = out.filter(l => PLAN_NAMES.has(norm(l.name)));
    if (muscles.length) out = out.filter(l => musclesOf(l).some(m => muscles.includes(m)));
    if (needle) out = out.filter(l => l.name.toLowerCase().includes(needle) || musclesOf(l).some(m => m.toLowerCase().includes(needle)));
    if (chip !== 'recent') out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [lifts, recent, chip, muscles, q]);
  const muscleChoices = MUSCLES.filter(m => m !== 'Other' && lifts.some(l => !l.archived && musclesOf(l).includes(m)));

  const toggle = l => {
    if (exclude.includes(l.id)) { if (onNotice) onNotice(`${l.name} is already in this workout — add sets in its block`); return; }
    if (mode === 'swap') { onPick([l.id]); return; }
    setPicked(p => (p.includes(l.id) ? p.filter(x => x !== l.id) : [...p, l.id]));
  };
  // ↑ / ↓ between rows (desktop drawer); Space / Enter are the buttons' own.
  const onListKey = e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = listRef.current ? [...listRef.current.querySelectorAll('.lw-pick-row')] : [];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    rows[j].focus();
  };

  if (creating) {
    return (
      <CreateForm onCancel={() => setCreating(false)} onClose={onClose} initialName={q} swap={mode === 'swap'}
                  onCreate={f => {
                    const out = onCreate(f);
                    if (out && out.ok) {
                      setCreating(false); setQ(''); setChip('all'); setMuscles([]);
                      if (mode === 'swap') onPick([out.id]); else onPick([...picked, out.id]);
                    }
                    return out;
                  }} />
    );
  }

  const names = picked.map(id => { const l = lifts.find(x => x.id === id); return l ? l.name : ''; }).filter(Boolean);
  const footer = mode !== 'swap' ? (
    <div className="lw-pick-foot">
      <Button variant="primary" size="lg" block disabled={!picked.length} onClick={() => onPick(picked)} data-testid="lw-pick-add">
        {picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'exercise' : 'exercises'}` : 'Pick exercises to add'}
      </Button>
      {names.length > 0 && <p className="lw-pick-names">{names.join(' · ')}</p>}
    </div>
  ) : null;

  const chips = [{ id: 'all', label: 'All' }, { id: 'recent', label: 'Recent' }, { id: 'plan', label: 'In plan' }];
  return (
    <Sheet title={title || (mode === 'swap' ? 'Swap exercise' : 'Add exercises')} eyebrow="// Workout" onClose={onClose} footer={footer}
           width={560} testId="lw-pick" className="lw-pick" initialFocus="input[type=search]">
      <div className="lw-pick-top">
        <div className="lw-pick-searchrow">
          <label className="lw-search">
            <Icon name="search" size={16} />
            <span className="sr-only">Search exercises</span>
            <input type="search" value={q} placeholder="Search exercises…" onChange={e => setQ(e.target.value)} autoComplete="off" data-testid="lw-search" />
            {q && <button type="button" className="lf-iconbtn lw-search-x" onClick={() => setQ('')} aria-label="Clear search"><Icon name="x" size={16} /></button>}
          </label>
          <Button variant="secondary" icon="plus" onClick={() => setCreating(true)} className="lw-pick-create" data-testid="lw-pick-create">Create</Button>
        </div>
        <div className="lw-chips" role="group" aria-label="Filter">
          {chips.map(c => <Chip key={c.id} selected={chip === c.id} onClick={() => setChip(c.id)}>{c.label}</Chip>)}
          <Chip selected={muscles.length > 0} onClick={() => setMuscleSheet(true)} aria-haspopup="dialog" data-testid="lw-chip-muscle">
            {muscles.length ? `Muscle · ${muscles.length}` : 'Muscle'} <Icon name="chevron-down" size={14} />
          </Chip>
        </div>
      </div>
      <ul className="lw-pick-list" aria-label="Exercises" ref={listRef} onKeyDown={onListKey}>
        {shown.map(l => {
          const n = picked.indexOf(l.id);
          const inW = exclude.includes(l.id);
          const ms = musclesOf(l).slice(0, 2).map(m => m.toUpperCase());
          const machine = perGymOf(l);
          const last = lasts.get(l.id);
          const meta = [...ms, machine && gym ? gymName(gym) : null].filter(Boolean).join(' · ');
          return (
            <li key={l.id}>
              <button type="button" className={`lw-pick-row${n >= 0 ? ' is-on' : ''}${inW ? ' is-in' : ''}`} onClick={() => toggle(l)}
                      aria-pressed={mode === 'swap' || inW ? undefined : n >= 0} data-testid="lw-pick-row">
                <span className="lw-avatar" aria-hidden="true">{initials(l.name)}</span>
                <span className="lw-pick-main">
                  <span className="lw-pick-name">{l.name}</span>
                  <span className="lw-pick-meta">{meta || 'NO MUSCLE TAGS'}{inW && <span className="lw-in-tag">In workout</span>}</span>
                  {last && <span className="lw-pick-last">last {agoShort(last.date, today)} · {realSetText(last.weight, last.reps, l)}</span>}
                </span>
                {mode !== 'swap' && !inW && (
                  <span className={`lw-tick${n >= 0 ? ' is-on' : ''}`} aria-hidden="true">{n >= 0 ? n + 1 : ''}</span>
                )}
                {mode === 'swap' && !inW && <Icon name="chevron-right" size={16} />}
              </button>
            </li>
          );
        })}
        {!shown.length && (
          <li className="lw-pick-empty">
            <p className="lf-meta">{q.trim() ? `No match for “${q.trim()}”.` : 'Nothing here with these filters.'}</p>
            <Button variant="secondary" icon="plus" onClick={() => setCreating(true)} data-testid="lw-pick-create-q">Create {q.trim() ? `“${q.trim()}”` : 'an exercise'}</Button>
          </li>
        )}
      </ul>
      {muscleSheet && (
        <Sheet title="Muscle" eyebrow="// Filter" onClose={() => setMuscleSheet(false)} testId="lw-muscles" width={440}
               footer={<><Button variant="quiet" size="lg" onClick={() => setMuscles([])} disabled={!muscles.length}>Clear</Button><Button variant="primary" size="lg" onClick={() => setMuscleSheet(false)}>Show {muscles.length ? 'matches' : 'all'}</Button></>}>
          <ul className="lw-checklist">
            {muscleChoices.map(m => {
              const on = muscles.includes(m);
              return (
                <li key={m}>
                  <label className="lw-check">
                    <input type="checkbox" checked={on} onChange={() => setMuscles(ms => (on ? ms.filter(x => x !== m) : [...ms, m]))} />
                    <span className="lw-check-box" aria-hidden="true"><Icon name="check" size={14} strokeWidth={3} /></span>
                    <span className="lw-check-txt">{m}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}
    </Sheet>
  );
}

function CreateForm({ onCreate, onCancel, onClose, initialName = '', swap = false }) {
  const [name, setName] = useState(initialName.trim());
  const [load, setLoad] = useState('weight');
  const [perGym, setPerGym] = useState(false);
  const [muscles, setMuscles] = useState([]);
  const [err, setErr] = useState(null);
  const submit = e => {
    if (e) e.preventDefault();
    const out = onCreate({ name, load, muscles, perGym });
    if (out && out.ok === false) setErr(out.error);
  };
  const flip = m => setMuscles(ms => (ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m]));
  const footer = (
    <>
      <Button variant="quiet" size="lg" onClick={onCancel}>Back</Button>
      <Button variant="primary" size="lg" onClick={submit} data-testid="lw-create-go">{swap ? 'Create and swap' : 'Create and add'}</Button>
    </>
  );
  return (
    <Sheet title="Create exercise" eyebrow="// Workout" onClose={onClose} footer={footer} width={560} testId="lw-create" initialFocus="#lw-c-name">
      <form className="lw-create" onSubmit={submit} noValidate>
        <label className={`lw-field${err ? ' has-error' : ''}`} htmlFor="lw-c-name">
          <span className="lf-eyebrow">Name</span>
          <input id="lw-c-name" className="lf-cellbox lw-input" value={name} maxLength={60} placeholder="e.g. Cable fly" onChange={e => { setName(e.target.value); setErr(null); }} autoComplete="off" />
          {err && <span className="lw-err" role="alert">{err}</span>}
        </label>
        <div className="lw-field">
          <span className="lf-eyebrow" id="lw-c-load">Loaded as</span>
          <Segmented options={LOADS} value={load} onChange={setLoad} label="Loaded as" full size="sm" />
          <span className="lf-meta">{load === 'per_hand' ? 'Log one dumbbell — volume counts both.' : load === 'bodyweight_plus' ? 'Log the weight you add (0 = bodyweight only).' : 'The number on the bar or the stack.'}</span>
        </div>
        <label className="lw-switch">
          <span className="lw-switch-text">
            <b>Machine: compare within each gym</b>
            <span>A machine at one gym isn&apos;t the same machine at another, so each gym keeps its own record.</span>
          </span>
          <input type="checkbox" role="switch" checked={perGym} onChange={e => setPerGym(e.target.checked)} data-testid="lw-create-machine" />
          <span className="lw-switch-ui" aria-hidden="true" />
        </label>
        <fieldset className="lw-field lw-targets">
          <legend className="lf-eyebrow">Muscle targets</legend>
          <div className="lw-chips">
            {MUSCLES.map(m => (
              <Chip key={m} selected={muscles.includes(m)} onClick={() => flip(m)} icon={muscles.includes(m) ? 'check' : undefined}>{m}</Chip>
            ))}
          </div>
        </fieldset>
      </form>
    </Sheet>
  );
}
