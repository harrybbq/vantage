/**
 * Snap reflow for the hub canvas.
 *
 * When snap is on and a widget is resized, the widgets it grows into
 * MOVE out of the way first, and only give up size once they have run
 * out of room. The previous behaviour shrank the neighbour immediately,
 * which meant a row lost total width every time you nudged one widget
 * wider even when there was empty canvas to slide into.
 *
 * Order of preference, in words:
 *   1. push the neighbour away along the axis of growth
 *   2. if it hits the perimeter, shrink it — but never below the floor
 *      that keeps its contents readable
 *   3. if it is already at that floor, refuse the growth
 *
 * Step 3 is what keeps the promise that a shrunken widget stays fully
 * visible: rather than letting a neighbour be squeezed into an
 * unreadable sliver, the widget being dragged simply stops growing. The
 * caller clamps to `maxExtent` and the drag feels like it hit a wall,
 * which it did.
 *
 * Pushes CASCADE: a widget shoved right can shove the next one, and the
 * refusal propagates back if anything at the end of the chain is stuck.
 *
 * Pure — no DOM, no React. The interesting part is the geometry, and
 * geometry is much easier to trust when you can assert on it directly.
 */

/** Do two boxes overlap on the axis PERPENDICULAR to the push? */
function crossOverlap(a, b, axis) {
  if (axis === 'x') return a.y < b.y + b.h && a.y + a.h > b.y;
  return a.x < b.x + b.w && a.x + a.w > b.x;
}

/**
 * @param {object}   moving   the resized widget's PROPOSED rect {id,x,y,w,h}
 * @param {Array}    others   every other widget's current rect
 * @param {'x'|'y'}  axis     axis of growth
 * @param {1|-1}     dir      +1 grows right/down, -1 grows left/up
 * @param {object}   opts     { limit, min, gap }
 *        limit — perimeter coordinate on the growth side. null = unbounded
 *                (the canvas grows downward, so vertical usually is).
 *        min   — legibility floor for the pushed widgets on this axis.
 *
 * @returns {{ ok: boolean, moved: Map<id, {x,y,w,h}>, maxExtent: number|null }}
 *        ok=false means the growth cannot be honoured in full; maxExtent
 *        is the furthest edge the moving widget may occupy.
 */
export function reflow(moving, others, axis, dir, opts = {}) {
  const { limit = null, min = 220, gap = 12 } = opts;
  const P = axis === 'x' ? 'x' : 'y';        // position key
  const S = axis === 'x' ? 'w' : 'h';        // size key

  // Only widgets that share the perpendicular band and sit on the side
  // we're growing into can be affected at all.
  const inPath = others
    .filter(o => crossOverlap(moving, o, axis))
    .filter(o => (dir > 0 ? o[P] >= moving[P] : o[P] + o[S] <= moving[P] + moving[S]))
    // Nearest first, so the cascade resolves in contact order.
    .sort((a, b) => (dir > 0 ? a[P] - b[P] : (b[P] + b[S]) - (a[P] + a[S])));

  const moved = new Map();
  // The edge the next widget must clear.
  let frontier = dir > 0 ? moving[P] + moving[S] : moving[P];
  let ok = true;
  let maxExtent = null;

  for (const o of inPath) {
    const rect = { x: o.x, y: o.y, w: o.w, h: o.h };
    const need = dir > 0 ? frontier + gap : frontier - gap;

    if (dir > 0) {
      if (rect[P] >= need) { frontier = rect[P] + rect[S]; continue; }   // already clear
      const shifted = need;
      const farEdge = shifted + rect[S];
      if (limit === null || farEdge <= limit) {
        rect[P] = shifted;                                   // 1. push
      } else {
        // 2. against the perimeter — pin the far edge and shrink.
        const room = limit - shifted;
        if (room >= min) {
          rect[P] = shifted;
          rect[S] = room;
        } else {
          // 3. no legible room left. Refuse, and report how far the
          //    moving widget may grow before this becomes true.
          ok = false;
          maxExtent = limit - min - gap;
          break;
        }
      }
    } else {
      const farEdge = rect[P] + rect[S];
      if (farEdge <= need) { frontier = rect[P]; continue; }
      const shiftedFar = need;
      const shiftedNear = shiftedFar - rect[S];
      if (limit === null || shiftedNear >= limit) {
        rect[P] = shiftedNear;
      } else {
        const room = shiftedFar - limit;
        if (room >= min) {
          rect[P] = limit;
          rect[S] = room;
        } else {
          ok = false;
          maxExtent = limit + min + gap;
          break;
        }
      }
    }

    moved.set(o.id, rect);
    frontier = dir > 0 ? rect[P] + rect[S] : rect[P];
  }

  return { ok, moved, maxExtent };
}

/**
 * Legibility floors. A widget narrower than this can't lay out its own
 * header, and one shorter can't show a row of content — at which point
 * "shrunk" has quietly become "broken", which is the thing this whole
 * mechanism exists to avoid.
 */
export const MIN_W = 220;
export const MIN_H = 90;
export const SNAP_GAP = 12;
