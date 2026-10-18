/**
 * One exercise in the live workout: its name and ⋯ menu, an optional
 * note, and the set table — Set · Previous · Reps · KG · RPE · ✓.
 *
 *   Previous  the same set of the last time this lift was trained
 *             ("180 × 8") — at this gym, for a machine; tap it to copy it
 *             into the row
 *   ✓         marks the set done (only done sets are saved on Finish);
 *             an empty row ticks with Previous's numbers
 *   delete    swipe a row left on a touch screen; a bin button on desktop
 *
 * Touch screens get tappable cells that drive the docked number pad;
 * desktop gets real inputs (Tab order reps → kg → rpe → ✓, ↑/↓ step)
 * with − / + either side. Narrow columns keep the table inside a 360 px
 * phone with no sideways scroll.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../Icon';
import { prevText, musclesOf } from '../../../lib/lifts/workout';
import { LOAD_LABEL } from '../../../lib/lifts/lifts';

const fmt = v => (v == null || v === '' ? '' : String(Math.round(Number(v) * 100) / 100));

export default function ExerciseBlock({
  ex, ei, lift, prev, coarse, editing, problem, onCell, onChange, onToggle, onRemoveSet, onAddSet, onMenu, onNote, noteOpen, onHistory, gymLabel = null,
}) {
  const per = lift && lift.load === 'per_hand';
  const bw = lift && lift.load === 'bodyweight_plus';
  const kgStep = per ? 1 : 2.5;
  const doneN = ex.sets.filter(s => s.done).length;
  return (
    <section className="wk-ex" aria-labelledby={`wk-ex-${ei}`} data-testid="wk-ex">
      <header className="wk-ex-head">
        <button type="button" className="wk-ex-name" id={`wk-ex-${ei}`} onClick={onHistory} title="View history">
          {lift ? lift.name : 'Unknown lift'}
        </button>
        <span className="wk-ex-count" aria-label={`${doneN} of ${ex.sets.length} sets done`}>{doneN}/{ex.sets.length}</span>
        <button type="button" className="wk-icon" onClick={onMenu} aria-label={`More for ${lift ? lift.name : 'this exercise'}`} data-testid="wk-ex-menu">
          <Icon name="ellipsis" size={18} />
        </button>
      </header>
      <p className="wk-ex-meta">
        {[ex.target ? `Target ${ex.sets.length} × ${ex.target}` : null, musclesOf(lift).slice(0, 3).join(' · ') || null, lift && lift.load !== 'weight' ? LOAD_LABEL[lift.load] : null, ex.optional ? 'optional' : null, gymLabel ? `${gymLabel} machine` : null].filter(Boolean).join(' · ')}
      </p>
      {(noteOpen || ex.note) && <Note value={ex.note || ''} autoFocus={noteOpen && !ex.note} onSave={onNote} label={`Note for ${lift ? lift.name : 'exercise'}`} />}
      <div className={`wk-table${coarse ? ' is-touch' : ' is-desk'}`} role="table" aria-label={`${lift ? lift.name : 'Exercise'} sets`}>
        <div className="wk-tr wk-th" role="row">
          <span role="columnheader">Set</span>
          <span role="columnheader"><span aria-hidden="true">Prev</span><span className="sr-only">Previous</span></span>
          <span role="columnheader" className="is-c">Reps</span>
          <span role="columnheader" className="is-c">{per ? 'KG/hand' : bw ? '+KG' : 'KG'}</span>
          <span role="columnheader" className="is-c">RPE</span>
          <span role="columnheader" className="is-c"><Icon name="check" size={14} /><span className="sr-only">Done</span></span>
          {!coarse && <span role="columnheader"><span className="sr-only">Delete</span></span>}
        </div>
        {ex.sets.map((s, si) => {
          const p = prev && prev.sets.length ? prev.sets[Math.min(si, prev.sets.length - 1)] : null;
          const pHere = prev && si < prev.sets.length ? prev.sets[si] : null;
          const ed = editing && editing.ei === ei && editing.si === si ? editing : null;
          return (
            <SetRow key={s.id} s={s} si={si} coarse={coarse} prevSet={pHere} fill={p} lift={lift} kgStep={kgStep} editing={ed}
                    problem={problem && problem.si === si ? problem.text : null}
                    onCell={f => onCell(ei, si, f)} onChange={patch => onChange(ei, si, patch)} onToggle={() => onToggle(ei, si)}
                    onRemove={() => onRemoveSet(ei, si)} name={lift ? lift.name : 'exercise'} />
          );
        })}
      </div>
      <button type="button" className="wk-addset" onClick={onAddSet} data-testid="wk-addset"><Icon name="plus" size={14} /> Add set</button>
    </section>
  );
}

function SetRow({ s, si, coarse, prevSet, fill, lift, kgStep, editing, problem, onCell, onChange, onToggle, onRemove, name }) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const g = useRef(null);
  const OPEN = -84;
  // Swipe left to reveal Delete (touch only; a vertical drag scrolls).
  const down = e => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    g.current = { x: e.clientX, y: e.clientY, base: open ? OPEN : 0, lock: null };
  };
  const move = e => {
    const st = g.current;
    if (!st) return;
    const mx = e.clientX - st.x, my = e.clientY - st.y;
    if (!st.lock) { if (Math.abs(mx) < 8 && Math.abs(my) < 8) return; st.lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'; }
    if (st.lock !== 'x') return;
    setDx(Math.max(OPEN - 30, Math.min(0, st.base + mx)));
  };
  const up = () => {
    const st = g.current;
    g.current = null;
    if (!st || st.lock !== 'x') return;
    setDx(cur => { const o = cur < OPEN / 2; setOpen(o); return o ? OPEN : 0; });
  };
  useEffect(() => { if (!coarse) { setDx(0); setOpen(false); } }, [coarse]);
  const label = f => `Set ${si + 1} ${f === 'weight' ? 'kilograms' : f}`;
  const pt = prevText(prevSet, lift);
  const copy = () => { if (prevSet) onChange({ reps: prevSet.reps, weight: prevSet.weight }); };
  return (
    <div id={`wk-r-${s.id}`} className={`wk-row-wrap${s.done ? ' is-done' : ''}${problem ? ' has-problem' : ''}`} role="rowgroup">
      {coarse && (
        <button type="button" className="wk-row-del" onClick={() => { setOpen(false); setDx(0); onRemove(); }} tabIndex={open ? 0 : -1}
                aria-hidden={!open} aria-label={`Delete set ${si + 1} of ${name}`} data-testid="wk-row-del">
          <Icon name="trash-2" size={18} />
        </button>
      )}
      <div className="wk-tr wk-row" role="row" style={dx ? { transform: `translateX(${dx}px)` } : undefined}
           onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="wk-row">
        <span role="cell" className="wk-setno">{si + 1}</span>
        <span role="cell" className="wk-prev-cell">
          <button type="button" className="wk-prev" onClick={copy} disabled={!prevSet} aria-label={prevSet ? `Copy previous ${pt} into set ${si + 1}` : `No previous for set ${si + 1}`}>
            {pt}
          </button>
        </span>
        <Cell f="reps" s={s} coarse={coarse} editing={editing} ph={fill ? fmt(fill.reps) : ''} label={label('reps')} step={1} onCell={onCell} onChange={onChange} />
        <Cell f="weight" s={s} coarse={coarse} editing={editing} ph={fill ? fmt(fill.weight) : lift && lift.load === 'bodyweight_plus' ? '0' : ''} label={label('weight')} step={kgStep} onCell={onCell} onChange={onChange} decimal />
        <Cell f="rpe" s={s} coarse={coarse} editing={editing} ph="RPE" label={label('RPE')} step={0.5} onCell={onCell} onChange={onChange} decimal small />
        <span role="cell" className="is-c">
          <button type="button" className={`wk-check${s.done ? ' is-on' : ''}`} onClick={onToggle} aria-pressed={!!s.done}
                  aria-label={`${s.done ? 'Undo' : 'Mark'} set ${si + 1} done`} data-testid="wk-check">
            <Icon name="check" size={18} strokeWidth={2.6} />
          </button>
        </span>
        {!coarse && (
          <span role="cell" className="is-c">
            <button type="button" className="wk-icon wk-del" onClick={onRemove} aria-label={`Delete set ${si + 1} of ${name}`}><Icon name="trash-2" size={15} /></button>
          </span>
        )}
      </div>
      {problem && <p className="wk-problem" role="alert">{problem}</p>}
    </div>
  );
}

function Cell({ f, s, coarse, editing, ph, label, step, onCell, onChange, decimal = false, small = false }) {
  const v = s[f];
  const on = editing && editing.field === f;
  if (coarse) {
    const shown = on ? editing.buf : fmt(v);
    return (
      <span role="cell" className="is-c">
        <button type="button" className={`wk-cell${on ? ' is-on' : ''}${shown === '' ? ' is-ph' : ''}${small ? ' is-small' : ''}`} onClick={() => onCell(f)}
                aria-label={`${label}${shown !== '' ? `, ${shown}` : ''}`} data-field={f} data-testid={`wk-cell-${f}`}>
          {shown === '' ? ph : shown}
        </button>
      </span>
    );
  }
  return (
    <span role="cell" className={`is-c wk-deskcell${small ? ' is-small' : ''}`}>
      {!small && <button type="button" className="wk-pm" tabIndex={-1} aria-label={`${label} down ${step}`} onClick={() => onChange({ [f]: Math.max(0, (Number(v) || 0) - step) })}><Icon name="minus" size={12} /></button>}
      <DeskInput v={v} ph={ph} label={label} step={step} decimal={decimal} f={f} onChange={onChange} />
      {!small && <button type="button" className="wk-pm" tabIndex={-1} aria-label={`${label} up ${step}`} onClick={() => onChange({ [f]: (Number(v) || 0) + step })}><Icon name="plus" size={12} /></button>}
    </span>
  );
}

/** A number input that keeps what is typed ("82.") while focused and writes the number through. */
function DeskInput({ v, ph, label, step, decimal, f, onChange }) {
  const [text, setText] = useState(fmt(v));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(fmt(v)); }, [v, focus]);
  return (
    <input className="wk-in" inputMode={decimal ? 'decimal' : 'numeric'} autoComplete="off" aria-label={label} placeholder={ph}
           value={focus ? text : fmt(v)} data-field={f}
           onFocus={e => { setFocus(true); setText(fmt(v)); e.target.select(); }}
           onBlur={() => setFocus(false)}
           onChange={e => { const t = e.target.value.replace(',', '.').replace(decimal ? /[^\d.]/g : /[^\d]/g, ''); setText(t); onChange({ [f]: t }); }}
           onKeyDown={e => {
             if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
               e.preventDefault();
               const n = Math.max(0, Math.round(((Number(text) || 0) + (e.key === 'ArrowUp' ? step : -step)) * 100) / 100);
               setText(String(n)); onChange({ [f]: n });
             }
           }} />
  );
}

function Note({ value, onSave, label, autoFocus }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  return (
    <label className="wk-note">
      <span className="sr-only">{label}</span>
      <textarea rows={1} value={t} maxLength={500} placeholder="Add a note — seat 5, paused reps…" autoFocus={autoFocus}
                onChange={e => setT(e.target.value)} onBlur={() => { if (t !== value) onSave(t); }} />
    </label>
  );
}
