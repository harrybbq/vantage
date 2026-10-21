/**
 * The live workout's sheets (all on the shared Sheet: Esc + ✕ + a
 * tappable backdrop, ≤ 88 vh with internal scroll):
 *
 *   SetMenu       the set number's menu (§3.5.2) — Warm-up (W) · Drop (D) ·
 *                 Failure (F) · Normal · ─ · Delete set. The tap alternative
 *                 to swipe. W never counts for PBs, rep maxes, e1RM or the
 *                 chart (it still counts for volume and is saved).
 *   ExerciseMenu  ⋯ on an exercise (§3.5.3) — Swap ›, Add note ›, View
 *                 history › (a sheet OVER the workout), the read-only
 *                 CompareScope line with "Change in Manage lifts ›", and
 *                 Remove (danger, 12 px gap, Undo 5 s). A lift not created
 *                 yet (pending) can't have history — says why.
 *   WorkoutMenu   the header ⋯ (§3.5.7) — rename, night flag, gym, and
 *                 Discard with the two-step confirm. (The rest timer and its
 *                 settings were removed on 2026-10-21.)
 *   GymSheet      which gym — before any set is ticked a tap just switches;
 *                 with done sets it asks first (they're saved under it).
 */
import { useState } from 'react';
import Icon from '../../../Icon';
import { Sheet, Button, GymSwitch, CompareScope } from '../ui';

function MenuRow({ icon, children, sub, onClick, disabled, testId, right = 'chevron-right' }) {
  return (
    <li>
      <button type="button" className="lw-mrow" onClick={onClick} disabled={disabled} data-testid={testId}>
        <Icon name={icon} size={18} />
        <span className="lw-mrow-txt">{children}{sub && <small>{sub}</small>}</span>
        {right && <Icon name={right} size={16} />}
      </button>
    </li>
  );
}

export function SetMenu({ si, set, liftName, onType, onDelete, onClose }) {
  const cur = set && set.type ? set.type : null;
  const opts = [['W', 'Warm-up'], ['D', 'Drop set'], ['F', 'Failure'], [null, 'Normal']];
  return (
    <Sheet title={`Set ${si + 1}`} eyebrow={`// ${liftName}`} onClose={onClose} testId="lw-setmenu" width={440}>
      <ul className="lw-menu" role="radiogroup" aria-label="Set type">
        {opts.map(([t, label]) => (
          <li key={label}>
            <button type="button" role="radio" aria-checked={cur === t} className={`lw-mrow${cur === t ? ' is-on' : ''}`} onClick={() => onType(t)} data-testid={`lw-type-${t || 'N'}`}>
              <span className="lw-typebadge" aria-hidden="true">{t || si + 1}</span>
              <span className="lw-mrow-txt">{label}{t === 'W' && <small>Saved and counted for volume — never a PB, rep max or estimate.</small>}</span>
              {cur === t && <Icon name="check" size={18} />}
            </button>
          </li>
        ))}
      </ul>
      <div className="lw-menu-danger">
        <Button variant="danger" icon="trash-2" onClick={onDelete} data-testid="lw-set-delete">Delete set</Button>
      </div>
    </Sheet>
  );
}

export function ExerciseMenu({ ex, lift, gymLabel, onSwap, onNote, onHistory, onManage, onRemove, onClose }) {
  const pending = !!(lift && lift.pending);
  const name = lift ? lift.name : 'Exercise';
  return (
    <Sheet title={name} eyebrow="// Exercise" onClose={onClose} testId="lw-exmenu" width={460}>
      <ul className="lw-menu">
        <MenuRow icon="repeat" onClick={onSwap} testId="lw-m-swap">Swap exercise</MenuRow>
        <MenuRow icon="notebook-pen" onClick={onNote} testId="lw-m-note">{ex.note ? 'Edit note' : 'Add note'}</MenuRow>
        <MenuRow icon="chart-column" onClick={onHistory} disabled={pending} testId="lw-m-history"
                 sub={pending ? 'History opens once its first set is ticked — the lift is created then.' : 'Opens over the workout'}>View history</MenuRow>
      </ul>
      {lift && (
        <div className="lw-menu-sec">
          <CompareScope lift={lift} gymLabel={gymLabel} onManage={pending ? null : onManage} />
          {!pending && onManage && (
            <Button variant="quiet" iconRight="chevron-right" onClick={() => onManage(lift)} className="lw-m-manage">Change in Manage lifts</Button>
          )}
        </div>
      )}
      <div className="lw-menu-danger">
        <Button variant="danger" icon="trash-2" onClick={onRemove} data-testid="lw-m-remove">Remove from workout</Button>
      </div>
    </Sheet>
  );
}

export function WorkoutMenu({ active, gymLabel, onRename, onNight, onGym, onDiscard, onClose }) {
  const [name, setName] = useState(active.name);
  const [asking, setAsking] = useState(false);
  const night = active.shift === 'night';
  return (
    <Sheet title="Workout" eyebrow={`// ${active.name}`} onClose={onClose} testId="lw-wkmenu" width={480}>
      <div className="lw-menu-sec">
        <label className="lw-field" htmlFor="lw-wk-name">
          <span className="lf-eyebrow">Name</span>
          <input id="lw-wk-name" className="lf-cellbox lw-input" value={name} maxLength={60} onChange={e => setName(e.target.value)}
                 onBlur={() => onRename(name)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} data-testid="lw-wk-name" />
        </label>
      </div>
      <ul className="lw-menu">
        <li>
          <label className="lw-switch">
            <span className="lw-switch-text"><b>☾ Night session · 80 %</b><span>Previous and targets come from your last night session (else day × 0.8).</span></span>
            <input type="checkbox" role="switch" checked={night} onChange={e => onNight(e.target.checked)} data-testid="lw-wk-night" />
            <span className="lw-switch-ui" aria-hidden="true" />
          </label>
        </li>
        <MenuRow icon="locate-fixed" onClick={onGym} testId="lw-wk-gym" sub={gymLabel ? `Training at ${gymLabel}` : 'No gym set'}>Gym</MenuRow>
      </ul>
      <div className="lw-menu-danger">
        {asking ? (
          <div className="lw-confirm" role="alert">
            <p className="lf-meta">Throw this workout away? Nothing from it is saved.</p>
            <div className="lw-confirm-acts">
              <Button variant="danger" onClick={onDiscard} data-testid="lw-wk-discard-yes">Discard workout</Button>
              <Button variant="secondary" onClick={() => setAsking(false)}>Keep it</Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" icon="trash-2" onClick={() => setAsking(true)} data-testid="lw-wk-discard">Discard workout…</Button>
        )}
      </div>
    </Sheet>
  );
}

export function GymSheet({ gyms, gymNow, doneN, gymName, onMove, onClose }) {
  const [pick, setPick] = useState(null);
  const footer = pick && pick !== gymNow ? (
    <>
      <Button variant="secondary" size="lg" onClick={() => setPick(null)}>Keep {gymNow ? gymName(gymNow) : 'as is'}</Button>
      <Button variant="primary" size="lg" onClick={() => onMove(pick)} data-testid="lw-gym-confirm">Move to {gymName(pick)}</Button>
    </>
  ) : null;
  return (
    <Sheet title="Which gym?" eyebrow="// Workout" onClose={onClose} footer={footer} testId="lw-gym" width={440}>
      <div className="lw-menu-sec">
        <GymSwitch gyms={gyms} value={pick || gymNow} label="Gym for this workout" testId="lw-gym-switch" onChange={id => (doneN && id !== gymNow ? setPick(id) : onMove(id))} />
        <p className="lf-meta">Machines compare within one gym: Previous and the targets come from there.</p>
        {pick && pick !== gymNow && (
          <p className="lw-gymwarn" role="alert">{doneN} done {doneN === 1 ? 'set' : 'sets'} will be saved under <b>{gymName(pick)}</b> instead of {gymNow ? gymName(gymNow) : 'no gym'}.</p>
        )}
      </div>
    </Sheet>
  );
}
