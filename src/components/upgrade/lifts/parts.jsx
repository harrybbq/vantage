/**
 * Small pieces shared by the Lifts screens: the sparkline, the ± stepper,
 * the labelled field, the Undo toast and the PB celebration. The toast
 * and the celebration are portalled to <body> (re-wrapped in the theme
 * classes) because an ancestor of the section can carry a transform,
 * which would pin a fixed element to the page instead of the screen.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../Icon';

/** Width of an element, kept current. */
export function useWidth(fallback = 600) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setW(Math.max(120, Math.round(el.getBoundingClientRect().width)));
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Estimated-1RM sparkline (a trend, not PBs): the best day-shift set of each week, to scale on both
 * axes (x is time, not index), drawn at the card's real width; the last
 * point dotted. Night sets (80% load) are left out so the line is the
 * trend, not the rota. Decorative — the card states the numbers in words.
 */
export function Spark({ points, from, to }) {
  const [ref, W] = useWidth(240);
  const H = 32, P = 3;
  if (!points || points.length < 2) {
    return <svg ref={ref} className="lf-spark is-empty" width="100%" height={H} aria-hidden="true"><line x1={P} x2={W - P} y1={H / 2} y2={H / 2} /></svg>;
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x0 = from ?? Math.min(...xs), x1 = to ?? Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < 1) { y0 -= 1; y1 += 1; }
  const X = x => P + ((x - x0) / Math.max(1, x1 - x0)) * (W - 2 * P);
  const Y = y => H - P - ((y - y0) / (y1 - y0)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg ref={ref} className="lf-spark" width="100%" height={H} aria-hidden="true">
      <path className="lf-spark-line" d={d} />
      <circle className="lf-spark-dot" cx={X(last.x)} cy={Y(last.y)} r="2.6" />
    </svg>
  );
}

/**
 * The gym switch (DXC | Greenock …) — a segmented control. `value` null
 * shows nothing selected (an unassigned set being edited).
 */
export function GymSwitch({ gyms, value, onChange, label = 'Gym', className = '', testId }) {
  if (!gyms || !gyms.length) return null;
  return (
    <div className={`sec-seg lf-seg lf-gymseg${className ? ` ${className}` : ''}`} role="group" aria-label={label} data-testid={testId}>
      {gyms.map(g => (
        <button key={g.id} type="button" aria-pressed={value === g.id} className={value === g.id ? 'is-on' : ''} onClick={() => onChange(g.id)}>
          {g.name}
        </button>
      ))}
    </div>
  );
}

/** − value + with a typed value in the middle. */
export function Stepper({ id, label, value, onChange, step, min, max, decimal = false, unit, dataField }) {
  const n = Number(value);
  const bump = dir => {
    const base = Number.isFinite(n) ? n : 0;
    let v = Math.round((base + dir * step) * 100) / 100;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    onChange(String(v));
  };
  return (
    <div className="lf-step" role="group" aria-labelledby={`${id}-lbl`}>
      <button type="button" className="lf-step-btn" onClick={() => bump(-1)} aria-label={`${label} down ${step}`}
              disabled={Number.isFinite(n) && min != null && n <= min}>
        <Icon name="minus" size={16} />
      </button>
      <span className="lf-step-box">
        <input id={id} data-field={dataField} inputMode={decimal ? 'decimal' : 'numeric'} autoComplete="off"
               value={value} onChange={e => onChange(e.target.value.replace(',', '.'))} aria-describedby={`${id}-lbl`} />
        {unit && <span className="lf-step-unit" aria-hidden="true">{unit}</span>}
      </span>
      <button type="button" className="lf-step-btn" onClick={() => bump(1)} aria-label={`${label} up ${step}`}
              disabled={Number.isFinite(n) && max != null && n >= max}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

export function Field({ label, id, error, hint, children, wide = false, as = 'label' }) {
  const Tag = as;
  return (
    <Tag className={`lf-field${wide ? ' is-wide' : ''}${error ? ' has-error' : ''}`} {...(as === 'label' ? { htmlFor: id } : {})}>
      <span className="lf-field-lbl" id={`${id}-lbl`}>{label}</span>
      {children}
      {error ? <span className="lf-field-err" role="alert">{error}</span> : hint ? <span className="lf-field-hint">{hint}</span> : null}
    </Tag>
  );
}

/** Five-second toast; `toast.undo` adds an Undo button. */
export function Toast({ toast, onUndo, onDone }) {
  const [left, setLeft] = useState(5);
  const t = useRef(null);
  useEffect(() => {
    if (!toast) return undefined;
    setLeft(5);
    const started = Date.now();
    t.current = setInterval(() => {
      const l = 5 - Math.floor((Date.now() - started) / 1000);
      if (l <= 0) { clearInterval(t.current); onDone(); } else setLeft(l);
    }, 250);
    return () => clearInterval(t.current);
  }, [toast, onDone]);
  if (!toast) return null;
  return createPortal(
    <div className="upg-app sec lifts lf-toast-root">
      <div className="lf-toast" role="status" aria-live="polite">
        <span className="lf-toast-text">{toast.text}</span>
        {toast.undo && (
          <button type="button" className="lf-toast-undo" onClick={() => { clearInterval(t.current); onUndo(toast); }}>
            Undo <span className="lf-toast-left" aria-hidden="true">{left}s</span>
          </button>
        )}
        <button type="button" className="lf-toast-x" aria-label="Dismiss" onClick={() => { clearInterval(t.current); onDone(); }}>
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The PB moment: a trophy, the line ("New PB: Leg press 180 kg × 6") and
 * which real-set records it beat ("heaviest · 5RM") — never an estimate. A short burst of sparks
 * behind the trophy; none under prefers-reduced-motion (CSS). Stays
 * 4.5 s, or until dismissed.
 */
export function Celebrate({ pb, onDone }) {
  useEffect(() => {
    if (!pb) return undefined;
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, [pb, onDone]);
  if (!pb) return null;
  return createPortal(
    <div className="upg-app sec lifts lf-cele-root">
      <div className="lf-cele" role="status" aria-live="assertive" data-testid="lift-pb">
        <span className="lf-cele-icon" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--k': i }} />)}
          <Icon name="trophy" size={22} strokeWidth={2} />
        </span>
        <span className="lf-cele-main">
          <b className="lf-cele-text">{pb.text}</b>
          {pb.kinds && pb.kinds.length > 0 && <span className="lf-cele-kinds">Beat your {pb.kinds.join(' · ')}</span>}
        </span>
        <button type="button" className="lf-toast-x" aria-label="Dismiss" onClick={onDone}><Icon name="x" size={14} /></button>
      </div>
    </div>,
    document.body,
  );
}
