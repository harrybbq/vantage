/**
 * Quick log — log one set, or edit one (brief §3.10; A8, A13).
 *
 *   // LIFTS · Log a set                                         [×]
 *   LIFT   [ Machine leg press ▾ ]   → a searchable list sheet (recent first)
 *          [Dip] [Lat pulldown] [Hip thrust]   three recent chips, no chip cloud
 *   GYM    [ DXC | Greenock ]  COMPARED WITHIN DXC
 *   [ KG ] [ REPS ] [ RPE ]     boxed cells: the live workout's NumPad on a
 *                               coarse pointer (docked in the footer), plain
 *                               inputs on a fine one
 *   DATE   [Today ▾]            Today · Yesterday · a small in-app month
 *                               sheet — never a native date input; nothing
 *                               after the calendar day (maxDate). "Today" is
 *                               the TRAINING day (after a night shift's midnight,
 *                               the shift's day — LiftsTab passes it)
 *   SET    [Normal | W | D | F]
 *   NOTE   one line that grows
 *   est. 1RM ~252 kg · ☾ Night shift · 80 % — a lighter set here isn't a regression
 *   [ Log set · ◆ PB ]          when the set would be a REAL PB (never a warm-up)
 *
 * Saving goes through LiftsTab (makeEntry / editEntry — an edit keeps the
 * set's id, createdAt, workout link and unknown keys). Validation is the
 * store's validateEntry; the first bad field takes focus.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import { Sheet, Button, Chip, Segmented, GymSwitch, CompareScope, NumPad, NightChip, useInputMode } from './ui';
import { validateEntry } from '../../../lib/lifts/store';
import { resolveLogDate, dateChipLabel, monthGrid, addMonths, agoShort } from '../../../lib/lifts/home';
import { padInput, padStep, fmtEstimate, realSetText } from '../../../lib/lifts/ui';
import {
  isNewPB, effectiveLoad, e1rmInfo, fmtKg, pbKinds, bannedRule, BANNED_NOTE, isIso, LOAD_LABEL, perGymOf, gymOf, stepFor, isWarmup, SET_TYPES, SET_TYPE_LABEL,
} from '../../../lib/lifts/lifts';

const ORDER = ['liftId', 'weight', 'reps', 'date', 'rpe', 'notes'];
const FIELDS = ['weight', 'reps', 'rpe'];
const TYPE_OPTS = [{ value: '', label: 'Normal' }, ...SET_TYPES.map(t => ({ value: t, label: t, title: SET_TYPE_LABEL[t] }))];

export default function LogSheet({
  entry, liftId, lifts, pickList, log, bwOf, today, maxDate = today, shiftOf, onClose, onSave, onDelete, gyms = [], gym: gym0 = null,
  gymName = id => id, onManage = null,
}) {
  const editing = !!(entry && entry.id);
  const { coarse } = useInputMode();
  // The last working set of a lift — at `gym` when the lift is a machine.
  const lastOf = (id, gym) => {
    const lift = lifts.find(l => l.id === id);
    const scoped = perGymOf(lift);
    let last = null;
    for (const e of log) {
      if (!e || e.liftId !== id || isWarmup(e) || (scoped && gymOf(e) !== (gym || null))) continue;
      if (!last || e.date > last.date || (e.date === last.date && (e.createdAt || 0) > (last.createdAt || 0))) last = e;
    }
    return last;
  };
  const [f, setF] = useState(() => {
    if (editing) {
      return { liftId: entry.liftId, weight: String(entry.weight), reps: String(entry.reps), date: entry.date, rpe: entry.rpe != null ? String(entry.rpe) : '',
        notes: entry.notes || '', gym: gymOf(entry), type: entry.type || '' };
    }
    const id = liftId || (pickList[0] && pickList[0].id) || '';
    const last = id ? lastOf(id, gym0) : null;
    return { liftId: id, weight: last ? String(last.weight) : '', reps: last ? String(last.reps) : '8', date: resolveLogDate('today', { today, maxDate }),
      rpe: '', notes: '', gym: gym0, type: '' };
  });
  const [errors, setErrors] = useState({});
  const [pad, setPad] = useState(null);          // { field, fresh } — coarse pointers only
  const [sub, setSub] = useState(null);          // 'lift' | 'date'
  const form = useRef(null);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const lift = lifts.find(l => l.id === f.liftId) || null;
  const perGym = perGymOf(lift);
  const step = lift ? stepFor(lift, f.gym) : 2.5;

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
  const recent = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const l of pickList) {
      if (out.length >= 3) break;
      if (l.id === f.liftId || seen.has(l.id)) continue;
      if (!log.some(e => e && e.liftId === l.id)) continue;
      seen.add(l.id); out.push(l);
    }
    return out;
  }, [pickList, log, f.liftId]);

  const draft = { id: editing ? entry.id : '__draft', liftId: f.liftId, date: f.date, weight: Number(f.weight), reps: Number(f.reps),
    ...(f.gym ? { gym: f.gym } : {}), ...(f.type ? { type: f.type } : {}) };
  const okNums = f.weight !== '' && Number.isFinite(draft.weight) && Number.isInteger(draft.reps) && draft.reps >= 1;
  const bw = lift && isIso(f.date) ? bwOf(f.date) : null;
  const load = okNums && lift ? effectiveLoad(draft, lift, bw && bw.kg) : null;
  const info = load != null && f.type !== 'W' ? e1rmInfo(load, draft.reps) : null;
  const pb = useMemo(() => (okNums && lift && isIso(f.date) && f.type !== 'W' ? isNewPB(log, draft, lift, { bwOf }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [okNums, lift, f.date, f.weight, f.reps, f.gym, f.type, log, bwOf]);
  const realPb = !!(pb && pb.any && !pb.first);
  const shift = isIso(f.date) ? shiftOf(f.date) : null;
  const banned = lift ? bannedRule(lift) : null;

  const submit = ev => {
    if (ev) ev.preventDefault();
    setPad(null);
    const v = validateEntry({ ...f, weight: f.weight === '' ? null : f.weight, reps: f.reps === '' ? null : f.reps }, maxDate);
    setErrors(v.errors);
    if (!v.ok) {
      const first = ORDER.find(k => v.errors[k]);
      const el = form.current && form.current.querySelector(`[data-field="${first}"]`);
      if (el) el.focus();
      return;
    }
    onSave({ ...f, type: f.type || null }, pb);
  };

  // ── The pad (coarse): keys into the field's buffer ──
  const padKey = k => setF(s => {
    const field = pad.field;
    const nb = padInput(s[field], k, { field, fresh: pad.fresh });
    if (pad.fresh) setPad(p => ({ ...p, fresh: false }));
    return nb == null ? s : { ...s, [field]: nb };
  });
  const padNext = () => {
    const i = FIELDS.indexOf(pad.field);
    if (i < FIELDS.length - 1) setPad({ field: FIELDS[i + 1], fresh: true }); else setPad(null);
  };
  // Esc closes the pad first (window capture runs before the sheet's document-capture Esc).
  useEffect(() => {
    if (!pad) return undefined;
    const k = e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); setPad(null); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [pad]);
  const lastSet = lift ? lastOf(lift.id, f.gym) : null;
  const unitLbl = lift && lift.load === 'per_hand' ? 'KG/hand' : lift && lift.load === 'bodyweight_plus' ? '+KG' : 'KG';
  const padEl = pad && (
    <NumPad field={pad.field} label={lift ? lift.name : 'Set'} fieldLabel={pad.field === 'weight' ? unitLbl : undefined}
            placeholder={pad.field === 'weight' && lift && lift.load === 'bodyweight_plus' ? '+0' : '—'}
            value={f[pad.field]} rpe={f.rpe} step={pad.field === 'weight' ? step : 1}
            onKey={padKey}
            onStep={dir => setF(s => ({ ...s, [pad.field]: padStep(s[pad.field], dir, pad.field === 'weight' ? step : 1, pad.field) }))}
            onRpe={n => { set('rpe', String(n)); setPad(null); }}
            onSet={v => { set(pad.field, String(v)); setPad(p => ({ ...p, fresh: false })); }}
            prevValue={lastSet ? (pad.field === 'weight' ? lastSet.weight : lastSet.reps) : null}
            prevText={lastSet ? realSetText(lastSet.weight, lastSet.reps, lift) : null}
            onNext={padNext} onDone={() => setPad(null)} onClose={() => setPad(null)} hasNext={pad.field !== 'rpe'} testId="lh-log-pad" />
  );

  const cell = (field, label, unit, err) => {
    const val = f[field];
    const id = `lh-log-${field}`;
    const active = pad && pad.field === field;
    return (
      <div className={`lh-cell${err ? ' has-error' : ''}${field === 'weight' ? ' is-kg' : ''}`}>
        <label className="lh-cell-lbl lf-eyebrow" htmlFor={id}>{label}</label>
        {coarse ? (
          <button id={id} type="button" data-field={field} className={`lh-cell-box lf-cellbox lf-st${active ? ' is-active' : ''}`}
                  onClick={() => setPad({ field, fresh: true })} aria-label={`${label}: ${val || 'empty'} — open the number pad`} data-testid={`lh-cell-${field}`}>
            <span className={`lf-num lh-cell-val${val === '' ? ' is-empty' : ''}`}>{val === '' ? (field === 'rpe' ? '—' : '—') : val}</span>
            {unit && <span className="lh-cell-unit">{unit}</span>}
          </button>
        ) : (
          <span className="lh-cell-box lf-cellbox">
            <input id={id} data-field={field} className="lf-num lh-cell-input" inputMode={field === 'reps' ? 'numeric' : 'decimal'} autoComplete="off"
                   value={val} placeholder={field === 'rpe' ? '—' : ''} data-testid={`lh-cell-${field}`}
                   onChange={e => set(field, field === 'reps' ? e.target.value.replace(/[^\d]/g, '') : e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))} />
            {unit && <span className="lh-cell-unit">{unit}</span>}
          </span>
        )}
        {err && <span className="lh-err" role="alert">{err}</span>}
      </div>
    );
  };

  const footer = padEl || (
    <div className="lh-log-foot">
      <Button type="submit" form="lh-log-form" variant="primary" size="lg" block data-testid="lh-log-save">
        {editing ? 'Save changes' : 'Log set'}{realPb && <span className="lh-pbtag"> · ◆ PB</span>}
      </Button>
      {editing && onDelete && (
        <Button variant="danger" icon="trash-2" onClick={() => onDelete(entry)} className="lh-log-del">Delete</Button>
      )}
    </div>
  );

  return (
    <Sheet title={editing ? 'Edit set' : 'Log a set'} eyebrow={editing ? `// ${lift ? lift.name : 'Set'}` : '// Lifts'} onClose={onClose}
           className="lh-logsheet" testId="lh-logsheet" width={440} footer={footer}>
      <form id="lh-log-form" ref={form} className="lh-form" onSubmit={submit} noValidate>
        <div className="lh-frow">
          <span className="lh-flbl lf-eyebrow" id="lh-log-lift-lbl">Lift</span>
          <button type="button" className="lh-picker lf-cellbox" data-field="liftId" onClick={() => setSub('lift')} aria-labelledby="lh-log-lift-lbl lh-log-lift-val"
                  data-testid="lh-log-lift">
            <span id="lh-log-lift-val" className="lh-picker-name">{lift ? lift.name : 'Pick a lift'}</span>
            <Icon name="chevron-down" size={16} />
          </button>
        </div>
        {!editing && recent.length > 0 && (
          <div className="lh-recent" role="group" aria-label="Recent lifts">
            {recent.map(l => <Chip key={l.id} onClick={() => pickLift(l.id)} className="lh-recent-chip">{l.name}</Chip>)}
          </div>
        )}
        {errors.liftId && <span className="lh-err" role="alert">{errors.liftId}</span>}
        {lift && lift.load !== 'weight' && (
          <p className="lf-meta">{LOAD_LABEL[lift.load]}{lift.load === 'bodyweight_plus' ? ' — log the added weight (0 for bodyweight)' : ' — the weight of ONE dumbbell'}</p>
        )}
        {banned && <p className="lf-meta lh-banned"><Icon name="octagon-alert" size={13} /> {BANNED_NOTE}</p>}

        {gyms.length > 0 && (
          <div className="lh-frow lh-gymrow">
            <span className="lh-flbl lf-eyebrow">Gym</span>
            <div className="lh-gymrow-ctl">
              <GymSwitch gyms={gyms} value={f.gym} onChange={pickGym} label="Gym this set was at" testId="lf-log-gym" />
              {lift && <CompareScope lift={lift} gymLabel={f.gym ? gymName(f.gym) : null} onManage={onManage ? () => { onClose(); onManage(); } : null} />}
            </div>
          </div>
        )}
        {!f.gym && gyms.length > 0 && <p className="lf-meta">No gym on this set — pick one to compare it with that gym.</p>}

        <div className="lh-cells">
          {cell('weight', lift && lift.load === 'per_hand' ? 'KG / hand' : lift && lift.load === 'bodyweight_plus' ? '+KG' : 'KG', null, errors.weight)}
          {cell('reps', 'Reps', null, errors.reps)}
          {cell('rpe', 'RPE', null, errors.rpe)}
        </div>

        <div className="lh-frow">
          <span className="lh-flbl lf-eyebrow" id="lh-log-date-lbl">Date</span>
          <div className="lh-datechips">
            <Chip selected onClick={() => setSub('date')} className="lh-datechip" data-field="date" data-testid="lh-log-date"
                  aria-label={`Date: ${dateChipLabel(f.date, today)} — change`}>
              {dateChipLabel(f.date, today)} ▾
            </Chip>
            {f.date !== today && <Chip onClick={() => set('date', resolveLogDate('today', { today, maxDate }))}>Today</Chip>}
            {f.date === today && <Chip onClick={() => set('date', resolveLogDate('yesterday', { today, maxDate }))}>Yesterday</Chip>}
          </div>
        </div>
        {errors.date && <span className="lh-err" role="alert">{errors.date}</span>}

        <div className="lh-frow">
          <span className="lh-flbl lf-eyebrow" id="lh-log-type-lbl">Set</span>
          <Segmented label="Set type" size="sm" options={TYPE_OPTS} value={f.type || ''} onChange={v => set('type', v)} testId="lh-log-type" />
        </div>
        {f.type === 'W' && <p className="lf-meta">Warm-ups are saved and count for volume, never for PBs or the chart.</p>}

        <div className="lh-frow lh-noterow">
          <label className="lh-flbl lf-eyebrow" htmlFor="lh-log-note">Note</label>
          <textarea id="lh-log-note" data-field="notes" rows={1} maxLength={500} value={f.notes} placeholder="Seat 5, paused reps…" className="lh-note lf-cellbox"
                    onChange={e => { set('notes', e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`; }} />
        </div>
        {errors.notes && <span className="lh-err" role="alert">{errors.notes}</span>}

        <div className={`lh-liveline${realPb ? ' is-pb' : ''}`} aria-live="polite" data-testid="lift-live">
          <span className="lh-muted lf-num">{info ? fmtEstimate(info.value, { low: info.low }) : f.type === 'W' ? 'warm-up — no estimate' : 'est. 1RM —'}</span>
          {shift === 'night' && <span className="lh-liveline-night"> · <NightChip variant="inline" label="Night shift · 80 %" /> — a lighter set here isn’t a regression</span>}
          {lift && lift.load === 'bodyweight_plus' && (
            <span className="lf-meta lh-liveline-sub">{bw ? `Bodyweight ${fmtKg(bw.kg)} kg (${bw.date})${load != null ? ` · total ${fmtKg(load)} kg` : ''}` : 'No bodyweight within 14 days — the estimate needs one.'}</span>
          )}
          {realPb && <span className="lh-liveline-pb">◆ This would be a PB{perGym && f.gym ? ` at ${gymName(f.gym)}` : ''} — {pbKinds(pb).join(' · ')}</span>}
          {pb && pb.first && <span className="lf-meta lh-liveline-sub">{perGym && f.gym ? `First set of this lift at ${gymName(f.gym)} — it sets the baseline there.` : 'First set of this lift — it sets the baseline.'}</span>}
        </div>
      </form>
      {sub === 'lift' && (
        <LiftPicker list={pickList} current={editing && lift && !pickList.some(l => l.id === lift.id) ? [lift, ...pickList] : pickList} log={log} today={today}
                    value={f.liftId} onPick={id => { pickLift(id); setSub(null); }} onClose={() => setSub(null)} />
      )}
      {sub === 'date' && (
        <DateSheet value={f.date} today={today} maxDate={maxDate} onPick={iso => { set('date', iso); setSub(null); }} onClose={() => setSub(null)} />
      )}
    </Sheet>
  );
}

/** The searchable lift list (recent first). */
function LiftPicker({ current, log, today, value, onPick, onClose }) {
  const [q, setQ] = useState('');
  const lastBy = useMemo(() => {
    const m = new Map();
    for (const e of log) if (e && e.liftId && !isWarmup(e) && (!m.has(e.liftId) || e.date > m.get(e.liftId).date)) m.set(e.liftId, e);
    return m;
  }, [log]);
  const shown = current.filter(l => !q.trim() || l.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet title="Pick a lift" eyebrow="// Log a set" onClose={onClose} testId="lh-liftpicker" initialFocus="input">
      <div className="lh-search">
        <Icon name="search" size={16} />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search lifts" aria-label="Search lifts" data-testid="lh-liftpicker-q" />
      </div>
      <ul className="lh-picklist">
        {shown.map(l => {
          const last = lastBy.get(l.id);
          return (
            <li key={l.id}>
              <button type="button" className={`lh-pickrow${l.id === value ? ' is-on' : ''}`} onClick={() => onPick(l.id)} aria-pressed={l.id === value}>
                <span className="lh-pickrow-name">{l.name}</span>
                <span className="lh-pickrow-meta lf-num">{LOAD_LABEL[l.load] || 'Weight'}{last ? ` · ${agoShort(last.date, today)} · ${realSetText(last.weight, last.reps, l)}` : ' · not logged yet'}</span>
                {l.id === value && <Icon name="check" size={18} />}
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="lf-meta">No lift called “{q}”. Add it in Manage lifts.</li>}
      </ul>
    </Sheet>
  );
}

/** Today · Yesterday · a month grid. Nothing after maxDate (the calendar day). */
function DateSheet({ value, today, maxDate, onPick, onClose }) {
  const [ym, setYm] = useState((isIso(value) ? value : today).slice(0, 7));
  const g = monthGrid(ym, { maxDate, today });
  const maxYm = (maxDate || today).slice(0, 7);
  return (
    <Sheet title="When was this set?" eyebrow="// Date" onClose={onClose} testId="lh-datesheet">
      <div className="lh-datequick">
        <Chip selected={value === today} onClick={() => onPick(resolveLogDate('today', { today, maxDate }))}>Today · {dateChipLabel(today, '')}</Chip>
        <Chip selected={value === resolveLogDate('yesterday', { today, maxDate })} onClick={() => onPick(resolveLogDate('yesterday', { today, maxDate }))}>Yesterday</Chip>
      </div>
      <div className="lh-month-nav">
        <button type="button" className="lf-iconbtn" onClick={() => setYm(addMonths(ym, -1))} aria-label="Previous month"><Icon name="chevron-left" size={18} /></button>
        <b className="lh-month-title">{g.label}</b>
        <button type="button" className="lf-iconbtn" onClick={() => setYm(addMonths(ym, 1))} aria-label="Next month" disabled={ym >= maxYm}><Icon name="chevron-right" size={18} /></button>
      </div>
      <div className="lh-cal" role="grid" aria-label={g.label}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="lh-cal-dow" aria-hidden="true">{d}</span>)}
        {g.weeks.flat().map(d => (
          <button key={d.iso} type="button" className={`lh-cal-d${d.inMonth ? '' : ' is-out'}${d.today ? ' is-today' : ''}${d.iso === value ? ' is-on' : ''}`}
                  disabled={d.disabled} onClick={() => onPick(d.iso)} aria-label={dateChipLabel(d.iso, '')} aria-pressed={d.iso === value}>
            {d.day}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
