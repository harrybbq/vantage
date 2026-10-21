/**
 * Upgrade → Lifts. A workout logger and a personal-best log for the main
 * lifts (owner, Oct 2026). Redesigned to the Oct 2026 brief (§3).
 *
 * Data: `S.lifts` — a NEW key, written additively (store.js has the
 * rules). The default list is seeded the first time this tab opens and
 * `S.lifts` is absent — and only once the cloud copy has loaded
 * (`hydrated`), so it can never seed over a store that hadn't arrived.
 *
 * Screens (this file only routes; each screen lives in its own file):
 *   home     Today (WorkoutToday: suggested card, resume banner, the week
 *            strip) + the lift list (LiftList)
 *   detail   one lift (LiftDetail — also renders embedded in a Sheet:
 *            <LiftDetail liftId embedded onClose />, via the Lifts context)
 *   workout  the live workout (WorkoutLive) while one is open
 * Sheets: LogSheet (Quick log / edit one set), ManageSheet, FinishSheet.
 * Delete has a five-second Undo that puts back the identical entry.
 *
 * The frame: ONE bar — Upgrade's "‹ Upgrade · Lifts" with ⚙ Manage at its
 * right end (lifts.css places it there); a lift's detail hides that bar
 * and shows its own single "‹ Lifts" back (A15). On phones the outer panel
 * border and padding go (no card in a card).
 *
 * Shifts: each set is tagged with the rota's shift for its date. In the
 * early hours after a night shift `today` is the shift's day
 * (trainingDay.js) — plan, 80 % load and the date sets save under.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import LiftDetail from './LiftDetail';
import LogSheet from './LogSheet';
import ManageSheet from './ManageSheet';
import WorkoutToday from './WorkoutToday';
import WeekMuscles from './WeekMuscles';
import LiftList from './LiftList';
import WorkoutLive from './WorkoutLive';
import FinishSheet from './FinishSheet';
import HistoryCard from './HistoryCard';
import { liftsLinkedTrackers, linkTrackerToLifts } from '../../../lib/trackers/autoLog';
import NewWorkoutSheet from './workout/NewWorkoutSheet';
import { takeLiftsResume, onLiftsResume } from '../../../lib/lifts/liveBus';
import { Toast } from './parts';
import { Button, PbToast } from './ui';
import { LiftsScope, useLiftsScope } from './ui/scope';
import { useLiftsData, todayIso, LiftsProvider } from './useLifts';
import {
  ensureLifts, withLifts, makeEntry, editEntry, upsertEntry, removeEntry, restoreEntry, addLift, renameLift, setArchived,
  moveLift, deleteLift, recentFirst, newId, defaultGym, setLastGym, setPerGym, addGym, renameGym, setGymArchived, deleteGym,
  setLiftStep, gymName as gymNameOf,
} from '../../../lib/lifts/store';
import { pbMessage, pbKinds, setText, shortLiftName } from '../../../lib/lifts/lifts';
import { shiftOn } from '../../../lib/rotation/pattern';
import { trainingDayOf } from '../../../lib/rotation/trainingDay';
import {
  activeOf, startWorkout, suggestedStart, discardWorkout, summariseWorkout, finishWorkout, saveTemplate, templateFromSession, deleteTemplate,
} from '../../../lib/lifts/workout';
import '../security/security.css';
import './lifts.css';
import './workout.css';
import './lifts-tokens.css';
import './home.css';

export default function LiftsTab({ S, update, hydrated = true }) {
  const calendarToday = todayIso();
  const today = trainingDayOf(S, new Date());
  const nightOf = today !== calendarToday ? today : null;
  const { lifts, bwOf, summaries, totals, gyms, exists } = useLiftsData(S, today);
  const activeGymList = useMemo(() => gyms.filter(g => !g.archived), [gyms]);
  const gymOrder = useMemo(() => gyms.map(g => g.id), [gyms]);
  const curGym = defaultGym(lifts);
  const gymName = useCallback(id => gymNameOf(lifts, id), [lifts]);
  const [open, setOpen] = useState(null);          // lift id in detail
  const [sheet, setSheet] = useState(null);        // { kind: 'log', liftId?, entry? } | { kind: 'manage', focus? }
  const [toast, setToast] = useState(null);
  const [pb, setPb] = useState(null);
  const [view, setView] = useState('list');        // 'list' | 'workout'
  const [finish, setFinish] = useState(null);      // { summary, saved, templateSaved }
  const [newSheet, setNewSheet] = useState(null);  // { tab } — the New workout sheet (nothing starts until its Start)
  const [pickOnOpen, setPickOnOpen] = useState(false);
  const active = activeOf(S);
  const scope = useLiftsScope();
  // The resume line's minutes: a slow tick, only while a workout is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [active ? active.id : null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'workout' && !active && !finish) setView('list'); }, [view, active, finish]);
  // The mini-bar's Resume (liveBus): open the workout — no state write, navigation only.
  const hasActive = !!active;
  useEffect(() => {
    const go = () => { if (takeLiftsResume() && hasActive) { setOpen(null); setView('workout'); window.scrollTo({ top: 0 }); } };
    go();
    return onLiftsResume(go);
  }, [hasActive]);

  // Seed the defaults once, only when the store is absent and the cloud copy is in.
  useEffect(() => {
    if (hydrated && !exists) update(prev => ensureLifts(prev, Date.now()));
  }, [hydrated, exists, update]);

  const write = useCallback(fn => update(prev => withLifts(prev, fn, Date.now())), [update]);
  const shiftOf = useCallback(iso => { const d = shiftOn(S, iso); return d ? d.shift : null; }, [S]);

  const inUse = lifts.list.filter(l => !l.archived);
  const pickList = useMemo(() => recentFirst(lifts), [lifts]);
  const counts = useMemo(() => {
    const m = new Map();
    for (const e of lifts.log) if (e && e.liftId) m.set(e.liftId, (m.get(e.liftId) || 0) + 1);
    return m;
  }, [lifts.log]);
  const gymCounts = useMemo(() => {
    const m = new Map();
    for (const e of lifts.log) if (e && e.gym) m.set(e.gym, (m.get(e.gym) || 0) + 1);
    return m;
  }, [lifts.log]);
  const recentIds = useMemo(() => pickList.filter(l => counts.has(l.id)).map(l => l.id), [pickList, counts]);
  useEffect(() => { if (open && !summaries.get(open)) setOpen(null); }, [open, summaries]);

  const save = (f, res) => {
    const editing = sheet && sheet.entry;
    const opts = { id: newId('ls'), now: Date.now(), shift: shiftOf(f.date) || null };
    // An edit keeps the set's id, createdAt, workout link and any key a newer build added.
    const entry = editing ? editEntry(editing, f, opts) : makeEntry(f, opts);
    write(l => (entry.gym && !editing ? setLastGym(upsertEntry(l, entry), entry.gym) : upsertEntry(l, entry)));
    setSheet(null);
    const lift = lifts.list.find(l => l.id === entry.liftId);
    if (res && res.any && !res.first && entry.type !== 'W') {
      setPb({ text: pbMessage(entry, lift), kinds: pbKinds(res), n: Date.now() });
    } else {
      setToast({ text: `${editing ? 'Saved' : 'Logged'} · ${shortLiftName(lift && lift.name)} ${setText(entry, lift)}`, n: Date.now() });
    }
  };

  const del = useCallback(entry => {
    let removed = null;
    write(l => { const out = removeEntry(l, entry.id); removed = out.removed; return out.lifts; });
    setSheet(null);
    const lift = lifts.list.find(l => l.id === entry.liftId);
    setToast({ text: `Deleted ${shortLiftName(lift && lift.name)} ${setText(entry, lift)} · ${entry.date}`, undo: () => removed, n: Date.now() });
  }, [write, lifts.list]);
  const undo = t => {
    const removed = t.undo && t.undo();
    if (removed) write(l => restoreEntry(l, removed));
    setToast({ text: 'Restored', n: Date.now() });
  };
  const doneToast = useCallback(() => setToast(null), []);
  const donePb = useCallback(() => setPb(null), []);

  // Writers checked against the current store first, so a sheet can show the error.
  const checked = (fn, ...a) => { const out = fn(lifts, ...a); if (out.ok) write(l => fn(l, ...a).lifts); return out; };
  const manage = {
    onAdd: ({ name, load, muscles, perGym }) => {
      const spec = { name, load, muscles, ...(typeof perGym === 'boolean' ? { perGym } : {}) };
      const out = addLift(lifts, spec, { id: newId('lift'), now: Date.now() });
      if (out.ok) write(l => addLift(l, spec, { id: out.id, now: Date.now() }).lifts);
      return out;
    },
    onRename: (id, name) => checked(renameLift, id, name),
    onMove: (id, dir, steps = 1) => write(l => { let x = l; for (let i = 0; i < steps; i++) x = moveLift(x, id, dir); return x; }),
    onArchive: (id, on) => write(l => setArchived(l, id, on)),
    onDelete: id => {
      const out = checked(deleteLift, id);
      if (!out.ok) setToast({ text: out.error, n: Date.now() });
      return out;
    },
    onPerGym: (id, on) => write(l => setPerGym(l, id, on)),
    onStep: (id, step, gym = null) => write(l => setLiftStep(l, id, step, gym)),
    onAddGym: name => {
      const out = addGym(lifts, name);
      if (out.ok) write(l => addGym(l, name, { id: out.id }).lifts);
      return out;
    },
    onRenameGym: (id, name) => checked(renameGym, id, name),
    onArchiveGym: (id, on) => checked(setGymArchived, id, on),
    onDeleteGym: id => checked(deleteGym, id),
  };
  const pickGym = id => write(l => setLastGym(l, id));

  // ── Workout ──
  const goWorkout = () => { setOpen(null); setView('workout'); window.scrollTo({ top: 0 }); };
  // Rows start EMPTY: the live table shows Previous as placeholders and ✓ commits them.
  const startSuggested = sug => {
    update(prev => startWorkout(prev, { ...suggestedStart(sug, { prefill: false }), now: Date.now(), today }));
    goWorkout();
  };
  // "Build my own" / Blank / Recent / Library → the New workout sheet; the clock starts on its Start.
  const buildOwn = tab => setNewSheet({ tab: typeof tab === 'string' ? tab : 'blank' });
  const startNew = args => {
    const { openPicker, ...startArgs } = args;
    update(prev => startWorkout(prev, { ...startArgs, now: Date.now(), today }));
    setNewSheet(null);
    setPickOnOpen(!!openPicker);
    goWorkout();
  };
  const discard = () => { update(prev => discardWorkout(prev)); setToast({ text: 'Workout discarded — nothing was saved', n: Date.now() }); };
  const openFinish = () => {
    const summary = summariseWorkout(S, Date.now(), { bwOf });
    if (summary) setFinish({ summary, saved: false, templateSaved: null });
  };
  const saveWorkout = () => {
    const { summary } = finish;
    update(prev => finishWorkout(prev, summary.session.finishedAt));
    // The sheet lists the PBs (and each was toasted when its set was ticked) — no second celebration.
    setFinish(f => ({ ...f, saved: true }));
  };
  const closeFinish = () => { const was = finish && finish.saved; setFinish(null); if (was) setView('list'); };
  // Save as template; started from a saved one → "Update template" replaces it in place (same id).
  const saveAsTemplate = (name, { update: replace = false } = {}) => {
    const from = finish.summary.template;
    const tpl = replace && from ? templateFromSession(finish.summary.session, from.name, from.id) : templateFromSession(finish.summary.session, name, newId('tp'));
    update(prev => saveTemplate(prev, tpl));
    setFinish(f => ({ ...f, templateSaved: replace ? `Updated template “${tpl.name}”` : `Saved as template “${tpl.name}” — it’s in Library` }));
  };
  const openLift = useCallback(id => { setOpen(id); window.scrollTo({ top: 0 }); }, []);
  // View history over the live workout: the lift's detail embedded in WorkoutLive's sheet,
  // so the workout stays underneath (it reads everything from the Lifts context).
  const renderHistory = (id, close) => <LiftDetail liftId={id} embedded onClose={close} />;

  const ctx = useMemo(() => ({
    S, lifts, summaries, bwOf, gyms, activeGyms: activeGymList, curGym, gymName, today, calendarToday, counts, shiftOf,
    activeGym: active && active.gym ? active.gym : curGym,
    openLog: ({ liftId, entry } = {}) => setSheet({ kind: 'log', liftId, entry }),
    deleteEntry: del,
    openManage: focus => setSheet({ kind: 'manage', focus }),
    openLift,
  }), [S, lifts, summaries, bwOf, gyms, activeGymList, curGym, gymName, today, calendarToday, counts, shiftOf, active, del, openLift]);

  const screen = open && summaries.get(open) ? 'detail' : view === 'workout' && active ? 'workout' : 'home';

  return (
    <LiftsScope value={scope}>
    <LiftsProvider value={ctx}>
    <div className={`upg-pane sec lifts lh-root is-${screen}`} style={scope.style} data-screen={screen}>
      {screen === 'detail' && (
        <LiftDetail liftId={open} onClose={() => { setOpen(null); window.scrollTo({ top: 0 }); }} backLabel="Lifts" />
      )}
      {screen === 'workout' && (
        <WorkoutLive S={S} update={update} list={lifts.list} recentIds={recentIds} today={today} bwOf={bwOf} gyms={activeGymList} gymName={gymName}
                     initialPicker={pickOnOpen} renderHistory={renderHistory} onManage={() => setSheet({ kind: 'manage' })}
                     onMinimise={() => { setPickOnOpen(false); setView('list'); window.scrollTo({ top: 0 }); }} onFinish={openFinish}
                     onQuickLog={() => setSheet({ kind: 'log' })} onCreateLift={manage.onAdd}
                     onToast={text => setToast({ text, n: Date.now() })} />
      )}
      {screen === 'home' && (
        <>
          <div className="lh-frame">
            <Button variant="quiet" icon="settings" className="lh-frame-manage" onClick={() => setSheet({ kind: 'manage' })} data-testid="lh-manage">Manage</Button>
          </div>
          <WorkoutToday S={S} today={today} nightOf={nightOf} now={now} active={active} list={lifts.list}
                        onStart={startSuggested} onBuild={buildOwn} onResume={goWorkout} onDiscard={discard}
                        onQuickLog={() => setSheet({ kind: 'log' })} canQuickLog={inUse.length > 0}
                        gyms={activeGymList} gym={curGym} onGym={pickGym} gymName={gymName} />
          <WeekMuscles S={S} today={today} />
          <HistoryCard S={S} update={update} today={calendarToday} />
          <LiftList list={lifts.list} summaries={summaries} counts={counts} today={today} activeGym={active && active.gym ? active.gym : curGym}
                    gymOrder={gymOrder} gymName={gymName} bwOf={bwOf} pbsMonth={totals.pbsMonth}
                    onOpen={openLift} onLog={id => setSheet({ kind: 'log', liftId: id })} onQuickLog={() => setSheet({ kind: 'log' })}
                    onManage={() => setSheet({ kind: 'manage' })} />
        </>
      )}
      {sheet && sheet.kind === 'log' && (
        <LogSheet entry={sheet.entry} liftId={sheet.liftId} lifts={lifts.list} pickList={pickList} log={lifts.log} bwOf={bwOf}
                  today={today} maxDate={calendarToday} shiftOf={shiftOf} onClose={() => setSheet(null)} onSave={save} onDelete={del}
                  gyms={activeGymList} gym={active && active.gym ? active.gym : curGym} gymName={gymName}
                  onManage={() => setSheet({ kind: 'manage' })} />
      )}
      {sheet && sheet.kind === 'manage' && (
        <ManageSheet lifts={lifts.list} counts={counts} onClose={() => setSheet(null)} gyms={gyms} gymCounts={gymCounts} focus={sheet.focus} {...manage} />
      )}
      {newSheet && (
        <NewWorkoutSheet S={S} today={today} gyms={activeGymList} gym={curGym} gymName={gymName} list={lifts.list} initialTab={newSheet.tab}
                         onStart={startNew} onClose={() => setNewSheet(null)} onQuickLog={() => { setNewSheet(null); setSheet({ kind: 'log' }); }}
                         onDeleteTemplate={id => update(prev => deleteTemplate(prev, id))} />
      )}
      {finish && (
        <FinishSheet summary={finish.summary} saved={finish.saved} templateSaved={finish.templateSaved} lifts={lifts.list} S={S} today={today}
                     gymLabel={finish.summary.session.gym ? gymName(finish.summary.session.gym) : null}
                     trackers={S.trackers || []} linked={liftsLinkedTrackers(S)}
                     dayLog={(S.logs || {})[finish.summary.session.date] || {}}
                     onLinkTracker={id => update(prev => linkTrackerToLifts(prev, id))}
                     onSave={saveWorkout} onKeepGoing={() => setFinish(null)} onClose={closeFinish} onSaveTemplate={saveAsTemplate}
                     onDiscard={() => { update(prev => discardWorkout(prev)); setFinish(null); setView('list'); setToast({ text: 'Workout discarded — nothing was saved', n: Date.now() }); }} />
      )}
      <Toast toast={toast} onUndo={undo} onDone={doneToast} />
      <PbToast pb={pb} onDone={donePb} />
    </div>
    </LiftsProvider>
    </LiftsScope>
  );
}
