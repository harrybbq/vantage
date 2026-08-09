/**
 * Rotation widget — today's shift, today's session, next holiday.
 *
 * The rotation lives on its own page fifteen months long. The three
 * facts you actually want daily are what you're on, what you're
 * training, and how far off the next break is — and those don't justify
 * opening a calendar.
 *
 * Owner-only, like the page it reads from. Everything comes from
 * lib/rotation/pattern.js, so the widget and the calendar cannot
 * disagree about what today is.
 */
import { useMemo } from 'react';
import {
  chipText, holidayDaySet, leaveType, nextHoliday, resolveDay,
} from '../../lib/rotation/pattern';

const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

const SHIFT_LABEL = { night: 'Night shift', day: 'Day shift', off: 'Off', leave: 'Booked off' };

export function RotationBody({ S, navigate }) {
  const iso = todayIso();
  const rotation = S.rotation || {};
  const overrides = rotation.overrides || {};
  const blocks = useMemo(() => rotation.holidayBlocks || [], [rotation.holidayBlocks]);

  const [y, m, d] = iso.split('-').map(Number);
  const day = resolveDay(y, m - 1, d, overrides);
  const onHoliday = holidayDaySet(blocks).has(iso);
  const upcoming = nextHoliday(blocks, iso);

  // Tomorrow, because on a night shift "what's next" is the question
  // you're actually asking at 3am.
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  const next = resolveDay(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), overrides);

  if (!day.inPattern) {
    return (
      <div className="rw">
        <div className="rw-empty">The rota starts 15 Jul 2026.</div>
      </div>
    );
  }

  const chip = chipText(day);
  const label = day.shift === 'leave'
    ? (leaveType(day.leave)?.label || 'Booked off')
    : SHIFT_LABEL[day.shift];

  return (
    <div className={'rw' + (onHoliday ? ' is-holiday' : '')}
         onClick={navigate ? () => navigate('upgrade') : undefined}
         role={navigate ? 'link' : undefined} tabIndex={navigate ? 0 : undefined}>
      <div className="rw-today">
        <div className={`rw-badge is-${day.shift}`}>{chip || '—'}</div>
        <div className="rw-today-text">
          <div className="rw-shift">{label}</div>
          <div className="rw-next">Tomorrow · {chipText(next) || SHIFT_LABEL[next.shift]}</div>
        </div>
      </div>

      <div className={'rw-session' + (day.session === 'Rest' ? ' is-rest' : '')}>
        <span className="rw-session-lbl">Training</span>
        <span className="rw-session-val">{day.session}</span>
        {day.cardio && <span className="rw-cardio">+ cardio</span>}
      </div>

      <div className="rw-hol">
        {upcoming ? (
          upcoming.active ? (
            <><span className="rw-hol-n">On holiday</span>
              <span className="rw-hol-lbl">{upcoming.days} day{upcoming.days === 1 ? '' : 's'}</span></>
          ) : (
            <><span className="rw-hol-n">{upcoming.startsIn}</span>
              <span className="rw-hol-lbl">
                day{upcoming.startsIn === 1 ? '' : 's'} to your next holiday · {upcoming.days} day{upcoming.days === 1 ? '' : 's'} off
              </span></>
          )
        ) : (
          <span className="rw-hol-lbl">No holiday marked yet.</span>
        )}
      </div>
    </div>
  );
}

export default RotationBody;
