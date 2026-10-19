/**
 * The workout in progress (brief §3.5, owner decisions in COMMON).
 *
 * FOCUS MODE (phones and tablets): while this is on screen the app's top
 * bar, bottom nav and Upgrade's "‹ Upgrade · Lifts" bar are hidden
 * (html[data-lifts-focus], CSS only — nothing is written). A sticky 52 px
 * header — [⌄] minimise · title · gym chip "DXC ▾" · ⋯ · Finish — and a
 * 32 px stats strip "23:14 · 4,820 kg · 7/19 sets · 2/6 ex ☾ 80 %" sit
 * above the first exercise (≈ 100 px from the top at 390). ⌄ goes back to
 * the app; the mini-bar (workout/MiniBar) keeps the workout visible.
 * Desktop (≥ 1024 px) is for review, not live logging: the same phone
 * row design in a centred 760 px column, keyboard entry, no 3-pane layout.
 *
 * One ExerciseBlock per exercise (the set table), then + Add exercises and
 * Quick log. The workout ⋯ holds rename / rest default / night / gym /
 * sound / Discard; Finish opens the summary (outline until every planned
 * set is ticked, or ≥ 1 is and the end of the list is on screen).
 *
 * The dock at the bottom: the rest timer (RestDock) above the number pad
 * (coarse pointers), both portalled. The active row stays scrolled above
 * them. Toasts: Undo (5 s) for deleted sets and removed exercises; the
 * in-workout PB toast (real sets only, ≥ 2 earlier sessions of the lift,
 * one per exercise per workout, never an edited set or a past day,
 * heaviest before rep max).
 *
 * Every edit goes through workout.js and is written to S.lifts.active at
 * once (the save upstream is debounced). Minimise / resume, the clock,
 * the rest countdown and every sheet are local — they never write.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../Icon';
import ExerciseBlock from './ExerciseBlock';
import ExercisePicker from './ExercisePicker';
import NumPad from './NumPad';
import RestDock from './workout/RestDock';
import { SetMenu, ExerciseMenu, WorkoutMenu, GymSheet } from './workout/Menus';
import { useFocusMode, primeTone, reducedMotion } from './workout/feedback';
import { setLiftsLive } from '../../../lib/lifts/liveBus';
import { Sheet, Button, IconButton, NightChip, UndoToast, PbToast, useInputMode, useScopeStyle } from './ui';
import {
  activeOf, elapsedSec, clock, volume, volumeText, previousForExercise, previousSession, addExercises, addSet, updateSet, toggleDone, setProblem,
  removeSet, removeExercise, insertSet, insertExercise, swapExercise, setNote, renameWorkout, setRestSec, adjustRest, setRestTotal, skipRest,
  discardWorkout, setWorkoutGym, setWorkoutShift, doneSetCount, listWithPending, exerciseLift, setSetType, markPbToasted, livePbSets,
  planProgress, nextOpenSet, restSecFor,
} from '../../../lib/lifts/workout';
import { withLifts, setLiftRest, setLiftsPref, liftsPrefs } from '../../../lib/lifts/store';
import { stepFor, perGymOf, personalBests, shortLiftName } from '../../../lib/lifts/lifts';
import { realSetText, padInput, padStep, livePb } from '../../../lib/lifts/ui';

const fmt = v => (v == null || v === '' ? '' : String(Math.round(Number(v) * 100) / 100));
const FIELDS = ['weight', 'reps', 'rpe'];

/** `(pointer: coarse)` — kept for older callers; ui/useInputMode is the source. */
export function useCoarse() {
  return useInputMode().coarse;
}

/** The ticking parts of the stats strip — its own 1 s clock so the table doesn't re-render every second. */
function Clock({ active }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return <span className="lw-clock" data-testid="lw-clock">{clock(elapsedSec(active, now))}</span>;
}

export default function WorkoutLive({
  S, update, list: listIn, recentIds = [], today, bwOf, gyms = [], gymName = id => id, initialPicker = false,
  onMinimise, onFinish, onQuickLog, onCreateLift, onManage, renderHistory, onToast,
}) {
  const active = activeOf(S);
  const L = S && S.lifts ? S.lifts : {};
  const log = L.log;
  const list = useMemo(() => listWithPending(listIn, active), [listIn, active]);
  const { coarse, layout } = useInputMode();
  const scopeStyle = useScopeStyle();
  const prefs = liftsPrefs(L);
  useFocusMode(layout !== 'desktop');
  useEffect(() => { setLiftsLive(true); return () => setLiftsLive(false); }, []);

  const [pad, setPad] = useState(null);            // { ei, si, field, buf, fresh }
  const [picker, setPicker] = useState(() => (initialPicker && active && !active.exercises.length ? { mode: 'add' } : null));
  const [exMenu, setExMenu] = useState(null);      // ei
  const [setMenu, setSetMenu] = useState(null);    // { ei, si }
  const [noteOpen, setNoteOpen] = useState(null);  // ei
  const [wkMenu, setWkMenu] = useState(false);
  const [gymSheet, setGymSheet] = useState(false);
  const [history, setHistory] = useState(null);    // liftId
  const [problem, setProb] = useState(null);       // { ei, si, text, n }
  const [flash, setFlash] = useState(null);        // set id
  const [cursor, setCursor] = useState(0);         // the exercise being worked on
  const [undo, setUndo] = useState(null);          // { text, undo, n }
  const [pbToast, setPbToast] = useState(null);    // { text, kinds, n }
  const [restOpen, setRestOpen] = useState(false);
  const [restLeaving, setRestLeaving] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [dockH, setDockH] = useState(0);
  const dockRef = useRef(null);
  const rootRef = useRef(null);
  const endRef = useRef(null);
  const ticked = useRef(new Set());                // set ids ticked once (a re-tick is an edit — no toast)

  const gymNow = active ? active.gym || null : null;
  const night = !!(active && active.shift === 'night');
  const exCount = active ? active.exercises.length : 0;
  const exKey = active ? active.exercises.map(e => `${e.liftId}:${e.sets.length}`).join('|') : '';

  // Previous per exercise — by shift and gym (previousForExercise = the foundation's previousFor rules).
  const prevs = useMemo(() => {
    if (!active) return [];
    return active.exercises.map(ex => {
      const lift = exerciseLift(listIn, ex);
      const p = previousForExercise(S, active, ex);
      // On a night with no night history, the pad's "= prev" chip shows the real day value beside the ☾ 80 % one.
      const day = night && p && p.source === 'day×0.8' ? previousSession(S, ex.liftId, { gym: gymNow, night: false, lift }) : null;
      return { p, day, lift };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, listIn, gymNow, night, exKey]);
  const label = p => (!p ? '' : p.source === 'day×0.8' ? '☾ 80 %' : p.source === 'night' ? '☾' : '');
  // "The same set last time", warm-ups aligned with warm-ups: a W row reads last time's W sets, every
  // other row last time's working sets (so a normal set 1 never inherits a warm-up's weight as its
  // placeholder). `prev` is that set (the PREV column, "—" past the end); `ph` the placeholder ✓
  // commits — clamped to the last one when this row is past the end.
  const rowsOf = useCallback((ei) => {
    const ex = active.exercises[ei];
    const { p } = prevs[ei] || {};
    const sets = p && p.sets ? p.sets : [];
    const pools = { W: sets.filter(x => x.type === 'W'), N: sets.filter(x => x.type !== 'W') };
    const at = { W: 0, N: 0 };
    return ex.sets.map(st => {
      const k = st.type === 'W' ? 'W' : 'N';
      const pool = pools[k];
      const i = at[k]++;
      return { prev: pool[i] || null, ph: pool.length ? pool[Math.min(i, pool.length - 1)] : null, label: label(p) };
    });
  }, [active, prevs]);

  // Real bests (heaviest), gym-scoped for machines — the active row's "best …".
  const bests = useMemo(() => {
    if (!active) return [];
    return active.exercises.map(ex => {
      const lift = exerciseLift(listIn, ex);
      if (!lift) return null;
      const pb = personalBests(log || [], lift, perGymOf(lift) ? { gym: gymNow, bwOf } : { bwOf });
      return pb.heaviest ? pb.heaviest.entry : null;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, listIn, gymNow, exKey]);

  const pbMarks = useMemo(() => (active ? livePbSets(S, { bwOf }) : new Map()),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, active && active.exercises, gymNow]);
  const progress = active ? planProgress(active) : { sets: 0, done: 0, exercises: 0, exercisesDone: 0 };
  const open = active ? nextOpenSet(active, cursor) : null;

  // ── The dock's height (rest + pad): the toast and the page's bottom padding follow it ──
  const resting = !!(active && active.rest);
  const showDock = resting || !!pad;
  useLayoutEffect(() => {
    if (!showDock || !dockRef.current) { setDockH(0); return undefined; }
    const el = dockRef.current;
    const report = () => setDockH(Math.round(el.getBoundingClientRect().height));
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showDock, restOpen]);
  useEffect(() => {
    document.documentElement.style.scrollPaddingBottom = dockH ? `${dockH + 16}px` : '';
  }, [dockH]);
  useEffect(() => () => { document.documentElement.style.scrollPaddingBottom = ''; }, []);

  // ── Close the pad on a tap outside it and outside the cells ──
  useEffect(() => {
    if (!pad) return undefined;
    const off = e => {
      if (dockRef.current && dockRef.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.lw-cell, .lw-ok, .lf-sheet-root')) return;
      setPad(null);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [pad]);
  useEffect(() => { if (!coarse) setPad(null); }, [coarse]);
  // Keep the row being typed into above the pad + rest.
  useEffect(() => {
    if (!pad || !active) return;
    const st = active.exercises[pad.ei] && active.exercises[pad.ei].sets[pad.si];
    const el = st && document.getElementById(`lw-r-${st.id}`);
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const dh = dockRef.current ? dockRef.current.getBoundingClientRect().height : 380;
      const head = rootRef.current ? rootRef.current.querySelector('.lw-head') : null;
      const top = head ? head.getBoundingClientRect().bottom + 8 : 100;
      const r = el.getBoundingClientRect();
      const limit = window.innerHeight - dh - 12;
      if (r.bottom > limit) window.scrollBy({ top: r.bottom - limit, behavior: 'auto' });
      else if (r.top < top) window.scrollBy({ top: r.top - top, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad && pad.ei, pad && pad.si, pad && pad.field, dockH]);

  // The end of the list on screen → Finish fills (with ≥ 1 set ticked).
  useEffect(() => {
    const el = endRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(es => setAtEnd(es.some(x => x.isIntersecting)), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [exCount]);

  // A flash lasts 120 ms (plus a frame).
  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 160);
    return () => clearTimeout(t);
  }, [flash]);

  const closeUndo = useCallback(() => setUndo(null), []);
  const closePb = useCallback(() => setPbToast(null), []);
  const closePad = useCallback(() => setPad(null), []);

  if (!active) return null;

  const liftAt = ei => exerciseLift(listIn, active.exercises[ei]);
  const setAt = (ei, si) => active.exercises[ei] && active.exercises[ei].sets[si];
  const phOf = (ei, si) => { const r = rowsOf(ei)[si]; return r ? r.ph : null; };
  const stepOf = (ei, field) => (field === 'reps' ? 1 : field === 'rpe' ? 0.5 : stepFor(liftAt(ei), gymNow));

  // ── Number pad (coarse) ──
  const openCell = (ei, si, field) => {
    const st = setAt(ei, si);
    if (!st) return;
    setProb(null);
    if (!coarse) {
      const el = document.querySelector(`#lw-r-${st.id} input[data-field="${field}"]`);
      if (el) el.focus();
      return;
    }
    setPad({ ei, si, field, buf: fmt(st[field]), fresh: true });
  };
  const commit = (p, buf) => update(prev => updateSet(prev, p.ei, p.si, { [p.field]: buf }));
  const onKey = k => {
    if (!pad) return;
    const buf = padInput(pad.buf, k, { field: pad.field, fresh: pad.fresh });
    if (buf == null) return;
    setPad({ ...pad, buf, fresh: false });
    commit(pad, buf);
  };
  const onStep = dir => {
    if (!pad) return;
    const st = setAt(pad.ei, pad.si);
    const ph = phOf(pad.ei, pad.si);
    const base = pad.buf !== '' ? pad.buf : st[pad.field] ?? (ph ? ph[pad.field] : null) ?? (pad.field === 'rpe' ? 8 : 0);
    const buf = padStep(base, dir, stepOf(pad.ei, pad.field), pad.field);
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
  // Next: KG → REPS → RPE → the next row's KG.
  const nextOf = p => {
    const i = FIELDS.indexOf(p.field);
    if (i < FIELDS.length - 1) return { ...p, field: FIELDS[i + 1] };
    const ex = active.exercises[p.ei];
    if (p.si + 1 < ex.sets.length) return { ei: p.ei, si: p.si + 1, field: 'weight' };
    for (let k = p.ei + 1; k < active.exercises.length; k++) if (active.exercises[k].sets.length) return { ei: k, si: 0, field: 'weight' };
    return null;
  };
  const onNext = () => {
    const n = pad && nextOf(pad);
    if (!n) { setPad(null); return; }
    openCell(n.ei, n.si, n.field);
  };

  // ── Focus the next row's KG (fine pointer: ✓ / Enter move on) ──
  const focusNextKg = setId => {
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const rows = [...root.querySelectorAll('.lw-rowwrap')];
      const i = rows.findIndex(el => el.id === `lw-r-${setId}`);
      const next = i >= 0 ? rows[i + 1] : null;
      const inp = next && next.querySelector('input[data-field="weight"]');
      if (inp) inp.focus();
    });
  };

  // ── ✓ ──
  const toggle = (ei, si) => {
    const ex = active.exercises[ei];
    const st = ex && ex.sets[si];
    if (!st) return;
    const t = Date.now();
    const ph = phOf(ei, si);
    // Always pass what the screen showed (nothing → nothing), so ✓ commits exactly the placeholders.
    const opts = { fill: ph ? { weight: ph.weight, reps: ph.reps } : { weight: null, reps: null } };
    const next = toggleDone(S, ei, si, t, opts);
    if (next === S) {
      if (st.done) return;
      const lift = liftAt(ei);
      const msg = setProblem({ ...st, reps: st.reps ?? (ph && ph.reps), weight: st.weight ?? (ph && ph.weight) }, lift) || 'Enter KG and reps';
      setProb({ ei, si, text: `${msg} to tick set ${si + 1}.`, n: t });
      const field = st.weight == null && !(lift && lift.load === 'bodyweight_plus') ? 'weight' : 'reps';
      openCell(ei, si, field);
      return;
    }
    setProb(null);
    if (pad && pad.ei === ei && pad.si === si) setPad(null);
    if (!st.done && prefs.restTone) primeTone();
    update(prev => toggleDone(prev, ei, si, t, opts));
    if (st.done) return;
    setCursor(ei);
    setRestLeaving(false);
    // The PB moment — real sets only, the foundation's rules (livePb).
    const edited = ticked.current.has(st.id) || (today && active.date < today);
    ticked.current.add(st.id);
    const res = livePb(next, ei, si, { bwOf, toasted: new Set(active.pbToasted || []), edited });
    if (res) {
      const nx = activeOf(next);
      const lift = exerciseLift(next.lifts.list, nx.exercises[ei]);
      const done = nx.exercises[ei].sets[si];
      const mark = livePbSets(next, { bwOf }).get(done.id);
      const was = mark && mark.was ? ` (was ${realSetText(mark.was.weight, mark.was.reps, lift)})` : '';
      const where = perGymOf(lift) && gymNow ? ` · ${gymName(gymNow)}` : '';
      setPbToast({ text: `PB · ${lift.name} · ${realSetText(done.weight, done.reps, lift)}${was}${where}`, kinds: res.headline ? [res.headline] : null, n: t });
      update(prev => markPbToasted(prev, res.liftId));
    }
    if (!coarse) focusNextKg(st.id);
  };

  // ── Rows ──
  const copyPrev = (ei, si) => {
    const r = rowsOf(ei)[si];
    if (!r || !r.prev) return;
    const patch = { weight: r.prev.weight, reps: r.prev.reps };
    if (r.prev.rpe != null) patch.rpe = r.prev.rpe;
    update(prev => updateSet(prev, ei, si, patch));
    setFlash(setAt(ei, si).id);
  };
  const deleteSet = (ei, si) => {
    const ex = active.exercises[ei];
    const set = ex && ex.sets[si];
    if (!set) return;
    setPad(null);
    setSetMenu(null);
    update(prev => removeSet(prev, ei, si));
    setUndo({ text: `Set ${si + 1} deleted`, undo: () => update(prev => insertSet(prev, ei, si, set, ex.liftId)), n: Date.now() });
  };
  const removeEx = ei => {
    const ex = active.exercises[ei];
    if (!ex) return;
    const lift = liftAt(ei);
    setExMenu(null);
    setPad(null);
    update(prev => removeExercise(prev, ei));
    setUndo({ text: `${lift ? lift.name : 'Exercise'} removed`, undo: () => update(prev => insertExercise(prev, ei, ex)), n: Date.now() });
  };

  // ── Rest ──
  const restEx = active.rest && active.rest.liftId ? active.exercises.findIndex(e => e.liftId === active.rest.liftId) : -1;
  const restLift = restEx >= 0 ? liftAt(restEx) : null;
  const nextSet = nextOpenSet(active, restEx >= 0 ? restEx : cursor);
  let nextText = '';
  if (nextSet) {
    const st = setAt(nextSet.ei, nextSet.si);
    const ph = phOf(nextSet.ei, nextSet.si);
    const w = st.weight ?? (ph ? ph.weight : null), r = st.reps ?? (ph ? ph.reps : null);
    const v = w != null && r != null ? ` · ${realSetText(w, r, liftAt(nextSet.ei))}` : '';
    const nl = liftAt(nextSet.ei);
    nextText = nextSet.ei === restEx ? `NEXT SET ${nextSet.si + 1}${v}` : `NEXT ${nl ? shortLiftName(nl.name).toUpperCase() : 'EXERCISE'}${v}`;
  }
  const skip = () => {
    setRestOpen(false);
    if (reducedMotion()) { update(prev => skipRest(prev)); return; }
    setRestLeaving(true);
    setTimeout(() => { update(prev => skipRest(prev)); setRestLeaving(false); }, 200);
  };
  const writeLifts = fn => update(prev => withLifts(prev, fn, Date.now()));

  const doneN = doneSetCount(active);
  const allDone = progress.sets > 0 && progress.done === progress.sets;
  const finishFilled = allDone || (progress.done >= 1 && atEnd);
  const inWorkout = active.exercises.map(e => e.liftId);
  const menuEx = exMenu != null ? active.exercises[exMenu] : null;
  const menuLift = exMenu != null ? liftAt(exMenu) : null;
  const vol = volume(active, list);
  const padEx = pad ? active.exercises[pad.ei] : null;

  return (
    <div ref={rootRef} className={`lw-live is-${layout}${coarse ? ' is-coarse' : ' is-fine'}`} style={{ '--lw-dock': `${dockH}px` }} data-testid="lw-live">
      <header className="lw-head">
        <div className="lw-bar">
          <IconButton icon="chevron-down" label="Minimise — the workout keeps running" onClick={onMinimise} className="lw-min" data-testid="lw-minimise" size={22} />
          <h2 className="lw-title" title={active.name}>{active.name}</h2>
          {gyms.length > 0 && (
            <button type="button" className="lw-gymchip" onClick={() => setGymSheet(true)} aria-label={`Gym: ${gymNow ? gymName(gymNow) : 'none'} — change`} data-testid="lw-gymchip">
              <span className="lw-gymchip-in"><span>{gymNow ? gymName(gymNow) : 'No gym'}</span><Icon name="chevron-down" size={14} /></span>
            </button>
          )}
          <IconButton icon="ellipsis" label="Workout menu" onClick={() => setWkMenu(true)} className="lw-wkmore" data-testid="lw-wkmenu-open" />
          <button type="button" className={`lw-finish${finishFilled ? ' is-ready' : ''}`} onClick={onFinish} data-testid="lw-finish">Finish</button>
        </div>
        <p className="lw-stats lf-num" data-testid="lw-stats">
          <Clock active={active} />
          <span aria-hidden="true">·</span><span data-testid="lw-volume">{volumeText(vol)}</span>
          <span aria-hidden="true">·</span><span>{progress.done}/{progress.sets} sets</span>
          <span aria-hidden="true" className="lw-stats-ex">·</span><span className="lw-stats-ex">{progress.exercisesDone}/{progress.exercises} ex</span>
          {night && <NightChip variant="inline" className="lw-stats-night" />}
        </p>
      </header>

      {active.exercises.length === 0 ? (
        <section className="lw-empty">
          <p className="lf-eyebrow">// {active.name}</p>
          <p className="lf-body">No exercises yet. Add them from your lifts, or create one — the clock is running.</p>
          <Button variant="primary" size="lg" icon="plus" block onClick={() => setPicker({ mode: 'add' })} data-testid="lw-add-first">Add exercises</Button>
          {onQuickLog && <Button variant="quiet" icon="zap" onClick={onQuickLog}>Or quick log one set</Button>}
        </section>
      ) : (
        <div className="lw-exs">
          {active.exercises.map((ex, ei) => {
            const lift = liftAt(ei);
            const rows = rowsOf(ei);
            const activeSi = open && open.ei === ei ? open.si : -1;
            let sub = null;
            if (activeSi >= 0) {
              const r = rows[activeSi];
              const best = bests[ei];
              const parts = [];
              if (r && r.prev) parts.push(`last ${realSetText(r.prev.weight, r.prev.reps, lift)}`);
              if (best) parts.push(`best ${realSetText(best.weight, best.reps, lift)}`);
              if (night && r && r.ph && r.ph.weight != null) parts.push(`☾ target ${fmt(r.ph.weight)}`);
              sub = parts.length ? parts.join(' · ') : 'First time — enter KG and reps';
            }
            return (
              <ExerciseBlock key={`${ex.liftId}-${ei}`} ex={ex} ei={ei} lift={lift} rows={rows} sub={sub} coarse={coarse} layout={layout} night={night}
                             gymLabel={gymNow ? gymName(gymNow) : null} activeSi={activeSi} editing={pad && pad.ei === ei ? pad : null} flash={flash}
                             pbMarks={pbMarks} problem={problem && problem.ei === ei ? problem : null} noteOpen={noteOpen === ei}
                             onCell={openCell} onInput={(a, b, patch) => update(prev => updateSet(prev, a, b, patch))} onToggle={toggle} onCopyPrev={copyPrev}
                             onSetMenu={(a, b) => { setPad(null); setSetMenu({ ei: a, si: b }); }} onDelete={deleteSet}
                             onAddSet={a => update(prev => addSet(prev, a))} onMenu={a => { setPad(null); setExMenu(a); }}
                             onNote={(a, tx) => { update(prev => setNote(prev, a, tx)); setNoteOpen(null); }} onNoteOpen={a => setNoteOpen(a)}
                             onManage={onManage ? () => onManage() : null} onEnter={toggle} />
            );
          })}
        </div>
      )}

      <div className="lw-foot" ref={endRef}>
        {active.exercises.length > 0 && (
          <>
            <Button variant="secondary" size="lg" icon="plus" block onClick={() => setPicker({ mode: 'add' })} data-testid="lw-add-ex">Add exercises</Button>
            {onQuickLog && <Button variant="quiet" icon="zap" onClick={onQuickLog} className="lw-ql">Quick log a set</Button>}
          </>
        )}
      </div>

      {showDock && createPortal(
        <div className={`upg-app sec lifts lw-dock${pad ? ' has-pad' : ''}${restLeaving ? ' is-leaving' : ''}`} ref={dockRef} style={scopeStyle} data-testid="lw-dock">
          {resting && (
            <RestDock active={active} nextText={nextText} expanded={restOpen} onExpand={setRestOpen}
                      onAdjust={sec => update(prev => adjustRest(prev, sec, Date.now()))} onSkip={skip}
                      onPreset={sec => update(prev => setRestTotal(prev, sec, Date.now()))}
                      useForExercise={restLift && !restLift.pending ? restLift.restSec === active.rest.total : null}
                      onUseForExercise={on => restLift && writeLifts(l => setLiftRest(l, restLift.id, on ? active.rest.total : null))}
                      tone={!!prefs.restTone} vibrate={prefs.restVibrate !== false}
                      hint={coarse && !prefs.restHintSeen} onHintSeen={() => writeLifts(l => setLiftsPref(l, 'restHintSeen', true))} />
          )}
          {pad && padEx && (() => {
            const st = padEx.sets[pad.si];
            if (!st) return null;
            const l = liftAt(pad.ei);
            const r = rowsOf(pad.ei)[pad.si] || {};
            const ph = r.ph;
            const pv = prevs[pad.ei] || {};
            const bwLift = l && l.load === 'bodyweight_plus';
            const best = bests[pad.ei];
            let prevValue = ph ? ph[pad.field] : null;
            let nightValue = null;
            if (pad.field === 'weight' && night && pv.p && pv.p.source === 'day×0.8') {
              const ds = pv.day && pv.day.sets.length ? pv.day.sets[Math.min(pad.si, pv.day.sets.length - 1)] : null;
              prevValue = ds ? ds.weight : null;
              nightValue = ph ? ph.weight : null;
            }
            return (
              <NumPad field={pad.field} title={`${l ? l.name : ''} · set ${pad.si + 1}`} value={pad.buf}
                      rpe={st.rpe} step={stepOf(pad.ei, pad.field)} onKey={onKey} onStep={onStep} onRpe={onRpe} onNext={onNext} onDone={closePad}
                      hasNext={!!nextOf(pad)}
                      fieldLabel={pad.field === 'weight' ? (l && l.load === 'per_hand' ? 'KG/hand' : bwLift ? '+KG' : 'KG') : undefined}
                      placeholder={pad.field === 'weight' && bwLift ? '+0' : ph && ph[pad.field] != null ? `${r.label && pad.field === 'weight' ? '☾' : ''}${fmt(ph[pad.field])}` : '—'}
                      prevText={r.prev ? realSetText(r.prev.weight, r.prev.reps, l) : null} bestText={best ? realSetText(best.weight, best.reps, l) : null}
                      prevValue={prevValue} nightValue={nightValue} targetReps={padEx.target || null}
                      onSet={v => { const p = pad; setPad({ ...p, buf: fmt(v), fresh: true }); commit(p, fmt(v)); }}
                      onClose={closePad} />
            );
          })()}
        </div>,
        document.body,
      )}

      {picker && (
        <ExercisePicker mode={picker.mode} lifts={list} log={log} recent={recentIds} today={today} gym={gymNow} gymName={gymName}
                        exclude={inWorkout.filter((_, i) => picker.mode !== 'swap' || i !== picker.ei)}
                        onClose={() => setPicker(null)} onCreate={onCreateLift} onNotice={text => setUndo({ text, n: Date.now() })}
                        onPick={ids => {
                          if (picker.mode === 'swap') update(prev => swapExercise(prev, picker.ei, ids[0]));
                          else update(prev => addExercises(prev, ids));
                          setPicker(null);
                        }} />
      )}

      {setMenu && setAt(setMenu.ei, setMenu.si) && (
        <SetMenu si={setMenu.si} set={setAt(setMenu.ei, setMenu.si)} liftName={liftAt(setMenu.ei) ? liftAt(setMenu.ei).name : 'Exercise'}
                 onType={tp => { update(prev => setSetType(prev, setMenu.ei, setMenu.si, tp)); setSetMenu(null); }}
                 onDelete={() => deleteSet(setMenu.ei, setMenu.si)} onClose={() => setSetMenu(null)} />
      )}

      {menuEx && (
        <ExerciseMenu ex={menuEx} lift={menuLift} gymLabel={gymNow ? gymName(gymNow) : null} restNow={restSecFor(active, menuLift)}
                      onSwap={() => { const ei = exMenu; setExMenu(null); setPicker({ mode: 'swap', ei }); }}
                      onNote={() => { setNoteOpen(exMenu); setExMenu(null); }}
                      onHistory={() => { const id = menuEx.liftId; setExMenu(null); setHistory(id); }}
                      onRest={sec => menuLift && !menuLift.pending && writeLifts(l => setLiftRest(l, menuLift.id, sec))}
                      onManage={onManage ? () => { setExMenu(null); onManage(); } : null}
                      onRemove={() => removeEx(exMenu)} onClose={() => setExMenu(null)} />
      )}

      {history && (
        <Sheet title={(list.find(l => l.id === history) || {}).name || 'History'} eyebrow="// History" onClose={() => setHistory(null)} width={560}
               testId="lw-history" className="lw-history">
          {renderHistory ? renderHistory(history, () => setHistory(null)) : <p className="lf-meta">History isn&apos;t available here.</p>}
        </Sheet>
      )}

      {wkMenu && (
        <WorkoutMenu active={active} gymLabel={gymNow ? gymName(gymNow) : null} prefs={prefs}
                     onRename={n => update(prev => renameWorkout(prev, n))} onRest={sec => update(prev => setRestSec(prev, sec))}
                     onNight={on => update(prev => setWorkoutShift(prev, on ? 'night' : 'day'))}
                     onGym={() => { setWkMenu(false); setGymSheet(true); }} onPref={(k, v) => writeLifts(l => setLiftsPref(l, k, v))}
                     onDiscard={() => { setWkMenu(false); update(prev => discardWorkout(prev)); if (onToast) onToast('Workout discarded — nothing was saved'); }}
                     onClose={() => setWkMenu(false)} />
      )}

      {gymSheet && (
        <GymSheet gyms={gyms} gymNow={gymNow} doneN={doneN} gymName={gymName} onClose={() => setGymSheet(false)}
                  onMove={id => {
                    update(prev => setWorkoutGym(prev, id));
                    setGymSheet(false);
                    if (doneN && onToast) onToast(`Now at ${gymName(id)} — ${doneN} ${doneN === 1 ? 'set' : 'sets'} re-tagged`);
                  }} />
      )}

      <UndoToast toast={undo} onUndo={t => { if (t.undo) t.undo(); setUndo(null); }} onDone={closeUndo} bottom={dockH} />
      <PbToast pb={pbToast} onDone={closePb} />
    </div>
  );
}
