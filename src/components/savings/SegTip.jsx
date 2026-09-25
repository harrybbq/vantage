/**
 * The small popup over a "where the month goes" band: what it is, what
 * it costs a month, what share of income that is.
 *
 * ── Why not `title` ──────────────────────────────────────────────────
 * The bands used to carry a native title. It takes about a second to
 * appear, cannot be styled, and never appears at all on a phone — which
 * is where most people look at this. One popup now serves both: hover
 * on a pointer device, tap on touch, focus from the keyboard.
 *
 * ── Why a portal ─────────────────────────────────────────────────────
 * The same bar is drawn inside a prime card, whose slots clip what
 * leaves them (they must — it is how a block is held to its rect). A
 * popup rendered in place would be cut off at the slot edge, so it is
 * rendered on <body> at the band's screen position instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * @returns { bind(data) → props for a band, node → render it once }
 *   data: { label, value, sub, col }
 */
export function useSegTip() {
  const [tip, setTip] = useState(null);
  const hide = useCallback(() => setTip(null), []);
  // What pressed last. Touch browsers fire an emulated mouseenter AND a
  // click for one tap; if both toggled, a tap would open and instantly
  // close the popup. Hover is honoured for real mice only, and a click
  // toggles only for touch and pen.
  const lastPointer = useRef('mouse');

  /* Tapping anywhere that is not a band closes it; so does any scroll,
     because the popup is pinned to where the band WAS on screen. */
  useEffect(() => {
    if (!tip) return undefined;
    const onDown = e => { if (!e.target.closest?.('[data-seg]')) hide(); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [tip, hide]);

  const bind = data => {
    const open = e => setTip({ rect: e.currentTarget.getBoundingClientRect(), key: data.label, ...data });
    return {
      'data-seg': '',
      tabIndex: 0,
      role: 'img',
      'aria-label': `${data.label}: ${data.value}${data.sub ? ', ' + data.sub : ''}`,
      onPointerEnter: e => { if (e.pointerType === 'mouse') open(e); },
      onPointerLeave: e => { if (e.pointerType === 'mouse') hide(); },
      onPointerDown: e => { lastPointer.current = e.pointerType || 'mouse'; },
      onFocus: e => { if (lastPointer.current === 'mouse') open(e); },
      onBlur: hide,
      // Touch has no hover: a tap opens it, a second tap on the same
      // band closes it. The hold-to-lift on mobile cards listens for
      // touchstart and is left alone — a tap never reaches 450ms.
      onClick: e => {
        e.stopPropagation();
        if (lastPointer.current === 'mouse') { open(e); return; }
        const rect = e.currentTarget.getBoundingClientRect();
        setTip(cur => (cur && cur.key === data.label ? null : { rect, key: data.label, ...data }));
      },
    };
  };

  let node = null;
  if (tip && typeof document !== 'undefined') {
    const vw = window.innerWidth;
    const cx = Math.min(vw - 84, Math.max(84, tip.rect.left + tip.rect.width / 2));
    const below = tip.rect.top < 64;
    node = createPortal(
      <div
        className={`seg-tip${below ? ' is-below' : ''}`}
        role="tooltip"
        style={{ left: cx, top: below ? tip.rect.bottom + 8 : tip.rect.top - 8 }}
      >
        <span className="seg-tip-label">
          {tip.col && <i style={{ background: tip.col }} />}
          {tip.label}
        </span>
        <span className="seg-tip-value">{tip.value}</span>
        {tip.sub && <span className="seg-tip-sub">{tip.sub}</span>}
      </div>,
      document.body,
    );
  }
  return { bind, node };
}
