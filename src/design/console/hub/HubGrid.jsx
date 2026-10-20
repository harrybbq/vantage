/**
 * The console hub grid: fixed size families, one shared order, and
 * drag-to-move with reflow on both widths.
 *
 *   desktop  4 columns. Pick a widget up by its header (mouse / pen); the
 *            others slide to show where it will land; drop to settle.
 *   phone    2 columns (small = half, medium / large = full). Long-press a
 *            card (450 ms, as the classic MobileWidget) to lift it; drag;
 *            release. A long-press released without moving opens the
 *            widget's menu, as classic does. Dragging near the top or
 *            bottom scrolls the page (lib/mobile/dragScroll).
 *   keyboard Every widget has a Move handle: Enter / Space picks it up,
 *            the arrow keys move it one place, Enter / Space drops it and
 *            Esc puts it back. Announced through a live region.
 *
 * Placement is computed by grid.js (packGrid / dropIndex) and given to the
 * browser as explicit grid cells, so the preview the user sees while
 * dragging is exactly what the drop produces. The reflow animation is a
 * FLIP on the cells' transforms over --cx-dur; under reduced motion the
 * cells simply move.
 *
 * The ⋯ menu: Small 1×1 / Medium 2×1 / Large 2×2 (only the sizes the
 * widget allows; a Pro size shows a Pro mark for a free account and opens
 * the paywall), move earlier / later, edit blocks (primes), remove.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/Icon';
import { WidgetFrame } from '../ui';
import { packGrid, dropIndex, effectiveSize, sizesFor, isProSize, SIZE_LABEL, SIZE_DIMS } from './grid';
import { createDragScroller } from '../../../lib/mobile/dragScroll';

const HOLD_MS = 450;
const reduced = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const rectOf = el => el.getBoundingClientRect();

function SizeMenu({ item, size, hasPro, presetIds, onSize, onPro, onMove, onEdit, onRemove, onClose, canEarlier, canLater, anchor }) {
  const ref = useRef(null);
  // The frame clips (overflow: hidden), so the menu is portalled to <body>
  // and pinned under its ⋯ button, kept inside the viewport.
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor || !ref.current) return;
      const a = anchor.getBoundingClientRect();
      const m = ref.current.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = Math.min(a.right - m.width, vw - m.width - 8);
      left = Math.max(8, left);
      let top = a.bottom + 4;
      if (top + m.height > vh - 8) top = Math.max(8, a.top - m.height - 4);
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);
  const t = sizesFor(item.type, { presetIds });
  useEffect(() => {
    const first = ref.current && ref.current.querySelector('button');
    if (first) first.focus();
    const onDown = e => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.cx-hub-more-btn')) onClose(false); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [onClose]);
  const onKeyNav = e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = Array.from(ref.current.querySelectorAll('button:not([disabled])'));
    const i = btns.indexOf(document.activeElement);
    const n = btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length];
    n && n.focus();
  };
  return createPortal(
    <div ref={ref} className="cx-hub-menu is-fixed" role="menu" aria-label="Widget options" onKeyDown={onKeyNav}
         style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
         onPointerDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
      <span className="cx-hub-menu-h">Size</span>
      {(t ? t.sizes : []).map(s => {
        const pro = !hasPro && isProSize(item.type, s, { presetIds });
        return (
          <button key={s} type="button" role="menuitemradio" aria-checked={s === size}
                  onClick={() => { if (pro) { onClose(false); onPro(); return; } onSize(s); onClose(true); }}>
            <span className="cx-hub-menu-check" aria-hidden="true">{s === size ? <Icon name="check" size={14} strokeWidth={2.5} /> : null}</span>
            <span>{SIZE_LABEL[s]}</span><span className="cx-num cx-muted">{SIZE_DIMS[s]}</span>
            <span className="cx-hub-sp" />
            {pro && <span className="cx-hub-pro">Pro</span>}
          </button>
        );
      })}
      <span className="cx-hub-menu-sep" role="separator" />
      <button type="button" role="menuitem" disabled={!canEarlier} onClick={() => { onMove(-1); onClose(true); }}>
        <span className="cx-hub-menu-check" aria-hidden="true"><Icon name="arrow-up" size={14} /></span>Move earlier
      </button>
      <button type="button" role="menuitem" disabled={!canLater} onClick={() => { onMove(1); onClose(true); }}>
        <span className="cx-hub-menu-check" aria-hidden="true"><Icon name="arrow-down" size={14} /></span>Move later
      </button>
      {onEdit && (
        <button type="button" role="menuitem" onClick={() => { onClose(false); onEdit(); }}>
          <span className="cx-hub-menu-check" aria-hidden="true"><Icon name="pencil" size={14} /></span>Edit blocks
        </button>
      )}
      <span className="cx-hub-menu-sep" role="separator" />
      <button type="button" role="menuitem" className="cx-danger" onClick={() => { onClose(false); onRemove(); }}>
        <span className="cx-hub-menu-check" aria-hidden="true"><Icon name="trash-2" size={14} /></span>Remove from hub
      </button>
    </div>,
    document.body,
  );
}

export default function HubGrid({
  items, cols, isMobile, hasPro, presetIds,
  metaFor, renderBody, onTitle,
  onMove, onSize, onRemove, onEditBlocks, onOpenPaywall,
}) {
  const gridRef = useRef(null);
  const cellRefs = useRef(new Map());
  const [drag, setDrag] = useState(null);       // { id, to } while a pointer drag is live
  const dragRef = useRef(null);                 // the live drag's measurements
  const flipRef = useRef(null);                 // Map id → rect captured before a reflow
  const [menuFor, setMenuFor] = useState(null);
  const [kbd, setKbd] = useState(null);         // { id, origin } while moving by keyboard
  const [say, setSay] = useState('');

  const sizeOf = useCallback(it => effectiveSize(it, { hasPro, presetIds }), [hasPro, presetIds]);
  const fromIdx = drag ? items.findIndex(i => i.id === drag.id) : -1;
  const order = useMemo(() => {
    if (!drag || fromIdx < 0 || drag.to === fromIdx) return items;
    const rest = items.filter((_, i) => i !== fromIdx);
    return [...rest.slice(0, drag.to), items[fromIdx], ...rest.slice(drag.to)];
  }, [items, drag, fromIdx]);
  const { cells } = useMemo(() => packGrid(order, cols, sizeOf), [order, cols, sizeOf]);
  const cellById = useMemo(() => Object.fromEntries(cells.map(c => [c.id, c])), [cells]);

  const snapshot = useCallback(skipId => {
    const m = new Map();
    for (const [id, el] of cellRefs.current) if (el && id !== skipId) m.set(id, rectOf(el));
    return m;
  }, []);

  // ── FLIP: slide every cell from where it was to where it is ──
  useLayoutEffect(() => {
    const before = flipRef.current;
    flipRef.current = null;
    const d = dragRef.current;
    if (d && d.el) placeDragged();
    if (!before || reduced()) return;
    for (const [id, r0] of before) {
      const el = cellRefs.current.get(id);
      if (!el || (d && id === d.id)) continue;
      const prev = el.style.transform;
      el.style.transition = 'none';
      el.style.transform = 'none';
      const r1 = rectOf(el);
      const dx = r0.left - r1.left, dy = r0.top - r1.top;
      if (!dx && !dy) { el.style.transform = prev === 'none' ? '' : ''; el.style.transition = ''; continue; }
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.offsetWidth; // commit the inverted position before animating
      el.style.transition = 'transform var(--cx-dur) var(--cx-ease)';
      el.style.transform = '';
    }
  });

  /** Put the dragged cell under the pointer, relative to its CURRENT slot. */
  function placeDragged() {
    const d = dragRef.current;
    if (!d || !d.el) return;
    d.el.style.transition = 'none';
    d.el.style.transform = 'none';
    const r = rectOf(d.el);
    const x = d.r0.left + (d.px - d.sx) - r.left;
    const y = d.r0.top + (d.py - d.sy) - r.top;
    d.el.style.transform = `translate(${x}px, ${y}px)${reduced() ? '' : ' scale(1.02)'}`;
  }

  /** Pointer → cell coordinates → best insertion index. */
  function retarget() {
    const d = dragRef.current;
    if (!d) return;
    placeDragged();
    const g = rectOf(gridRef.current);
    const cx = d.r0.left + (d.px - d.sx) + d.r0.width / 2;
    const cy = d.r0.top + (d.py - d.sy) + d.r0.height / 2;
    const colW = (g.width - d.gap * (cols - 1)) / cols;
    const x = (cx - g.left) / (colW + d.gap);
    // Rows have content heights, so map y through the measured row tops.
    const yr = cy - g.top;
    const tops = d.rowTops;
    let y = 0;
    if (yr <= 0) y = 0;
    else {
      let r = tops.length - 1;
      while (r > 0 && tops[r] > yr) r--;
      const next = r + 1 < tops.length ? tops[r + 1] : d.gridH + d.gap;
      y = r + Math.max(0, Math.min(1.5, (yr - tops[r]) / Math.max(1, next - tops[r])));
    }
    const to = dropIndex(items, d.from, { x, y }, cols, sizeOf);
    if (to !== d.to) {
      d.to = to;
      flipRef.current = snapshot(d.id);
      setDrag({ id: d.id, to });
    }
  }

  function begin(id, sx, sy, kind) {
    const el = cellRefs.current.get(id);
    const from = items.findIndex(i => i.id === id);
    if (!el || from < 0 || !gridRef.current) return false;
    const g = rectOf(gridRef.current);
    const cs = getComputedStyle(gridRef.current);
    const gap = parseFloat(cs.rowGap || cs.gap) || 16;
    // Row tops relative to the grid, from the cells as they stand.
    const rows = {};
    for (const it of items) {
      const c = cellById[it.id]; const e = cellRefs.current.get(it.id);
      if (!c || !e) continue;
      const t = rectOf(e).top - g.top;
      rows[c.row] = rows[c.row] == null ? t : Math.min(rows[c.row], t);
    }
    const maxRow = Math.max(0, ...Object.keys(rows).map(Number));
    const rowTops = [];
    for (let r = 1; r <= maxRow; r++) rowTops.push(rows[r] ?? (rowTops.length ? rowTops[rowTops.length - 1] : 0));
    dragRef.current = { id, from, to: from, el, r0: rectOf(el), sx, sy, px: sx, py: sy, gap, rowTops, gridH: g.height, kind, moved: false, unswallow: swallowNextClick() };
    el.classList.add('is-lifted');
    document.documentElement.classList.add('cx-hub-dragging');
    setDrag({ id, to: from });
    setMenuFor(null);
    return true;
  }

  /* A pick-up must never also count as a click on whatever is under the
     pointer: a held tracker checkbox would tick itself, a held title would
     navigate. Armed when the drag BEGINS and ended after the drop, because
     the click that follows a touchend is not guaranteed to land before a
     zero timeout. */
  function swallowNextClick() {
    const eat = e => { e.preventDefault(); e.stopPropagation(); };
    document.addEventListener('click', eat, { capture: true, once: true });
    return () => setTimeout(() => document.removeEventListener('click', eat, { capture: true }), 400);
  }
  function finish(cancel = false) {
    const d = dragRef.current;
    dragRef.current = null;
    d?.unswallow?.();
    document.documentElement.classList.remove('cx-hub-dragging');
    if (!d) return;
    d.scroller?.stop();
    // FLIP the dropped card from where the finger left it into its slot.
    const at = rectOf(d.el);
    d.el.classList.remove('is-lifted');
    d.el.style.transition = '';
    d.el.style.transform = '';
    const snap = snapshot(null);
    snap.set(d.id, at);
    flipRef.current = snap;
    setDrag(null);
    if (!cancel && d.to !== d.from) onMove(d.from, d.to);
    if (!cancel && d.kind === 'touch' && !d.moved) setMenuFor(d.id);
  }

  // ── Mouse / pen: drag by the header ──
  function onPointerDown(e, id) {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    // The header is the handle — including its title, which still opens
    // its page on a plain click (a drag swallows that click below).
    if (!e.target.closest('.cx-wf-head') || e.target.closest('a, input, select, textarea, button:not(.cx-wf-title)')) return;
    const sx = e.clientX, sy = e.clientY;
    let started = false;
    const move = ev => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        started = begin(id, sx, sy, 'mouse');
        if (!started) return cleanup();
      }
      const d = dragRef.current;
      if (!d) return;
      d.px = ev.clientX; d.py = ev.clientY; d.moved = true;
      retarget();
    };
    const up = () => { cleanup(); if (started) finish(false); };
    const key = ev => { if (ev.key === 'Escape' && started) { cleanup(); finish(true); } };
    function cleanup() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, true);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);
  }

  // ── Touch: long-press to lift ──
  const hold = useRef(null);
  function onTouchStart(e, id) {
    if (e.touches.length !== 1) return;
    if (e.target.closest('input, select, textarea, .cx-hub-menu')) return;
    const t = e.touches[0];
    const sx = t.clientX, sy = t.clientY;
    clearTimeout(hold.current?.timer);
    const cancelEarly = ev => {
      const p = ev.touches[0];
      if (p && Math.hypot(p.clientX - sx, p.clientY - sy) > 8) stopHold();
    };
    const stopHold = () => {
      clearTimeout(hold.current?.timer);
      document.removeEventListener('touchmove', cancelEarly);
      document.removeEventListener('touchend', stopHold);
      document.removeEventListener('touchcancel', stopHold);
      hold.current = null;
    };
    document.addEventListener('touchmove', cancelEarly, { passive: true });
    document.addEventListener('touchend', stopHold);
    document.addEventListener('touchcancel', stopHold);
    hold.current = {
      timer: setTimeout(() => {
        stopHold();
        if (!begin(id, sx, sy, 'touch')) return;
        if (navigator.vibrate) { try { navigator.vibrate(18); } catch { /* ignore */ } }
        const d = dragRef.current;
        d.scroller = createDragScroller({
          getBounds: () => {
            const bar = document.querySelector('.m-tabs, .cx-shell-tabs');
            const top = document.querySelector('.m-appbar, .cx-shell-appbar');
            return { top: top ? rectOf(top).bottom : 0, bottom: bar ? rectOf(bar).top : window.innerHeight };
          },
          onScrolled: () => retarget(),
        });
        const move = ev => {
          const p = ev.touches[0];
          const dd = dragRef.current;
          if (!p || !dd) return;
          ev.preventDefault();
          dd.px = p.clientX; dd.py = p.clientY;
          if (Math.hypot(dd.px - dd.sx, dd.py - dd.sy) > 6) dd.moved = true;
          dd.scroller?.move(p.clientY);
          retarget();
        };
        const end = () => {
          document.removeEventListener('touchmove', move);
          document.removeEventListener('touchend', end);
          document.removeEventListener('touchcancel', end);
          finish(false);
        };
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('touchend', end);
        document.addEventListener('touchcancel', end);
      }, HOLD_MS),
    };
  }
  useEffect(() => () => { clearTimeout(hold.current?.timer); document.documentElement.classList.remove('cx-hub-dragging'); }, []);

  // ── Keyboard move ──
  // A keyed cell that React moves in the DOM can drop focus; put it back
  // on the handle so the next arrow key still lands.
  useLayoutEffect(() => {
    if (!kbd) return;
    const g = cellRefs.current.get(kbd.id)?.querySelector('.cx-hub-grip');
    if (g && document.activeElement !== g) g.focus({ preventScroll: true });
  });
  useEffect(() => {
    if (!kbd) return undefined;
    const off = e => { const g = cellRefs.current.get(kbd.id)?.querySelector('.cx-hub-grip'); if (g && !g.contains(e.target)) setKbd(null); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [kbd]);
  function announce(id, verb) {
    const i = items.findIndex(x => x.id === id);
    const it = items[i];
    if (!it) return;
    setSay(`${metaFor(it).title}${verb ? `, ${verb}` : ''}. Position ${i + 1} of ${items.length}.`);
  }
  useEffect(() => { if (kbd) announce(kbd.id); /* re-announce after each move */ }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  function onGripKey(e, id, idx) {
    const k = e.key;
    if (!kbd || kbd.id !== id) {
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        setKbd({ id, origin: idx });
        const it = items[idx];
        setSay(`${metaFor(it).title}, picked up. Position ${idx + 1} of ${items.length}. Arrow keys move it, Enter drops it, Escape puts it back.`);
      }
      return;
    }
    if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowDown' || k === 'ArrowRight') {
      e.preventDefault();
      const to = idx + (k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1);
      if (to < 0 || to >= items.length) return;
      flipRef.current = snapshot(null);
      onMove(idx, to);
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      setKbd(null);
      setSay(`${metaFor(items[idx]).title}, dropped. Position ${idx + 1} of ${items.length}.`);
    } else if (k === 'Escape') {
      e.preventDefault();
      if (idx !== kbd.origin) { flipRef.current = snapshot(null); onMove(idx, kbd.origin); }
      setKbd(null);
      setSay(`${metaFor(items[idx]).title}, move cancelled.`);
    } else if (k === 'Tab') {
      setKbd(null);
    }
  }

  const closeMenu = useCallback(refocus => {
    const id = menuFor;
    setMenuFor(null);
    if (refocus && id) {
      const btn = cellRefs.current.get(id)?.querySelector('.cx-hub-more-btn');
      btn && btn.focus();
    }
  }, [menuFor]);

  return (
    <>
      <div ref={gridRef} className={`cx-hub-grid${drag ? ' is-dragging' : ''}`} data-cols={cols}>
        {order.map(item => {
          const c = cellById[item.id];
          if (!c) return null;
          const idx = items.findIndex(i => i.id === item.id);
          const size = sizeOf(item);
          const meta = metaFor(item);
          const lifted = (drag && drag.id === item.id) || (kbd && kbd.id === item.id);
          return (
            <div
              key={item.id}
              ref={el => { if (el) cellRefs.current.set(item.id, el); else cellRefs.current.delete(item.id); }}
              className={`cx-hub-cell is-${size}${lifted ? ' is-picked' : ''}${menuFor === item.id ? ' has-menu' : ''}`}
              data-id={item.id}
              data-type={item.type}
              style={{ gridColumn: `${c.col} / span ${c.w}`, gridRow: `${c.row} / span ${c.h}` }}
              onPointerDown={e => onPointerDown(e, item.id)}
              onTouchStart={isMobile ? e => onTouchStart(e, item.id) : undefined}
              onContextMenu={isMobile ? e => e.preventDefault() : undefined}
            >
              <WidgetFrame
                icon={meta.icon}
                title={meta.title}
                meta={meta.meta}
                size={size}
                onTitleClick={onTitle ? () => onTitle(item) : undefined}
                actions={(
                  <span className="cx-hub-acts">
                    <button
                      type="button"
                      className="cx-hub-grip"
                      aria-label={`Move ${meta.title}`}
                      aria-pressed={!!(kbd && kbd.id === item.id)}
                      aria-describedby="cx-hub-grip-help"
                      onKeyDown={e => onGripKey(e, item.id, idx)}
                    >
                      <Icon name="grip-vertical" size={16} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      className="cx-hub-more-btn"
                      aria-label={`Options for ${meta.title}`}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === item.id}
                      onClick={() => setMenuFor(m => (m === item.id ? null : item.id))}
                    >
                      <Icon name="ellipsis" size={16} strokeWidth={1.75} />
                    </button>
                    {menuFor === item.id && (
                      <SizeMenu
                        item={item}
                        size={size}
                        hasPro={hasPro}
                        presetIds={presetIds}
                        anchor={cellRefs.current.get(item.id)?.querySelector('.cx-hub-more-btn') || null}
                        onSize={s => onSize(item.id, s)}
                        onPro={() => onOpenPaywall?.('generic')}
                        onMove={dlt => { flipRef.current = snapshot(null); onMove(idx, idx + dlt); }}
                        onEdit={onEditBlocks ? onEditBlocks(item) : null}
                        onRemove={() => onRemove(item.id)}
                        onClose={closeMenu}
                        canEarlier={idx > 0}
                        canLater={idx < items.length - 1}
                      />
                    )}
                  </span>
                )}
              >
                {renderBody(item, size)}
              </WidgetFrame>
            </div>
          );
        })}
      </div>
      <p id="cx-hub-grip-help" className="cx-sr">Press Enter to pick the widget up, the arrow keys to move it, Enter to drop it, Escape to cancel.</p>
      <p className="cx-sr" aria-live="assertive" role="status">{say}</p>
    </>
  );
}
