/**
 * The small controls every Lifts screen uses — one look each:
 *   Button       primary (accent fill, 52 px phone / 44 desktop), secondary
 *                (outline), danger (text only, never a fill), quiet
 *   IconButton   a 44 × 44 hit area around a small icon; aria-label required
 *   Chip         a selectable / tappable chip (neutral, accent, pb, night)
 *   Segmented    one segmented control (radio semantics, arrow keys)
 * Styles: ui.css (scoped to .lifts).
 */
import { useRef } from 'react';
import Icon from '../../../Icon';
import './ui.css';

const cx = (...a) => a.filter(Boolean).join(' ');

/**
 * <Button variant="primary|secondary|danger|quiet" size="lg|md" block icon iconRight …button props>
 * lg = the screen's primary action (52 px on phones, 44 on desktop); md = 44 / 36 by pointer.
 */
export function Button({ variant = 'secondary', size = 'md', block = false, icon, iconRight, className = '', children, type = 'button', ...rest }) {
  return (
    <button type={type} className={cx('lf-btn', `is-${variant}`, `is-${size}`, block && 'is-block', className)} {...rest}>
      {icon && <Icon name={icon} size={16} />}
      {children != null && <span className="lf-btn-txt">{children}</span>}
      {iconRight && <Icon name={iconRight} size={16} />}
    </button>
  );
}

/** <IconButton icon="x" label="Close" size={18} tone="neutral|danger|accent" …button props> — always ≥ 44 × 44 on touch. */
export function IconButton({ icon, label, size = 18, tone = 'neutral', className = '', type = 'button', children, ...rest }) {
  return (
    <button type={type} className={cx('lf-iconbtn', tone !== 'neutral' && `is-${tone}`, className)} aria-label={label} title={rest.title || label} {...rest}>
      {icon ? <Icon name={icon} size={size} /> : children}
    </button>
  );
}

/**
 * <Chip selected onClick tone="neutral|accent|pb|night" icon> — `selected`
 * makes it a toggle (aria-pressed). Without onClick it renders a static label.
 */
export function Chip({ selected, onClick, tone = 'neutral', icon, className = '', children, type = 'button', ...rest }) {
  const cls = cx('lf-chip', tone !== 'neutral' && `is-${tone}`, selected && 'is-on', !onClick && 'is-static', className);
  if (!onClick) return <span className={cls} {...rest}>{icon && <Icon name={icon} size={14} />}{children}</span>;
  return (
    <button type={type} className={cls} onClick={onClick} aria-pressed={selected == null ? undefined : !!selected} {...rest}>
      {icon && <Icon name={icon} size={14} />}{children}
    </button>
  );
}

/**
 * <Segmented options={[{ value, label, disabled?, title? }]} value onChange label="aria name" size="md|sm" full testId>
 * Radio semantics: one tab stop, ← → / Home / End move and select.
 */
export function Segmented({ options, value, onChange, label, size = 'md', full = false, className = '', testId }) {
  const ref = useRef(null);
  const opts = (options || []).filter(Boolean);
  if (!opts.length) return null;
  const sel = opts.findIndex(o => o.value === value);
  const idx = sel >= 0 ? sel : Math.max(0, opts.findIndex(o => !o.disabled));
  const move = (from, dir) => {
    for (let k = 1; k <= opts.length; k++) {
      const j = dir === 'home' ? k - 1 : dir === 'end' ? opts.length - k : (from + dir * k + opts.length * 2) % opts.length;
      if (!opts[j].disabled) return j;
    }
    return from;
  };
  const onKey = e => {
    const map = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'home', End: 'end' };
    if (!(e.key in map)) return;
    e.preventDefault();
    const j = move(idx, map[e.key]);
    if (opts[j] && opts[j].value !== value) onChange(opts[j].value);
    const btn = ref.current && ref.current.querySelectorAll('button')[j];
    if (btn) btn.focus();
  };
  return (
    <div ref={ref} className={cx('lf-segm', `is-${size}`, full && 'is-full', className)} role="radiogroup" aria-label={label} data-testid={testId} onKeyDown={onKey}>
      {opts.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} className={on ? 'is-on' : ''} disabled={o.disabled}
                  tabIndex={i === idx ? 0 : -1}
                  title={o.title} onClick={() => !on && onChange(o.value)}>
            <span className="lf-segm-txt">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
