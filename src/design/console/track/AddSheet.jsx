/**
 * "Add to calendar" — one sheet for Event · Multi-day · Trip, and the
 * editor for an existing event or multi-day event.
 *
 * Every write goes through the existing writers, never a copy:
 *   Event      makeEvent + addEvent / updateEvent(cleanPatch) / removeEvent  (lib/calendar/events)
 *   Multi-day  makeSpan + addSpan / updateSpan / removeSpan                  (lib/calendar/spans)
 *   Trip       trips.js addTrip — the classic Add-trip path, same record shape
 * Switching an existing event between one day and multi-day moves it in
 * ONE update, as the classic EventModal does, so it never exists twice.
 *
 * Event memory (lib/calendar/eventMemory) finishes a name the user has
 * used before and fills only the fields they have not typed into, with
 * an Undo — the classic SuggestInput, re-skinned by track.css.
 *
 * A trip respects the free-tier cap the classic "Plan trip" modal is
 * held to (App's MODAL_CAPS → useTierLimits); at the cap it opens the
 * paywall instead.
 */
import { useMemo, useRef, useState } from 'react';
import { Sheet, Button, Segmented } from '../ui';
import SuggestInput from '../../../components/calendar/SuggestInput';
import { emptyHolidayForm } from '../../../components/holiday/HolidayFormTabs';
import { EVENT_COLOURS, addEvent, cleanPatch, eventColour, isTime, makeEvent, removeEvent, updateEvent } from '../../../lib/calendar/events';
import { MAX_SPAN_DAYS, addDays, addSpan, findSpan, isRealDate, makeSpan, rangeLabel, removeSpan, spanLength, updateSpan } from '../../../lib/calendar/spans';
import { completion, describe, fillPlan, learnEvents, locationCompletion, suggest, suggestLocations } from '../../../lib/calendar/eventMemory';
import { useTierLimits } from '../../../hooks/useTierLimits';
import { addTrip, tripFromForm } from './trips';
import { CoverField, SavingsPotField, STATUS_OPTIONS } from './TripFields';

const KINDS = [
  { value: 'event', label: 'Event' },
  { value: 'span', label: 'Multi-day' },
  { value: 'trip', label: 'Trip' },
];

export default function AddSheet({ S, update, date, kind: initialKind = 'event', event = null, onClose, onOpenPaywall, onTripAdded }) {
  const editing = !!event;
  const spanId = event?.source === 'span' ? event.spanId : null;
  const [span] = useState(() => (spanId ? findSpan(S, spanId) : null));
  const [kind, setKind] = useState(editing ? (spanId ? 'span' : 'event') : initialKind);
  const { atLimit } = useTierLimits();

  // Shared fields
  const [title, setTitle] = useState(event?.title || '');
  const [day, setDay] = useState(event && !spanId ? date : date);
  const [startDate, setStartDate] = useState(span?.start || event?.spanStart || date);
  const [endDate, setEndDate] = useState(span?.end || event?.spanEnd || (isRealDate(date) ? addDays(date, 1) : date));
  const [start, setStart] = useState(event?.time || '');
  const [end, setEnd] = useState(event?.end || '');
  const [location, setLocation] = useState(event?.location || '');
  const [colour, setColour] = useState(event?.colour || (span?.colour) || EVENT_COLOURS[0].hex);
  // Trip fields — the classic form shape
  const [trip, setTrip] = useState(() => ({ ...emptyHolidayForm(), from: date || '', to: isRealDate(date) ? addDays(date, 3) : '' }));

  // Event memory, learned once per open (as the classic modal does).
  const nameRef = useRef(null);
  const touched = useRef(null);
  if (!touched.current) {
    touched.current = new Set(editing ? ['start', 'end', 'location', 'colour'].filter(k => !!(k === 'start' ? event.time : event[k])) : []);
  }
  const [fill, setFill] = useState(null);
  const memory = useMemo(() => learnEvents(S.calendarEvents, { excludeId: event?.id }), [S.calendarEvents, event?.id]);
  const titleSuggestions = useMemo(() => suggest(memory, title, { date: day }), [memory, title, day]);
  const titleGhost = useMemo(() => completion(memory, title, { date: day }), [memory, title, day]);
  const locSuggestions = useMemo(() => suggestLocations(memory, location, { title }), [memory, location, title]);
  const locGhost = useMemo(() => locationCompletion(memory, location, { title }), [memory, location, title]);
  const values = { title, start, end, location, colour };
  const setters = { title: setTitle, start: setStart, end: setEnd, location: setLocation, colour: setColour };
  function userSet(k, v) {
    touched.current.add(k);
    setters[k](v);
    if (fill && k in fill.prev && k !== 'title') {
      const prev = { ...fill.prev };
      delete prev[k];
      setFill(Object.keys(prev).some(f => f !== 'title') ? { prev } : null);
    }
  }
  function applyEntry(entry) {
    if (!entry) return;
    const patch = fillPlan(entry, values, touched.current);
    const prev = {};
    for (const k of Object.keys(patch)) { prev[k] = values[k]; setters[k](patch[k]); }
    setFill(Object.keys(patch).some(k => k !== 'title') ? { prev } : null);
  }
  function undoFill() {
    if (!fill) return;
    for (const [k, v] of Object.entries(fill.prev)) setters[k](v);
    setFill(null);
    nameRef.current?.focus();
  }

  const clean = title.trim();
  const datesOk = isRealDate(startDate) && isRealDate(endDate);
  const datesBackwards = datesOk && endDate < startDate;
  const tooLong = datesOk && !datesBackwards && spanLength(startDate, endDate) > MAX_SPAN_DAYS;
  const endBackwards = !!end && !!start && end <= start;
  const canSave = kind === 'trip'
    ? !!trip.dest.trim()
    : clean.length > 0 && (kind === 'span' ? isRealDate(startDate) : isRealDate(day));

  function save() {
    if (!canSave) return;
    if (kind === 'trip') {
      if (atLimit('holidays', (S.holidays || []).length)) { onClose(); onOpenPaywall?.('holidays'); return; }
      const rec = tripFromForm(emptyHolidayForm(), trip);
      update(prev => addTrip(prev, rec));
      onClose();
      onTripAdded?.(rec);
      return;
    }
    if (kind === 'span') {
      const fields = { title: clean, start: startDate, end: endDate, location, colour };
      // Minted outside the updater so a double-invoked updater cannot make two ids.
      const fresh = spanId ? null : makeSpan({ ...fields, note: event?.note || '' });
      update(prev => {
        if (spanId) return updateSpan(prev, spanId, fields);
        const added = addSpan(prev, fresh);
        if (added === prev) return prev;
        return editing ? removeEvent(added, date, event.id) : added;
      });
      onClose();
      return;
    }
    const fields = { title: clean, time: start, end, location, colour };
    if (spanId) {
      // Multi-day → one day, in one update.
      const single = makeEvent({ ...fields, note: span?.note || '' });
      update(prev => {
        const added = addEvent(prev, day, single);
        if (added === prev) return prev;
        return removeSpan(added, spanId);
      });
      onClose();
      return;
    }
    if (editing) {
      update(prev => {
        if (day === date) return updateEvent(prev, date, event.id, cleanPatch(fields));
        // Moved to another day: the same event (same id) on the new date, gone from the old, in one update.
        const moved = { ...(prev.calendarEvents?.[date] || []).find(e => e && e.id === event.id), ...cleanPatch(fields) };
        if (!moved.id) return prev;
        const added = addEvent(removeEvent(prev, date, event.id), day, moved);
        return added;
      });
      onClose();
      return;
    }
    const fresh = makeEvent(fields);
    update(prev => addEvent(prev, day, fresh));
    onClose();
  }

  function del() {
    if (!editing) return;
    if (spanId) {
      const n = span ? spanLength(span.start, span.end) : event.dayCount;
      if (!window.confirm(`Delete “${event.title}”${n > 1 ? `, all ${n} days` : ''}?`)) return;
      update(prev => removeSpan(prev, spanId));
    } else {
      if (!window.confirm(`Delete “${event.title}”?`)) return;
      update(prev => removeEvent(prev, date, event.id));
    }
    onClose();
  }

  const heading = editing ? (spanId ? 'Edit multi-day event' : 'Edit event') : 'Add to calendar';
  const primary = kind === 'trip' ? 'Add trip' : editing ? 'Save' : kind === 'span' ? 'Add multi-day event' : 'Add event';
  const kinds = editing ? KINDS.map(k => (k.value === 'trip' ? { ...k, disabled: true } : k)) : KINDS;
  const tripDays = isRealDate(trip.from) && isRealDate(trip.to) && trip.to >= trip.from ? spanLength(trip.from, trip.to) : 0;

  return (
    <Sheet title={heading} onClose={onClose} className="cx-track-addsheet" testId="track-add" initialFocus={editing ? 'input' : '.cx-seg-opt[aria-checked="true"]'}
           footer={(
             <div className="cx-track-foot3">
               {editing && <Button variant="danger" onClick={del}>Delete</Button>}
               <span className="cx-track-sp" />
               <Button variant="ghost" onClick={onClose}>Cancel</Button>
               <Button variant="primary" onClick={save} disabled={!canSave}>{primary}</Button>
             </div>
           )}>
      <Segmented label="What to add" options={kinds} value={kind} onChange={setKind} className="cx-track-kinds" />

      {kind !== 'trip' ? (
        <div className="cx-track-form">
          <div className="cx-track-classic">
            <SuggestInput
              inputRef={nameRef} label="Name" listLabel="Past events"
              value={title} placeholder="Dentist, gym with Finlay, flight out…"
              onType={v => userSet('title', v)}
              options={titleSuggestions.map(e => ({ id: e.key, title: e.title, detail: describe(e), dot: e.colour || null }))}
              ghost={titleGhost}
              onPick={i => applyEntry(titleSuggestions[i])}
              onAcceptGhost={() => applyEntry(titleSuggestions[0])}
              onEnter={() => { if (canSave) save(); }}
            />
          </div>
          {fill && (
            <p className="cx-track-filled" role="status">
              Filled from your past events · <button type="button" className="cx-track-inline" onClick={undoFill}>Undo</button>
            </p>
          )}
          {kind === 'span' ? (
            <>
              <div className="cx-track-two">
                <div className="cx-field">
                  <label className="cx-label" htmlFor="add-from">From</label>
                  <input id="add-from" className="cx-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="cx-field">
                  <label className="cx-label" htmlFor="add-to">Ends on</label>
                  <input id="add-to" className="cx-input" type="date" value={endDate} min={isRealDate(startDate) ? startDate : undefined}
                         onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>
              <p className={`cx-track-hint${datesBackwards || tooLong || !isRealDate(startDate) ? ' is-warn' : ''}`}>
                {!isRealDate(startDate) ? 'Pick a start date.'
                  : datesBackwards ? 'Ends before it starts. The dates will be swapped.'
                    : tooLong ? `Longer than ${MAX_SPAN_DAYS} days. It will end on day ${MAX_SPAN_DAYS}.`
                      : datesOk ? `${rangeLabel(startDate, endDate)}. All day, every day in between.` : ''}
              </p>
            </>
          ) : (
            <>
              <div className="cx-field">
                <label className="cx-label" htmlFor="add-day">Date</label>
                <input id="add-day" className="cx-input" type="date" value={day} onChange={e => setDay(e.target.value)} />
              </div>
              <div className="cx-track-two">
                <div className="cx-field">
                  <label className="cx-label" htmlFor="add-start">Starts</label>
                  <input id="add-start" className="cx-input" type="time" value={start} onChange={e => userSet('start', e.target.value)} />
                </div>
                <div className="cx-field">
                  <label className="cx-label" htmlFor="add-end">Ends</label>
                  <input id="add-end" className="cx-input" type="time" value={end} onChange={e => userSet('end', e.target.value)} />
                </div>
              </div>
              <p className={`cx-track-hint${endBackwards || (end && !start) ? ' is-warn' : ''}`}>
                {endBackwards ? 'Ends before it starts. The end time won’t be saved.'
                  : end && !start ? 'An end time needs a start time.'
                    : !start && !end ? 'Leave both blank for an all-day event.' : isTime(start) ? `${start}${end ? ` – ${end}` : ''}` : ''}
              </p>
            </>
          )}
          <div className="cx-track-classic">
            <SuggestInput
              label="Location" listLabel="Past locations"
              value={location} placeholder="Optional"
              onType={v => userSet('location', v)}
              options={locSuggestions.map(p => ({ id: p.key, title: p.location, detail: p.count === 1 ? 'Used once' : `Used ${p.count} times` }))}
              ghost={locGhost}
              onPick={i => { touched.current.add('location'); setLocation(locSuggestions[i].location); }}
              onAcceptGhost={() => { if (locSuggestions[0]) { touched.current.add('location'); setLocation(locSuggestions[0].location); } }}
            />
          </div>
          <div className="cx-field">
            <span className="cx-label" id="add-colour-l">Colour</span>
            <div className="cx-track-swatches" role="radiogroup" aria-labelledby="add-colour-l">
              {EVENT_COLOURS.map(c => (
                <button key={c.id} type="button" role="radio" aria-checked={colour === c.hex} aria-label={c.id}
                        className="cx-track-swatch" style={{ background: c.hex }} onClick={() => userSet('colour', c.hex)} />
              ))}
            </div>
          </div>
          <div className="cx-track-preview" aria-hidden="true">
            <span className="cx-track-kbar" style={{ '--k': eventColour({ colour }) }} />
            <span className="cx-track-preview-t">{clean || 'Untitled'}</span>
            {kind === 'span'
              ? datesOk && <span className="cx-muted">{Math.min(spanLength(...(datesBackwards ? [endDate, startDate] : [startDate, endDate])), MAX_SPAN_DAYS)} days</span>
              : isTime(start) ? <span className="cx-muted cx-num">{start}</span> : <span className="cx-muted">All day</span>}
          </div>
        </div>
      ) : (
        <div className="cx-track-form">
          <CoverField value={trip.imageUrl} onChange={v => setTrip(f => ({ ...f, imageUrl: v }))} idPrefix="add-trip" />
          <div className="cx-field">
            <label className="cx-label" htmlFor="add-trip-dest">Trip</label>
            <input id="add-trip-dest" className="cx-input" type="text" placeholder="Lisbon, Portugal" value={trip.dest}
                   onChange={e => setTrip(f => ({ ...f, dest: e.target.value }))} />
          </div>
          <div className="cx-track-two">
            <div className="cx-field">
              <label className="cx-label" htmlFor="add-trip-from">From</label>
              <input id="add-trip-from" className="cx-input" type="date" value={trip.from} onChange={e => setTrip(f => ({ ...f, from: e.target.value }))} />
            </div>
            <div className="cx-field">
              <label className="cx-label" htmlFor="add-trip-to">To</label>
              <input id="add-trip-to" className="cx-input" type="date" value={trip.to} min={trip.from || undefined}
                     onChange={e => setTrip(f => ({ ...f, to: e.target.value }))} />
            </div>
          </div>
          <div className="cx-field">
            <span className="cx-label">Status</span>
            <Segmented label="Status" options={STATUS_OPTIONS} value={trip.status} onChange={v => setTrip(f => ({ ...f, status: v }))} />
          </div>
          <SavingsPotField S={S} value={trip.savingsGoalId} idPrefix="add-trip" onChange={v => setTrip(f => ({ ...f, savingsGoalId: v }))} />
          <p className="cx-track-hint">
            {tripDays ? `Shows across ${tripDays} day${tripDays === 1 ? '' : 's'} on your calendar${trip.status === 'planning' ? ', dashed until it’s booked' : ''}. ` : ''}
            Flights, stay and itinerary can be added after.
          </p>
        </div>
      )}
    </Sheet>
  );
}
