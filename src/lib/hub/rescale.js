import { MIN_W } from './reflow';

/**
 * Carry a hub layout between display widths.
 *
 * Widget positions and sizes are absolute pixels, which means they only
 * mean anything relative to the canvas they were arranged on. Open the
 * same account on a wider monitor and a layout built at 1440 sits in the
 * left half with a stripe of nothing beside it; open it narrower and it
 * runs off the edge.
 *
 * So the width the layout was arranged at is stored with it
 * (`S.widgetLayoutW`) and the horizontal axis is scaled on the way to
 * the screen. A news widget arranged wide stays proportionally wide; a
 * savings widget kept skinny at the side stays skinny, at the side.
 *
 * ONLY the horizontal axis. Vertical space is unbounded — the canvas
 * grows and the page scrolls — so a taller window should reveal more of
 * the layout rather than stretch it, and a widget's height is a choice
 * about its content rather than about the screen.
 *
 * Scaling is a VIEW concern. Nothing here is written back on load: state
 * keeps holding the coordinates the user actually arranged, in the space
 * named by `widgetLayoutW`. It is rebased only when they next move or
 * resize something — see rebaseLayout — so a quick look on a small
 * laptop can never quietly flatten a layout built on a big monitor.
 */

/** Below this the scale is a rounding artefact, not a display change. */
const EPSILON = 0.02;

export function scaleFactor(from, to) {
  if (!(from > 0) || !(to > 0)) return 1;
  const k = to / from;
  return Math.abs(k - 1) < EPSILON ? 1 : k;
}

/**
 * @param entry  { x, y } position or { w, h } size
 * @param k      horizontal scale
 * @param canvasW current canvas width, for clamping
 */
function scaleX(v, k) { return Math.round(v * k); }

/**
 * Map one widget's box into the current canvas width.
 *
 * Returns null when there is nothing to change, so callers can skip the
 * write entirely rather than churning identical values.
 */
export function scaleBox(box, k, canvasW) {
  if (!box) return null;
  const x = box.x != null ? scaleX(box.x, k) : null;
  const w = box.w != null ? Math.max(MIN_W, scaleX(box.w, k)) : null;
  const out = { ...box };
  if (x != null) out.x = Math.max(0, x);
  if (w != null) out.w = w;
  // Keep the right edge inside the canvas. A layout scaled down can push
  // a wide widget past the wall once its width hits the MIN_W floor.
  if (canvasW > 0 && out.x != null && out.w != null && out.x + out.w > canvasW) {
    out.x = Math.max(0, canvasW - out.w);
  }
  return out;
}

/**
 * The whole layout, mapped from the width it was arranged at to the
 * width on screen now.
 *
 * @param positions S.widgetPositions
 * @param sizes     S.widgetSizes
 * @param from      S.widgetLayoutW — the width it was arranged at
 * @param to        the canvas width now
 * @returns { positions, sizes, k } — same objects back when k is 1
 */
export function rescaleLayout(positions = {}, sizes = {}, from, to) {
  const k = scaleFactor(from, to);
  if (k === 1) return { positions, sizes, k: 1 };

  const outPos = {};
  const outSize = {};
  for (const id of Object.keys(positions)) {
    const p = positions[id];
    const s = sizes[id];
    // Position and size have to be clamped together: the right edge is
    // a property of the pair, not of either one.
    const w = s?.w != null ? Math.max(MIN_W, scaleX(s.w, k)) : null;
    const x = Math.max(0, scaleX(p?.x ?? 0, k));
    const clampedX = (w != null && to > 0 && x + w > to) ? Math.max(0, to - w) : x;
    outPos[id] = { ...p, x: clampedX };
    if (s) outSize[id] = { ...s, ...(w != null ? { w } : {}) };
  }
  // Sizes can exist without a position (a widget resized before it was
  // ever dragged). Carry those across too.
  for (const id of Object.keys(sizes)) {
    if (outSize[id]) continue;
    const s = sizes[id];
    outSize[id] = s?.w != null ? { ...s, w: Math.max(MIN_W, scaleX(s.w, k)) } : s;
  }
  return { positions: outPos, sizes: outSize, k };
}

/**
 * Rebase saved state onto the current width.
 *
 * Called when the user moves or resizes something on a display that is
 * not the one they arranged on. Their new drag is already in current-
 * width pixels, so every OTHER widget has to be brought into the same
 * space or the layout would be half in one coordinate system and half
 * in another.
 *
 * Returns the patch to merge, or null when nothing needs to move.
 */
export function rebaseLayout(prev, canvasW) {
  const from = prev?.widgetLayoutW;
  if (!(canvasW > 0)) return null;
  if (!(from > 0)) return { widgetLayoutW: canvasW };   // first time — just record it
  const k = scaleFactor(from, canvasW);
  if (k === 1) return null;
  const { positions, sizes } = rescaleLayout(
    prev.widgetPositions || {}, prev.widgetSizes || {}, from, canvasW,
  );
  return { widgetPositions: positions, widgetSizes: sizes, widgetLayoutW: canvasW };
}
