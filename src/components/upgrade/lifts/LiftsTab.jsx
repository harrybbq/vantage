/**
 * Upgrade → Lifts. A personal-best log for the main lifts (owner, Oct
 * 2026: "a section where I can keep logs of my PBs on main lifts").
 *
 * Data: `S.lifts` — a NEW key, written additively (store.js has the
 * rules). The default list (the programme's compound movements) is
 * seeded the first time this tab opens and `S.lifts` is absent — and
 * only once the cloud copy has loaded (`hydrated`), so it can never seed
 * over a store that simply hadn't arrived yet. Until then the defaults
 * are shown, not written.
 *
 * The programme bans back squat, deadlift and barbell RDL. The log does
 * not: it is a record, not a plan. A banned lift gets one quiet line.
 *
 * Shifts: each set is tagged with the rota's shift for its date
 * (shiftOn). Night sessions run at 80% load, so those sets say so — in
 * the list, the chart (hollow points) and the sheet. PBs count raw weight.
 *
 * Screens: the list (today's workout, then the PB cards) → one lift
 * (LiftDetail); the live workout (WorkoutLive) while one is open.
 * Sheets: LogSheet (Quick Log — log / edit one set), ManageSheet and the
 * Finish summary. Delete has a five-second Undo that puts back the
 * identical entry in its old place.
 *
 * The workout logger (workout.js): a workout in progress lives in
 * S.lifts.active and survives a reload; coming back to Lifts with one
 * open shows "Workout in progress · 23 min · Resume / Discard" rather
 * than throwing you into it. Finish writes its done sets to the same
 * log the PB tables read, so PBs keep one source of truth.
 *
 * Gyms (S.lifts.gyms, DXC / Greenock by default): every set and workout
 * is tagged with one, defaulting to the last gym used. Machines compare
 * within a gym, free weights across (lib/lifts/lifts.js). Manage lifts
 * edits the gyms and each lift's per-gym switch.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../Icon';
import LiftCard, { agoText } from './LiftCard';
import LiftDetail from './LiftDetail';
import LogSheet from './LogSheet';
import ManageSheet from './ManageSheet';
import WorkoutToday from './WorkoutToday';
import WorkoutLive from './WorkoutLive';
import FinishSheet from './FinishSheet';
import { Toast, Celebrate } from './parts';
import { useLiftsData, todayIso } from './useLifts';
import {
  ensureLifts, withLifts, makeEntry, upsertEntry, removeEntry, restoreEntry, addLift, renameLift, setArchived,
  moveLift, deleteLift, recentFirst, newId, defaultGym, setLastGym, setPerGym, addGym, renameGym, setGymArchived, deleteGym,
  gymName as gymNameOf,
} from '../../../lib/lifts/store';
import { pbMessage, pbKinds, setText, shortLiftName } from '../../../lib/lifts/lifts';
import { shiftOn } from '../../../lib/rotation/pattern';
import { trainingDayOf } from '../../../lib/rotation/trainingDay';
import {
  activeOf, startWorkout, suggestedStart, discardWorkout, summariseWorkout, finishWorkout, saveTemplate, templateFromSession,
} from '../../../lib/lifts/workout';
import '../security/security.css';
import './lifts.css';
import './workout.css';

export default function LiftsTab({ S, update, hydrated = true }) {
  // The training day, not the calendar day: a 3:30am session after a
  // night shift belongs to the shift's day — its plan, its 80% load, and
  // the date its sets and workout are saved under (trainingDay.js).
  const calendarToday = todayIso();
  const today = trainingDayOf(S, new Date());
  const nightOf = today !== calendarToday ? today : null;
  const { lifts, bwOf, summaries, totals, gyms, exists } = useLiftsData(S, today);
  const activeGymList = useMemo(() => gyms.filter(g => !g.archived), [gyms]);
  const curGym = defaultGym(lifts);
  const gymName = useCallback(id => gymNameOf(lifts, id), [lifts]);
  const [open, setOpen] = useState(null);          // lift id in detail
  const [sheet, setSheet] = useState(null);        // { kind: 'log', liftId?, entry? } | { kind: 'manage' }
  const [toast, setToast] = useState(null);
  const [pb, setPb] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState('list');        // 'list' | 'workout'
  const [finish, setFinish] = useState(null);      // { summary, saved, templateSaved }
  const active = activeOf(S);
  // The resume line's minutes: a slow tick, only while a workout is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [active ? active.id : null]); // eslint-disable-line react-hooks/exhaustive-deps
  // Finished or discarded elsewhere (another device, the summary): back to the list.
  useEffect(() => { if (view === 'workout' && !active && !finish) setView('list'); }, [view, active, finish]);

  // Seed the defaults once, only when the store is absent and the cloud copy is in.
  useEffect(() => {
    if (hydrated && !exists) update(prev => ensureLifts(prev, Date.now()));
  }, [hydrated, exists, update]);

  const write = useCallback(fn => update(prev => withLifts(prev, fn, Date.now())), [update]);
  const shiftOf = useCallback(iso => { const d = shiftOn(S, iso); return d ? d.shift : null; }, [S]);

  const inUse = lifts.list.filter(l => !l.archived);
  const archived = lifts.list.filter(l => l.archived);
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
  const cur = open ? summaries.get(open) : null;
  useEffect(() => { if (open && !cur) setOpen(null); }, [open, cur]);

  const save = (f, res) => {
    const editing = sheet && sheet.entry;
    const entry = makeEntry({ ...(editing || {}), ...f, id: editing ? editing.id : undefined, createdAt: editing ? editing.createdAt : undefined },
      { id: newId('ls'), now: Date.now(), shift: shiftOf(f.date) || null });
    write(l => (entry.gym && !editing ? setLastGym(upsertEntry(l, entry), entry.gym) : upsertEntry(l, entry)));
    setSheet(null);
    const lift = lifts.list.find(l => l.id === entry.liftId);
    if (res && res.any && !res.first) {
      setPb({ text: pbMessage(entry, lift), kinds: pbKinds(res), n: Date.now() });
    } else {
      setToast({ text: `${editing ? 'Saved' : 'Logged'} · ${shortLiftName(lift && lift.name)} ${setText(entry, lift)}`, n: Date.now() });
    }
  };

  const del = entry => {
    let removed = null;
    write(l => { const out = removeEntry(l, entry.id); removed = out.removed; return out.lifts; });
    setSheet(null);
    const lift = lifts.list.find(l => l.id === entry.liftId);
    setToast({ text: `Deleted ${shortLiftName(lift && lift.name)} ${setText(entry, lift)} · ${entry.date}`, undo: () => removed, n: Date.now() });
  };
  const undo = t => {
    const removed = t.undo && t.undo();
    if (removed) write(l => restoreEntry(l, removed));
    setToast({ text: 'Restored', n: Date.now() });
  };
  const doneToast = useCallback(() => setToast(null), []);
  const donePb = useCallback(() => setPb(null), []);

  const manage = {
    onAdd: ({ name, load, muscles }) => {
      const out = addLift(lifts, { name, load, muscles }, { id: newId('lift'), now: Date.now() });
      if (out.ok) write(l => addLift(l, { name, load, muscles }, { id: out.id, now: Date.now() }).lifts);
      return out;
    },
    onRename: (id, name) => {
      const out = renameLift(lifts, id, name);
      if (out.ok) write(l => renameLift(l, id, name).lifts);
      return out;
    },
    onMove: (id, dir) => write(l => moveLift(l, id, dir)),
    onArchive: (id, on) => write(l => setArchived(l, id, on)),
    onDelete: id => {
      const out = deleteLift(lifts, id);
      if (out.ok) write(l => deleteLift(l, id).lifts);
      else setToast({ text: out.error, n: Date.now() });
      return out;
    },
    onPerGym: (id, on) => write(l => setPerGym(l, id, on)),
    // Gyms: checked against the current store first so the sheet can show the error.
    onAddGym: name => {
      const out = addGym(lifts, name);
      if (out.ok) write(l => addGym(l, name, { id: out.id }).lifts);
      return out;
    },
    onRenameGym: (id, name) => {
      const out = renameGym(lifts, id, name);
      if (out.ok) write(l => renameGym(l, id, name).lifts);
      return out;
    },
    onArchiveGym: (id, on) => {
      const out = setGymArchived(lifts, id, on);
      if (out.ok) write(l => setGymArchived(l, id, on).lifts);
      return out;
    },
    onDeleteGym: id => {
      const out = deleteGym(lifts, id);
      if (out.ok) write(l => deleteGym(l, id).lifts);
      return out;
    },
  };
  const pickGym = id => write(l => setLastGym(l, id));

  // ── Workout ──
  const goWorkout = () => { setOpen(null); setView('workout'); window.scrollTo({ top: 0 }); };
  const startSuggested = sug => {
    update(prev => startWorkout(prev, { ...suggestedStart(sug), now: Date.now(), today }));
    goWorkout();
  };
  const buildOwn = () => {
    const sh = shiftOf(today);
    update(prev => startWorkout(prev, { source: 'blank', name: 'Workout', shift: sh, gym: curGym, now: Date.now(), today }));
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
    setFinish(f => ({ ...f, saved: true }));
    if (summary.pbs.length) {
      setPb({ text: summary.pbs.length === 1 ? summary.pbs[0].text : `${summary.pbs.length} new bests this workout`,
        kinds: summary.pbs.length === 1 ? null : summary.pbs.map(x => x.text.replace(/^New best: /, '')), n: Date.now() });
    }
  };
  const closeFinish = () => { const was = finish && finish.saved; setFinish(null); if (was) setView('list'); };
  const saveAsTemplate = name => {
    const tpl = templateFromSession(finish.summary.session, name, newId('tp'));
    update(prev => saveTemplate(prev, tpl));
    setFinish(f => ({ ...f, templateSaved: tpl.name }));
  };
  const showHistory = id => { setOpen(id); window.scrollTo({ top: 0 }); };

  const logSheet = sheet && sheet.kind === 'log' && (
    <LogSheet entry={sheet.entry} liftId={sheet.liftId} lifts={lifts.list} pickList={pickList} log={lifts.log} bwOf={bwOf}
              today={today} maxDate={calendarToday} shiftOf={shiftOf} onClose={() => setSheet(null)} onSave={save} onDelete={del}
              gyms={activeGymList} gym={active && active.gym ? active.gym : curGym} gymName={gymName} />
  );

  return (
    <div className="upg-pane sec lifts">
      {cur ? (
        <LiftDetail s={cur} today={today} bwOf={bwOf} gyms={gyms} onPerGym={manage.onPerGym} onBack={() => setOpen(null)}
                    backLabel={view === 'workout' && active ? 'Back to workout' : 'All lifts'}
                    onLog={() => setSheet({ kind: 'log', liftId: cur.lift.id })}
                    onEdit={e => setSheet({ kind: 'log', entry: e })} onDelete={del} />
      ) : view === 'workout' && active ? (
        <WorkoutLive S={S} update={update} list={lifts.list} recentIds={recentIds} today={today} gyms={activeGymList} gymName={gymName}
                     onPerGym={manage.onPerGym}
                     onMinimise={() => { setView('list'); window.scrollTo({ top: 0 }); }} onFinish={openFinish}
                     onQuickLog={() => setSheet({ kind: 'log' })} onHistory={showHistory} onCreateLift={manage.onAdd}
                     onToast={text => setToast({ text, n: Date.now() })} />
      ) : (
        <>
          <WorkoutToday S={S} today={today} nightOf={nightOf} now={now} active={active} onStart={startSuggested} onBuild={buildOwn}
                        onResume={goWorkout} onDiscard={discard} gyms={activeGymList} gym={curGym} onGym={pickGym} gymName={gymName} />
          <div className="lf-bar">
            <div className="lf-bar-text">
              <span className="sec-eyebrow">// Personal bests</span>
              <p className="lf-summary">
                {totals.sets
                  ? <>{inUse.length} lifts · {totals.sets} sets · <b>{totals.pbsMonth} {totals.pbsMonth === 1 ? 'PB' : 'PBs'} this month</b> · last logged {agoText(totals.last.date, today)}</>
                  : 'Log a set and its PBs build themselves from real sets: heaviest, and your 1–12 rep maxes.'}
              </p>
            </div>
            <div className="lf-bar-acts">
              <button type="button" className="sec-btn is-quiet lf-btn-lg" onClick={() => setSheet({ kind: 'manage' })}>
                <Icon name="settings" size={14} /> Manage lifts
              </button>
              <button type="button" className="sec-btn is-primary lf-btn-lg" onClick={() => setSheet({ kind: 'log' })} disabled={!inUse.length}>
                <Icon name="zap" size={14} /> Quick log a set
              </button>
            </div>
          </div>
          {!inUse.length && <p className="lf-muted">No lifts in use — add one in Manage lifts.</p>}
          <ul className="lf-cards" aria-label="Lifts">
            {inUse.map(l => (
              <LiftCard key={l.id} s={summaries.get(l.id)} today={today} gyms={gyms} onOpen={() => setOpen(l.id)}
                        onLog={() => setSheet({ kind: 'log', liftId: l.id })} />
            ))}
          </ul>
          {archived.length > 0 && (
            <div className="lf-archived">
              <button type="button" className="sec-btn is-quiet lf-btn-lg" aria-expanded={showArchived} onClick={() => setShowArchived(v => !v)}>
                <Icon name={showArchived ? 'chevron-up' : 'chevron-down'} size={14} /> Archived · {archived.length}
              </button>
              {showArchived && (
                <ul className="lf-cards" aria-label="Archived lifts">
                  {archived.map(l => <LiftCard key={l.id} s={summaries.get(l.id)} today={today} gyms={gyms} onOpen={() => setOpen(l.id)} />)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      {logSheet}
      {sheet && sheet.kind === 'manage' && (
        <ManageSheet lifts={lifts.list} counts={counts} onClose={() => setSheet(null)} gyms={gyms} gymCounts={gymCounts} {...manage} />
      )}
      {finish && (
        <FinishSheet summary={finish.summary} saved={finish.saved} templateSaved={finish.templateSaved}
                     gymLabel={finish.summary.session.gym ? gymName(finish.summary.session.gym) : null}
                     onSave={saveWorkout} onKeepGoing={() => setFinish(null)} onClose={closeFinish} onSaveTemplate={saveAsTemplate}
                     onDiscard={() => { update(prev => discardWorkout(prev)); setFinish(null); setView('list'); setToast({ text: 'Workout discarded — nothing was saved', n: Date.now() }); }} />
      )}
      <Toast toast={toast} onUndo={undo} onDone={doneToast} />
      <Celebrate pb={pb} onDone={donePb} />
    </div>
  );
}
