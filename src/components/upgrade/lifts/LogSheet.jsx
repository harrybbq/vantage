/**
 * Log a set (or edit one) in Upgrade's side sheet — a bottom sheet on a
 * phone, height-capped with its own scroll so the backdrop stays tappable.
 *
 * Lift picker (most recently logged first), weight with ± steppers
 * (2.5 kg; 1 kg for a per-dumbbell lift), reps stepper, date (today),
 * optional RPE and note. Before saving it shows the estimated 1RM live
 * (labelled as an estimate) and whether this set would be a REAL-set PB
 * (heaviest or a rep max), judged by the same isNewPB the save uses. Validation is the store's validateEntry, shown under each field;
 * the first bad field takes focus.
 *
 * Gym: a switch (default: the last gym). For a machine (perGym) lift the
 * pre-fill and the PB hint are that gym's; a set being edited keeps its
 * gym (an unassigned one shows none picked until one is chosen).
 */
import { useMemo, useRef, useState } from 'react';
import { Sheet } from '../security/parts';
import Icon from '../../Icon';
import { Field, Stepper, GymSwitch } from './parts';
import { validateEntry } from '../../../lib/lifts/store';
import {
  isNewPB, effectiveLoad, e1rmInfo, fmtE1rm, fmtKg, pbKinds, bannedRule, BANNED_NOTE, isIso, LOAD_LABEL, perGymOf, gymOf,
} from '../../../lib/lifts/lifts';

const ORDER = ['liftId', 'weight', 'reps', 'date', 'rpe', 'notes'];
const RPES = ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'];

export default function LogSheet({ entry, liftId, lifts, pickList, log, bwOf, today, shiftOf, onClose, onSave, onDelete, gyms = [], gym: gym0 = null, gymName = id => id }) {
  const editing = !!(entry && entry.id);
  // The last set of a lift — at `gym` when the lift is a machine.
  const lastOf = (id, gym) => {
    const lift = lifts.find(l => l.id === id);
    const scoped = perGymOf(lift);
    let last = null;
    for (const e of log) {
      if (!e || e.liftId !== id || (scoped && gymOf(e) !== (gym || null))) continue;
      if (!last || e.date > last.date || (e.date === last.date && (e.createdAt || 0) > (last.createdAt || 0))) last = e;
    }
    return last;
  };
  const [f, setF] = useState(() => {
    if (editing) return { liftId: entry.liftId, weight: String(entry.weight), reps: String(entry.reps), date: entry.date, rpe: entry.rpe != null ? String(entry.rpe) : '', notes: entry.notes || '', gym: gymOf(entry) };
    const id = liftId || (pickList[0] && pickList[0].id) || '';
    const last = id ? lastOf(id, gym0) : null;
    return { liftId: id, weight: last ? String(last.weight) : '', reps: last ? String(last.reps) : '8', date: today, rpe: '', notes: '', gym: gym0 };
  });
  const [errors, setErrors] = useState({});
  const form = useRef(null);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const lift = lifts.find(l => l.id === f.liftId) || null;
  const step = lift && lift.load === 'per_hand' ? 1 : 2.5;

  // Picking another lift (or, for a machine, another gym) pre-fills its last set there (new sets only).
  const pickLift = id => {
    if (editing) { set('liftId', id); return; }
    const last = lastOf(id, f.gym);
    setF(s => ({ ...s, liftId: id, weight: last ? String(last.weight) : s.weight, reps: last ? String(last.reps) : s.reps }));
  };
  const pickGym = g => {
    if (editing || !perGymOf(lift)) { set('gym', g); return; }
    const last = lastOf(f.liftId, g);
    setF(s => ({ ...s, gym: g, weight: last ? String(last.weight) : '', reps: last ? String(last.reps) : s.reps }));
  };
  const perGym = perGymOf(lift);

  const draft = { id: editing ? entry.id : '__draft', liftId: f.liftId, date: f.date, weight: Number(f.weight), reps: Number(f.reps), ...(f.gym ? { gym: f.gym } : {}) };
  const okNums = f.weight !== '' && Number.isFinite(draft.weight) && Number.isInteger(draft.reps) && draft.reps >= 1;
  const bw = lift && isIso(f.date) ? bwOf(f.date) : null;
  const load = okNums && lift ? effectiveLoad(draft, lift, bw && bw.kg) : null;
  const info = load != null ? e1rmInfo(load, draft.reps) : null;
  const pb = useMemo(() => (okNums && lift && isIso(f.date) ? isNewPB(log, draft, lift, { bwOf }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [okNums, lift, f.date, f.weight, f.reps, f.gym, log, bwOf]);
  const shift = isIso(f.date) ? shiftOf(f.date) : null;
  const banned = lift ? bannedRule(lift) : null;

  const submit = ev => {
    ev.preventDefault();
    const v = validateEntry({ ...f, weight: f.weight === '' ? null : f.weight, reps: f.reps === '' ? null : f.reps }, today);
    setErrors(v.errors);
    if (!v.ok) {
      const first = ORDER.find(k => v.errors[k]);
      const el = form.current && form.current.querySelector(`[data-field="${first}"]`);
      if (el) el.focus();
      return;
    }
    onSave(f, pb);
  };

  const id = k => `lf-s-${k}`;
  return (
    <Sheet title={editing ? 'Edit set' : 'Log a set'} eyebrow={editing ? `// ${lift ? lift.name : 'Set'}` : '// Lifts'} onClose={onClose} className="lifts">
      <form ref={form} className="lf-form" onSubmit={submit} noValidate>
        <div className="lf-field is-wide">
          <span className="lf-field-lbl" id={id('lift-lbl')}>Lift{!editing && pickList.length > 1 ? ' · recent first' : ''}</span>
          <div className="lf-picks" role="radiogroup" aria-labelledby={id('lift-lbl')}>
            {(editing && lift && !pickList.some(l => l.id === lift.id) ? [lift, ...pickList] : pickList).map((l, i) => (
              <button key={l.id} type="button" role="radio" aria-checked={f.liftId === l.id}
                      data-field={(f.liftId ? f.liftId === l.id : i === 0) ? 'liftId' : undefined}
                      className={`lf-pick${f.liftId === l.id ? ' is-on' : ''}`} onClick={() => pickLift(l.id)}>
                {l.name}
              </button>
            ))}
          </div>
          {errors.liftId && <span className="lf-field-err" role="alert">{errors.liftId}</span>}
          {lift && lift.load !== 'weight' && (
            <span className="lf-field-hint">{LOAD_LABEL[lift.load]}{lift.load === 'bodyweight_plus' ? ' — log the added weight (0 for bodyweight)' : ' — the weight of ONE dumbbell'}</span>
          )}
          {banned && <span className="lf-banned"><Icon name="octagon-alert" size={13} /> {BANNED_NOTE}</span>}
        </div>

        {gyms.length > 0 && (
          <div className="lf-field is-wide">
            <span className="lf-field-lbl" id={id('gym-lbl')}>Gym</span>
            <GymSwitch gyms={gyms} value={f.gym} onChange={pickGym} label="Gym this set was at" testId="lf-log-gym" />
            <span className="lf-field-hint">
              {!f.gym ? 'No gym on this set — pick one to compare it with that gym.'
                : perGym ? `A machine — compared with your sets at ${gymName(f.gym)} only.` : 'Free weight — compared across every gym.'}
            </span>
          </div>
        )}

        <div className="lf-grid">
          <Field as="div" label={lift && lift.load === 'bodyweight_plus' ? 'Added weight' : lift && lift.load === 'per_hand' ? 'Per dumbbell' : 'Weight'} id={id('w')} error={errors.weight}>
            <Stepper id={id('w')} label="Weight" value={f.weight} onChange={v => set('weight', v)} step={step} min={0} max={1000} decimal unit="kg" dataField="weight" />
          </Field>
          <Field as="div" label="Reps" id={id('r')} error={errors.reps}>
            <Stepper id={id('r')} label="Reps" value={f.reps} onChange={v => set('reps', v.replace(/[^\d]/g, ''))} step={1} min={1} max={50} dataField="reps" />
          </Field>
          <Field label="Date" id={id('d')} error={errors.date}>
            <input id={id('d')} data-field="date" type="date" max={today} value={f.date} onChange={e => set('date', e.target.value)} />
          </Field>
          <Field label="RPE (optional)" id={id('rpe')} error={errors.rpe}>
            <select id={id('rpe')} data-field="rpe" value={f.rpe} onChange={e => set('rpe', e.target.value)}>
              <option value="">—</option>
              {RPES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Note (optional)" id={id('n')} error={errors.notes} wide>
            <textarea id={id('n')} data-field="notes" rows={2} maxLength={500} value={f.notes} placeholder="Seat 5, paused reps, felt strong…"
                      onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>

        <div className={`lf-live${pb && pb.any ? ' is-pb' : ''}`} aria-live="polite" data-testid="lift-live">
          <div className="lf-live-row">
            <span className="lf-live-lbl">Est. 1RM</span>
            <b className="lf-live-val">{info ? `${info.low ? '≈' : '~'}${fmtE1rm(info.value)} kg` : '—'}</b>
            {info && <span className="lf-live-note">an estimate, not a PB</span>}
            {info && info.low && <span className="lf-tag">low confidence · over 12 reps</span>}
          </div>
          {lift && lift.load === 'bodyweight_plus' && (
            <p className="lf-live-sub">
              {bw ? `Bodyweight ${fmtKg(bw.kg)} kg (${bw.date})${load != null ? ` · total ${fmtKg(load)} kg` : ''}` : 'No bodyweight within 14 days — the estimate needs one. The set still counts for heaviest and rep maxes (on added weight).'}
            </p>
          )}
          {pb && pb.any && <p className="lf-live-pb"><Icon name="trophy" size={14} /> This would be a PB{perGym && f.gym ? ` at ${gymName(f.gym)}` : ''} — {pbKinds(pb).join(' · ')}</p>}
          {pb && pb.first && <p className="lf-live-sub">{perGym && f.gym ? `First set of this lift at ${gymName(f.gym)} — it sets the baseline there.` : 'First set of this lift — it sets the baseline.'}</p>}
          {shift === 'night' && <p className="lf-live-sub lf-night"><Icon name="moon" size={13} /> Night shift · 80% load — a lighter set here isn’t a regression.</p>}
        </div>

        <div className="lf-form-acts">
          <button type="submit" className="sec-btn is-primary lf-btn-lg">{editing ? 'Save changes' : 'Log set'}</button>
          <button type="button" className="sec-btn is-quiet lf-btn-lg" onClick={onClose}>Cancel</button>
          {editing && onDelete && (
            <button type="button" className="sec-btn is-bad lf-btn-lg lf-del" onClick={() => onDelete(entry)}>
              <Icon name="trash-2" size={14} /> Delete
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
