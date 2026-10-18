/**
 * Rotation tab — the 16-day shift cycle with training mapped onto it.
 *
 * Replaces the iframe onto public/schedule/shift-rotation-2026.html.
 * The pattern maths lives in lib/rotation/pattern.js; this file is the
 * calendar and the day editor.
 *
 * Two changes of substance from the old page:
 *
 *   Bank holidays are gone. They were flagged as a pay-premium
 *   question, and the owner doesn't get them — so the flags were
 *   drawing attention to nothing.
 *
 *   Days are editable. A pattern that cannot absorb annual leave or a
 *   swapped session stops matching reality within a month, at which
 *   point it is decoration. Edits are sparse overrides keyed by ISO
 *   date, so the pattern stays the source of truth and only the
 *   deviations are stored.
 *
 * The session plan (Oct 2026, lib/lifts/plan.js): what the days SHOW is
 * effectiveOverrides(S) — the owner's edits (which always win), then
 * what was actually trained (✓ logged) and what the plan has moved
 * since (↻ moved), e.g. Legs carried to the day after Push was done on a
 * Legs day. None of that is written: S.rotation.overrides still holds
 * only what was set here by hand. A legend tells the three apart, and
 * the day editor still pins a session by hand — including the pattern's
 * own, against the plan. Leave, shift counts and the allowance read the
 * hand edits only: they are about shifts, not sessions.
 */
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import {
  ALLOWANCE_DEFAULT, LEAVE_TYPES, SESSION_OPTIONS, WINDOW, allowanceUsed,
  chipText, datesBetween, holidayDaySet, leaveType, monthGrid, monthRange,
  nextHoliday, normaliseBlock, rangeStats, patternDay,
  resolveDay, daysUntilReset,
  scheduleOf, cycleShape,
} from '../../lib/rotation/pattern';
import ShiftPatternCard from './ShiftPatternCard';
import { effectiveOverrides, plannedSessions, plannedOn } from '../../lib/lifts/plan';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/**
 * The next sixteen days — one full cycle from today.
 *
 * The calendar answers "what does a month look like"; this answers the
 * question the page is actually opened for, "what's coming", without
 * scanning a grid. Each day opens the same editor as the calendar.
 */
function NextDays({ overrides, raw, holidayDays, today, onOpen, schedule }) {
  const days = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number);
    return Array.from({ length: 16 }, (_, i) => {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      return resolveDay(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), overrides, schedule);
    }).filter(c => c.inPattern);
  }, [overrides, today, schedule]);
  if (!days.length) return null;
  return (
    <section className="upg-card upg-next">
      <div className="upg-card-head">
        <h3>Next 16 days</h3>
        <span className="upg-card-sub">tap a day to change it</span>
      </div>
      <div className="upg-next-row">
        {days.map((c, i) => {
          const dt = new Date(c.iso + 'T12:00:00');
          const chip = chipText(c);
          return (
            <button key={c.iso} type="button" onClick={() => onOpen(c)}
                    className={['upg-next-day', `is-${c.shift}`, c.cardio ? 'has-cardio' : '',
                      kindOf(overrides, raw, c.iso) ? `is-${kindOf(overrides, raw, c.iso)}` : '',
                      holidayDays.has(c.iso) ? 'is-holiday' : '', i === 0 ? 'is-today' : ''].filter(Boolean).join(' ')}
                    aria-label={`${dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}: ${c.shift === 'off' ? 'off' : chip}, ${c.session}${KIND_WORDS[kindOf(overrides, raw, c.iso)] || ''}`}>
              <span className="upg-next-dow">{i === 0 ? 'Today' : DOW[(dt.getDay() + 6) % 7]}</span>
              <span className="upg-next-dt">{dt.getDate()}</span>
              <span className="upg-next-chip">{chip || 'Off'}</span>
              <span className={'upg-next-sess' + (c.session === 'Rest' ? ' is-rest' : '')}>{c.session}</span>
              <Mark overrides={overrides} raw={raw} iso={c.iso} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** 'done' | 'dynamic' for a day the plan derived, else null. */
const derivedOf = (eff, iso) => (eff[iso] && eff[iso].derived) || null;
/** edited (by hand) › dynamic (moved by the plan) › done (a workout logged) › missed. */
const kindOf = (eff, raw, iso, mark) => (raw[iso] ? 'edited'
  : derivedOf(eff, iso) === 'dynamic' ? 'dynamic'
  : derivedOf(eff, iso) === 'done' || mark === 'done' ? 'done'
  : mark === 'missed' ? 'missed' : null);
const KIND_WORDS = { edited: ' (edited by you)', dynamic: ' (moved by the plan)', done: ' (workout logged)', missed: ' (missed)' };
/** The day's mark — a glyph, so it never rests on colour alone: ✓ logged, ↻ moved, ● edited by you. */
function Mark({ overrides, raw, iso, mark }) {
  const d = kindOf(overrides, raw, iso, mark);
  if (!d) return null;
  return <span className={`upg-mark is-${d}`} aria-hidden="true">{d === 'done' ? '✓' : d === 'dynamic' ? '↻' : d === 'missed' ? '–' : '●'}</span>;
}

export default function RotationTab({ S, update, isMobile }) {
  // The owner's own edits: what the editor writes, and what leave, shift
  // counts and the allowance are counted from.
  const overrides = useMemo(() => (S.rotation && S.rotation.overrides) || {}, [S.rotation]);
  // What the days show: those edits, then logged workouts and the plan.
  const eff = effectiveOverrides(S, { today: todayIso() });
  // The stored shift pattern (validated; the original rota when unset).
  // Cached per stored value, so its identity is stable between renders.
  const schedule = scheduleOf(S);
  const [editing, setEditing] = useState(null);   // resolved day | null
  // Holiday range picker. `anchor` is the first date clicked; `hover`
  // drives the live preview so the block is visible before committing,
  // the way a flight search shows the nights between two dates.
  const [booking, setBooking] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const [hover, setHover] = useState(null);

  const months = useMemo(
    () => monthRange(WINDOW.fromY, WINDOW.fromM, WINDOW.toY, WINDOW.toM),
    []);
  /* Three months at a time (one on a phone), opening on this month. All
     fifteen at once made the page 2,700px tall — 7,200 on a phone — with
     cells too small to read, and the past months took as much room as
     the coming ones. */
  const perPage = isMobile ? 1 : 3;
  const nowIdx = useMemo(() => {
    const n = new Date();
    const i = months.findIndex(([y, m]) => y === n.getFullYear() && m === n.getMonth());
    return i < 0 ? 0 : i;
  }, [months]);
  const maxStart = Math.max(0, months.length - perPage);
  const [pageStart, setPageStart] = useState(() => Math.min(nowIdx, maxStart));
  const start = Math.min(pageStart, maxStart);
  const shown = months.slice(start, start + perPage);
  const pageLabel = shown.length
    ? `${MONTHS[shown[0][1]].slice(0, 3)} ${shown[0][0]}${shown.length > 1 ? ` – ${MONTHS[shown[shown.length - 1][1]].slice(0, 3)} ${shown[shown.length - 1][0]}` : ''}`
    : '';
  const stats = useMemo(
    () => rangeStats(WINDOW.fromDate, WINDOW.toDate, overrides, schedule),
    [overrides, schedule]);
  const allowance = useMemo(
    // Scoped to the CURRENT leave year, which is what an allowance is.
    // Counting the whole override map meant the number could only fall,
    // and would have been wrong the moment January arrived.
    () => allowanceUsed(
      overrides,
      { ...ALLOWANCE_DEFAULT, ...((S.rotation || {}).allowance || {}) },
      new Date().getFullYear(),
      schedule),
    [overrides, S.rotation, schedule]);
  // Holiday blocks are a visual overlay, stored separately from the
  // per-day overrides. They shade the calendar and drive the countdown;
  // they book nothing and cost no allowance.
  const blocks = useMemo(() => (S.rotation && S.rotation.holidayBlocks) || [], [S.rotation]);
  const today = todayIso();
  const holidayDays = useMemo(() => holidayDaySet(blocks), [blocks]);
  // Days a workout was logged (✓), and training days that passed with
  // none once workouts are being logged (–, their session carries
  // forward). Only the months on screen are asked.
  const shownKey = shown.map(([y, m]) => `${y}-${m}`).join('|');
  const marks = useMemo(() => {
    const m = new Map();
    if (!shown.length) return m;
    const [y0, m0] = shown[0];
    const from = `${y0}-${String(m0 + 1).padStart(2, '0')}-01`;
    for (const p of plannedSessions(S, { from, days: 31 * shown.length + 6, today })) {
      if (p.done.length || p.source === 'done') m.set(p.iso, 'done');
      else if (p.missed) m.set(p.iso, 'missed');
    }
    return m;
  // the plan reads the rota and the finished workouts only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, S.rotation, S.lifts && S.lifts.sessions, S.lifts && S.lifts.list, today]);

  // Additive: a new `rotation` key, and within it only the days that
  // deviate. Setting a day back to its pattern value deletes the entry
  // rather than storing a redundant one, so the override map stays a
  // record of real decisions.
  function setOverride(iso, patch) {
    update(prev => {
      const cur = { ...((prev.rotation && prev.rotation.overrides) || {}) };
      const next = { ...(cur[iso] || {}), ...patch };
      Object.keys(next).forEach(k => { if (next[k] == null || next[k] === '') delete next[k]; });
      if (Object.keys(next).length) cur[iso] = next; else delete cur[iso];
      return { ...prev, rotation: { ...(prev.rotation || {}), overrides: cur } };
    });
    setEditing(e => (e && e.iso === iso ? { ...e, ...patch } : e));
  }

  function clearDay(iso) {
    update(prev => {
      const cur = { ...((prev.rotation && prev.rotation.overrides) || {}) };
      delete cur[iso];
      return { ...prev, rotation: { ...(prev.rotation || {}), overrides: cur } };
    });
    setEditing(null);
  }

  const resetIn = daysUntilReset(today);
  const editedCount = Object.keys(overrides).length;
  const upcoming = useMemo(() => nextHoliday(blocks, today), [blocks, today]);

  // The set of dates the picker is currently proposing, so the calendar
  // can shade them before anything is written.
  const preview = useMemo(
    () => (booking && anchor ? new Set(datesBetween(anchor, hover || anchor)) : null),
    [booking, anchor, hover]);

  /** Add a visual holiday block. Books nothing. */
  function addBlock(a, b) {
    const block = normaliseBlock({
      id: Math.random().toString(36).slice(2, 10), start: a, end: b, label: '',
    });
    if (!block) return;
    update(prev => ({
      ...prev,
      rotation: {
        ...(prev.rotation || {}),
        holidayBlocks: [...((prev.rotation || {}).holidayBlocks || []), block],
      },
    }));
  }

  function removeBlock(id) {
    update(prev => ({
      ...prev,
      rotation: {
        ...(prev.rotation || {}),
        holidayBlocks: ((prev.rotation || {}).holidayBlocks || []).filter(b => b.id !== id),
      },
    }));
  }

  /** A click in marking mode: first sets the anchor, second commits. */
  function pickDate(iso) {
    if (!anchor) { setAnchor(iso); setHover(iso); return; }
    addBlock(anchor, iso);
    setAnchor(null); setHover(null); setBooking(false);
  }

  return (
    <div className="upg-pane">
      <NextDays overrides={eff} raw={overrides} holidayDays={holidayDays} today={today} onOpen={setEditing} schedule={schedule} />
      <ShiftPatternCard S={S} update={update} schedule={schedule} today={today} />
      <div className="upg-stats">
        {[
          { k: 'night', n: stats.night, label: 'Night shifts' },
          { k: 'day', n: stats.day, label: 'Day shifts' },
          { k: 'off', n: stats.off, label: 'Days off' },
          { k: 'leave', n: stats.leave, label: 'Booked off' },
        ].map(s => (
          <div key={s.k} className={`upg-stat is-${s.k}`}>
            <div className="upg-stat-num">{s.n}</div>
            <div className="upg-stat-lbl">{s.label}</div>
            {/* Allowance sits under the count it relates to rather than
                in its own tile — it is the same fact, read the other
                way round. */}
            {s.k === 'leave' && (
              <>
                <div className={'upg-stat-sub' + (allowance.left <= 5 ? ' is-low' : '')}>
                  {allowance.over > 0
                    ? `0 left — ${allowance.over} over`
                    : `${allowance.left} of ${allowance.total} left`}
                </div>
                {/* The reset is the other half of the number: 12 days
                    left is a different fact in September than it is on
                    27 December. */}
                <div className="upg-stat-sub is-quiet">
                  {allowance.year} · back to {allowance.total} in {resetIn} day{resetIn === 1 ? '' : 's'}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="upg-note">
        {cycleShape(schedule, today).len}-day cycle · PPLUL from the 1st day of each shift block · cardio on upper days ·
        {' '}{stats.sessions} sessions ({stats.cardio} with cardio) · 15 Jul 2026 → 30 Sep 2027
        {editedCount > 0 && <> · <b>{editedCount} day{editedCount === 1 ? '' : 's'} edited</b></>}
      </div>

      <div className="upg-holbar">
        {!booking ? (
          <button type="button" className="upg-opt is-gold" onClick={() => setBooking(true)}>
            <Icon name="plane" size={12} /> Mark a holiday
          </button>
        ) : (
          <>
            <span className="upg-holhint">
              {anchor ? 'Now pick the last day' : 'Pick the first day'}
            </span>
            {anchor && <span className="upg-holcount">{datesBetween(anchor, hover || anchor).length} days</span>}
            <button type="button" className="upg-textbtn"
                    onClick={() => { setBooking(false); setAnchor(null); setHover(null); }}>Cancel</button>
          </>
        )}
        {upcoming && !booking && (
          <span className="upg-holnext">
            {upcoming.active
              ? <>On holiday now — {upcoming.days} day{upcoming.days === 1 ? '' : 's'}</>
              : <>Next holiday in <b>{upcoming.startsIn}</b> day{upcoming.startsIn === 1 ? '' : 's'} · {upcoming.days} day{upcoming.days === 1 ? '' : 's'}</>}
          </span>
        )}
      </div>

      {blocks.length > 0 && (
        <div className="upg-blocklist">
          {[...blocks].map(normaliseBlock).filter(Boolean)
            .sort((a, b) => a.start.localeCompare(b.start)).map(b => (
            <span key={b.id} className="upg-block">
              <b>{b.start}</b> → <b>{b.end}</b>
              <span className="upg-block-n">{datesBetween(b.start, b.end).length}d</span>
              <button type="button" className="upg-block-x" aria-label="Remove holiday"
                      onClick={() => removeBlock(b.id)}>✕</button>
            </span>
          ))}
        </div>
      )}

      <div className="upg-legend">
        <span><i className="upg-sw is-night" /> Night</span>
        <span><i className="upg-sw is-day" /> Day</span>
        <span><i className="upg-sw is-off" /> Off</span>
        <span><i className="upg-sw is-leave" /> Holiday</span>
        <span><i className="upg-sw is-cardio" /> Cardio day</span>
      </div>
      <div className="upg-legend upg-legend-plan" data-testid="rota-plan-legend">
        <span><span className="upg-mark is-edited" aria-hidden="true">●</span> Edited by you — always wins</span>
        <span><span className="upg-mark is-done" aria-hidden="true">✓</span> Workout logged</span>
        <span><span className="upg-mark is-dynamic" aria-hidden="true">↻</span> Moved by the plan</span>
        <span><span className="upg-mark is-missed" aria-hidden="true">–</span> Missed — carried forward</span>
        <span className="upg-legend-hint">
          <Icon name="pencil" size={11} /> Tap a day to change its session or book it off
        </span>
      </div>

      <div className="upg-pager" role="group" aria-label="Calendar months">
        <button type="button" className="upg-pager-btn" onClick={() => setPageStart(Math.max(0, start - perPage))}
                disabled={start === 0} aria-label="Earlier months">‹</button>
        <span className="upg-pager-lbl">{pageLabel}</span>
        <button type="button" className="upg-pager-btn" onClick={() => setPageStart(Math.min(maxStart, start + perPage))}
                disabled={start >= maxStart} aria-label="Later months">›</button>
        {start !== Math.min(nowIdx, maxStart) && (
          <button type="button" className="upg-textbtn" onClick={() => setPageStart(Math.min(nowIdx, maxStart))}>This month</button>
        )}
        <span className="upg-pager-of">{start + 1}–{Math.min(start + perPage, months.length)} of {months.length} months</span>
      </div>

      <div className={'upg-months is-paged' + (isMobile ? ' is-mobile' : '')}>
        {shown.map(([y, m]) => (
          <div key={`${y}-${m}`} className="upg-month">
            <h3>{MONTHS[m]} <span>{y}</span></h3>
            <div className="upg-dow">{DOW.map(d => <span key={d}>{d}</span>)}</div>
            <div className="upg-grid">
              {monthGrid(y, m, eff, schedule).map((cell, i) => {
                if (!cell) return <div key={`e${i}`} className="upg-cell is-empty" />;
                if (!cell.inPattern) {
                  return <div key={cell.iso} className="upg-cell is-empty"><span className="upg-dt">{cell.iso.slice(8)}</span></div>;
                }
                const inPreview = preview && preview.has(cell.iso);
                const cls = [
                  'upg-cell', `is-${cell.shift}`,
                  holidayDays.has(cell.iso) ? 'is-holiday' : '',
                  cell.cardio ? 'has-cardio' : '',
                  kindOf(eff, overrides, cell.iso, marks.get(cell.iso)) ? `is-${kindOf(eff, overrides, cell.iso, marks.get(cell.iso))}` : '',
                  cell.iso === today ? 'is-today' : '',
                  cell.iso < today ? 'is-past' : '',
                  inPreview ? 'in-range' : '',
                  booking ? 'is-picking' : '',
                ].filter(Boolean).join(' ');
                const chip = chipText(cell);
                return (
                  <button key={cell.iso} type="button" className={cls}
                          onClick={() => (booking ? pickDate(cell.iso) : setEditing(cell))}
                          onMouseEnter={() => booking && anchor && setHover(cell.iso)}
                          onFocus={() => booking && anchor && setHover(cell.iso)}
                          aria-label={`${cell.iso}: ${chip || 'off'}, ${cell.session}${KIND_WORDS[kindOf(eff, overrides, cell.iso, marks.get(cell.iso))] || ''}`}
                          title={cell.shift === 'leave'
                            ? `${leaveType(cell.leave)?.label} — would have been ${cell.baseShift}${cell.baseShiftNum || ''}`
                            : undefined}>
                    {/* Date and shift share a row rather than both being
                        absolutely placed — at this cell width the chip
                        landed on top of the number and "15" + "N1" read
                        as "15N1". */}
                    <span className="upg-cell-top">
                      <span className="upg-dt">{Number(cell.iso.slice(8))}</span>
                      {chip && <span className="upg-chip">{chip}</span>}
                    </span>
                    <span className={'upg-sess' + (cell.session === 'Rest' ? ' is-rest' : '')}
                          data-short={cell.session.slice(0, 3)}><span>{cell.session}</span></span>
                    <Mark overrides={eff} raw={overrides} iso={cell.iso} mark={marks.get(cell.iso)} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <DayEditor
          day={editing}
          schedule={schedule}
          rawEdited={!!overrides[editing.iso]}
          derived={derivedOf(eff, editing.iso)}
          plan={plannedOn(S, editing.iso, today)}
          onClose={() => setEditing(null)}
          onSet={patch => setOverride(editing.iso, patch)}
          onClear={() => clearDay(editing.iso)}
        />
      )}
    </div>
  );
}

/**
 * Day editor. A sheet rather than inline: the calendar is dense, and
 * expanding a cell in place would reflow the month under the finger
 * that just tapped it.
 */
function DayEditor({ day, schedule, onClose, onSet, onClear, rawEdited = day.edited, derived = null, plan = null }) {
  // What the pattern would say with nothing overridden — so the editor
  // can show what you are deviating FROM, and offer a way back.
  const [y, m, d] = day.iso.split('-').map(Number);
  const base = patternDay(y, m - 1, d, schedule);
  const dateLabel = new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

  return (
    <div className="modal-overlay open" onClick={onClose} role="presentation">
      <div className="modal upg-day-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="upg-day-head">
          <div>
            <div className="upg-day-date">{dateLabel}</div>
            <div className="upg-day-base">
              Pattern: {base.shift === 'off' ? 'Off' : base.shift === 'night' ? `Night ${base.shiftNum}` : `Day ${base.shiftNum}`}
              {' · '}{base.session}
            </div>
            {plan && !rawEdited && (plan.source === 'done' || plan.source === 'dynamic' || plan.missed) && (
              <div className={`upg-day-plan is-${plan.missed ? 'missed' : plan.source}`} data-testid="day-plan">
                <span className="upg-mark" aria-hidden="true">{plan.source === 'done' ? '✓' : plan.missed ? '–' : '↻'}</span>
                {plan.why}. Pick a session below to pin it by hand — yours always wins.
              </div>
            )}
          </div>
          <button type="button" className="link-del-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="upg-day-group">
          <div className="upg-day-label">Session</div>
          <div className="upg-chipset">
            {SESSION_OPTIONS.map(s => (
              <button key={s} type="button"
                      className={'upg-opt' + (day.session === s ? ' is-on' : '')}
                      onClick={() => onSet({ session: s === base.session && !derived ? null : s })}>{s}</button>
            ))}
          </div>
        </div>

        <div className="upg-day-group">
          <div className="upg-day-label">
            Shift
            {base.shift === 'off' && <span className="upg-day-sub"> — already an off day</span>}
          </div>
          <div className="upg-chipset">
            <button type="button"
                    className={'upg-opt' + (!day.leave ? ' is-on' : '')}
                    onClick={() => onSet({ leave: null })}>Working</button>
            {LEAVE_TYPES.map(l => (
              <button key={l.id} type="button"
                      className={'upg-opt' + (day.leave === l.id ? ' is-on' : '')}
                      onClick={() => onSet({ leave: l.id })}>{l.label}</button>
            ))}
          </div>
        </div>

        <div className="upg-day-group">
          <div className="upg-day-label">Note</div>
          <input className="upg-day-note" type="text" maxLength={120}
                 placeholder="Optional — why, or what you swapped it for"
                 value={day.note || ''}
                 onChange={e => onSet({ note: e.target.value })} />
        </div>

        <div className="upg-day-actions">
          {rawEdited && (
            <button type="button" className="upg-textbtn" onClick={onClear}>{derived || (plan && plan.source === 'dynamic') ? 'Clear my edit' : 'Reset to pattern'}</button>
          )}
          <button type="button" className="link-open-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
