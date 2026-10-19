/**
 * One exercise in the live workout (brief §3.5.1–3.5.3).
 *
 * Header: the name at 16/600 wrapping to two lines (never a one-line
 * ellipsis), the done count "2/3", ⋯ (44). Meta: target · two muscles ·
 * CompareScope ("COMPARED WITHIN DXC" — the setting lives in Manage).
 * A note shows under it as one muted line with ✎ (tap to edit).
 *
 * The set table — SET · PREV · KG · REPS · RPE · ✓ (32 · 88 · 72 · 52 ·
 * 44 · 48 at 390; PREV 70 and wrapping at 360):
 *   compact row 48 px   done / future rows; values without boxes
 *   ACTIVE row          the next unticked set: boxed cells, an outlined ✓,
 *                       and the sub-line "last … · best … · ☾ target …"
 *   PREV                the same set last time (gym-scoped for a machine,
 *                       night-scoped on a night) — tap copies KG + REPS
 *                       (+ RPE) with a 120 ms flash; "—" and not a button
 *                       when there is none
 *   empty cells         show Previous (clamped to the last set) as a muted
 *                       placeholder; ✓ commits it. Night: the × 0.8 value
 *                       with ☾ — never red, never a "drop"
 *   SET                 tap → W / D / F / Normal / Delete set; W D F replace
 *                       the number; a real PB shows a gold ◆ (+ a 3 px gold
 *                       rail and a PB badge after the reps)
 *   swipe left          reveals Delete — fully hidden at rest (no red
 *                       sliver); commits past 50 % or on a tap; Undo 5 s
 *   entry               coarse pointer → cells open the docked pad; fine →
 *                       plain inputs, Tab order KG → REPS → RPE → ✓, Enter
 *                       ticks and moves to the next row's KG. No row bin, no
 *                       inline ± steppers (A3 / A5).
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../Icon';
import { IconButton, CompareScope, PbMark } from './ui';
import { musclesOf } from '../../../lib/lifts/workout';
import { realSetText } from '../../../lib/lifts/ui';

const fmt = v => (v == null || v === '' ? '' : String(Math.round(Number(v) * 100) / 100));
const DEL_W = 72;

export default function ExerciseBlock({
  ex, ei, lift, rows, sub, coarse, layout, night = false, gymLabel = null, activeSi = -1, editing = null, flash = null, pbMarks = null,
  problem = null, noteOpen = false, onCell, onInput, onToggle, onCopyPrev, onSetMenu, onDelete, onAddSet, onMenu, onNote, onNoteOpen, onManage, onEnter,
}) {
  const name = lift ? lift.name : 'Unknown lift';
  const doneN = ex.sets.filter(s => s.done).length;
  const per = lift && lift.load === 'per_hand';
  const bw = lift && lift.load === 'bodyweight_plus';
  const ms = musclesOf(lift).slice(0, 2);
  const target = ex.target ? `${ex.sets.length} × ${ex.target}` : null;
  const last = ex.sets[ex.sets.length - 1];
  const copies = last && last.weight != null && last.reps != null ? realSetText(last.weight, last.reps, lift) : null;
  const swipe = coarse || layout === 'phone';
  return (
    <section className="lw-ex" aria-labelledby={`lw-ex-${ei}`} data-testid="lw-ex">
      <header className="lw-ex-head">
        <h3 className="lf-name lw-ex-name" id={`lw-ex-${ei}`}>{name}</h3>
        <span className="lw-ex-count lf-num" aria-label={`${doneN} of ${ex.sets.length} sets done`}>{doneN}/{ex.sets.length}</span>
        <IconButton icon="ellipsis" label={`More for ${name}`} onClick={() => onMenu(ei)} className="lw-ex-more" data-testid="lw-ex-menu" />
      </header>
      <div className="lw-ex-meta">
        {[target, ...ms.map(m => m.toUpperCase()), ex.optional ? 'OPTIONAL' : null].filter(Boolean).map((t, i) => <span key={i}>{t}</span>)}
        {lift && <CompareScope lift={lift} gymLabel={gymLabel} onManage={lift.pending ? null : onManage} className="lw-ex-scope" />}
      </div>
      {(noteOpen || ex.note) && (
        <Note value={ex.note || ''} open={noteOpen} onOpen={() => onNoteOpen(ei)} onSave={t => onNote(ei, t)} label={`Note for ${name}`} />
      )}
      <div className={`lw-table${coarse ? ' is-coarse' : ' is-fine'}`} role="table" aria-label={`${name} sets`}>
        <div className="lw-tr lw-th" role="row">
          <span role="columnheader">Set</span>
          <span role="columnheader">Prev<span className="sr-only">ious</span></span>
          <span role="columnheader" className="is-c">{per ? 'KG/H' : bw ? '+KG' : 'KG'}{per && <span className="sr-only"> per hand</span>}</span>
          <span role="columnheader" className="is-c">Reps</span>
          <span role="columnheader" className="is-c">RPE</span>
          <span role="columnheader" className="is-c"><Icon name="check" size={14} strokeWidth={2.6} /><span className="sr-only">Done</span></span>
        </div>
        {ex.sets.map((s, si) => (
          <SetRow key={s.id} s={s} si={si} ei={ei} lift={lift} row={rows[si] || {}} coarse={coarse} swipe={swipe} night={night}
                  active={si === activeSi} sub={si === activeSi ? sub : null}
                  editing={editing && editing.si === si ? editing : null} flash={flash === s.id} pb={pbMarks ? pbMarks.get(s.id) : null}
                  problem={problem && problem.si === si ? problem : null} name={name}
                  onCell={onCell} onInput={onInput} onToggle={onToggle} onCopyPrev={onCopyPrev} onSetMenu={onSetMenu} onDelete={onDelete} onEnter={onEnter} />
        ))}
      </div>
      <button type="button" className="lw-addset" onClick={() => onAddSet(ei)} data-testid="lw-addset">
        <Icon name="plus" size={15} /> Add set{copies ? <span className="lw-addset-c"> (copies {copies})</span> : null}
      </button>
    </section>
  );
}

function SetRow({ s, si, ei, lift, row, coarse, swipe, night, active, sub, editing, flash, pb, problem, name, onCell, onInput, onToggle, onCopyPrev, onSetMenu, onDelete, onEnter }) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const g = useRef(null);
  const wrap = useRef(null);
  const swiped = useRef(false);
  const prev = row.prev || null;
  const ph = row.ph || null;
  const type = s.type || null;
  const mark = pb && !type ? 'pb' : null;

  // Swipe left (touch, or a mouse drag in the phone layout): 24 px to lock, past 50 % commits.
  const down = e => {
    if (!swipe || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea')) return;
    g.current = { x: e.clientX, y: e.clientY, base: open ? -DEL_W : 0, lock: null, w: wrap.current ? wrap.current.offsetWidth : 360 };
    swiped.current = false;
  };
  const move = e => {
    const st = g.current;
    if (!st) return;
    const mx = e.clientX - st.x, my = e.clientY - st.y;
    if (!st.lock) {
      if (Math.abs(mx) < 24 && Math.abs(my) < 10) return;
      st.lock = Math.abs(mx) > Math.abs(my) && Math.abs(mx) >= 24 ? 'x' : 'y';
      if (st.lock === 'x' && e.currentTarget.setPointerCapture) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* gone */ } }
    }
    if (st.lock !== 'x') return;
    swiped.current = true;
    setDx(Math.max(-st.w, Math.min(0, st.base + mx)));
  };
  const up = () => {
    const st = g.current;
    g.current = null;
    if (!st || st.lock !== 'x') return;
    setDx(cur => {
      if (-cur > st.w * 0.5) { setOpen(false); setTimeout(() => onDelete(ei, si), 0); return 0; }
      const o = cur < -DEL_W / 2;
      setOpen(o);
      return o ? -DEL_W : 0;
    });
  };
  // A swipe isn't a tap on whatever cell it started on.
  const clickCapture = e => { if (swiped.current) { e.stopPropagation(); e.preventDefault(); swiped.current = false; } };
  useEffect(() => { if (!swipe) { setDx(0); setOpen(false); } }, [swipe]);

  const prevTxt = prev && prev.weight != null && prev.reps != null ? realSetText(prev.weight, prev.reps, lift) : null;
  const [pw, pr] = prevTxt ? prevTxt.split(' × ') : [null, null];
  const label = f => `Set ${si + 1} ${f === 'weight' ? 'kilograms' : f === 'rpe' ? 'RPE' : 'reps'}`;
  const nightPh = night && row.label;
  const setLabel = type || (mark ? null : String(si + 1));
  const cls = ['lw-tr', 'lw-row', 'lf-st', s.done && 'is-done', mark && 'is-pb', active && !s.done && 'is-current', type && `is-type-${type}`].filter(Boolean).join(' ');

  return (
    <div ref={wrap} id={`lw-r-${s.id}`} className={`lw-rowwrap${active && !s.done ? ' is-current' : ''}${problem ? ' has-problem' : ''}`} role="rowgroup">
      {swipe && (
        <button type="button" className="lw-del" style={{ transform: `translateX(${Math.max(0, DEL_W + dx)}px)` }} onClick={() => { setOpen(false); setDx(0); onDelete(ei, si); }}
                tabIndex={open ? 0 : -1} aria-hidden={!open} aria-label={`Delete set ${si + 1} of ${name}`} data-testid="lw-row-del">
          Delete
        </button>
      )}
      <div className={cls} role="row" style={dx ? { transform: `translateX(${dx}px)`, transition: g.current ? 'none' : undefined } : undefined}
           onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={clickCapture} data-testid="lw-row">
        <span role="cell" className="lw-c-set">
          <button type="button" className={`lw-setno${mark ? ' is-pb' : ''}${type ? ' is-type' : ''}`} onClick={() => onSetMenu(ei, si)}
                  aria-label={`Set ${si + 1}${type ? `, ${type === 'W' ? 'warm-up' : type === 'D' ? 'drop set' : 'failure'}` : ''}${mark ? ', personal best' : ''} — set type or delete`}
                  data-testid="lw-setno">
            {mark ? <PbMark /> : setLabel}
          </button>
        </span>
        <span role="cell" className="lw-c-prev">
          {prevTxt ? (
            <button type="button" className="lw-prev" onClick={() => onCopyPrev(ei, si)} aria-label={`Copy previous ${prevTxt}${prev.type ? ` (${prev.type})` : ''} into set ${si + 1}`} data-testid="lw-prev">
              <span className="lw-prev-w">{prev.type ? <b>{prev.type}·</b> : null}{pw}</span> <span className="lw-prev-r">× {pr}</span>
            </button>
          ) : <span className="lw-prev is-none" aria-disabled="true" aria-label={`No previous for set ${si + 1}`}>—</span>}
        </span>
        <Cell f="weight" s={s} coarse={coarse} boxed={active && !s.done} editing={editing} flash={flash} ph={ph ? fmt(ph.weight) : lift && lift.load === 'bodyweight_plus' ? '+0' : ''}
              night={nightPh} label={label('weight')} onCell={() => onCell(ei, si, 'weight')} onInput={patch => onInput(ei, si, patch)} onEnter={() => onEnter(ei, si)} decimal />
        <Cell f="reps" s={s} coarse={coarse} boxed={active && !s.done} editing={editing} flash={flash} ph={ph ? fmt(ph.reps) : ''}
              label={label('reps')} onCell={() => onCell(ei, si, 'reps')} onInput={patch => onInput(ei, si, patch)} onEnter={() => onEnter(ei, si)} badge={mark ? 'PB' : null} />
        <Cell f="rpe" s={s} coarse={coarse} boxed={active && !s.done} editing={editing} flash={flash && prev && prev.rpe != null} ph="–"
              label={label('rpe')} onCell={() => onCell(ei, si, 'rpe')} onInput={patch => onInput(ei, si, patch)} onEnter={() => onEnter(ei, si)} decimal small />
        <span role="cell" className="lw-c-ok">
          <button type="button" className={`lw-ok${s.done ? ' is-on' : ''}${problem ? ' is-shake' : ''}`} onClick={() => onToggle(ei, si)} aria-pressed={!!s.done}
                  aria-label={`${s.done ? 'Undo' : 'Mark'} set ${si + 1} done`} data-testid="lw-ok" key={problem ? problem.n : 'ok'}>
            <Icon name="check" size={20} strokeWidth={2.8} />
          </button>
        </span>
      </div>
      {sub && <p className="lw-sub" data-testid="lw-sub">{sub}</p>}
      {problem && <p className="lw-problem" role="alert">{problem.text}</p>}
    </div>
  );
}

function Cell({ f, s, coarse, boxed, editing, flash, ph, night = null, label, onCell, onInput, onEnter, decimal = false, small = false, badge = null }) {
  const v = s[f];
  const on = !!(editing && editing.field === f);
  const cls = `lw-cell${boxed ? ' is-boxed' : ''}${on ? ' is-on' : ''}${flash ? ' is-flash' : ''}${small ? ' is-small' : ''}`;
  if (coarse) {
    const shown = on ? editing.buf : fmt(v);
    const empty = shown === '';
    return (
      <span role="cell" className="is-c">
        <button type="button" className={`${cls}${empty ? ' is-ph' : ''}`} onClick={onCell} data-field={f} data-testid={`lw-cell-${f}`}
                aria-label={`${label}${empty ? (ph && ph !== '–' ? `, suggested ${ph}` : ', empty') : `, ${shown}`}`}>
          {empty ? <>{night && ph ? <span className="lw-ph-night" aria-hidden="true">☾</span> : null}{ph}</> : shown}
          {badge && !empty && <span className="lw-pbbadge">{badge}</span>}
        </button>
      </span>
    );
  }
  return (
    <span role="cell" className="is-c">
      <span className={`${cls} is-input`}>
        <FineInput v={v} ph={night && ph ? `☾${ph}` : ph} label={label} decimal={decimal} f={f} onInput={onInput} onEnter={onEnter} />
        {badge && v != null && <span className="lw-pbbadge">{badge}</span>}
      </span>
    </span>
  );
}

/** A keyboard input that keeps what is typed ("82.") while focused and writes the number through. Enter ticks the set. */
function FineInput({ v, ph, label, decimal, f, onInput, onEnter }) {
  const [text, setText] = useState(fmt(v));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(fmt(v)); }, [v, focus]);
  return (
    <input className="lw-in" inputMode={decimal ? 'decimal' : 'numeric'} autoComplete="off" aria-label={label} placeholder={ph} enterKeyHint="done"
           value={focus ? text : fmt(v)} data-field={f} data-testid={`lw-in-${f}`}
           onFocus={e => { setFocus(true); setText(fmt(v)); e.target.select(); }}
           onBlur={() => setFocus(false)}
           onChange={e => { const t = e.target.value.replace(',', '.').replace(decimal ? /[^\d.]/g : /[^\d]/g, ''); setText(t); onInput({ [f]: t }); }}
           onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }} />
  );
}

function Note({ value, open, onOpen, onSave, label }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  if (!open) {
    return (
      <button type="button" className="lw-note" onClick={onOpen} aria-label={`${label}: ${value}. Edit`}>
        <Icon name="pencil" size={14} /> <span>{value}</span>
      </button>
    );
  }
  return (
    <label className="lw-note-edit">
      <span className="sr-only">{label}</span>
      <textarea className="lf-cellbox" rows={2} value={t} maxLength={500} placeholder="Seat 5, paused reps…" autoFocus
                onChange={e => setT(e.target.value)} onBlur={() => onSave(t)}
                onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onSave(value); } }} />
    </label>
  );
}
