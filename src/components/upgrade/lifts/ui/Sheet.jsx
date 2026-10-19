/**
 * The ONE Lifts sheet (brief §3.12).
 *
 * <Sheet title eyebrow onClose footer modal width placement className testId
 *        initialFocus labelId closeLabel>
 *
 *   phones / tablets (< 1024 px)  a bottom sheet: top radius 16, a drag
 *       handle in a 48 px hit area (drag down past 96 px, or flick, to
 *       close), a 52 px header (eyebrow · title · 44 px close), at most
 *       88vh with the body scrolling inside, `footer` sticky at the bottom
 *       with safe-area padding.
 *   desktop (≥ 1024 px)  a right drawer `width` px wide (440–560, default 480).
 *   modal (default)  40 % scrim that closes on tap, focus trapped inside,
 *       focus returned to the opener on close, aria-modal.
 *   modal={false}  no scrim, the page stays interactive, focus is not
 *       moved or trapped — the rest timer's expanded sheet. Always a
 *       bottom sheet (placement is ignored).
 *   Esc closes the TOPMOST sheet only (sheets stack: a picker over a menu).
 *
 * Portalled to <body> (an ancestor transform would pin a fixed element to
 * the page), wrapped in `upg-app sec lifts` so the Lifts tokens apply,
 * carrying the accent variables (useScopeStyle). Motion: 200 ms slide,
 * none under prefers-reduced-motion.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../Icon';
import { useScopeStyle } from './scope';
import useInputMode from './useInputMode';
import './ui.css';

const stack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Sheet({
  title, eyebrow, onClose, children, footer = null, modal = true, width = 480, placement = 'auto', className = '', testId,
  initialFocus = null, labelId, closeLabel = 'Close',
}) {
  const panel = useRef(null);
  const me = useRef({});
  const autoId = useId();
  const titleId = labelId || `lf-sheet-${autoId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const style = useScopeStyle();
  const { layout } = useInputMode();
  const side = modal && (placement === 'right' || (placement === 'auto' && layout === 'desktop')) ? 'right' : 'bottom';
  const [drag, setDrag] = useState(0);
  const g = useRef(null);
  const close = useCallback(() => { if (onClose) onClose(); }, [onClose]);

  // Stack order (Esc closes the top one only).
  useEffect(() => {
    const token = me.current;
    stack.push(token);
    return () => { const i = stack.indexOf(token); if (i >= 0) stack.splice(i, 1); };
  }, []);
  useEffect(() => {
    const k = e => {
      if (e.key !== 'Escape' || e.defaultPrevented || stack[stack.length - 1] !== me.current) return;
      // Capture phase + preventDefault: the sheet wins over a docked number pad's Esc.
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  }, [close]);

  // Focus in on open (modal), back to the opener on close.
  useLayoutEffect(() => {
    if (!modal) return undefined;
    const before = document.activeElement;
    const el = panel.current;
    if (el) {
      const target = (initialFocus && el.querySelector(initialFocus)) || el;
      target.focus({ preventScroll: true });
    }
    return () => { if (before && typeof before.focus === 'function' && document.contains(before)) before.focus({ preventScroll: true }); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus trap (modal): Tab cycles inside the panel.
  const onKeyDown = e => {
    if (!modal || e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) { e.preventDefault(); panel.current.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  // Drag the handle down to close (bottom sheets).
  const down = e => {
    if (side !== 'bottom') return;
    g.current = { y: e.clientY, t: performance.now(), id: e.pointerId };
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = e => { if (g.current) setDrag(Math.max(0, e.clientY - g.current.y)); };
  const up = e => {
    const st = g.current;
    g.current = null;
    if (!st) return;
    const dy = Math.max(0, e.clientY - st.y);
    const v = dy / Math.max(1, performance.now() - st.t);
    setDrag(0);
    if (dy > 96 || (dy > 24 && v > 0.6)) close();
  };

  const panelStyle = side === 'right' ? { width: `min(${Math.max(440, Math.min(560, width))}px, 100vw)` } : undefined;
  return createPortal(
    <div className={`upg-app sec lifts lf-sheet-root is-${side}${modal ? '' : ' is-nonmodal'}${className ? ` ${className}` : ''}`} style={style}>
      {modal && <div className="lf-sheet-scrim" onClick={close} aria-hidden="true" data-testid={testId ? `${testId}-scrim` : undefined} />}
      <section ref={panel} tabIndex={-1} className="lf-sheet" role="dialog" aria-modal={modal ? 'true' : undefined} aria-labelledby={titleId}
               data-testid={testId} onKeyDown={onKeyDown}
               style={{ ...panelStyle, ...(drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : null) }}>
        {side === 'bottom' && (
          <div className="lf-sheet-handle" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true">
            <span />
          </div>
        )}
        <header className="lf-sheet-head">
          <div className="lf-sheet-titles">
            {eyebrow && <p className="lf-eyebrow">{eyebrow}</p>}
            <h2 className="lf-sheet-title" id={titleId}>{title}</h2>
          </div>
          <button type="button" className="lf-iconbtn lf-sheet-x" onClick={close} aria-label={closeLabel} data-testid={testId ? `${testId}-close` : undefined}>
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="lf-sheet-body">{children}</div>
        {footer && <footer className="lf-sheet-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
export { Sheet };
