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
 * Height bands.
 *
 * Shape alone is not enough, and the gap it leaves is exactly what a
 * user notices: drag a 300x300 card down to 300x200 and the aspect goes
 * 1.0 → 1.5, which is still `square`, so NOTHING in the layout responds.
 * The card just clips. Aspect describes proportion; it cannot describe
 * "there are only 90 pixels left, drop something".
 *
 * So absolute height is published too, as a four-step band. Bands rather
 * than raw pixels for the same reason shapes are named: a layout author
 * needs regions they can design for, not a continuum.
 *
 *   xs  a strip — room for the chrome and one row of content
 *   sm  short — secondary rows and footnotes have to go
 *   md  comfortable
 *   lg  everything fits
 */
/* Boundaries sit ABOVE the height at which each layout starts to
 * overflow, not at it. A band that triggers exactly when content stops
 * fitting is a band that never helps: measured on the vitals widget,
 * 240px was still `md` (full layout) and overflowed by 18px, while the
 * `sm` reductions save about that much. Trigger early and the card is
 * never squeezed; trigger late and the band does nothing but rename the
 * problem. */
export const H_BANDS = { xs: 170, sm: 280, md: 420 };

const H_ORDER = ['xs', 'sm', 'md', 'lg'];
// EDGES[i] is the boundary between H_ORDER[i] and H_ORDER[i + 1].
const H_EDGES = [H_BANDS.xs, H_BANDS.sm, H_BANDS.md];

export function heightBand(h) {
  if (!(h > 0)) return 'lg';
  if (h < H_BANDS.xs) return 'xs';
  if (h < H_BANDS.sm) return 'sm';
  if (h < H_BANDS.md) return 'md';
  return 'lg';
}

/**
 * Same hysteresis argument as nextShape, but in pixels — a card parked
 * on 240px must not flip layouts on every sub-pixel of a drag.
 */
const H_STICK = 8;

export function nextHeightBand(current, h) {
  const fresh = heightBand(h);
  if (!current || fresh === current) return fresh;
  if (!(h > 0)) return current;
  const ci = H_ORDER.indexOf(current);
  const fi = H_ORDER.indexOf(fresh);
  const lo = Math.min(ci, fi);
  const hi = Math.max(ci, fi);
  // Sitting on any boundary we would have to cross? Then stay put.
  for (let i = lo; i < hi; i++) {
    if (Math.abs(h - H_EDGES[i]) < H_STICK) return current;
  }
  return fresh;
}

/**
 * Watch an element and keep `data-shape` (and optionally `data-h`)
 * current on it. Returns a disposer. Safe to call with null.
 *
 * `heightBands` defaults to on, but MUST be off wherever height is not
 * something the user set. The mobile stack is auto-height: a compact
 * card is short because its content is short, not because anyone asked
 * for a strip, and stamping `data-h="xs"` there would strip layers off
 * widgets nobody shrank. Height bands are a response to a deliberate
 * vertical resize, which only the desktop canvas has.
 */
export function observeShape(el, { heightBands = true } = {}) {
  if (!el || typeof ResizeObserver === 'undefined') return () => {};
  let shape = null;
  let band = null;
  const apply = () => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    const nextS = nextShape(shape, w, h);
    if (nextS !== shape) {
      shape = nextS;
      el.setAttribute('data-shape', nextS);
    }
    if (!heightBands) return;
    const nextH = nextHeightBand(band, h);
    if (nextH !== band) {
      band = nextH;
      el.setAttribute('data-h', nextH);
    }
  };
  const ro = new ResizeObserver(apply);
  ro.observe(el);
  apply();
  return () => ro.disconnect();
}
