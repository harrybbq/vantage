/**
 * Widget shape classification.
 *
 * The width breakpoints already in place are continuous and handle most
 * of the range — they are the primary mechanism and this does not
 * replace them. What they CANNOT do is see height: widget cards are
 * auto-height in the snapping grid, so their query containers are
 * `inline-size`, and `@container (max-height: …)` never matches. A card
 * 600px wide reads identically to CSS whether it is 200px or 700px tall,
 * even though those want completely different layouts.
 *
 * So shape is measured here and published as a `data-shape` attribute
 * for CSS to key off. It is deliberately a small, named vocabulary
 * rather than raw numbers: five shapes a designer can actually draw
 * layouts for, matching the mock-ups.
 *
 *   column  ▯   very tall and thin   — a scanning list
 *   tall    ▯   taller than wide     — a stacked card
 *   square  ▢   roughly balanced     — the default
 *   wide    ▭   wider than tall      — side-by-side
 *   banner  ▬   very wide and short  — one horizontal strip
 *
 * Pure classification, no DOM — the geometry is easy to trust when it
 * can be asserted on directly.
 */

/** Aspect boundaries. Deliberately wide bands: a shape should be a
 *  region you can land in by dragging, not a knife edge you flicker
 *  across. */
export const SHAPE_BANDS = {
  column: 0.55,   // w/h <= this
  tall:   0.85,
  wide:   1.55,   // w/h >= this
  banner: 2.6,
};

/**
 * A card can be wide in ratio yet tall in pixels (a big square-ish
 * widget), which is not a banner. Banners also have to be genuinely
 * short, or a 900x400 card would lose layers it has room for.
 */
export const BANNER_MAX_H = 210;

export function classifyShape(w, h) {
  if (!(w > 0) || !(h > 0)) return 'square';
  const a = w / h;
  if (a >= SHAPE_BANDS.banner && h <= BANNER_MAX_H) return 'banner';
  if (a >= SHAPE_BANDS.wide) return 'wide';
  if (a <= SHAPE_BANDS.column) return 'column';
  if (a <= SHAPE_BANDS.tall) return 'tall';
  return 'square';
}

/**
 * Hysteresis: once a shape is chosen, require the aspect to move past
 * the boundary by this fraction before changing. Without it a widget
 * parked exactly on a band edge flickers between two layouts on every
 * sub-pixel resize, which looks broken and thrashes layout.
 */
const STICK = 0.06;

export function nextShape(current, w, h) {
  const fresh = classifyShape(w, h);
  if (!current || fresh === current) return fresh;
  if (!(w > 0) || !(h > 0)) return current;
  const a = w / h;
  // Only the boundary between the current shape and the candidate
  // matters, so find it and require a clear crossing.
  const edges = {
    'column|tall': SHAPE_BANDS.column,
    'tall|square': SHAPE_BANDS.tall,
    'square|wide': SHAPE_BANDS.wide,
    'wide|banner': SHAPE_BANDS.banner,
  };
  const key = [current, fresh].sort().join('|');
  const edge = edges[key] ?? edges[[fresh, current].sort().join('|')];
  if (edge == null) return fresh;               // non-adjacent, just move
  return Math.abs(a - edge) < edge * STICK ? current : fresh;
}

/**
 * Watch an element and keep `data-shape` current on it.
 * Returns a disposer. Safe to call with null.
 */
export function observeShape(el) {
  if (!el || typeof ResizeObserver === 'undefined') return () => {};
  let current = null;
  const apply = () => {
    const next = nextShape(current, el.clientWidth, el.clientHeight);
    if (next !== current) {
      current = next;
      el.setAttribute('data-shape', next);
    }
  };
  const ro = new ResizeObserver(apply);
  ro.observe(el);
  apply();
  return () => ro.disconnect();
}
