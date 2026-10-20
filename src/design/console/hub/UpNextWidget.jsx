/**
 * Up next — the hub's door into the calendar.
 *
 * The next trip (cover photo, name, dates, countdown), then the next
 * three things on the calendar: the user's own events (single-day and
 * multi-day spans, through lib/calendar/events.js eventsOn, which is the
 * one read path for the store) and bill renewals (lib/money/recurring
 * nextRenewal, which rolls a stale date forward). Trip days themselves
 * are not repeated in the list — the card above already is the trip.
 * Everything opens Track.
 */
import { useMemo } from 'react';
import Icon from '../../../components/Icon';
import { eventsOn, todayIso, eventColour } from '../../../lib/calendar/events';
import { nextRenewal } from '../../../lib/money/recurring';

const DAY = 86400000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const at = iso => new Date(iso + 'T12:00');
const dShort = d => `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
const gbp = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function when(iso, today, time) {
  const d = at(iso);
  const days = Math.round((d - at(today)) / DAY);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days < 7 ? WD[d.getDay()] : `${d.getDate()} ${MON[d.getMonth()]}`;
  return time ? `${day} ${time}` : day;
}

export function nextTrip(S, today) {
  return (S.holidays || []).filter(h => h && h.status !== 'completed' && h.from && h.from >= today)
    .sort((a, b) => (a.from < b.from ? -1 : 1))[0] || null;
}

export function upcoming(S, now = new Date(), n = 3) {
  const today = todayIso(now);
  const out = [];
  const seenSpan = new Set();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 60 && out.length < n + 6; i++) {
    const iso = todayIso(d);
    for (const ev of eventsOn(S, iso)) {
      if (ev.source === 'holiday') continue;
      if (ev.source === 'span') {
        const key = ev.spanId || ev.id || ev.title;
        if (seenSpan.has(key)) continue;
        seenSpan.add(key);
      }
      // An event already over today is not "next".
      if (iso === today && ev.time) {
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if ((ev.end || ev.time) < hhmm) continue;
      }
      const span = ev.source === 'span' && ev.dayCount > 1;
      out.push({
        key: `e:${iso}:${ev.id || ev.title}`, iso, sort: `${iso} ${ev.time || '99'}`,
        title: ev.title || 'Untitled', colour: eventColour(ev),
        right: span ? `${when(iso, today)}${ev.dayIndex > 1 ? ', ongoing' : ''} · ${ev.dayCount} days` : when(iso, today, ev.time),
      });
    }
    d.setDate(d.getDate() + 1);
  }
  for (const s of S.subscriptions || []) {
    const r = nextRenewal(s, now);
    if (!r) continue;
    const iso = todayIso(r);
    if ((r - at(today)) / DAY > 60) continue;
    out.push({ key: `b:${s.id}`, iso, sort: `${iso} 98`, title: `${s.name} renews`, colour: 'var(--cx-muted)', right: `${when(iso, today)} · ${gbp(s.amount)}`, bill: true });
  }
  return out.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0)).slice(0, n);
}

export default function UpNextWidget({ S, navigate, size }) {
  const now = new Date();
  const today = todayIso(now);
  const trip = nextTrip(S, today);
  const items = useMemo(() => upcoming(S, now, size === 'small' ? 1 : 3),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [S.calendarEvents, S.subscriptions, S.holidays, today, size]);
  const go = () => navigate?.('track');
  if (!trip && !items.length) return <p className="cx-hub-empty">Nothing coming up in the next 60 days.</p>;
  const days = trip ? Math.round((at(trip.from) - at(today)) / DAY) : null;
  const nights = trip && trip.to ? Math.max(0, Math.round((at(trip.to) - at(trip.from)) / DAY)) : null;
  const img = trip && /^(https?:|data:image\/)/i.test(trip.imageUrl || '') ? trip.imageUrl : null;
  return (
    <div className="cx-hub-upnext">
      {trip && (
        <button type="button" className={`cx-hub-trip${img ? ' has-img' : ''}`} onClick={go}
                style={img ? { backgroundImage: `url("${img.replace(/"/g, '%22')}")` } : undefined}
                aria-label={`${trip.name || trip.dest || 'Trip'}, in ${days} days. Open the calendar`}>
          <span className="cx-hub-trip-ov" aria-hidden="true" />
          <span className="cx-hub-trip-txt">
            <span className="cx-hub-trip-nm">{trip.name || trip.dest || trip.destination || 'Trip'}</span>
            <span className="cx-hub-trip-dt">
              {dShort(at(trip.from))}{trip.to ? ` – ${dShort(at(trip.to))}` : ''}{nights ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}
            </span>
          </span>
          <span className="cx-hub-trip-in">
            {days === 0 ? 'Today' : <><span className="cx-num">{days}</span> <small>day{days === 1 ? '' : 's'}</small></>}
          </span>
        </button>
      )}
      {size !== 'small' && items.length > 0 && (
        <ul className="cx-hub-list">
          {items.map(it => (
            <li key={it.key}>
              <button type="button" className="cx-hub-row" onClick={go}>
                <span className="cx-hub-dot" style={{ background: it.colour }} aria-hidden="true" />
                <span className="cx-hub-ell">{it.title}</span>
                <span className="cx-hub-sp" />
                <span className="cx-muted cx-hub-nowrap">{it.right}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!trip && size === 'small' && items[0] && (
        <button type="button" className="cx-hub-row" onClick={go}>
          <Icon name="calendar-days" size={14} />
          <span className="cx-hub-ell">{items[0].title}</span>
        </button>
      )}
    </div>
  );
}
