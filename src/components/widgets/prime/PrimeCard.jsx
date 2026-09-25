/**
 * A prime widget: one card per section, showing the blocks the user
 * picked, in the order they put them.
 *
 * ── What this component does, and what it does not ───────────────────
 * It asks the packer where each block goes, asks the adapters what each
 * block says, and renders the shared views into absolutely-positioned
 * slots. It decides no geometry itself and reads no store beyond `S`.
 *
 * The same component renders on both platforms. Desktop passes a width
 * AND a height — the user dragged the card to that size, and the packer
 * has to make the blocks fit it. Mobile passes a width only; height is
 * whatever the content needs, and the card reports it back through
 * `onHeight` so the stack can lay itself out.
 *
 * ── Why the slots are absolutely positioned ──────────────────────────
 * A flex or grid column would re-flow during a resize drag, and every
 * re-flow is a layout pass over every block. Absolute rects let the
 * browser move six boxes without touching what is inside them, and let
 * React skip re-rendering a block whose LEVEL has not changed — which is
 * what keeps a drag smooth rather than stepping.
 *
 * ── The container-query gotcha ───────────────────────────────────────
 * The SLOT carries `container-type: size` and the block inside is styled
 * from it. Nothing is ever styled by its own container query, which does
 * not work and has caught this codebase before.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import { makePacker } from '../../../lib/hub/pack';
import { PRIMES, blocksOf, blockOpts, primeOf } from '../../../lib/hub/primeBlocks';
import { blockData } from '../../../lib/hub/primeData';
import { BlockView } from './PrimeViews';

/** Two packers per prime, built once — `makePacker` closes over the
 *  block registry, which never changes at runtime. The headless one is
 *  for hosts that already draw a title row (the mobile card). */
const PACKERS = Object.fromEntries(
  // Headless still keeps a 12px top inset — the same as the sides — so
  // the first block does not sit on the host's header rule.
  Object.entries(PRIMES).map(([k, p]) => [k, { head: makePacker(p.blocks), bare: makePacker(p.blocks, 12) }]),
);

export default function PrimeCard({
  widget,                 // the stored widget: { id, type, blocks?, title? }
  S,
  width,
  height = null,          // null = mobile: no ceiling, report the height instead
  guides = false,
  live = false,           // true while a resize drag is in flight
  head = true,            // false = the host draws the title row
  onEdit,
  onDelete,
  onAct,                  // row actions (habit relapse); absent = no buttons
  onHeight,
  className = '',
}) {
  const key = primeOf(widget);
  const P = key ? PRIMES[key] : null;

  const ids = useMemo(() => (key ? blocksOf(widget) : []), [key, widget]);

  const packed = useMemo(() => {
    if (!key) return { items: [], height: height || 0 };
    return PACKERS[key][head ? 'head' : 'bare'](ids, width, height);
  }, [key, ids, width, height, head]);

  /* Payloads are keyed by block id, so a resize that changes only the
     LEVEL of a block re-uses the data it already built. */
  const payloads = useMemo(() => {
    if (!key) return {};
    const out = {};
    ids.forEach(id => { out[id] = blockData(key, id, S, blockOpts(widget, id)); });
    return out;
  }, [key, ids, S, widget]);

  /* Mobile reports the height it needs so the stack can size the card.
     In an effect, not in render: calling a parent's setter mid-render is
     how you get "cannot update a component while rendering another". */
  useEffect(() => {
    if (height == null && onHeight) onHeight(packed.height);
  }, [height, onHeight, packed.height]);

  if (!P) return null;

  const title = widget.title ? ` · ${widget.title}` : '';

  return (
    <div
      className={`prime-card${live ? ' is-live' : ''} ${className}`}
      style={{ width: width ? `${width}px` : '100%', height: `${packed.height}px` }}
      data-prime={key}
    >
      {head && <div className="prime-head">
        <span
          className="prime-chip"
          style={{ background: `${P.col}1a`, border: `1px solid ${P.col}47`, color: P.col }}
          aria-hidden="true"
        >
          <Icon name={P.icon} size={12} />
        </span>
        <span className="prime-name">// {P.name}{title}</span>
        {onEdit && (
          <button
            type="button"
            className="prime-count"
            onClick={onEdit}
            /* The touch guard matters: on mobile the card root starts a
               450ms hold-to-lift, and without this, reaching for the
               chip picks the card up instead of opening the editor. */
            onPointerDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            aria-label={`Edit which blocks ${P.name} shows`}
            title="Choose blocks and order"
          >
            {ids.length} <span aria-hidden="true">▾</span>
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="prime-del"
            onClick={onDelete}
            onPointerDown={e => e.stopPropagation()}
            aria-label={`Remove this ${P.name} card`}
            title="Remove card"
          >✕</button>
        )}
      </div>}

      {packed.items.map(slot => {
        const payload = payloads[slot.key] || { d: {}, s: {} };
        return (
          <div
            key={slot.key}
            className="prime-slot"
            style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h }}
          >
            <BlockView view={slot.view} d={payload.d} s={payload.s} onAct={onAct} />
          </div>
        );
      })}

      {guides && packed.items.map(slot => (
        <div
          key={`g-${slot.key}`}
          className="prime-guide"
          style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h }}
        >
          <span>{slot.tag}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A prime card that sizes itself from the box it is mounted in.
 *
 * Desktop: the canvas wrapper has a width and height the user dragged,
 * so both are measured and the packer fits the blocks INTO them.
 * Mobile (`auto`): only the width is measured; the card is as tall as
 * its blocks need and the stack flows round it.
 *
 * `live` is raised while the size is changing frame to frame, which
 * drops the slot transitions so a resize drag tracks the pointer
 * instead of trailing a quarter-second behind it.
 */
export function PrimeFit({ auto = false, ...rest }) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  const [live, setLive] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    let idle = 0;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setBox(prev => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let first = true;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
      if (first) { first = false; return; }
      setLive(true);
      clearTimeout(idle);
      idle = setTimeout(() => setLive(false), 180);
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); clearTimeout(idle); };
  }, []);

  return (
    <div ref={ref} className={`prime-fit${auto ? ' is-auto' : ''}`}>
      {box && box.w > 0 && (
        <PrimeCard {...rest} width={box.w} height={auto ? null : Math.max(0, box.h)} live={live} />
      )}
    </div>
  );
}
