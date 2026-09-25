/**
 * Near-miss edge matching while a widget is resized with Snap drag off.
 *
 * Free sizing is the point of Snap drag being off, so this never moves
 * anything more than a few pixels. It only closes gaps that were almost
 * closed already: when the edge being dragged comes within THRESHOLD of
 * the same edge of a neighbour, it lands exactly on it. Move further than
 * that and it lets go — the pointer is still in charge.
 *
 * ── Which neighbours ─────────────────────────────────────────────────
 *   left / right grip → widgets ABOVE or BELOW (they share the column,
 *                       so matching their left/right edge squares it up)
 *   top / bottom grip → widgets BESIDE it (they share the row, so
 *                       matching their top/bottom edge lines the row up)
 * Anything that is neither — diagonal, or too far away to read as part
 * of the same column or row — is ignored.
 *
 * Pure: rects in, rect out. The caller writes the style.
 */

export const THRESHOLD = 10;     // px — close enough to be a near miss
const REACH = 240;               // px — further than this is a different group

const overlapX = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
const overlapY = (a, b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
const gapY = (a, b) => Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
const gapX = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));

/**
 * @param rect   the widget as the pointer left it: { x, y, w, h }
 * @param side   'l' | 'r' | 't' | 'b' — the grip being dragged
 * @param others the other widgets' rects
 * @param opts   { threshold, minW, minH }
 * @returns { rect, guide } — rect adjusted (or unchanged), and the edge it
 *          matched as { axis: 'x'|'y', at, from, to } for drawing a guide,
 *          or null when nothing matched.
 */
export function matchEdge(rect, side, others, opts = {}) {
  const T = opts.threshold ?? THRESHOLD;
  const minW = opts.minW ?? 0;
  const minH = opts.minH ?? 0;
  let best = null;

  for (const o of others || []) {
    if (!o || !(o.w > 0) || !(o.h > 0)) continue;
    if (side === 'l' || side === 'r') {
      // Above or below: shares some of the column, no vertical overlap.
      if (overlapX(rect, o) <= 0 || overlapY(rect, o) > 0 || gapY(rect, o) > REACH) continue;
      const mine = side === 'r' ? rect.x + rect.w : rect.x;
      const theirs = side === 'r' ? o.x + o.w : o.x;
      const d = Math.abs(mine - theirs);
      if (d > T || d === 0) {
        if (d === 0) best = best || { d: 0, o, at: theirs };
        continue;
      }
      if (!best || d < best.d || (d === best.d && gapY(rect, o) < gapY(rect, best.o))) best = { d, o, at: theirs };
    } else if (side === 'b' || side === 't') {
      // Beside: shares some of the row, no horizontal overlap.
      if (overlapY(rect, o) <= 0 || overlapX(rect, o) > 0 || gapX(rect, o) > REACH) continue;
      const theirs = side === 'b' ? o.y + o.h : o.y;
      const d = Math.abs((side === 'b' ? rect.y + rect.h : rect.y) - theirs);
      if (d > T) continue;
      if (!best || d < best.d || (d === best.d && gapX(rect, o) < gapX(rect, best.o))) best = { d, o, at: theirs };
    }
  }
  if (!best) return { rect, guide: null };

  const out = { ...rect };
  if (side === 'r') out.w = best.at - rect.x;
  else if (side === 'l') { out.w = rect.x + rect.w - best.at; out.x = best.at; }
  else if (side === 'b') out.h = best.at - rect.y;
  else { out.h = rect.y + rect.h - best.at; out.y = best.at; }
  // Never below the floors — a match that would shrink past them is not
  // a near miss worth taking.
  if (out.w < minW || out.h < minH) return { rect, guide: null };

  const o = best.o;
  const guide = (side === 'b' || side === 't')
    ? { axis: 'y', at: best.at, from: Math.min(out.x, o.x), to: Math.max(out.x + out.w, o.x + o.w) }
    : { axis: 'x', at: best.at, from: Math.min(out.y, o.y), to: Math.max(out.y + out.h, o.y + o.h) };
  return { rect: out, guide };
}
