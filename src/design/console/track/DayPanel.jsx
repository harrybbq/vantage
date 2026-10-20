/**
 * The selected day: what is on it, then the trackers ready to tick.
 *
 * Phones show it under the month; wide screens in the right column
 * ("Today" when the day is today). Events come through eventsOn (trips
 * and multi-day events merged in by lib/calendar), the trips' itinerary
 * items for the day, the day's subscription renewals, and — owner only,
 * already gated by the caller — the rota shift.
 *
 * Ticking writes through applyTick (tick.js), the composition of the
 * same library calls classic QuickLog/TrackSection make: log cell,
 * markManual, streaks, the symmetric weekly coin award. Toasts and
 * confetti fire exactly as classic fires them.
 */
import { useMemo, useState } from 'react';
import { eventColour, eventWhen, eventsOn } from '../../../lib/calendar/events';
import { trackerDone, trackerProgress, trackerStep, dailyGoalOf, fmtTrackerValue } from '../../../lib/trackers/done';
import { sourceById, isAutoFilled, autoProvenance } from '../../../lib/trackers/autoLog';
import { countWeekLogs, getTodayStr } from '../../../utils/helpers';
import { fireGoal, fireStreak7, fireStreak30 } from '../../../utils/confetti';
import { Checkbox, Button } from '../ui';
import { applyTick, tapValue } from './tick';
import { itineraryOn, billsInRange, money, trackerCompletion } from './model';
import TIcon from './icons';

const ITEM_ICON = { travel: 'plane', stay: 'bed', food: 'utensils', activity: 'ticket', other: 'circle-dot' };
const longDate = iso => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = iso => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** Fire a tick's effects the way classic QuickLog does. */
export function fireTickEffects(effects, onShowCoinToast) {
  for (const e of effects) {
    if (e.type === 'award') {
      onShowCoinToast?.('+' + e.amount + ' ⬡ — ' + e.tracker.name + ' weekly goal!', true);
      fireGoal();
    } else if (e.type === 'streak7') {
      fireStreak7();
      onShowCoinToast?.(`🔥 7 day streak on ${e.tracker.name}!`, true);
    } else if (e.type === 'streak30') {
      fireStreak30();
      onShowCoinToast?.('🔥 30 day streak — incredible consistency!', true);
    }
  }
}

function Ring({ pct, colour }) {
  const R = 8, C = 2 * Math.PI * R;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r={R} fill="none" stroke="var(--cx-track)" strokeWidth="2.5" />
      {pct > 0 && (
        <circle cx="10" cy="10" r={R} fill="none" stroke={colour} strokeWidth="2.5" strokeLinecap="round"
                strokeDasharray={`${(Math.min(1, pct) * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 10 10)" />
      )}
    </svg>
  );
}

function NumberEdit({ tracker, value, onSave, onCancel }) {
  const [v, setV] = useState(value ? String(value) : '');
  const num = s => { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
  return (
    <form className="cx-track-numedit" onSubmit={e => { e.preventDefault(); onSave(num(v)); }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <label className="cx-track-sr" htmlFor={`num-${tracker.id}`}>{tracker.name}{tracker.unit ? ` (${tracker.unit})` : ''}</label>
      <input id={`num-${tracker.id}`} className="cx-input cx-num" type="text" inputMode="decimal" autoFocus value={v} placeholder="0"
             onChange={e => setV(e.target.value)} onFocus={e => e.target.select()} />
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      <Button variant="primary" type="submit">Save</Button>
    </form>
  );
}

function TrackerRow({ S, t, iso, onSet }) {
  const [editing, setEditing] = useState(false);
  const v = ((S.logs || {})[iso] || {})[t.id];
  const done = trackerDone(t, v);
  const auto = isAutoFilled(S, iso, t.id) ? autoProvenance(S, iso, t.id) : null;
  const week = t.weeklyTarget ? countWeekLogs(S.logs || {}, t.id, iso, t) : null;
  const colour = t.color || 'var(--cx-accent)';
  if (t.type === 'boolean') {
    return (
      <div className="cx-track-tr">
        <Checkbox checked={v === true} onChange={next => onSet(t, next)} label={t.name} />
        <span className="cx-track-tr-n" onClick={() => onSet(t, v !== true)}>{t.name}</span>
        {auto && <span className="cx-track-auto" title={`${auto.text}. Change it and it stays yours.`}>Auto</span>}
        <span className="cx-track-tr-v cx-num">{week != null ? `${week}/${t.weeklyTarget} wk` : ''}</span>
      </div>
    );
  }
  const num = typeof v === 'number' ? v : 0;
  const goal = dailyGoalOf(t);
  const step = trackerStep(t, sourceById(t.auto?.source)?.step);
  return (
    <div className={`cx-track-tr is-num${editing ? ' is-editing' : ''}`}>
      <button type="button" className="cx-track-ring" onClick={() => onSet(t, tapValue(t, v, step))}
              aria-label={`${t.name}: add ${fmtTrackerValue(step)}${t.unit ? ' ' + t.unit : ''}`}>
        {done ? <span className="cx-track-ring-done" style={{ background: colour }}><TIcon name="check" size={13} strokeWidth={2.5} /></span>
          : <Ring pct={trackerProgress(t, num)} colour={colour} />}
      </button>
      <span className="cx-track-tr-n">{t.name}</span>
      {auto && <span className="cx-track-auto" title={`${auto.text}. Change it and it stays yours.`}>Auto</span>}
      <button type="button" className="cx-track-tr-v cx-track-tr-edit cx-num" onClick={() => setEditing(e => !e)} aria-expanded={editing}
              aria-label={`${t.name}: ${fmtTrackerValue(num)}${goal ? ` of ${fmtTrackerValue(goal)}` : ''}. Type an amount`}>
        {t.unit === '£'
          ? `£${fmtTrackerValue(num)}${goal ? ` / £${fmtTrackerValue(goal)}` : ''}`
          : `${fmtTrackerValue(num)}${goal ? ` / ${fmtTrackerValue(goal)}` : ''}${t.unit && t.unit.length <= 3 ? ` ${t.unit}` : ''}`}
      </button>
      {editing && (
        <NumberEdit tracker={t} value={num} onCancel={() => setEditing(false)}
                    onSave={n => { if (n !== num) onSet(t, n); setEditing(false); }} />
      )}
    </div>
  );
}

export default function DayPanel({
  S, iso, today, update, onShowCoinToast, onOpenTrip, onEditEvent, onAdd, onManage, shift, compact, wide,
}) {
  const [all, setAll] = useState(false);
  const evs = useMemo(() => eventsOn(S, iso), [S, iso]);
  const items = useMemo(() => itineraryOn(S, iso), [S, iso]);
  const bills = useMemo(() => billsInRange(S, iso, iso)[iso] || [], [S, iso]);
  const trackers = S.trackers || [];
  const comp = trackerCompletion(S, iso);
  const limit = compact && !all ? 5 : trackers.length;

  function setValue(t, value) {
    update(prev => {
      const r = applyTick(prev, { day: iso, trackerId: t.id, value, today: getTodayStr() });
      fireTickEffects(r.effects, onShowCoinToast);
      return r.next;
    });
  }

  const isToday = iso === today;
  const empty = !evs.length && !items.length && !bills.length && !shift;

  return (
    <section className="cx-panel cx-track-day" aria-label={`${longDate(iso)}`}>
      <header className="cx-track-day-head">
        {wide && isToday
          ? <h2 className="cx-track-day-t">Today <span className="cx-track-day-sub">{shortDate(iso)}</span></h2>
          : <h2 className="cx-track-day-t">{longDate(iso)}</h2>}
        <span className="cx-track-day-meta cx-num">{comp.total ? `${comp.done} of ${comp.total} done` : ''}</span>
        <Button variant="ghost" iconOnly icon="plus" label={`Add to ${shortDate(iso)}`} onClick={() => onAdd(iso)} />
      </header>

      <div className="cx-track-agenda">
        {shift && (
          <div className={`cx-track-ar is-shift is-${shift.shift}`}>
            <span className="cx-track-kbar" style={{ '--k': 'var(--cx-night)' }} />
            <span className="cx-track-ar-tm cx-num">{shift.chip || ''}</span>
            <span className="cx-track-ar-t">{shift.label}</span>
          </div>
        )}
        {evs.map(ev => {
          const trip = ev.source === 'holiday';
          const span = ev.source === 'span';
          return (
            <button key={ev.id} type="button" className="cx-track-ar"
                    onClick={() => (trip ? onOpenTrip(ev.tripId) : onEditEvent(ev, iso))}>
              <span className="cx-track-kbar" style={{ '--k': eventColour(ev) }} />
              <span className="cx-track-ar-tm cx-num">{trip || span ? '' : (ev.time || '')}</span>
              <span className="cx-track-ar-main">
                <span className="cx-track-ar-t">{ev.title}</span>
                {(trip || span || ev.location || ev.end) && (
                  <span className="cx-track-ar-s">
                    {trip || span ? ev.span : [ev.end ? eventWhen(ev) : '', ev.location].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <TIcon name={trip ? 'plane' : span ? 'calendar-days' : (ev.kind === 'training' ? 'dumbbell' : 'clock')} size={16} className="cx-track-ar-i" />
            </button>
          );
        })}
        {items.map(it => (
          <button key={it.trip.id + it.id} type="button" className="cx-track-ar is-itin" onClick={() => onOpenTrip(it.trip.id)}>
            <span className="cx-track-kbar" style={{ '--k': 'var(--cx-mid)' }} />
            <span className="cx-track-ar-tm cx-num">{it.time || ''}</span>
            <span className="cx-track-ar-main">
              <span className="cx-track-ar-t">{it.title || it.note}</span>
              <span className="cx-track-ar-s">{it.trip.dest}{it.title && it.note ? ` · ${it.note}` : ''}</span>
            </span>
            <TIcon name={ITEM_ICON[it.kind] || 'circle-dot'} size={16} className="cx-track-ar-i" />
          </button>
        ))}
        {bills.map(b => (
          <div key={b.id} className="cx-track-ar is-bill">
            <span className="cx-track-kbar" style={{ '--k': 'var(--cx-muted)' }} />
            <span className="cx-track-ar-tm cx-num">{money(b.amount)}</span>
            <span className="cx-track-ar-t">{b.name} renews</span>
          </div>
        ))}
        {empty && <p className="cx-track-empty">Nothing on. Add an event, a multi-day event or a trip.</p>}
      </div>

      <div className="cx-track-sub">
        <span className="cx-track-sub-t">Trackers</span>
        <span className="cx-track-sub-m">{isToday ? 'Tick for today' : `Tick for ${shortDate(iso)}`}</span>
      </div>
      {!trackers.length && <p className="cx-track-empty">No trackers yet.</p>}
      <div className="cx-track-trs">
        {trackers.slice(0, limit).map(t => <TrackerRow key={t.id} S={S} t={t} iso={iso} onSet={setValue} />)}
      </div>
      {compact && trackers.length > 5 && (
        <button type="button" className="cx-track-link" onClick={() => setAll(a => !a)} aria-expanded={all}>
          <span>{all ? 'Fewer trackers' : `All ${trackers.length} trackers`}</span>
          <TIcon name={all ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>
      )}
      <button type="button" className="cx-track-link" onClick={onManage}>
        <span>Manage trackers</span>
        <span className="cx-track-link-m">Auto-fill · add · remove</span>
      </button>
    </section>
  );
}
