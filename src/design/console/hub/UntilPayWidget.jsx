/**
 * Until pay — the hub's view of lib/money/payday (owner, Nov 2026;
 * mockup C). The total of subscription renewals from today up to the
 * next pay day, how many days that is, and the next few; the title goes
 * to Track, where the pay day is marked and changed.
 */
import { useMemo } from 'react';
import { beforePay, payOf } from '../../../lib/money/payday';
import { todayIso } from '../../../lib/calendar/events';

const gbp = n => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = iso => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** The frame's right-hand label: the next pay date. */
export function untilPayMeta(S) {
  const b = beforePay(S, todayIso(new Date()));
  return b ? short(b.next) : 'Track';
}

export default function UntilPayWidget({ S, navigate, size }) {
  const today = todayIso(new Date());
  const info = useMemo(() => beforePay(S, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [S.pay, S.subscriptions, today]);
  const go = () => navigate?.('track');

  if (!payOf(S) || !info) {
    return (
      <div className="cx-hub-kpi-wrap">
        <p className="cx-hub-empty">Mark your pay day on the Track calendar to see what’s still to come out before it.</p>
        <button type="button" className="cx-hub-foot-row" onClick={go}>
          <span className="cx-accent">Open Track</span>
        </button>
      </div>
    );
  }

  const shown = size === 'small' ? [] : info.items.slice(0, 3);
  const more = info.items.length - shown.length;
  return (
    <div className="cx-hub-kpi-wrap cx-hub-untilpay">
      <div className="cx-hub-kpi">
        <span className="cx-num cx-hub-kpi-v">{gbp(info.total)}</span>
        <span className="cx-hub-kpi-l">
          {info.items.length ? 'subscriptions still to come out' : 'nothing renews before pay'}
          {' · '}<span className="cx-num">{info.days}</span> day{info.days === 1 ? '' : 's'} to pay
        </span>
      </div>
      {shown.length > 0 && (
        <ul className="cx-hub-list">
          {shown.map(it => (
            <li key={`${it.id}-${it.iso}`}>
              <button type="button" className="cx-hub-row" onClick={go}>
                <span className="cx-muted cx-hub-nowrap cx-hub-untilpay-d">{it.iso === today ? 'Today' : short(it.iso)}</span>
                <span className="cx-hub-ell">{it.name}</span>
                <span className="cx-hub-sp" />
                <span className="cx-num cx-hub-nowrap">{gbp(it.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <button type="button" className="cx-hub-foot-row" onClick={go}>
          <span className="cx-muted">+{more} more before pay</span>
        </button>
      )}
    </div>
  );
}
