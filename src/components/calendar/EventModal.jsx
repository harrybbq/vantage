/**
 * Add or edit one calendar event.
 *
 * Reached from the day menu's "Add event" rather than from a page of its
 * own, because the gesture that already exists for a day — right-click
 * it — is the one people will reach for. Anything that makes putting an
 * event on a date take more than two decisions will lose to the phone's
 * own calendar.
 *
 * ── What it asks for, and what it doesn't ────────────────────────────
 * Name, start, end, location, colour. That is the whole form. No
 * recurrence, no reminders, no attendees: half-built recurrence is worse
 * than none, because data written under a half rule has to be migrated
 * when the real one lands (the note at the top of lib/calendar/events.js
 * is the long version).
 *
 * Only the name is required. An event with no time is legitimate — "car
 * in for its MOT, some time Tuesday" — and forcing a made-up 09:00 onto
 * it would put a lie in the agenda.
 *
 * Normalisation is NOT done here. makeEvent/cleanPatch own it, so the
 * same rules apply to anything that ever writes an event, not just this
 * form.
 *
 * ── Event memory ─────────────────────────────────────────────────────
 * Typing a name the user has used before offers to finish it — name,
 * location, times, colour — from how that event usually goes
 * (lib/calendar/eventMemory.js has the rules). Picking a suggestion
 * fills only fields the user has NOT typed into in this form, and says
 * so with an Undo. Learned on open from S.calendarEvents, on the device;
 * nothing is sent or stored.
 *
 * ── Multi-day ────────────────────────────────────────────────────────
 * A "Multi-day" switch under the date turns the form into a range: a
 * start and an end date, no times (a holiday is all-day), and the header
 * reads "Mon 5 Oct → Fri 9 Oct · 5 days". Saving writes ONE span to
 * S.calendarSpans (lib/calendar/spans.js), never a copy per day. A span
 * opened from the day menu is edited and deleted WHOLE here — the day
 * you tapped is just the way in. Switching an existing event across
 * (single ↔ multi-day) moves it in one update, so there is no moment
 * where it exists twice or not at all.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { EVENT_COLOURS, addEvent, cleanPatch, eventColour, isTime, makeEvent, removeEvent, updateEvent } from '../../lib/calendar/events';
import {
  MAX_SPAN_DAYS, addDays, addSpan, findSpan, isRealDate, makeSpan, rangeLabel, removeSpan, spanLength, updateSpan,
} from '../../lib/calendar/spans';
import { completion, describe, fillPlan, learnEvents, locationCompletion, suggest, suggestLocations } from '../../lib/calendar/eventMemory';
import SuggestInput from './SuggestInput';

const prettyDate = iso => new Date(iso + 'T12:00').toLocaleDateString(undefined, {
  weekday: 'long', day: 'numeric', month: 'long',
});

export default function EventModal({ dates, event, calendarEvents, calendarSpans, multiDay = false, update, onClose }) {
  const editing = !!event;
  const nameRef = useRef(null);

  // Editing a span: the event handed in is ONE DAY of it, so read the
  // span itself for the fields a day does not carry (its note, its real
  // dates). Read once on open — if it has gone (deleted on another
  // device) the form still opens from the day's copy rather than crashing.
  const spanId = event?.source === 'span' ? event.spanId : null;
  const [span] = useState(() => (spanId ? findSpan({ calendarSpans }, spanId) : null));
  const editingSpan = !!spanId;
  const sorted = useMemo(() => [...dates].sort(), [dates]);

  const [multi, setMulti] = useState(editingSpan || multiDay);
  const [startDate, setStartDate] = useState(span?.start || event?.spanStart || sorted[0]);
  const [endDate, setEndDate] = useState(
    span?.end || event?.spanEnd || (multiDay ? sorted[sorted.length - 1] : sorted[0]),
  );
  // The switch is offered where a range makes sense: one day, a run of
  // days picked as one, or an existing event. Not for "add the same
  // event to these five scattered Tuesdays", which is per-day by nature.
  const canMulti = dates.length === 1 || multiDay || editing;

  const [title, setTitle] = useState(event?.title || '');
  const [start, setStart] = useState(event?.time || '');
  const [end, setEnd] = useState(event?.end || '');
  const [location, setLocation] = useState(event?.location || '');
  const [colour, setColour] = useState(event?.colour || EVENT_COLOURS[0].hex);

  // Fields the user has typed into in THIS form — a suggestion never
  // overwrites one. When editing, whatever the event already holds counts
  // as theirs too: picking a suggestion fills blanks, it does not rewrite
  // an event's saved details.
  const touched = useRef(null);
  if (!touched.current) {
    touched.current = new Set(editing
      ? ['start', 'end', 'location', 'colour'].filter(k => !!(k === 'start' ? event.time : event[k]))
      : []);
  }
  // { prev: { field: valueBeforeFill } } while the "Filled from…" note shows.
  const [fill, setFill] = useState(null);

  // Learned once per open. The modal only exists while it is open, so
  // this is a single pass over the calendar per "Add event" tap.
  const memory = useMemo(
    () => learnEvents(calendarEvents, { excludeId: event?.id }),
    [calendarEvents, event?.id],
  );
  const day = dates[0];
  const titleSuggestions = useMemo(() => suggest(memory, title, { date: day }), [memory, title, day]);
  const titleGhost = useMemo(() => completion(memory, title, { date: day }), [memory, title, day]);
  const locSuggestions = useMemo(() => suggestLocations(memory, location, { title }), [memory, location, title]);
  const locGhost = useMemo(() => locationCompletion(memory, location, { title }), [memory, location, title]);

  const titleOptions = useMemo(() => titleSuggestions.map(e => ({
    id: e.key, title: e.title, detail: describe(e), dot: e.colour || null,
  })), [titleSuggestions]);
  const locOptions = useMemo(() => locSuggestions.map(p => ({
    id: p.key, title: p.location, detail: p.count === 1 ? 'Used once' : `Used ${p.count} times`,
  })), [locSuggestions]);

  const values = { title, start, end, location, colour };
  const setters = { title: setTitle, start: setStart, end: setEnd, location: setLocation, colour: setColour };

  /** A user edit: mark the field theirs, and drop it from any pending Undo. */
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
    const patch = fillPlan(entry, values, touched.current);
    const prev = {};
    for (const k of Object.keys(patch)) { prev[k] = values[k]; setters[k](patch[k]); }
    // Only worth announcing when more than the name changed.
    setFill(Object.keys(patch).some(k => k !== 'title') ? { prev } : null);
  }

  function undoFill() {
    if (!fill) return;
    for (const [k, v] of Object.entries(fill.prev)) setters[k](v);
    setFill(null);
    nameRef.current?.focus();
  }

  function pickLocation(loc) {
    touched.current.add('location');
    setLocation(loc);
  }

  useEffect(() => {
    // The name is the only required field, so it is where the cursor
    // belongs — a modal that opens with nothing focused costs a tap.
    nameRef.current?.focus();
    // defaultPrevented: a suggestion list claims the first Esc to close
    // itself, and that press should not also close the form.
    const esc = e => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const clean = title.trim();
  // Flagged, not blocked. The store drops a backwards end time anyway;
  // saying so before the save is what stops it looking like data loss.
  const endBackwards = !!end && !!start && end <= start;
  const endOrphan = !!end && !start;
  // Same idea for dates — makeSpan swaps a backwards range and pulls in
  // an over-long one, and the form says so before it happens.
  const datesOk = isRealDate(startDate) && isRealDate(endDate);
  const datesBackwards = datesOk && endDate < startDate;
  const tooLong = datesOk && !datesBackwards && spanLength(startDate, endDate) > MAX_SPAN_DAYS;
  const canSave = clean.length > 0 && (!multi || isRealDate(startDate));

  function toggleMulti() {
    // Turning it on with a one-day range would save a "multi-day" event
    // of one day; start it at two so the end field means something the
    // moment it appears.
    if (!multi && isRealDate(startDate) && (!isRealDate(endDate) || endDate <= startDate)) {
      setEndDate(addDays(startDate, 1));
    }
    setMulti(!multi);
  }

  function save() {
    if (!canSave) return;
    const fields = { title: clean, time: start, end, location, colour };
    if (multi) {
      const spanFields = { title: clean, start: startDate, end: endDate, location, colour };
      // Built outside the updater so a double-invoked updater (React dev
      // mode) cannot mint two different ids.
      const fresh = editingSpan ? null : makeSpan({ ...spanFields, note: event?.note || '' });
      update(prev => {
        if (editingSpan) return updateSpan(prev, spanId, spanFields);
        // Single event → multi-day: drop the day's copy and add the span
        // in ONE update. If the span would be refused, keep the event.
        const added = addSpan(prev, fresh);
        if (added === prev) return prev;
        return editing ? removeEvent(added, dates[0], event.id) : added;
      });
      onClose();
      return;
    }
    if (editingSpan) {
      // Multi-day → one day: the span becomes a normal event on its first
      // day, timed if times were given. Same one-update rule.
      const single = makeEvent({ ...fields, note: span?.note || '' });
      const day = isRealDate(startDate) ? startDate : dates[0];
      update(prev => {
        const added = addEvent(prev, day, single);
        if (added === prev) return prev;
        return removeSpan(added, spanId);
      });
      onClose();
      return;
    }
    update(prev => {
      if (editing) {
        return updateEvent(prev, dates[0], event.id, cleanPatch(fields));
      }
      // Multi-select adds the same event to every chosen day. One
      // makeEvent per date, because two days sharing an id would make
      // "delete this one" ambiguous.
      return dates.reduce((acc, iso) => addEvent(acc, iso, makeEvent(fields)), prev);
    });
    onClose();
  }

  function del() {
    if (!editing) return;
    if (editingSpan) {
      const n = span ? spanLength(span.start, span.end) : event.dayCount;
      if (!window.confirm(`Delete “${event.title}”${n > 1 ? ` — all ${n} days` : ''}?`)) return;
      update(prev => removeSpan(prev, spanId));
      onClose();
      return;
    }
    if (!window.confirm(`Delete “${event.title}”?`)) return;
    update(prev => removeEvent(prev, dates[0], event.id));
    onClose();
  }

  const heading = multi
    ? (editing ? 'Edit multi-day event' : 'New multi-day event')
    : (editing ? 'Edit event' : 'New event');
  const sub = multi
    ? (datesOk ? rangeLabel(startDate, endDate) : 'Pick the dates')
    : dates.length > 1 ? `${dates.length} days — one copy on each` : prettyDate(dates[0]);
  const days = datesOk ? spanLength(...(datesBackwards ? [endDate, startDate] : [startDate, endDate])) : 0;

  return createPortal(
    <div className="modal-overlay open" role="presentation" onClick={onClose}>
      <div className="modal ev-modal" role="dialog" aria-modal="true" aria-label={heading}
           onClick={e => e.stopPropagation()}>
        <div className="ev-modal-head">
          <div>
            <div className="ev-modal-title">{heading}</div>
            <div className="ev-modal-sub">{sub}</div>
          </div>
          <button type="button" className="ev-modal-x" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="ev-modal-body">
          <SuggestInput
            inputRef={nameRef} label="Name" listLabel="Past events"
            value={title} placeholder="Dentist, gym with Finlay, flight out…"
            onType={v => userSet('title', v)}
            options={titleOptions}
            ghost={titleGhost}
            onPick={i => applyEntry(titleSuggestions[i])}
            // Accepting the greyed completion is the same choice as
            // picking the top row, so it fills the same fields.
            onAcceptGhost={() => titleSuggestions[0] && applyEntry(titleSuggestions[0])}
            onEnter={() => { if (canSave) save(); }}
          />
          {fill && (
            <div className="ev-filled" role="status">
              <span>Filled from your past events</span>
              <span aria-hidden="true">·</span>
              <button type="button" className="ev-filled-undo" onClick={undoFill}>Undo</button>
            </div>
          )}

          {canMulti && (
            <button type="button" role="switch" aria-checked={multi}
                    className={'ev-switch' + (multi ? ' is-on' : '')} onClick={toggleMulti}>
              <span className="ev-switch-track" aria-hidden="true"><span className="ev-switch-knob" /></span>
              <span className="ev-switch-text">
                <span className="ev-switch-lbl">Multi-day</span>
                <span className="ev-switch-hint">Holidays, trips, festivals — one event across several days</span>
              </span>
            </button>
          )}

          {multi ? (
            <>
              <div className="ev-row">
                <label className="ev-field">
                  <span className="ev-field-lbl">From</span>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </label>
                <label className="ev-field">
                  <span className="ev-field-lbl">Ends on</span>
                  <input type="date" value={endDate} min={isRealDate(startDate) ? startDate : undefined}
                         onChange={e => setEndDate(e.target.value)} />
                </label>
              </div>
              {!isRealDate(startDate) && <div className="ev-warn">Pick a start date.</div>}
              {datesBackwards && <div className="ev-warn">Ends before it starts — the dates will be swapped.</div>}
              {tooLong && <div className="ev-warn">Longer than {MAX_SPAN_DAYS} days — it will end on day {MAX_SPAN_DAYS}.</div>}
              {datesOk && !datesBackwards && !tooLong && <div className="ev-fine">All day, every day in between.</div>}
            </>
          ) : (
            <>
              <div className="ev-row">
                <label className="ev-field">
                  <span className="ev-field-lbl">Starts</span>
                  <input type="time" value={start} onChange={e => userSet('start', e.target.value)} />
                </label>
                <label className="ev-field">
                  <span className="ev-field-lbl">Ends</span>
                  <input type="time" value={end} onChange={e => userSet('end', e.target.value)} />
                </label>
              </div>
              {endBackwards && <div className="ev-warn">Ends before it starts — the end time won&apos;t be saved.</div>}
              {endOrphan && <div className="ev-warn">An end time needs a start time.</div>}
              {!start && !end && <div className="ev-fine">Leave both blank for an all-day event.</div>}
            </>
          )}

          <SuggestInput
            label="Location" listLabel="Past locations"
            value={location} placeholder="Optional"
            onType={v => userSet('location', v)}
            options={locOptions}
            ghost={locGhost}
            onPick={i => pickLocation(locSuggestions[i].location)}
            onAcceptGhost={() => locSuggestions[0] && pickLocation(locSuggestions[0].location)}
          />

          <div className="ev-field">
            <span className="ev-field-lbl">Colour</span>
            <div className="ev-swatches" role="radiogroup" aria-label="Event colour">
              {EVENT_COLOURS.map(c => (
                <button key={c.id} type="button" role="radio" aria-checked={colour === c.hex}
                        aria-label={c.id}
                        className={'ev-swatch' + (colour === c.hex ? ' is-on' : '')}
                        style={{ background: c.hex }}
                        onClick={() => userSet('colour', c.hex)} />
              ))}
            </div>
          </div>

          {/* What it will look like on the day. Cheap to render and it
              settles the "is that colour readable" question here rather
              than after it is saved. */}
          <div className="ev-preview">
            <span className="ev-preview-dot" style={{ background: eventColour({ colour }) }} />
            <span className="ev-preview-name">{clean || 'Untitled'}</span>
            {multi && days > 0 && (
              <span className="ev-preview-when">{Math.min(days, MAX_SPAN_DAYS)} days</span>
            )}
            {!multi && isTime(start) && (
              <span className="ev-preview-when">
                {start}{end && !endBackwards ? ` – ${end}` : ''}
              </span>
            )}
            {location.trim() && <span className="ev-preview-where">{location.trim()}</span>}
          </div>
        </div>

        <div className="ev-modal-foot">
          {editing && (
            <button type="button" className="ev-btn is-del" onClick={del}>Delete</button>
          )}
          <button type="button" className="ev-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="ev-btn is-go" onClick={save} disabled={!canSave}>
            {editing ? 'Save' : multi ? 'Add multi-day event' : dates.length > 1 ? `Add to ${dates.length} days` : 'Add event'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
