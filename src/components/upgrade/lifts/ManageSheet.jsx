/**
 * Manage lifts and gyms (brief §3.11; A8) — a bottom sheet on phones, a
 * 480 px drawer on desktop.
 *
 * Lift rows: a drag handle (reorder; ↑ / ↓ also sit in the row's ⋯), the
 * name as TEXT with ✎ to edit it inline (Save / Cancel — no always-on
 * input to rename by accident), meta "WEIGHT · 24 sets", and the Compare
 * switch [Per gym | All gyms] — the ONLY place that setting is edited
 * (CompareScope elsewhere explains it and links here). The ⋯ holds Move up
 * / down, Weight step (1 / 1.25 / 2 / 2.5 / 5 → lift.step, or per gym for a
 * machine → lift.stepByGym), Rest default (→ lift.restSec), Archive, and
 * Delete for a lift with no sets.
 * "+ Add lift" expands to name · Loaded as · Machine switch.
 * Gyms: name (✎), set count, ⋯ (Archive; Delete if no sets), + Add gym.
 * Archived lifts and gyms sit in a collapsed group with Restore.
 * Every write is additive and touches only that lift / gym (store.js).
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../Icon';
import { Sheet, Button, IconButton, Segmented, Chip } from './ui';
import { STEP_CHOICES, REST_PRESETS } from '../../../lib/lifts/store';
import { LOAD_TYPES, LOAD_LABEL, bannedRule, perGymOf, perGymByName, stepFor, DEFAULT_STEP } from '../../../lib/lifts/lifts';

const COMPARE = [{ value: 'gym', label: 'Per gym' }, { value: 'all', label: 'All gyms' }];
const restTxt = s => (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} min`);
const ROW_H = 64;

/** Name as text + ✎ → an inline input with Save / Cancel. */
function InlineName({ value, label, max = 60, onSave, testId }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  const [err, setErr] = useState(null);
  const input = useRef(null);
  useEffect(() => { if (edit && input.current) input.current.focus(); }, [edit]);
  useEffect(() => { if (!edit) setV(value); }, [value, edit]);
  const save = () => {
    const out = onSave(v);
    if (out && out.ok === false) { setErr(out.error); return; }
    setErr(null); setEdit(false);
  };
  if (!edit) {
    return (
      <span className="lh-mname">
        <span className="lh-mname-txt">{value}</span>
        <IconButton icon="pencil" size={16} label={`Rename ${label}`} onClick={() => setEdit(true)} data-testid={testId} />
      </span>
    );
  }
  return (
    <span className="lh-medit">
      <input ref={input} className="lf-cellbox lh-medit-in" value={v} maxLength={max} aria-label={`New name for ${label}`}
             onChange={e => setV(e.target.value)}
             onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEdit(false); setErr(null); } }} />
      <span className="lh-medit-acts">
        <Button variant="primary" onClick={save}>Save</Button>
        <Button variant="quiet" onClick={() => { setEdit(false); setErr(null); }}>Cancel</Button>
      </span>
      {err && <span className="lh-err" role="alert">{err}</span>}
    </span>
  );
}

function LiftRow({ lift, count, index, total, gyms, focus, onRename, onPerGym, onMenu, drag }) {
  const per = perGymOf(lift);
  const ref = useRef(null);
  useEffect(() => { if (focus && ref.current) ref.current.scrollIntoView({ block: 'center' }); }, [focus]);
  const steps = per && lift.stepByGym ? Object.entries(lift.stepByGym).map(([g, s]) => `${(gyms.find(x => x.id === g) || { name: g }).name} ${s}`).join(' · ') : null;
  const meta = [
    LOAD_LABEL[lift.load], `${count} ${count === 1 ? 'set' : 'sets'}`,
    lift.step ? `step ${lift.step}` : null, steps ? `step ${steps}` : null,
    lift.restSec ? `rest ${restTxt(lift.restSec)}` : null, bannedRule(lift) ? 'not in programme' : null,
  ].filter(Boolean).join(' · ');
  const dy = drag && drag.id === lift.id ? drag.dy : 0;
  return (
    <li ref={ref} className={`lh-mrow${focus ? ' is-focus' : ''}${dy ? ' is-drag' : ''}`} style={dy ? { transform: `translateY(${dy}px)` } : undefined} data-testid="lh-mrow">
      {!lift.archived && (
        <span className="lh-handle" aria-hidden="true" onPointerDown={e => drag && drag.start(e, lift.id, index, total)}>
          <Icon name="grip-vertical" size={16} />
        </span>
      )}
      <div className="lh-mrow-main">
        <InlineName value={lift.name} label={lift.name} onSave={n => onRename(lift.id, n)} testId="lh-rename" />
        <span className="lh-mmeta">{meta}</span>
      </div>
      {!lift.archived && (
        <Segmented label={`${lift.name}: compare`} size="sm" options={COMPARE} value={per ? 'gym' : 'all'} onChange={v => onPerGym(lift.id, v === 'gym')}
                   className="lh-mcompare" testId="lh-compare" />
      )}
      <IconButton icon="ellipsis" label={`More for ${lift.name}`} onClick={() => onMenu(lift)} data-testid="lh-mmore" />
    </li>
  );
}

/** The lift's ⋯: move, weight step, rest default, archive / delete. */
function LiftMenu({ lift, count, gyms, first, last, onClose, onMove, onStep, onRest, onArchive, onDelete }) {
  const per = perGymOf(lift);
  const def = DEFAULT_STEP[lift.load] || 2.5;
  const stepOpts = [{ value: '', label: `Default · ${def}` }, ...STEP_CHOICES.map(s => ({ value: String(s), label: String(s) }))];
  const restOpts = [{ value: '', label: 'Workout' }, ...REST_PRESETS.map(s => ({ value: String(s), label: restTxt(s) }))];
  const act = fn => () => { fn(); onClose(); };
  return (
    <Sheet title={lift.name} eyebrow="// Manage lift" onClose={onClose} testId="lh-liftmenu">
      <div className="lh-menu">
        {!lift.archived && (
          <div className="lh-menu-row">
            <Button variant="secondary" icon="arrow-up" onClick={() => onMove(lift.id, -1)} disabled={first}>Move up</Button>
            <Button variant="secondary" icon="arrow-down" onClick={() => onMove(lift.id, 1)} disabled={last}>Move down</Button>
          </div>
        )}
        <p className="lf-eyebrow">// Weight step (the ± on the pad)</p>
        {per ? gyms.filter(g => !g.archived).map(g => (
          <div key={g.id} className="lh-menu-field">
            <span className="lf-meta">{g.name} · now {stepFor(lift, g.id)} kg</span>
            <Segmented label={`Weight step at ${g.name}`} size="sm" full options={stepOpts}
                       value={lift.stepByGym && lift.stepByGym[g.id] != null ? String(lift.stepByGym[g.id]) : ''}
                       onChange={v => onStep(lift.id, v === '' ? null : Number(v), g.id)} testId={`lh-step-${g.id}`} />
          </div>
        )) : (
          <div className="lh-menu-field">
            <span className="lf-meta">Now {stepFor(lift)} kg</span>
            <Segmented label="Weight step" size="sm" full options={stepOpts} value={lift.step != null ? String(lift.step) : ''}
                       onChange={v => onStep(lift.id, v === '' ? null : Number(v))} testId="lh-step" />
          </div>
        )}
        {per && <p className="lf-meta">A machine&apos;s stack differs gym to gym, so each gym keeps its own step.</p>}
        <p className="lf-eyebrow">// Rest default</p>
        <Segmented label="Rest default" size="sm" full options={restOpts} value={lift.restSec ? String(lift.restSec) : ''}
                   onChange={v => onRest(lift.id, v === '' ? null : Number(v))} testId="lh-rest" />
        <p className="lf-meta">The rest timer after a set of this lift. “Workout” uses the workout&apos;s default (90 s).</p>
        <div className="lh-menu-gap" />
        <Button variant="secondary" size="lg" block icon={lift.archived ? 'rotate-ccw' : 'archive'} onClick={act(() => onArchive(lift.id, !lift.archived))}>
          {lift.archived ? 'Restore' : 'Archive'}
        </Button>
        {count === 0 && (
          <>
            <div className="lh-menu-gap" />
            <Button variant="danger" size="lg" block icon="trash-2" onClick={act(() => onDelete(lift.id))} data-testid="lh-mdelete">Delete lift</Button>
          </>
        )}
        <p className="lf-meta">{count ? 'Archiving keeps every set and PB; the lift just leaves the list and the picker.' : 'No sets yet — it can be deleted.'}</p>
      </div>
    </Sheet>
  );
}

function GymRow({ gym, used, onRename, onArchive, onDelete }) {
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState(null);
  const act = (fn, ...a) => { const out = fn(...a); setErr(out && out.ok === false ? out.error : null); setMenu(false); };
  return (
    <li className="lh-mrow is-gym" data-testid="lf-gym-row">
      <div className="lh-mrow-main">
        <InlineName value={gym.name} label={`the gym ${gym.name}`} max={30} onSave={n => onRename(gym.id, n)} />
        <span className="lh-mmeta">{used} {used === 1 ? 'set' : 'sets'}{gym.archived ? ' · archived' : ''}</span>
        {err && <span className="lh-err" role="alert">{err}</span>}
      </div>
      <IconButton icon="ellipsis" label={`More for the gym ${gym.name}`} onClick={() => setMenu(true)} />
      {menu && (
        <Sheet title={gym.name} eyebrow="// Manage gym" onClose={() => setMenu(false)}>
          <div className="lh-menu">
            <Button variant="secondary" size="lg" block icon={gym.archived ? 'rotate-ccw' : 'archive'} onClick={() => act(onArchive, gym.id, !gym.archived)}>
              {gym.archived ? 'Restore' : 'Archive'}
            </Button>
            {used === 0 && <><div className="lh-menu-gap" /><Button variant="danger" size="lg" block icon="trash-2" onClick={() => act(onDelete, gym.id)}>Delete gym</Button></>}
            <p className="lf-meta">A gym with sets can be archived, not removed — its sets keep their gym.</p>
          </div>
        </Sheet>
      )}
    </li>
  );
}

function AddLift({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [load, setLoad] = useState('weight');
  const [machine, setMachine] = useState(null);     // null = follow the name
  const [err, setErr] = useState(null);
  const per = machine == null ? perGymByName(name) : machine;
  const add = e => {
    e.preventDefault();
    const out = onAdd({ name, load, ...(machine == null ? {} : { perGym: machine }) });
    if (out && out.ok === false) { setErr(out.error); return; }
    setErr(null); setName(''); setLoad('weight'); setMachine(null); setOpen(false);
  };
  if (!open) {
    return <button type="button" className="lh-addrow" onClick={() => setOpen(true)} data-testid="lh-addlift"><Icon name="plus" size={16} /> Add lift</button>;
  }
  return (
    <form className="lh-addform" onSubmit={add} noValidate>
      <label className="lf-eyebrow" htmlFor="lh-add-name">Name</label>
      <input id="lh-add-name" className="lf-cellbox lh-medit-in" value={name} maxLength={60} placeholder="e.g. Bench press" autoFocus onChange={e => setName(e.target.value)} />
      {err && <span className="lh-err" role="alert">{err}</span>}
      <span className="lf-eyebrow">Loaded as</span>
      <Segmented label="Loaded as" size="sm" full options={LOAD_TYPES.map(t => ({ value: t, label: LOAD_LABEL[t] }))} value={load} onChange={setLoad} />
      <span className="lf-eyebrow">Machine</span>
      <Segmented label="Machine: compare within each gym" size="sm" full options={[{ value: 'gym', label: 'Machine · per gym' }, { value: 'all', label: 'Free · all gyms' }]}
                 value={per ? 'gym' : 'all'} onChange={v => setMachine(v === 'gym')} />
      <p className="lf-meta">{per ? 'Compared within each gym — a machine at one gym isn’t the same machine at another.' : 'One record across every gym.'}{machine == null && name.trim() ? ' (guessed from the name)' : ''}</p>
      <div className="lh-menu-row">
        <Button variant="quiet" onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>
        <Button type="submit" variant="primary" icon="plus">Add lift</Button>
      </div>
    </form>
  );
}

function AddGym({ onAddGym }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const add = e => {
    e.preventDefault();
    const out = onAddGym(name);
    if (out && out.ok === false) { setErr(out.error); return; }
    setErr(null); setName(''); setOpen(false);
  };
  if (!open) return <button type="button" className="lh-addrow" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> Add gym</button>;
  return (
    <form className="lh-addform" onSubmit={add} noValidate>
      <label className="lf-eyebrow" htmlFor="lh-add-gym">Gym name</label>
      <input id="lh-add-gym" className="lf-cellbox lh-medit-in" value={name} maxLength={30} placeholder="e.g. Hotel gym" autoFocus onChange={e => setName(e.target.value)} />
      {err && <span className="lh-err" role="alert">{err}</span>}
      <div className="lh-menu-row">
        <Button variant="quiet" onClick={() => { setOpen(false); setErr(null); }}>Cancel</Button>
        <Button type="submit" variant="primary" icon="plus">Add gym</Button>
      </div>
    </form>
  );
}

export default function ManageSheet({
  lifts, counts, onClose, onAdd, onRename, onMove, onArchive, onDelete, onPerGym, onStep, onRest,
  gyms = [], gymCounts = new Map(), onAddGym, onRenameGym, onArchiveGym, onDeleteGym, focus = null,
}) {
  const [menu, setMenu] = useState(null);
  const [showArch, setShowArch] = useState(false);
  const [drag, setDrag] = useState(null);           // { id, dy }
  const active = lifts.filter(l => !l.archived);
  const archived = lifts.filter(l => l.archived);
  const liveGyms = gyms.filter(g => !g.archived);
  const archGyms = gyms.filter(g => g.archived);
  const menuLift = menu ? lifts.find(l => l.id === menu) : null;
  const ai = menuLift ? active.findIndex(l => l.id === menuLift.id) : -1;

  // Drag the handle: rows follow the finger; on release the lift moves by whole rows.
  const dragApi = {
    start: (e, id, index, total) => {
      e.preventDefault();
      const y0 = e.clientY;
      const el = e.currentTarget;
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      const li = el.closest('li');
      const h = (li && li.getBoundingClientRect().height + 1) || ROW_H;   // + the hairline
      const clamp = dy => Math.max(-index * h, Math.min((total - 1 - index) * h, dy));
      const mv = ev => setDrag({ id, dy: clamp(ev.clientY - y0) });
      const up = ev => {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        const steps = Math.round(clamp(ev.clientY - y0) / h);
        setDrag(null);
        if (steps) onMove(id, steps < 0 ? -1 : 1, Math.abs(steps));
      };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    },
  };
  const dragState = drag ? { ...dragApi, ...drag } : dragApi;

  return (
    <Sheet title="Manage lifts" eyebrow="// Lifts" onClose={onClose} width={480} className="lh-manage" testId="lh-manage-sheet">
      <section aria-labelledby="lh-m-h">
        <p className="lf-eyebrow" id="lh-m-h">// In use · {active.length}</p>
        <p className="lf-meta lh-mnote"><b>Per gym</b> compares a machine only with itself — DXC&apos;s stack with DXC&apos;s. <b>All gyms</b> keeps one record everywhere.</p>
        <ul className="lh-mlist">
          {active.map((l, i) => (
            <LiftRow key={l.id} lift={l} count={counts.get(l.id) || 0} index={i} total={active.length} gyms={gyms} focus={focus === l.id}
                     onRename={onRename} onPerGym={onPerGym} onMenu={x => setMenu(x.id)} drag={dragState} />
          ))}
        </ul>
        <AddLift onAdd={onAdd} />
      </section>

      {onAddGym && (
        <section className="lh-mgyms" aria-labelledby="lh-g-h">
          <p className="lf-eyebrow" id="lh-g-h">// Gyms · {liveGyms.length}</p>
          <p className="lf-meta lh-mnote">A gym with sets can be archived, not removed — its sets keep their gym.</p>
          <ul className="lh-mlist">
            {liveGyms.map(g => <GymRow key={g.id} gym={g} used={gymCounts.get(g.id) || 0} onRename={onRenameGym} onArchive={onArchiveGym} onDelete={onDeleteGym} />)}
          </ul>
          <AddGym onAddGym={onAddGym} />
        </section>
      )}

      {(archived.length > 0 || archGyms.length > 0) && (
        <section className="lh-march">
          <button type="button" className="lh-addrow" aria-expanded={showArch} onClick={() => setShowArch(v => !v)} data-testid="lh-arch-toggle">
            <Icon name={showArch ? 'chevron-down' : 'chevron-right'} size={16} /> Archived · {archived.length + archGyms.length}
          </button>
          {showArch && (
            <>
              {archived.length > 0 && (
                <ul className="lh-mlist">
                  {archived.map(l => (
                    <li key={l.id} className="lh-mrow is-arch">
                      <div className="lh-mrow-main"><span className="lh-mname-txt">{l.name}</span><span className="lh-mmeta">{LOAD_LABEL[l.load]} · {counts.get(l.id) || 0} sets · archived</span></div>
                      <Chip onClick={() => onArchive(l.id, false)} icon="rotate-ccw">Restore</Chip>
                    </li>
                  ))}
                </ul>
              )}
              {archGyms.length > 0 && (
                <ul className="lh-mlist">
                  {archGyms.map(g => (
                    <li key={g.id} className="lh-mrow is-arch">
                      <div className="lh-mrow-main"><span className="lh-mname-txt">{g.name}</span><span className="lh-mmeta">gym · {gymCounts.get(g.id) || 0} sets · archived</span></div>
                      <Chip onClick={() => onArchiveGym(g.id, false)} icon="rotate-ccw">Restore</Chip>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {menuLift && (
        <LiftMenu lift={menuLift} count={counts.get(menuLift.id) || 0} gyms={gyms} first={ai <= 0} last={ai < 0 || ai === active.length - 1}
                  onClose={() => setMenu(null)} onMove={onMove} onStep={onStep} onRest={onRest} onArchive={onArchive} onDelete={onDelete} />
      )}
    </Sheet>
  );
}
