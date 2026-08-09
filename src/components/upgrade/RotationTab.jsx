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
 */
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import {
  LEAVE_TYPES, SESSION_OPTIONS, WINDOW, chipText, leaveType,
  monthGrid, monthRange, rangeStats, patternDay,
} from '../../lib/rotation/pattern';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

export default function RotationTab({ S, update, isMobile }) {
  const overrides = useMemo(() => (S.rotation && S.rotation.overrides) || {}, [S.rotation]);
  const [editing, setEditing] = useState(null);   // resolved day | null

  const months = useMemo(
    () => monthRange(WINDOW.fromY, WINDOW.fromM, WINDOW.toY, WINDOW.toM),
    []);
  const stats = useMemo(
    () => rangeStats(WINDOW.fromDate, WINDOW.toDate, overrides),
    [overrides]);

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

  const today = todayIso();
  const editedCount = Object.keys(overrides).length;

  return (
    <div className="upg-pane">
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
          </div>
        ))}
      </div>

      <div className="upg-note">
        16-day cycle · PPLUL rolling continuously · cardio on upper days ·
        {' '}{stats.sessions} sessions ({stats.cardio} with cardio) · 15 Jul 2026 → 30 Sep 2027
        {editedCount > 0 && <> · <b>{editedCount} day{editedCount === 1 ? '' : 's'} edited</b></>}
      </div>

      <div className="upg-legend">
        <span><i className="upg-sw is-night" /> Night</span>
        <span><i className="upg-sw is-day" /> Day</span>
        <span><i className="upg-sw is-off" /> Off</span>
        <span><i className="upg-sw is-leave" /> Leave</span>
        <span><i className="upg-sw is-cardio" /> Cardio day</span>
        <span className="upg-legend-hint">
          <Icon name="pencil" size={11} /> Tap a day to change its session or book it off
        </span>
      </div>

      <div className={'upg-months' + (isMobile ? ' is-mobile' : '')}>
        {months.map(([y, m]) => (
          <div key={`${y}-${m}`} className="upg-month">
            <h3>{MONTHS[m]} <span>{y}</span></h3>
            <div className="upg-dow">{DOW.map(d => <span key={d}>{d}</span>)}</div>
            <div className="upg-grid">
              {monthGrid(y, m, overrides).map((cell, i) => {
                if (!cell) return <div key={`e${i}`} className="upg-cell is-empty" />;
                if (!cell.inPattern) {
                  return <div key={cell.iso} className="upg-cell is-empty"><span className="upg-dt">{cell.iso.slice(8)}</span></div>;
                }
                const cls = [
                  'upg-cell', `is-${cell.shift}`,
                  cell.cardio ? 'has-cardio' : '',
                  cell.edited ? 'is-edited' : '',
                  cell.iso === today ? 'is-today' : '',
                  cell.iso < today ? 'is-past' : '',
                ].filter(Boolean).join(' ');
                const chip = chipText(cell);
                return (
                  <button key={cell.iso} type="button" className={cls}
                          onClick={() => setEditing(cell)}
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
                    <span className={'upg-sess' + (cell.session === 'Rest' ? ' is-rest' : '')}>{cell.session}</span>
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
function DayEditor({ day, onClose, onSet, onClear }) {
  // What the pattern would say with nothing overridden — so the editor
  // can show what you are deviating FROM, and offer a way back.
  const [y, m, d] = day.iso.split('-').map(Number);
  const base = patternDay(y, m - 1, d);
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
          </div>
          <button type="button" className="link-del-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="upg-day-group">
          <div className="upg-day-label">Session</div>
          <div className="upg-chipset">
            {SESSION_OPTIONS.map(s => (
              <button key={s} type="button"
                      className={'upg-opt' + (day.session === s ? ' is-on' : '')}
                      onClick={() => onSet({ session: s === base.session ? null : s })}>{s}</button>
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
          {day.edited && (
            <button type="button" className="upg-textbtn" onClick={onClear}>Reset to pattern</button>
          )}
          <button type="button" className="link-open-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
