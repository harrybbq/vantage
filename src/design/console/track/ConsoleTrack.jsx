/**
 * Track, console design: Calendar · Diet · Vitals.
 *
 * The Holiday section is merged in here: trips live on the calendar
 * (photo bands on the Month view, plain colours on the Year view), open
 * as a trip sheet, and are added from the same "Add to calendar" sheet
 * as events. The full tracker list lives in the selected day's panel.
 *
 * View state (which tab, which view, which month, which day) is LOCAL:
 * classic writes calMonth/calYear/selectedLogDate into S, which costs a
 * save of the whole state for a page flip; the console writes nothing
 * until the user changes data. Data writes go only through the existing
 * writers (lib/calendar, trips.js ≙ the Holiday section, tick.js ≙
 * QuickLog/TrackSection), so every key written is one classic writes.
 *
 * Diet and Vitals are the classic NutritionSection and VitalsPanel,
 * mounted as they are and re-skinned from outside by track.css.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, Button, Segmented, Sheet } from '../ui';
import NutritionSection from '../../../components/NutritionSection';
import VitalsPanel from '../../../components/track/VitalsPanel';
import AutoFillModal from '../../../components/track/AutoFillModal';
import VisitedTab from '../../../components/holiday/VisitedTab';
import { getTodayStr } from '../../../utils/helpers';
import { OWNER_SURFACES_IN_BUILD } from '../../../lib/native/ownerSurfaces';
import { shiftChipsInMonth, shiftOn, showsOnCalendar, setShowOnCalendar } from '../../../lib/rotation/pattern';
import { effectiveOverrides } from '../../../lib/lifts/plan';
import { EVENT_KINDS } from '../../../lib/calendar/events';
import { MONTHS, addDays, mondayOf, partsOf, isoOf, nextTrip } from './model';
import useWide from './useWide';
import MonthGrid from './MonthGrid';
import WeekGrid from './WeekGrid';
import YearGrid from './YearGrid';
import DayPanel from './DayPanel';
import NextTripCard from './TripCard';
import VisitedPanel from './VisitedPanel';
import TripSheet from './TripSheet';
import TripEditSheet from './TripEditSheet';
import AddSheet from './AddSheet';
import ManageTrackers from './ManageTrackers';
import TIcon from './icons';

const TABS = [
  { value: 'calendar', label: 'Calendar' },
  { value: 'diet', label: 'Diet' },
  { value: 'vitals', label: 'Vitals' },
];
const VIEWS = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'year', label: 'Year' },
];
// Classic deep links name the old tabs; 'trackers' now lives in the calendar.
const TAB_FOR = { trackers: 'calendar', calendar: 'calendar', diet: 'diet', vitals: 'vitals' };
const noop = () => {};
const kindColour = id => EVENT_KINDS.find(k => k.id === id)?.colour;

function shiftMonth(iso, n) {
  const { y, m } = partsOf(iso);
  const d = new Date(y, m + n, 1, 12);
  return isoOf(d.getFullYear(), d.getMonth(), 1);
}

/** The phone's "Month ▾" chip: a small menu of the three views. */
function ViewMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const label = VIEWS.find(v => v.value === value)?.label;
  return (
    <div className="cx-track-viewmenu" ref={ref}>
      <button type="button" className="cx-chip cx-track-viewchip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {label}<TIcon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="cx-track-menu" role="menu">
          {VIEWS.map(v => (
            <button key={v.value} type="button" role="menuitemradio" aria-checked={v.value === value}
                    onClick={() => { onChange(v.value); setOpen(false); }}>
              {v.label}{v.value === value && <TIcon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ConsoleTrack({
  S, update, userId, isOwner, onOpenModal, onOpenPaywall, onShowCoinToast, requestedTrackTab, initialView = 'month',
}) {
  const wide = useWide(1024);
  const today = getTodayStr();
  const [tab, setTab] = useState('calendar');
  const [view, setView] = useState(initialView);
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [sheet, setSheet] = useState(null);
  const [autoFor, setAutoFor] = useState(null);

  // Deep links (navigate('diet') etc.) carry a nonce, as classic's do.
  useEffect(() => {
    const t = requestedTrackTab && TAB_FOR[requestedTrackTab.tab];
    if (t) setTab(t);
  }, [requestedTrackTab]);

  // Owner only, compiled out of native builds — the classic gate.
  const owner = OWNER_SURFACES_IN_BUILD && !!isOwner;
  const shiftsOn = owner && showsOnCalendar(S);
  const { y: ay, m: am } = partsOf(anchor);
  const monthShifts = useMemo(
    () => (shiftsOn ? shiftChipsInMonth(S, ay, am) : null),
    // S.rotation holds the overrides and the schedule; nothing else matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shiftsOn, S.rotation, ay, am],
  );
  const shiftChipsFor = useCallback(iso => {
    if (!shiftsOn) return null;
    const { y, m } = partsOf(iso);
    return shiftChipsInMonth(S, y, m)[iso] || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftsOn, S.rotation]);
  const dayShift = useMemo(
    () => (shiftsOn ? shiftOn({ ...S, rotation: { ...(S.rotation || {}), overrides: effectiveOverrides(S) } }, selected) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shiftsOn, S.rotation, S.lifts, selected],
  );

  const trip = useMemo(() => nextTrip(S, today), [S, today]);
  const openTrip = id => setSheet({ type: 'trip', id });
  const openSpan = ev => setSheet({ type: 'edit', event: ev, date: String(ev.id).slice(-10) });
  const editEvent = (ev, iso) => setSheet({ type: 'edit', event: ev, date: iso });
  const add = (iso, kind = 'event') => setSheet({ type: 'add', date: iso || selected, kind });

  function step(n) {
    if (view === 'month') setAnchor(a => shiftMonth(a, n));
    else if (view === 'week') setAnchor(a => addDays(mondayOf(a), 7 * n));
    else setAnchor(a => isoOf(partsOf(a).y + n, 0, 1));
  }
  function goToday() { setAnchor(today); setSelected(today); }
  function selectDay(iso) {
    setSelected(iso);
    if (view === 'month' && iso.slice(0, 7) !== anchor.slice(0, 7)) setAnchor(iso);
  }
  function openDayInMonth(iso) { setView('month'); setAnchor(iso); setSelected(iso); }

  const title = view === 'year' ? String(ay)
    : view === 'week' ? (() => {
      const mon = mondayOf(anchor), sun = addDays(mon, 6);
      const a = partsOf(mon), b = partsOf(sun);
      return a.m === b.m ? `${a.d} – ${b.d} ${MONTHS[b.m].slice(0, 3)} ${b.y}` : `${a.d} ${MONTHS[a.m].slice(0, 3)} – ${b.d} ${MONTHS[b.m].slice(0, 3)} ${b.y}`;
    })()
      : `${MONTHS[am]} ${ay}`;
  const unit = view === 'year' ? 'year' : view === 'week' ? 'week' : 'month';
  const sheetTrip = sheet && (sheet.type === 'trip' || sheet.type === 'tripEdit') ? (S.holidays || []).find(t => t && t.id === sheet.id) : null;

  const dayPanel = (
    <DayPanel S={S} iso={selected} today={today} update={update} onShowCoinToast={onShowCoinToast}
              onOpenTrip={openTrip} onEditEvent={editEvent} onAdd={iso => add(iso)} onManage={() => setSheet({ type: 'manage' })}
              shift={dayShift} compact={!wide} wide={wide} />
  );
  // Owner only (Upgrade › Rotation): show or hide the rota on the calendar.
  const shiftToggle = owner ? (
    <button type="button" className="cx-chip cx-track-shiftchip" aria-pressed={shiftsOn}
            onClick={() => update(prev => setShowOnCalendar(prev, !showsOnCalendar(prev)))}
            title={shiftsOn ? 'Hide your shifts on the calendar' : 'Show your shifts on the calendar'}>
      Shifts
    </button>
  ) : null;
  const nextCard = <NextTripCard trip={trip} S={S} today={today} onOpen={openTrip} compact={!wide} />;

  return (
    <section className="section active cx-page cx-track-page" aria-label="Track">
      <header className="cx-track-head">
        <Segmented label="Track sections" options={TABS} value={tab} onChange={setTab} className="cx-track-tabs" />
        {tab === 'calendar' && (
          wide
            ? <Button variant="primary" icon="plus" onClick={() => add(selected)} className="cx-track-addbtn">Add</Button>
            : <Button variant="primary" icon="plus" iconOnly label="Add to calendar" onClick={() => add(selected)} className="cx-track-addbtn" />
        )}
      </header>

      {tab === 'calendar' && (
        <div className={`cx-track-cal is-${view}`}>
          <div className="cx-track-main">
            <Panel className="cx-track-board">
              <div className="cx-track-bar">
                <Button variant="ghost" iconOnly icon="chevron-left" label={`Previous ${unit}`} onClick={() => step(-1)} />
                <h2 className="cx-track-title" aria-live="polite">{title}</h2>
                <Button variant="ghost" iconOnly icon="chevron-right" label={`Next ${unit}`} onClick={() => step(1)} />
                {wide && <Button className="cx-track-todaybtn" onClick={goToday}>Today</Button>}
                <span className="cx-track-sp" />
                {wide && view === 'month' && (
                  <span className="cx-track-legend is-inline" aria-hidden="true">
                    {['training', 'social', 'appointment'].map(k => <span key={k}><i style={{ background: kindColour(k) }} />{EVENT_KINDS.find(x => x.id === k).label}</span>)}
                    <span><i className="is-bill" />Bills</span>
                  </span>
                )}
                {owner && wide && shiftToggle}
                {wide
                  ? <Segmented label="Calendar view" options={VIEWS} value={view} onChange={setView} className="cx-track-views" />
                  : <ViewMenu value={view} onChange={setView} />}
                {!wide && view !== 'year' && anchor.slice(0, 7) !== today.slice(0, 7) && (
                  <Button variant="ghost" onClick={goToday}>Today</Button>
                )}
              </div>
              {view === 'month' && (
                <MonthGrid S={S} year={ay} month={am} today={today} selected={selected} onSelect={selectDay}
                           onOpenTrip={openTrip} onOpenSpan={openSpan} wide={wide} shiftChips={monthShifts} />
              )}
              {view === 'week' && (
                <WeekGrid S={S} monday={mondayOf(anchor)} today={today} selected={selected} onSelect={setSelected}
                          onOpenTrip={openTrip} onOpenSpan={openSpan} onEditEvent={editEvent} wide={wide} shiftChipsFor={shiftChipsFor} />
              )}
              {view === 'year' && (
                <YearGrid S={S} year={ay} today={today} onOpenDay={openDayInMonth}
                          onOpenMonth={m => { setView('month'); setAnchor(isoOf(ay, m, 1)); }} />
              )}
              {wide && view !== 'year' && (
                <p className="cx-track-foot">
                  <i aria-hidden="true" />The line under a day is how many trackers you ticked. Trips and multi-day events run across the days they cover.
                </p>
              )}
            </Panel>
            {!wide && view !== 'year' && (
              <div className="cx-track-legend">
                <span aria-hidden="true"><i className="is-trip" />Trip</span>
                {['training', 'social'].map(k => <span key={k} aria-hidden="true"><i className="is-dot" style={{ background: kindColour(k) }} />{EVENT_KINDS.find(x => x.id === k).label}</span>)}
                <span aria-hidden="true"><i className="is-dot is-bill" />Bills</span>
                <span aria-hidden="true"><i className="is-line" />Trackers done</span>
                {shiftToggle}
              </div>
            )}
          </div>
          <aside className="cx-track-side">
            {view === 'year' ? (
              <>
                {nextCard}
                <VisitedPanel S={S} year={ay} onOpenMap={() => setSheet({ type: 'map' })} />
              </>
            ) : wide ? <>{nextCard}{dayPanel}</> : <>{dayPanel}{nextCard}</>}
          </aside>
        </div>
      )}

      {tab === 'diet' && (
        <div className="cx-track-classic cx-track-reskin cx-track-diet">
          {userId
            ? <NutritionSection userId={userId} S={S} update={update} selectedDate={selected === today ? null : selected}
                                calYear={ay} calMonth={am} onShowCoinToast={onShowCoinToast} onMonthDataReady={noop} onOpenModal={onOpenModal} />
            : <Panel className="cx-track-pad"><p className="cx-track-empty">Sign in to log food.</p></Panel>}
        </div>
      )}
      {tab === 'vitals' && (
        <div className="cx-track-classic cx-track-reskin cx-track-vitals">
          <VitalsPanel S={S} update={update} />
        </div>
      )}

      {sheet?.type === 'add' && (
        <AddSheet S={S} update={update} date={sheet.date} kind={sheet.kind} onClose={() => setSheet(null)} onOpenPaywall={onOpenPaywall}
                  onTripAdded={rec => { if (rec.from) { setAnchor(rec.from); setSelected(rec.from); } }} />
      )}
      {sheet?.type === 'edit' && (
        <AddSheet S={S} update={update} date={sheet.date} event={sheet.event} onClose={() => setSheet(null)} />
      )}
      {sheet?.type === 'trip' && sheetTrip && (
        <TripSheet trip={sheetTrip} S={S} update={update} today={today} onClose={() => setSheet(null)}
                   onEdit={(id, t) => setSheet({ type: 'tripEdit', id, tab: t })}
                   onShowOnCalendar={t => { setSheet(null); setView('month'); setAnchor(t.from); setSelected(t.from); }} />
      )}
      {sheet?.type === 'tripEdit' && sheetTrip && (
        <TripEditSheet trip={sheetTrip} S={S} update={update} tab={sheet.tab}
                       onClose={() => setSheet({ type: 'trip', id: sheetTrip.id })} onDeleted={() => setSheet(null)} />
      )}
      {sheet?.type === 'manage' && (
        <ManageTrackers S={S} update={update} onClose={() => setSheet(null)} onOpenModal={onOpenModal}
                        onAuto={t => { setSheet(null); setAutoFor(t); }} />
      )}
      {sheet?.type === 'map' && (
        <Sheet title="Visited" eyebrow="Map" onClose={() => setSheet(null)} width={560} className="cx-track-mapsheet" testId="track-map">
          <div className="cx-track-classic cx-track-reskin"><VisitedTab S={S} update={update} /></div>
        </Sheet>
      )}
      {autoFor && (
        <AutoFillModal tracker={(S.trackers || []).find(t => t.id === autoFor.id) || autoFor} S={S} update={update} owner={owner}
                       onClose={() => setAutoFor(null)} />
      )}
    </section>
  );
}
