/**
 * Toasts, portalled to <body> in the `.lifts` scope.
 *
 * <UndoToast toast={{ text, undo?, n }} onUndo onDone duration=5000 bottom>
 *   Bottom of the screen, 5 s with a visible countdown on Undo. `toast.n`
 *   (any changing value) restarts it for a new message. `bottom` lifts it
 *   clear of a docked bar (the rest timer / pad), in px.
 *   parts.jsx `Toast` is this, so older callers keep working.
 *
 * <PbToast pb={{ text, kinds?, n }} onDone duration=3000>
 *   Top of the screen, 3 s, gold ◆ — a REAL set only (never an estimate,
 *   never a trophy for one). `kinds` lists which records it beat.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../Icon';
import { useScopeStyle } from './scope';
import { PbMark } from './rules';
import './ui.css';

export function UndoToast({ toast, onUndo, onDone, duration = 5000, bottom = 0 }) {
  const style = useScopeStyle();
  const secs = Math.max(1, Math.round(duration / 1000));
  const [left, setLeft] = useState(secs);
  const t = useRef(null);
  useEffect(() => {
    if (!toast) return undefined;
    setLeft(secs);
    const started = Date.now();
    t.current = setInterval(() => {
      const l = secs - Math.floor((Date.now() - started) / 1000);
      if (Date.now() - started >= duration) { clearInterval(t.current); onDone(); } else setLeft(l);
    }, 250);
    return () => clearInterval(t.current);
  }, [toast, onDone, duration, secs]);
  if (!toast) return null;
  return createPortal(
    <div className="upg-app sec lifts lf-toast-root lf-utoast-root" style={{ ...style, '--lf-toast-bottom': `${bottom}px` }}>
      <div className="lf-utoast" role="status" aria-live="polite" data-testid="lf-undo-toast">
        <span className="lf-utoast-text">{toast.text}</span>
        {toast.undo && onUndo && (
          <button type="button" className="lf-utoast-undo" onClick={() => { clearInterval(t.current); onUndo(toast); }}>
            Undo <span className="lf-utoast-left lf-num" aria-hidden="true">{left}s</span>
          </button>
        )}
        <button type="button" className="lf-iconbtn lf-utoast-x" aria-label="Dismiss" onClick={() => { clearInterval(t.current); onDone(); }}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function PbToast({ pb, onDone, duration = 3000 }) {
  const style = useScopeStyle();
  useEffect(() => {
    if (!pb) return undefined;
    const tm = setTimeout(onDone, duration);
    return () => clearTimeout(tm);
  }, [pb, onDone, duration]);
  if (!pb) return null;
  return createPortal(
    <div className="upg-app sec lifts lf-pbtoast-root" style={style}>
      <div className="lf-pbtoast" role="status" aria-live="assertive" data-testid="lf-pb-toast">
        <PbMark className="lf-pbtoast-mark" />
        <span className="lf-pbtoast-main">
          <b className="lf-pbtoast-text">{pb.text}</b>
          {pb.kinds && pb.kinds.length > 0 && <span className="lf-pbtoast-kinds">Beat your {pb.kinds.join(' · ')}</span>}
        </span>
        <button type="button" className="lf-iconbtn lf-pbtoast-x" aria-label="Dismiss" onClick={onDone}><Icon name="x" size={16} /></button>
      </div>
    </div>,
    document.body,
  );
}
