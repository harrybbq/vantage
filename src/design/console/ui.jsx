/**
 * Console design primitives — the shared React half of the cx- family.
 *
 *   Panel · Button · Chip · Segmented · Checkbox · Sheet · WidgetFrame
 *
 * They render the classes in base.css, which only apply under
 * <html data-design="console">: use them ONLY in console-only components
 * (chosen via useDesign().isConsole). Owned by the design foundation; a
 * screen agent that needs another primitive builds it in its own area and
 * notes it in README.md for consolidation.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../components/Icon';
// The one dependency-free piece of the Lifts sheet (the rest of that sheet
// is tied to the Lifts graph and CSS): where the iOS keyboard is.
import useKeyboardInset from '../../components/upgrade/lifts/ui/useKeyboardInset';

const cx = (...a) => a.filter(Boolean).join(' ');

/* ── Panel ─────────────────────────────────────────────────────────── */
/** <Panel as="section" className>…</Panel> — s1 surface, hairline, radius 12. */
export function Panel({ as: As = 'section', className, children, ...rest }) {
  return <As className={cx('cx-panel', className)} {...rest}>{children}</As>;
}

/* ── Button ────────────────────────────────────────────────────────── */
/**
 * <Button variant="primary|secondary|ghost|danger" icon="plus" block iconOnly label>
 * 40 px (48 on coarse pointers), radius 8, sentence case — write the label
 * that way, there is no text-transform. `iconOnly` needs `label` (aria-label).
 */
export function Button({
  variant = 'secondary', icon = null, iconSize = 16, block = false, iconOnly = false, label, className, type = 'button', children, ...rest
}) {
  return (
    <button
      type={type}
      className={cx('cx-btn', variant !== 'secondary' && `cx-btn--${variant}`, block && 'cx-btn--block', iconOnly && 'cx-btn--icon', className)}
      aria-label={iconOnly ? label : rest['aria-label']}
      {...rest}
    >
      {icon && <Icon name={icon} size={iconSize} strokeWidth={1.75} />}
      {!iconOnly && children}
    </button>
  );
}

/* ── Chip ──────────────────────────────────────────────────────────── */
/**
 * <Chip icon selected onClick>…</Chip> — 28 px, radius 6. A <button> with
 * aria-pressed when it has onClick, a <span> otherwise.
 */
export function Chip({ icon = null, selected, onClick, className, children, ...rest }) {
  const content = <>{icon && <Icon name={icon} size={14} strokeWidth={1.75} />}{children}</>;
  if (onClick) {
    return (
      <button type="button" className={cx('cx-chip', className)} aria-pressed={selected == null ? undefined : !!selected} onClick={onClick} {...rest}>
        {content}
      </button>
    );
  }
  return <span className={cx('cx-chip', selected && 'is-on', className)} {...rest}>{content}</span>;
}

/* ── Segmented ─────────────────────────────────────────────────────── */
/**
 * <Segmented label="View" value={v} onChange={setV}
 *            options={[{ value: 'month', label: 'Month' }, …]} />
 * A radiogroup: arrows move the choice, the selected segment is raised.
 * Options may carry `disabled`.
 */
export function Segmented({ options, value, onChange, label, className, ...rest }) {
  const refs = useRef([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter(i => i >= 0);
  const onKeyDown = (e, i) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir || !enabled.length) return;
    e.preventDefault();
    const at = enabled.indexOf(i);
    const j = enabled[(at + dir + enabled.length) % enabled.length];
    onChange?.(options[j].value);
    refs.current[j]?.focus();
  };
  const anyOn = options.some(o => o.value === value);
  return (
    <div role="radiogroup" aria-label={label} className={cx('cx-seg', className)} {...rest}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (!anyOn && i === enabled[0]) ? 0 : -1}
            disabled={o.disabled}
            className="cx-seg-opt"
            onClick={() => { if (!on) onChange?.(o.value); }}
            onKeyDown={e => onKeyDown(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Checkbox ──────────────────────────────────────────────────────── */
/**
 * <Checkbox checked onChange={next => …} label="Gym session" showLabel />
 * The one 20 px rounded square (44 px hit area). `label` is always the
 * accessible name; `showLabel` also draws it beside the box.
 */
export function Checkbox({ checked, onChange, label, showLabel = false, disabled = false, className, ...rest }) {
  const labelId = `cx-check-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const toggle = () => { if (!disabled) onChange?.(!checked); };
  const box = (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      aria-label={showLabel ? undefined : label}
      aria-labelledby={showLabel ? labelId : undefined}
      disabled={disabled}
      className={cx('cx-check', className)}
      onClick={toggle}
      {...rest}
    >
      <Icon name="check" size={14} strokeWidth={2.5} />
    </button>
  );
  if (!showLabel) return box;
  // The visible text names the box and toggles it too.
  return (
    <span className="cx-check-label">
      {box}
      <span id={labelId} onClick={toggle}>{label}</span>
    </span>
  );
}

/* ── WidgetFrame ───────────────────────────────────────────────────── */
/**
 * <WidgetFrame icon="flame" title="Nutrition" meta="1,706 of 2,650"
 *              size="small|medium|large" onTitleClick actions>…body…</WidgetFrame>
 * Chrome only: 16 px icon + 13/600 title + right-aligned 12 px meta, then
 * the body. `size` is exposed as data-size for the hub grid (1×1 · 2×1 ·
 * 2×2); spans and heights are the hub's business. `actions` sits after
 * the meta (e.g. an icon Button for a menu).
 */
export function WidgetFrame({ icon = null, title, meta = null, size = 'medium', onTitleClick, actions = null, className, children, ...rest }) {
  const sz = size === 'small' || size === 'large' ? size : 'medium';
  return (
    <section className={cx('cx-wf', `cx-wf--${sz}`, className)} data-size={sz} {...rest}>
      <header className="cx-wf-head">
        {icon && <Icon name={icon} size={16} strokeWidth={1.75} />}
        {onTitleClick
          ? <button type="button" className="cx-wf-title" onClick={onTitleClick}>{title}</button>
          : <h3 className="cx-wf-title">{title}</h3>}
        {meta != null && meta !== '' && <span className="cx-wf-meta">{meta}</span>}
        {actions}
      </header>
      <div className="cx-wf-body">{children}</div>
    </section>
  );
}

/* ── Sheet ─────────────────────────────────────────────────────────── */
// Same layout switch as Lifts (< 1024 px phone/tablet → bottom sheet).
const DESKTOP_Q = '(min-width: 1024px)';
const subscribeDesktop = cb => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(DESKTOP_Q);
  if (mq.addEventListener) mq.addEventListener('change', cb); else mq.addListener(cb);
  return () => { if (mq.removeEventListener) mq.removeEventListener('change', cb); else mq.removeListener(cb); };
};
const isDesktopNow = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DESKTOP_Q).matches : true);
const useIsDesktop = () => useSyncExternalStore(subscribeDesktop, isDesktopNow, () => true);

const stack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The console sheet — the Lifts Sheet's behaviour under cx- classes:
 *
 * <Sheet title eyebrow onClose footer modal width placement className testId
 *        initialFocus labelId closeLabel>
 *
 *   < 1024 px  bottom sheet: radius 16 top, a grab handle in a 48 px hit
 *              area (drag down past 96 px, or flick, to close), at most
 *              88vh with the body scrolling inside, sticky `footer` with
 *              safe-area padding, riding on the iOS keyboard.
 *   ≥ 1024 px  right drawer `width` px (440–560, default 480).
 *   modal (default)  scrim closes on tap, focus moved in and trapped,
 *              returned to the opener on close, aria-modal.
 *   modal={false}  no scrim, page stays interactive, always a bottom sheet.
 *   Esc closes the TOPMOST console sheet only. (The Lifts sheet keeps its
 *   own stack; the two are never open together.)
 * Portalled to <body>. 200 ms slide; none under reduced motion.
 */
export function Sheet({
  title, eyebrow, onClose, children, footer = null, modal = true, width = 480, placement = 'auto', className = '', testId,
  initialFocus = null, labelId, closeLabel = 'Close',
}) {
  const panel = useRef(null);
  const me = useRef({});
  const autoId = useId();
  const titleId = labelId || `cx-sheet-${autoId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const desktop = useIsDesktop();
  const side = modal && (placement === 'right' || (placement === 'auto' && desktop)) ? 'right' : 'bottom';
  const { kb, vvh } = useKeyboardInset(side === 'bottom');
  const rootStyle = side === 'bottom' ? { '--cx-kb': `${kb}px`, ...(vvh ? { '--cx-vvh': `${vvh}px` } : null) } : undefined;
  const [drag, setDrag] = useState(0);
  const g = useRef(null);
  const close = useCallback(() => { if (onClose) onClose(); }, [onClose]);

  useEffect(() => {
    const token = me.current;
    stack.push(token);
    return () => { const i = stack.indexOf(token); if (i >= 0) stack.splice(i, 1); };
  }, []);
  useEffect(() => {
    const k = e => {
      if (e.key !== 'Escape' || e.defaultPrevented || stack[stack.length - 1] !== me.current) return;
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  }, [close]);

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

  const onKeyDown = e => {
    if (!modal || e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) { e.preventDefault(); panel.current.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const down = e => {
    if (side !== 'bottom') return;
    g.current = { y: e.clientY, t: performance.now() };
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
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
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className={cx('cx-sheet-root', `is-${side}`, !modal && 'is-nonmodal', className)} style={rootStyle}>
      {modal && <div className="cx-sheet-scrim" onClick={close} aria-hidden="true" data-testid={testId ? `${testId}-scrim` : undefined} />}
      <section ref={panel} tabIndex={-1} className="cx-sheet" role="dialog" aria-modal={modal ? 'true' : undefined} aria-labelledby={titleId}
               data-testid={testId} onKeyDown={onKeyDown}
               style={{ ...panelStyle, ...(drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : null) }}>
        {side === 'bottom' && (
          <div className="cx-sheet-handle" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true">
            <span />
          </div>
        )}
        <header className="cx-sheet-head">
          <div className="cx-sheet-titles">
            {eyebrow && <p className="cx-eyebrow">{eyebrow}</p>}
            <h2 className="cx-sheet-title" id={titleId}>{title}</h2>
          </div>
          <button type="button" className="cx-sheet-x" onClick={close} aria-label={closeLabel} data-testid={testId ? `${testId}-close` : undefined}>
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="cx-sheet-body">{children}</div>
        {footer && <footer className="cx-sheet-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
