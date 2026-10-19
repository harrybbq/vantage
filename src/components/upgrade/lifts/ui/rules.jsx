/**
 * The three rules, made visible (brief §3.2) — build once, use wherever a
 * number appears.
 *
 *   <RealBest>      a set that was actually lifted: "192.5 × 5", an
 *                   optional gold ◆ PB badge, a date and a gym tag. Exact.
 *   <Estimate>      "est. 1RM ~241 kg" — always "est.", always "~", 1 kg on
 *                   tiles / 0.5 kg in readouts, muted, dashed when boxed,
 *                   NEVER gold. ⓘ opens the explainer popover.
 *   <CompareScope>  "COMPARED WITHIN DXC" (a machine) / "COMPARED ACROSS
 *                   GYMS" (a free weight) — one 12 px mono line under a
 *                   lift's title. Tap → an explainer sheet; the setting
 *                   itself lives only in Manage lifts (onManage).
 *   <NightChip>     "☾ NIGHT · 80 %" — indigo + a moon shape, so it reads
 *                   with any accent. variant="inline" is the small "☾ 80 %"
 *                   beside a scaled value.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtEstimate, realSetText, fmtShortDate, compareScope, ESTIMATE_EXPLAINER } from '../../../../lib/lifts/ui';
import { useScopeStyle } from './scope';
import Sheet from './Sheet';
import { Button } from './controls';
import './ui.css';

const cx = (...a) => a.filter(Boolean).join(' ');

/** The gold diamond — the PB shape. Decorative (the badge says "PB" in words). */
export const PbMark = ({ className = '' }) => <span className={cx('lf-pbmark', className)} aria-hidden="true">◆</span>;
/** The night moon — the night shape. */
export const NightMark = ({ className = '' }) => <span className={cx('lf-nightmark', className)} aria-hidden="true">☾</span>;

/**
 * <RealBest entry={{ weight, reps, date?, gym? }} | weight reps date gym
 *           lift pb gymLabel today size="sm|md|lg" showDate className>
 * `gymLabel` (e.g. "DXC") shows a gym tag — pass it for gym-specific
 * (machine) values only. `pb` adds ◆ PB. `lift` formats a dip "+20 × 8".
 */
export function RealBest({ entry, weight, reps, date, lift = null, pb = false, gymLabel = null, today = null, size = 'md', showDate = true, unit = 'kg', className = '' }) {
  const w = entry ? entry.weight : weight;
  const r = entry ? entry.reps : reps;
  const d = entry ? entry.date : date;
  const txt = realSetText(w, r, lift);
  const per = lift && lift.load === 'per_hand';
  return (
    <span className={cx('lf-realbest', `is-${size}`, pb && 'is-pb', className)}>
      <span className="lf-realbest-val lf-num">{txt}{txt !== '—' && unit && <span className="lf-realbest-unit">{per ? `${unit}/hand` : lift && lift.load === 'bodyweight_plus' ? '' : unit}</span>}</span>
      {pb && <span className="lf-pbbadge"><PbMark /> PB</span>}
      {showDate && d && <span className="lf-realbest-date">{fmtShortDate(d, today)}</span>}
      {gymLabel && <span className="lf-gymchip">{gymLabel}</span>}
    </span>
  );
}

/**
 * <Estimate value low ctx="tile|readout" label="est. 1RM" unit boxed showInfo className>
 * `boxed` draws the dashed tile boundary. The ⓘ popover explains Epley and
 * that PBs only come from real sets.
 */
export function Estimate({ value, low = false, ctx = 'tile', label = 'est. 1RM', unit = 'kg', boxed = false, showInfo = true, className = '' }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const id = useId();
  const tipId = `lf-est-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <span className={cx('lf-estimate', boxed && 'lf-st is-est is-boxed', className)}>
      <span className="lf-estimate-val lf-num">{fmtEstimate(value, { ctx, low, label, unit })}</span>
      {showInfo && (
        <button ref={btn} type="button" className="lf-info" aria-label="What is an estimate?" aria-expanded={open} aria-controls={open ? tipId : undefined}
                onClick={() => setOpen(o => !o)} data-testid="lf-est-info">
          <span aria-hidden="true">ⓘ</span>
        </button>
      )}
      {open && <Popover anchor={btn} id={tipId} onClose={() => setOpen(false)}>{ESTIMATE_EXPLAINER}</Popover>}
    </span>
  );
}

/** A small explainer bubble anchored under (or above) a button, kept inside the viewport with a 16 px gutter. */
function Popover({ anchor, id, onClose, children }) {
  const ref = useRef(null);
  const style = useScopeStyle();
  const [pos, setPos] = useState({ left: 16, top: -9999, w: 300 });
  const place = useCallback(() => {
    const a = anchor.current, el = ref.current;
    if (!a || !el) return;
    const r = a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const w = Math.min(300, vw - 32);
    const h = el.offsetHeight;
    const left = Math.max(16, Math.min(vw - 16 - w, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 6;
    const top = below + h > vh - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : below;
    setPos({ left, top, w });
  }, [anchor]);
  useLayoutEffect(place, [place]);
  useEffect(() => {
    const off = e => { if (ref.current && !ref.current.contains(e.target) && !(anchor.current && anchor.current.contains(e.target))) onClose(); };
    const key = e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', off);
    window.addEventListener('keydown', key, true);   // window capture: before a sheet's document-capture Esc
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', off);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [onClose, place, anchor]);
  return createPortal(
    <div className="upg-app sec lifts lf-pop-root" style={style}>
      <div ref={ref} id={id} role="tooltip" className="lf-pop" style={{ left: pos.left, top: pos.top, width: pos.w }} data-testid="lf-pop">{children}</div>
    </div>,
    document.body,
  );
}

/**
 * <CompareScope lift gymLabel onManage className>
 * Machine → "COMPARED WITHIN DXC" (the active gym's name); free weight →
 * "COMPARED ACROSS GYMS". Tap → explainer sheet; "Change in Manage lifts ›"
 * calls onManage (omit it where Manage isn't reachable).
 */
export function CompareScope({ lift, gymLabel = null, onManage = null, className = '' }) {
  const [open, setOpen] = useState(false);
  const sc = compareScope(lift, gymLabel);
  const name = lift && lift.name ? lift.name : 'This lift';
  return (
    <>
      <button type="button" className={cx('lf-scope', sc.perGym && 'is-pergym', className)} onClick={() => setOpen(true)} aria-haspopup="dialog"
              data-testid="lf-scope">
        <span className="lf-scope-txt">{sc.text}</span>
      </button>
      {open && (
        <Sheet title={sc.perGym ? `Compared within ${sc.short}` : 'Compared across gyms'} eyebrow="// How this lift is compared" onClose={() => setOpen(false)}
               testId="lf-scope-sheet"
               footer={onManage ? <Button variant="secondary" size="lg" block iconRight="chevron-right" onClick={() => { setOpen(false); onManage(lift); }}>Change in Manage lifts</Button> : null}>
          <div className="lf-explain">
            {sc.perGym ? (
              <>
                <p><b>{name}</b> is a machine. A machine at one gym isn&apos;t the same machine at another, so 100 kg here isn&apos;t 100 kg there.</p>
                <p>Previous, the suggested weights, your PBs and the chart only use sets logged at <b>{sc.short}</b>. Each gym keeps its own record.</p>
              </>
            ) : (
              <>
                <p><b>{name}</b> is a free weight. A plate is a plate at any gym, so every gym counts toward one record.</p>
                <p>Previous, PBs and the chart use sets from every gym.</p>
              </>
            )}
            <p className="lf-meta">This is set per lift in Manage lifts.</p>
          </div>
        </Sheet>
      )}
    </>
  );
}

/**
 * <NightChip scale={0.8} variant="chip|inline" label className>
 * chip: "☾ NIGHT · 80 %"; inline: "☾ 80 %" (or `label`) beside a scaled value.
 */
export function NightChip({ scale = 0.8, variant = 'chip', label = null, className = '' }) {
  const pct = `${Math.round(scale * 100)} %`;
  if (variant === 'inline') {
    return <span className={cx('lf-night-inline', className)}><NightMark /> {label || pct}</span>;
  }
  return <span className={cx('lf-nightchip', className)}><NightMark /> {label || `Night · ${pct}`}</span>;
}
