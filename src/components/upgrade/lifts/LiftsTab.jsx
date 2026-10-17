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
 * Screens: the list (cards) → one lift (LiftDetail). Sheets: LogSheet
 * (log / edit) and ManageSheet. Delete has a five-second Undo that puts
 * back the identical entry in its old place.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../Icon';
import LiftCard, { agoText } from './LiftCard';
import LiftDetail from './LiftDetail';
import LogSheet from './LogSheet';
import ManageSheet from './ManageSheet';
import { Toast, Celebrate } from './parts';
import { useLiftsData, todayIso } from './useLifts';
import {
  ensureLifts, withLifts, makeEntry, upsertEntry, removeEntry, restoreEntry, addLift, renameLift, setArchived,
  moveLift, deleteLift, recentFirst, newId,
} from '../../../lib/lifts/store';
import { pbMessage, pbKinds, setText, shortLiftName } from '../../../lib/lifts/lifts';
import { shiftOn } from '../../../lib/rotation/pattern';
import '../security/security.css';
import './lifts.css';

export default function LiftsTab({ S, update, hydrated = true }) {
  const today = todayIso();
  const { lifts, bwOf, summaries, totals, exists } = useLiftsData(S, today);
  const [open, setOpen] = useState(null);          // lift id in detail
  const [sheet, setSheet] = useState(null);        // { kind: 'log', liftId?, entry? } | { kind: 'manage' }
  const [toast, setToast] = useState(null);
  const [pb, setPb] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  // Seed the defaults once, only when the store is absent and the cloud copy is in.
  useEffect(() => {
    if (hydrated && !exists) update(prev => ensureLifts(prev, Date.now()));
  }, [hydrated, exists, update]);

  const write = useCallback(fn => update(prev => withLifts(prev, fn, Date.now())), [update]);
  const shiftOf = useCallback(iso => { const d = shiftOn(S, iso); return d ? d.shift : null; }, [S]);

  const active = lifts.list.filter(l => !l.archived);
  const archived = lifts.list.filter(l => l.archived);
  const pickList = useMemo(() => recentFirst(lifts), [lifts]);
  const counts = useMemo(() => {
    const m = new Map();
    for (const e of lifts.log) if (e && e.liftId) m.set(e.liftId, (m.get(e.liftId) || 0) + 1);
    return m;
  }, [lifts.log]);
  const cur = open ? summaries.get(open) : null;
  useEffect(() => { if (open && !cur) setOpen(null); }, [open, cur]);

  const save = (f, res) => {
    const editing = sheet && sheet.entry;
    const entry = makeEntry({ ...(editing || {}), ...f, id: editing ? editing.id : undefined, createdAt: editing ? editing.createdAt : undefined },
      { id: newId('ls'), now: Date.now(), shift: shiftOf(f.date) || null });
    write(l => upsertEntry(l, entry));
    setSheet(null);
    const lift = lifts.list.find(l => l.id === entry.liftId);
    if (res && res.any && !res.first) {
      setPb({ text: pbMessage(entry, lift, res.value), kinds: pbKinds(res), n: Date.now() });
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
    onAdd: ({ name, load }) => {
      const out = addLift(lifts, { name, load }, { id: newId('lift'), now: Date.now() });
      if (out.ok) write(l => addLift(l, { name, load }, { id: out.id, now: Date.now() }).lifts);
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
  };

  const logSheet = sheet && sheet.kind === 'log' && (
    <LogSheet entry={sheet.entry} liftId={sheet.liftId} lifts={lifts.list} pickList={pickList} log={lifts.log} bwOf={bwOf}
              today={today} shiftOf={shiftOf} onClose={() => setSheet(null)} onSave={save} onDelete={del} />
  );

  return (
    <div className="upg-pane sec lifts">
      {cur ? (
        <LiftDetail s={cur} today={today} bwOf={bwOf} onBack={() => setOpen(null)}
                    onLog={() => setSheet({ kind: 'log', liftId: cur.lift.id })}
                    onEdit={e => setSheet({ kind: 'log', entry: e })} onDelete={del} />
      ) : (
        <>
          <div className="lf-bar">
            <div className="lf-bar-text">
              <span className="sec-eyebrow">// Personal bests</span>
              <p className="lf-summary">
                {totals.sets
                  ? <>{active.length} lifts · {totals.sets} sets · <b>{totals.pbsMonth} {totals.pbsMonth === 1 ? 'PB' : 'PBs'} this month</b> · last logged {agoText(totals.last.date, today)}</>
                  : 'Log a set and its PBs build themselves: best e1RM, heaviest, and your 1–12 rep maxes.'}
              </p>
            </div>
            <div className="lf-bar-acts">
              <button type="button" className="sec-btn is-quiet lf-btn-lg" onClick={() => setSheet({ kind: 'manage' })}>
                <Icon name="settings" size={14} /> Manage lifts
              </button>
              <button type="button" className="sec-btn is-primary lf-btn-lg" onClick={() => setSheet({ kind: 'log' })} disabled={!active.length}>
                <Icon name="plus" size={14} /> Log a set
              </button>
            </div>
          </div>
          {!active.length && <p className="lf-muted">No lifts in use — add one in Manage lifts.</p>}
          <ul className="lf-cards" aria-label="Lifts">
            {active.map(l => (
              <LiftCard key={l.id} s={summaries.get(l.id)} today={today} onOpen={() => setOpen(l.id)}
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
                  {archived.map(l => <LiftCard key={l.id} s={summaries.get(l.id)} today={today} onOpen={() => setOpen(l.id)} />)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      {logSheet}
      {sheet && sheet.kind === 'manage' && (
        <ManageSheet lifts={lifts.list} counts={counts} onClose={() => setSheet(null)} {...manage} />
      )}
      <Toast toast={toast} onUndo={undo} onDone={doneToast} />
      <Celebrate pb={pb} onDone={donePb} />
    </div>
  );
}
