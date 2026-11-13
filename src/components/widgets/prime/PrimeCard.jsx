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
 *
 * ── Owner-only blocks ────────────────────────────────────────────────
 * Savings › Account balances, and every account inside the other Savings
 * numbers, are the owner's alone (lib/savings/visibleAccounts). For
 * anyone else a stored `accounts` block is simply not drawn — never
 * removed from the widget — and the adapters read a view of S with no
 * accounts in it. A card left with nothing visible draws the prime's
 * default, the same fallback blocksOf uses for a block that no longer
 * exists.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import { makePacker } from '../../../lib/hub/pack';
import { PRIMES, blocksOf, blockOpts, primeOf } from '../../../lib/hub/primeBlocks';
import { blockData } from '../../../lib/hub/primeData';
import { BlockView } from './PrimeViews';
import { useDaySummary } from '../../../lib/diet/daySummary';
import { useShowAccounts } from '../../../hooks/useShowAccounts';
import { visibleBlockIds, savingsView } from '../../../lib/savings/visibleAccounts';

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
  grow = false,           // true = may exceed `height` when the content needs it
  natural = false,        // true = exactly as tall as the blocks need at this width (console desktop)
  extra = 0,              // with `natural`: px to add, when the host stretched the card
  scale = 1,              // with `natural`: a UI scale to multiply the slots by (unused since the console zooms the card instead); the blocks are
                          // packed in design px and the slots drawn that much larger
  guides = false,
  live = false,           // true while a resize drag is in flight
  head = true,            // false = the host draws the title row
  onEdit,
  onDelete,
  onAct,                  // row actions (habit relapse); absent = no buttons
  onHeight,
  ext = null,             // data a prime reads from outside S (Nutrition: today's totals)
  className = '',
}) {
  const key = primeOf(widget);
  const P = key ? PRIMES[key] : null;

  const showAccounts = useShowAccounts();
  const ids = useMemo(() => {
    if (!key) return [];
    const seen = visibleBlockIds(key, blocksOf(widget), showAccounts);
    return seen.length ? seen : visibleBlockIds(key, PRIMES[key].def, showAccounts);
  }, [key, widget, showAccounts]);
  // Read-only: payloads only. Nothing here writes S.
  const viewS = useMemo(() => savingsView(S, showAccounts), [S, showAccounts]);

  /* Payloads are keyed by block id, so a resize that changes only the
     LEVEL of a block re-uses the data it already built. */
  const payloads = useMemo(() => {
    if (!key) return {};
    const out = {};
    ids.forEach(id => { out[id] = blockData(key, id, viewS, blockOpts(widget, id), ext); });
    return out;
  }, [key, ids, viewS, widget, ext]);

  /* How many records each list block holds, so a list is sized for its
     own rows instead of a typical count (lib/hub/pack.js maxOf). */
  const counts = useMemo(() => {
    const out = {};
    for (const id of ids) {
      const d = payloads[id] && payloads[id].d;
      const list = d && (Array.isArray(d.rows) ? d.rows : Array.isArray(d.items) ? d.items : null);
      // An empty list is recorded as 0 (not left out): a card sized to
      // its content then draws one empty-state row, not a full box.
      if (list) out[id] = list.length;
    }
    return out;
  }, [ids, payloads]);

  /* `grow`: the host can make room (the console grid's rows grow with
     their content), so take the box when everything fits in it and the
     content's own height when it does not, instead of squeezing a
     seven-tracker list into a box sized for five. */
  const packed = useMemo(() => {
    if (!key) return { items: [], height: height || 0 };
    const pack = PACKERS[key][head ? 'head' : 'bare'];
    if (natural) {
      // The card's own height: every block at full detail, columns
      // balanced, no spare (lib/hub/pack natural).
      const opts = { balance: true, tight: true };
      const k = scale > 0 ? scale : 1;
      const w = width / k;
      const p = pack(ids, w, pack.natural(ids, w, counts, opts) + Math.max(0, extra) / k, counts, opts);
      if (k === 1) return p;
      // Edges are scaled and snapped together, so neighbours still meet exactly.
      const sx = v => Math.round(v * k);
      return {
        height: sx(p.height),
        items: p.items.map(i => ({ ...i, x: sx(i.x), y: sx(i.y), w: sx(i.x + i.w) - sx(i.x), h: sx(i.y + i.h) - sx(i.y) })),
      };
    }
    if (grow && height != null) {
      const natural = pack(ids, width, null, counts);
      if (natural.height > height) return pack(ids, width, natural.height, counts);
    }
    return pack(ids, width, height, counts);
  }, [key, ids, width, height, head, counts, grow, natural, extra, scale]);

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
export function PrimeFit({ auto = false, natural = false, userId = null, ...rest }) {
  const ref = useRef(null);
  // Only a Nutrition card fetches; everything else is drawn from S. The
  // fetch is shared and cached (lib/diet/daySummary), so a Nutrition card
  // beside the old Macros widget still costs one request.
  const nutrition = primeOf(rest.widget) === 'nutrition';
  const day = useDaySummary(nutrition ? userId : null);
  const ext = nutrition ? day : null;
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
      // The console scales its interface by screen size (design/console/screen.css).
      const ui = natural ? (parseFloat(getComputedStyle(el).getPropertyValue('--cx-ui')) || 1) : 1;
      setBox(prev => (prev && prev.w === w && prev.h === h && prev.ui === ui ? prev : { w, h, ui }));
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
  }, [natural]);

  return (
    <div ref={ref} className={`prime-fit${auto || natural ? ' is-auto' : ''}`}>
      {box && box.w > 0 && (
        <PrimeCard {...rest} natural={natural} ext={ext} live={live}
                   /* Console desktop: the card is laid out at its design size and ZOOMED by the
                      screen scale (.cx-uizoom, design/console/screen.css), so its text, rings and
                      charts grow with the frame around it instead of sitting small inside it. */
                   className={`${rest.className || ''}${natural ? ' cx-uizoom' : ''}`}
                   width={natural ? box.w / (box.ui || 1) : box.w}
                   extra={natural ? (rest.extra || 0) / (box.ui || 1) : rest.extra}
                   height={auto || natural ? null : Math.max(0, box.h)} />
      )}
    </div>
  );
}
