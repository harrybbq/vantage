/**
 * "Pay in 9 days · £72.97 of subscriptions to go" — the small indicator
 * on the Track calendar, in both designs (owner, Nov 2026).
 *
 * Tap it for the list: each subscription renewal from today up to the
 * next pay day, and the schedule with Change. With no pay day set it
 * offers one, but only to someone who has subscriptions to count.
 * Everything comes from lib/money/payday.js; this only draws it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { beforePay, payOf, freqLabel, inDays } from '../../lib/money/payday';
import './PayIndicator.css';

const pad = n => String(n).padStart(2, '0');
export const todayIso = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const short = iso => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const gbp = n => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayIndicator({ S, onEdit, today = todayIso() }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const popRef = useRef(null);
  const pay = payOf(S);
  const info = useMemo(() => beforePay(S, today), [S, today]);
  const hasSubs = Array.isArray(S && S.subscriptions) && S.subscriptions.some(s => s && s.nextDate);

  useEffect(() => {
    if (!open) return undefined;
    const down = e => {
      if (ref.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // Page scroll or resize moves the button away from the list; scrolling
    // the list itself (long on a phone) must not close it.
    const shut = e => { if (e && e.target && popRef.current?.contains(e.target)) return; setOpen(false); };
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    const key = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key);
      window.removeEventListener('resize', shut); window.removeEventListener('scroll', shut, true);
    };
  }, [open]);

  // The list is portalled to <body> and placed under the button: inside a
  // card it would be clipped by the card's edge, and classic's Track card
  // re-points the text colours for its dark panels.
  useLayoutEffect(() => {
    if (!open || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(320, vw - 32);
    const left = Math.max(16, Math.min(r.left, vw - w - 16));
    // Below the button when there's room, else above; never off-screen
    // (the list scrolls inside instead).
    const below = vh - r.bottom - 16, above = r.top - 16;
    setPos(below >= 260 || below >= above
      ? { top: r.bottom + 6, left, width: w, maxHeight: Math.min(420, below) }
      : { bottom: vh - r.top + 6, left, width: w, maxHeight: Math.min(420, above) });
  }, [open]);

  if (!pay) {
    if (!hasSubs || !onEdit) return null;
    return (
      <button type="button" className="payind payind-setup" onClick={() => onEdit(today)}>
        <Icon name="coin" size={14} strokeWidth={1.75} />
        <span>Set your pay day</span>
      </button>
    );
  }
  if (!info) {
    // A one-off pay day that has passed.
    return onEdit ? (
      <button type="button" className="payind payind-setup" onClick={() => onEdit(today)}>
        <Icon name="coin" size={14} strokeWidth={1.75} /><span>Set your next pay day</span>
      </button>
    ) : null;
  }

  const n = info.items.length;
  const label = `Pay ${inDays(info.days)}`;
  const due = n ? `${gbp(info.total)} of subscriptions to go` : 'no subscriptions due';
  return (
    <div className="payind-wrap" ref={ref}>
      <button type="button" className={`payind${n ? '' : ' is-clear'}`} aria-expanded={open} onClick={() => setOpen(o => !o)}
              aria-label={`${label}, ${short(info.next)}. ${due}. Show the list`}>
        <Icon name="coin" size={14} strokeWidth={1.75} />
        <span className="payind-when">{label}</span>
        <span className="payind-sep" aria-hidden="true">·</span>
        <span className="payind-due">{n ? <><b>{gbp(info.total)}</b> to go</> : 'nothing due'}</span>
      </button>
      {open && pos && createPortal(
        <div className="payind-pop" role="dialog" aria-label="Before your next pay" ref={popRef}
             style={pos}>
          <div className="payind-pop-head">
            <span>Before pay on {short(info.next)}</span>
            <b>{gbp(info.total)}</b>
          </div>
          {n ? (
            <ul className="payind-list">
              {info.items.map(it => (
                <li key={`${it.id}-${it.iso}`}>
                  <span className="payind-d">{short(it.iso)}</span>
                  <span className="payind-n">{it.name}</span>
                  <span className="payind-a">{gbp(it.amount)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="payind-empty">No subscriptions renew before then.</p>}
          <div className="payind-pop-foot">
            <span>{info.paidToday ? 'Paid today · ' : ''}{freqLabel(pay.freq)}{pay.weekendEarly ? ', Friday before a weekend' : ''}</span>
            {onEdit && <button type="button" className="payind-link" onClick={() => { setOpen(false); onEdit(info.next); }}>Change</button>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
