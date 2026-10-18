/**
 * The workout in progress — the gym app's flow in Upgrade's furniture.
 *
 * Header: minimise (back to Lifts; the workout keeps running and the
 * Lifts page offers Resume), the workout's name, Finish. A live strip:
 * Duration (ticking), Volume (kg, done sets), Exercises.
 *
 * Empty (just started from "Build my own"): Start your workout — Blank
 * (Add exercises) / Recent (the last 10 finished, to repeat) / Library
 * (the five programme sessions + saved templates), or Quick Log.
 *
 * Then one ExerciseBlock per exercise, Add exercises, Quick Log,
 * Settings (name, rest timer length) and Discard (asks first).
 *
 * The ⋯ menu per exercise: Swap exercise, Add note, View history (the
 * lift's PB page; back returns here), Remove from workout. Supersets and
 * unilateral logging are not built.
 *
 * Rest timer: ✓ starts it (90 s unless changed in Settings). A slim bar
 * docked at the bottom with +15 s and Skip; it ends quietly (no sound).
 * Reduced motion: the bar steps instead of sliding.
 *
 * Every edit goes through workout.js and is written to S.lifts.active
 * at once — the save upstream is debounced — so nothing typed is lost to
 * a refresh. The clock is local state and never writes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet, ConfirmButton } from '../security/parts';
import Icon from '../../Icon';
import ExerciseBlock from './ExerciseBlock';
import ExercisePicker from './ExercisePicker';
import NumPad from './NumPad';
import {
  activeOf, elapsedSec, clock, volume, volumeText, previousSets, addExercises, addSet, updateSet, toggleDone, setProblem,
  removeSet, removeExercise, swapExercise, setNote, renameWorkout, setRestSec, extendRest, skipRest, restLeft, discardWorkout,
  recentWorkouts, templatesOf, templateStart, repeatStart, fillEmptyWorkout, deleteTemplate, clampRest,
} from '../../../lib/lifts/workout';
import { shortLiftName } from '../../../lib/lifts/lifts';

const fmt = v => (v == null || v === '' ? '' : String(Math.round(Number(v) * 100) / 100));
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateShort = iso => { const [, m, d] = iso.split('-').map(Number); return `${d} ${SHORT[m - 1]}`; };

/** `(pointer: coarse)` — a touch screen gets the number pad and swipe-to-delete. */
export function useCoarse() {
  const q = '(pointer: coarse)';
  const [m, setM] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, []);
  return m;
}

export default function WorkoutLive({ S, update, list, recentIds, today, onMinimise, onFinish, onQuickLog, onHistory, onCreateLift, onToast }) {
  const active = activeOf(S);
  const coarse = useCoarse();
  const [now, setNow] = useState(() => Date.now());
  const [pad, setPad] = useState(null);            // { ei, si, field, buf, fresh }
  const [picker, setPicker] = useState(null);      // { mode: 'add' } | { mode: 'swap', ei }
  const [menu, setMenu] = useState(null);          // exercise index
  const [noteOpen, setNoteOpen] = useState(null);
  const [settings, setSettings] = useState(false);
  const [problem, setProb] = useState(null);       // { ei, si, text }
  const [tab, setTab] = useState('blank');
  const padRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const liftOf = useCallback(id => list.find(l => l.id === id) || null, [list]);
  const prevs = useMemo(() => {
    const m = new Map();
    if (active) for (const ex of active.exercises) m.set(ex.liftId, previousSets(S, ex.liftId));
    return m;
  // previous sets only change when the log does
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S && S.lifts && S.lifts.log, active && active.exercises.map(e => e.liftId).join('|')]);

  // ── Rest timer ──
  const left = active ? restLeft(active, now) : 0;
  const resting = !!(active && active.rest);
  useEffect(() => {
    if (!resting || left > 0) return undefined;
    const t = setTimeout(() => update(prev => skipRest(prev)), 4000);
    return () => clearTimeout(t);
  }, [resting, left, update]);

  // ── Number pad ──
  const closePad = useCallback(() => setPad(null), []);
  useEffect(() => {
    if (!pad) return undefined;
    const off = e => {
      if (padRef.current && padRef.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.wk-cell, .wk-check')) return;
      setPad(null);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [pad]);
  useEffect(() => { if (!coarse) setPad(null); }, [coarse]);
  // Keep the row being typed into above the pad.
  useEffect(() => {
    if (!pad || !active) return;
    const st = active.exercises[pad.ei] && active.exercises[pad.ei].sets[pad.si];
    const el = st && document.getElementById(`wk-r-${st.id}`);
    const ph = padRef.current ? padRef.current.getBoundingClientRect().height : 330;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const limit = window.innerHeight - ph - 12;
    if (r.bottom > limit) window.scrollBy({ top: r.bottom - limit, behavior: 'auto' });
    else if (r.top < 70) window.scrollBy({ top: r.top - 70, behavior: 'auto' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad && pad.ei, pad && pad.si, pad && pad.field]);

  if (!active) return null;

  const stepOf = (ei, field) => {
    if (field === 'reps') return 1;
    if (field === 'rpe') return 0.5;
    const l = liftOf(active.exercises[ei] && active.exercises[ei].liftId);
    return l && l.load === 'per_hand' ? 1 : 2.5;
  };
  const setAt = (ei, si) => active.exercises[ei] && active.exercises[ei].sets[si];
  const openCell = (ei, si, field) => {
    const st = setAt(ei, si);
    if (!st) return;
    setProb(null);
    setPad({ ei, si, field, buf: fmt(st[field]), fresh: true });
  };
  const commit = (p, buf) => update(prev => updateSet(prev, p.ei, p.si, { [p.field]: buf }));
  const onKey = k => {
    if (!pad) return;
    let buf = pad.fresh ? '' : pad.buf;
    if (k === 'back') buf = pad.fresh ? '' : buf.slice(0, -1);
    else if (k === '.') { if (pad.field === 'reps' || buf.includes('.')) return; buf = (buf || '0') + '.'; }
    else { if (buf.replace('.', '').length >= 5) return; buf = buf === '0' ? k : buf + k; }
    setPad({ ...pad, buf, fresh: false });
    commit(pad, buf);
  };
  const onStep = dir => {
    if (!pad) return;
    const st = setAt(pad.ei, pad.si);
    const prev = prevs.get(active.exercises[pad.ei].liftId);
    const ps = prev && prev.sets.length ? prev.sets[Math.min(pad.si, prev.sets.length - 1)] : null;
    const base = pad.buf !== '' ? Number(pad.buf) : st[pad.field] ?? (ps ? ps[pad.field] : null) ?? 0;
    let v = Math.round((Number(base) + dir * stepOf(pad.ei, pad.field)) * 100) / 100;
    v = Math.max(pad.field === 'reps' || pad.field === 'rpe' ? 1 : 0, v);
    if (pad.field === 'rpe') v = Math.min(10, v);
    const buf = String(v);
    setPad({ ...pad, buf, fresh: false });
    commit(pad, buf);
  };
  const onRpe = n => {
    if (!pad) return;
    const st = setAt(pad.ei, pad.si);
    const v = Number(st.rpe) === n ? null : n;
    update(prev => updateSet(prev, pad.ei, pad.si, { rpe: v }));
    if (pad.field === 'rpe') setPad({ ...pad, buf: fmt(v), fresh: true });
  };
  const nextOf = p => {
    if (p.field === 'reps') return { ...p, field: 'weight' };
    const ex = active.exercises[p.ei];
    if (p.si + 1 < ex.sets.length) return { ei: p.ei, si: p.si + 1, field: 'reps' };
    for (let k = p.ei + 1; k < active.exercises.length; k++) if (active.exercises[k].sets.length) return { ei: k, si: 0, field: 'reps' };
    return null;
  };
  const onNext = () => {
    const n = pad && nextOf(pad);
    if (!n) { setPad(null); return; }
    openCell(n.ei, n.si, n.field);
  };

  // ── Sets ──
  const toggle = (ei, si) => {
    const t = Date.now();
    const next = toggleDone(S, ei, si, t);
    if (next === S) {
      const st = setAt(ei, si);
      const p = prevs.get(active.exercises[ei].liftId);
      const ps = p && p.sets.length ? p.sets[Math.min(si, p.sets.length - 1)] : null;
      const lift = liftOf(active.exercises[ei].liftId);
      const msg = setProblem({ ...st, reps: st.reps ?? (ps && ps.reps), weight: st.weight ?? (ps && ps.weight) }, lift) || 'This set can’t be ticked yet';
      setProb({ ei, si, text: `${msg} to tick set ${si + 1}.` });
      return;
    }
    setProb(null);
    if (pad && pad.ei === ei && pad.si === si) setPad(null);
    update(prev => toggleDone(prev, ei, si, t));
  };

  const vol = volume(active, list);
  const doneSets = active.exercises.reduce((k, ex) => k + ex.sets.filter(s => s.done).length, 0);
  const inWorkout = active.exercises.map(e => e.liftId);
  const menuEx = menu != null ? active.exercises[menu] : null;
  const menuLift = menuEx ? liftOf(menuEx.liftId) : null;

  const fill = opts => {
    update(prev => fillEmptyWorkout(prev, opts));
  };

  return (
    <div className={`wk-live${pad ? ' has-pad' : ''}${resting ? ' has-rest' : ''}`} data-testid="wk-live">
      <div className="wk-live-head">
        <div className="wk-topbar">
          <button type="button" className="wk-icon wk-min" onClick={onMinimise} aria-label="Minimise workout — it keeps running" data-testid="wk-minimise">
            <Icon name="chevron-down" size={20} />
          </button>
          <div className="wk-titles">
            <span className="sec-eyebrow">// {active.source === 'suggested' ? 'Suggested' : 'Workout'} · {dateShort(active.date)}{active.shift === 'night' ? ' · night · 80% load' : ''}</span>
            <h3 className="wk-title">{active.name}</h3>
          </div>
          <button type="button" className="sec-btn is-primary wk-btn wk-finish" onClick={onFinish} data-testid="wk-finish">Finish</button>
        </div>
        <dl className="wk-stats">
          <div><dt>Duration</dt><dd data-testid="wk-duration">{clock(elapsedSec(active, now))}</dd></div>
          <div><dt>Volume</dt><dd data-testid="wk-volume">{volumeText(vol)}</dd></div>
          <div><dt>Sets</dt><dd>{doneSets}</dd></div>
          <div><dt>Exercises</dt><dd>{active.exercises.length}</dd></div>
        </dl>
      </div>

      {active.exercises.length === 0 ? (
        <Chooser S={S} today={today} tab={tab} setTab={setTab} onAdd={() => setPicker({ mode: 'add' })} onQuickLog={onQuickLog} onFill={fill}
                 onDeleteTemplate={id => update(prev => deleteTemplate(prev, id))} list={list} />
      ) : (
        <div className="wk-exs">
          {active.exercises.map((ex, ei) => (
            <ExerciseBlock key={`${ex.liftId}-${ei}`} ex={ex} ei={ei} lift={liftOf(ex.liftId)} prev={prevs.get(ex.liftId)} coarse={coarse}
                           editing={pad && pad.ei === ei ? pad : null} problem={problem && problem.ei === ei ? problem : null}
                           onCell={openCell} onChange={(a, b, patch) => update(prev => updateSet(prev, a, b, patch))}
                           onToggle={toggle} onRemoveSet={(a, b) => { setPad(null); update(prev => removeSet(prev, a, b)); }}
                           onAddSet={() => update(prev => addSet(prev, ei))} onMenu={() => setMenu(ei)}
                           noteOpen={noteOpen === ei} onNote={t => { update(prev => setNote(prev, ei, t)); setNoteOpen(null); }}
                           onHistory={() => onHistory(ex.liftId)} />
          ))}
        </div>
      )}

      <div className="wk-foot">
        {active.exercises.length > 0 && (
          <div className="wk-foot-row">
            <button type="button" className="sec-btn is-primary wk-btn" onClick={() => setPicker({ mode: 'add' })} data-testid="wk-add-ex"><Icon name="plus" size={14} /> Add exercises</button>
            <button type="button" className="sec-btn wk-btn" onClick={onQuickLog}><Icon name="zap" size={14} /> Quick log</button>
          </div>
        )}
        <div className="wk-foot-row">
          <button type="button" className="sec-btn is-quiet wk-btn" onClick={() => setSettings(true)}><Icon name="settings" size={14} /> Settings</button>
          <ConfirmButton label="Discard" confirmLabel="Discard workout" onConfirm={() => { update(prev => discardWorkout(prev)); onToast && onToast('Workout discarded — nothing was saved'); }} className="wk-btn" />
        </div>
      </div>

      {(resting || pad) && createPortal(
        // The dock: rest timer above the number pad, both fixed to the
        // bottom of the screen, portalled (an ancestor transform would pin
        // them to the page) and re-wrapped in the theme classes.
        <div className={`upg-app sec lifts wk-dock${pad ? '' : ' is-rest-only'}`} ref={padRef}>
          {resting && (
            <RestBar left={left} total={active.rest.total} onAdd={() => update(prev => extendRest(prev, 15, Date.now()))}
                     onSkip={() => update(prev => skipRest(prev))} />
          )}
          {pad && (() => {
            const ex = active.exercises[pad.ei];
            const st = ex && ex.sets[pad.si];
            if (!st) return null;
            const l = liftOf(ex.liftId);
            return (
              <NumPad field={pad.field} title={`${shortLiftName(l ? l.name : '')} · set ${pad.si + 1}`} value={pad.buf}
                      rpe={st.rpe} step={stepOf(pad.ei, pad.field)} onKey={onKey} onStep={onStep} onRpe={onRpe} onNext={onNext} onDone={closePad}
                      hasNext={!!nextOf(pad)} />
            );
          })()}
        </div>,
        document.body,
      )}

      {picker && (
        <ExercisePicker mode={picker.mode} lifts={list} recent={recentIds} exclude={inWorkout.filter((_, i) => picker.mode !== 'swap' || i !== picker.ei)}
                        onClose={() => setPicker(null)} onCreate={onCreateLift}
                        onPick={ids => {
                          if (picker.mode === 'swap') update(prev => swapExercise(prev, picker.ei, ids[0]));
                          else update(prev => addExercises(prev, ids));
                          setPicker(null);
                        }} />
      )}

      {menuEx && (
        <Sheet title={menuLift ? menuLift.name : 'Exercise'} eyebrow="// Exercise" onClose={() => setMenu(null)} className="lifts">
          <ul className="wk-menu">
            <li><button type="button" onClick={() => { const ei = menu; setMenu(null); setPicker({ mode: 'swap', ei }); }}><Icon name="repeat" size={17} /> Swap exercise <Icon name="chevron-right" size={15} /></button></li>
            <li><button type="button" onClick={() => { setNoteOpen(menu); setMenu(null); }}><Icon name="notebook-pen" size={17} /> {menuEx.note ? 'Edit note' : 'Add note'} <Icon name="chevron-right" size={15} /></button></li>
            <li><button type="button" onClick={() => { const id = menuEx.liftId; setMenu(null); onHistory(id); }}><Icon name="chart-column" size={17} /> View history <Icon name="chevron-right" size={15} /></button></li>
          </ul>
          <div className="wk-menu-danger">
            <ConfirmButton label="Remove from workout" confirmLabel={`Remove ${menuLift ? shortLiftName(menuLift.name) : 'it'}`}
                           onConfirm={() => { const ei = menu; setMenu(null); setPad(null); update(prev => removeExercise(prev, ei)); }} className="wk-btn" />
          </div>
          <p className="lf-muted">Supersets and one-side-at-a-time logging aren&apos;t built yet.</p>
        </Sheet>
      )}

      {settings && <SettingsSheet active={active} onClose={() => setSettings(false)}
                                  onName={n => update(prev => renameWorkout(prev, n))} onRest={s => update(prev => setRestSec(prev, s))} />}
    </div>
  );
}

function RestBar({ left, total, onAdd, onSkip }) {
  const pct = total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  return (
    <div className={`wk-rest${left === 0 ? ' is-over' : ''}`} role="timer" aria-label={left ? `Rest, ${left} seconds left` : 'Rest over'} data-testid="wk-rest">
      <div className="wk-rest-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <div className="wk-rest-row">
        <Icon name="timer" size={16} />
        <b className="wk-rest-left">{left ? clock(left) : 'Rest over'}</b>
        <span className="wk-rest-of">{left ? `of ${clock(total)}` : 'next set when ready'}</span>
        {left > 0 && <button type="button" className="wk-rest-btn" onClick={onAdd} data-testid="wk-rest-add">+15 s</button>}
        <button type="button" className="wk-rest-btn" onClick={onSkip}>{left ? 'Skip' : 'Dismiss'}</button>
      </div>
    </div>
  );
}

function Chooser({ S, today, tab, setTab, onAdd, onQuickLog, onFill, onDeleteTemplate, list }) {
  const recent = useMemo(() => recentWorkouts(S), [S]);
  const tpls = useMemo(() => templatesOf(S), [S]);
  const nameOf = id => { const l = list.find(x => x.id === id); return l ? shortLiftName(l.name) : '—'; };
  return (
    <section className="wk-card wk-choose" aria-labelledby="wk-choose-h">
      <h4 id="wk-choose-h" className="wk-choose-h">Start your workout</h4>
      <p className="lf-muted">Choose how you&apos;d like to begin. The clock is already running.</p>
      <div className="sec-seg lf-seg wk-seg" role="tablist" aria-label="Start from">
        {[['blank', 'Blank'], ['recent', 'Recent'], ['library', 'Library']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'blank' && (
        <div className="wk-choose-blank">
          <button type="button" className="sec-btn is-primary wk-btn wk-big" onClick={onAdd} data-testid="wk-add-first"><Icon name="plus" size={15} /> Add exercises</button>
          <button type="button" className="wk-linkbtn" onClick={onQuickLog}><Icon name="zap" size={13} /> Or use Quick Log</button>
        </div>
      )}
      {tab === 'recent' && (
        recent.length ? (
          <ul className="wk-tpl-list">
            {recent.map(s => (
              <li key={s.id}>
                <button type="button" className="wk-tpl" onClick={() => onFill(repeatStart(S, s, today))}>
                  <span className="wk-tpl-main"><b>{s.name}</b><span>{dateShort(s.date)} · {s.exercises.length} exercises · {volumeText(volume(s, list))}</span>
                    <span className="wk-tpl-ex">{s.exercises.map(ex => nameOf(ex.liftId)).join(' · ')}</span></span>
                  <Icon name="chevron-right" size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="lf-muted">No finished workouts yet — they appear here to repeat.</p>
      )}
      {tab === 'library' && (
        <ul className="wk-tpl-list">
          {tpls.map(t => (
            <li key={t.id} className="wk-tpl-li">
              <button type="button" className="wk-tpl" onClick={() => onFill(templateStart(S, t, today))}>
                <span className="wk-tpl-main"><b>{t.name}{t.builtIn ? <em> · programme</em> : ''}</b>
                  <span>{t.exercises.length} exercises · {t.exercises.reduce((k, x) => k + (Number(x.sets) || 0), 0)} sets</span>
                  <span className="wk-tpl-ex">{t.exercises.map(x => (x.name ? shortLiftName(x.name) : nameOf(x.liftId))).join(' · ')}</span></span>
                <Icon name="chevron-right" size={16} />
              </button>
              {!t.builtIn && (
                <button type="button" className="wk-icon" onClick={() => onDeleteTemplate(t.id)} aria-label={`Delete template ${t.name}`}><Icon name="trash-2" size={15} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SettingsSheet({ active, onClose, onName, onRest }) {
  const [name, setName] = useState(active.name);
  const rest = clampRest(active.restSec);
  return (
    <Sheet title="Workout settings" eyebrow="// Workout" onClose={onClose} className="lifts">
      <div className="lf-form">
        <label className="lf-field is-wide" htmlFor="wk-s-name">
          <span className="lf-field-lbl">Name</span>
          <input id="wk-s-name" value={name} maxLength={60} onChange={e => setName(e.target.value)} onBlur={() => onName(name)}
                 onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        </label>
        <div className="lf-field is-wide">
          <span className="lf-field-lbl" id="wk-s-rest">Rest timer · starts when you tick a set</span>
          <div className="sec-seg lf-seg wk-seg" role="group" aria-labelledby="wk-s-rest">
            {[60, 90, 120, 180].map(s => (
              <button key={s} type="button" aria-pressed={rest === s} className={rest === s ? 'is-on' : ''} onClick={() => onRest(s)}>{s < 120 ? `${s} s` : `${s / 60} min`}</button>
            ))}
          </div>
          <div className="wk-rest-set">
            <button type="button" className="lf-step-btn wk-rest-step" onClick={() => onRest(rest - 15)} aria-label="Rest 15 seconds shorter"><Icon name="minus" size={16} /></button>
            <b>{clock(rest)}</b>
            <button type="button" className="lf-step-btn wk-rest-step" onClick={() => onRest(rest + 15)} aria-label="Rest 15 seconds longer"><Icon name="plus" size={16} /></button>
          </div>
          <span className="lf-field-hint">Remembered for your next workout.</span>
        </div>
      </div>
    </Sheet>
  );
}
