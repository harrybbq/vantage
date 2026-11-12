/**
 * The desktop hub's layout: widgets placed by the height their content
 * needs (owner, Nov 2026).
 *
 * ── What it replaced ────────────────────────────────────────────────
 * A CSS grid of row tracks. Every widget in a row was as tall as the
 * tallest one in it, and a "large" widget was two rows tall whatever it
 * held, so a three-line League card sat in a box sized for its
 * neighbour's twelve trackers. The dead space was the grid's, not the
 * widgets'.
 *
 * ── The rule ────────────────────────────────────────────────────────
 * Columns keep a running top (a skyline). In the user's order, each
 * widget goes where its top is highest on the page: a 1-column widget in
 * the shortest column, a 2-column widget on the left or right half
 * (never straddling the middle, as before), leftmost on a tie. Its
 * height is its own.
 *
 * The one hole this can leave is under the shorter of two side-by-side
 * small widgets when a wide one comes next. That small widget is
 * stretched to close it (`extra`), so card edges stay aligned and the
 * page has no gaps; the stretch is at most the difference between two
 * neighbours. A small widget with nothing beside it (the next card is
 * wide) takes both columns of its half rather than leave the other
 * empty (`widened`).
 *
 * Size still means what it did for everything except height: how wide
 * the widget is and how much it shows (grid.js spanOf, each widget's
 * own row caps).
 *
 * Pure: no React, no DOM. Heights come in, rectangles go out.
 */
import { spanOf } from './grid.js';

const EPS = 0.5;

/**
 * @param items     the hub's items, in order
 * @param cols      columns (4 on desktop)
 * @param sizeOf    item → 'small' | 'medium' | 'large'
 * @param heightOf  item → natural height in px (content + chrome)
 * @param gap       px between cards, both ways
 * @returns { cells: [{ id, col, w, y, h, extra, widened }], height } — col
 *          is 0-based; h includes `extra`, the stretch added to close a
 *          hole; `widened` marks a small card given both columns.
 */
export function packMasonry(items, cols = 4, sizeOf = it => it.size, heightOf = () => 0, gap = 16) {
  const tops = new Array(cols).fill(0);      // next free y per column
  const last = new Array(cols).fill(null);   // the cell that set it
  const cells = [];
  for (const it of items) {
    const w = Math.min(spanOf(sizeOf(it), cols)[0], cols);
    const step = cols % w === 0 ? w : 1;
    let col = 0, y = Infinity;
    for (let c = 0; c + w <= cols; c += step) {
      let t = 0;
      for (let k = c; k < c + w; k++) t = Math.max(t, tops[k]);
      if (t < y - EPS) { y = t; col = c; }
    }
    // Close the hole above this card in any column that stopped short.
    for (let k = col; k < col + w; k++) {
      const hole = y - tops[k];
      if (hole <= EPS) continue;
      const above = last[k];
      if (above && above.w === 1 && !above.widened) { above.extra += hole; above.h += hole; continue; }
      // Nothing small above to stretch: the hole is the empty half beside
      // a lone small card. That card takes both columns instead.
      if (w !== 2) continue;
      const q = k === col ? col + 1 : col;
      const lone = last[q];
      if (lone && lone.w === 1 && Math.abs(lone.y - tops[k]) <= EPS) {
        lone.w = 2; lone.col = col; lone.widened = true;
        last[k] = lone; tops[k] = tops[q];
      }
    }
    const h = Math.max(0, Number(heightOf(it)) || 0);
    const cell = { id: it.id, col, w, y, h, extra: 0, widened: false };
    cells.push(cell);
    for (let k = col; k < col + w; k++) { tops[k] = y + h + gap; last[k] = cell; }
  }
  // At the foot of a half, two small cards side by side end level.
  for (let c = 0; c + 1 < cols; c += 2) {
    const a = last[c], b = last[c + 1];
    if (!a || !b || a === b || a.w !== 1 || b.w !== 1) continue;
    const diff = tops[c] - tops[c + 1];
    if (Math.abs(diff) <= EPS) continue;
    const short = diff > 0 ? b : a;
    short.extra += Math.abs(diff); short.h += Math.abs(diff);
    tops[c] = tops[c + 1] = Math.max(tops[c], tops[c + 1]);
  }
  // The same for a small card left alone at the foot of its half.
  for (let c = 0; c + 1 < cols; c += 2) {
    for (const [k, q] of [[c, c + 1], [c + 1, c]]) {
      const lone = last[k];
      if (lone && lone.w === 1 && !lone.widened && tops[q] <= lone.y + EPS) {
        lone.w = 2; lone.col = c; lone.widened = true;
        last[q] = lone; tops[q] = tops[k];
      }
    }
  }
  const height = Math.max(0, ...tops.map(t => t - gap));
  return { cells, height };
}

/**
 * Where should the dragged item go? Every insertion index is packed and
 * the one that puts the dragged card's centre nearest `target` wins.
 * `target` and the result are in px from the grid's top-left;
 * `geom` = { colW, gap } turns columns into px. Staying put wins a tie,
 * so a pick-up-and-drop changes nothing.
 */
export function dropIndexMasonry(items, fromIdx, target, cols, sizeOf, heightOf, geom) {
  if (fromIdx < 0 || fromIdx >= items.length) return fromIdx;
  const { colW, gap } = geom;
  const moving = items[fromIdx];
  const rest = items.filter((_, i) => i !== fromIdx);
  const dist = to => {
    const order = rest.slice(0, to).concat([moving], rest.slice(to));
    const p = packMasonry(order, cols, sizeOf, heightOf, gap).cells.find(c => c.id === moving.id);
    const cx = p.col * (colW + gap) + (p.w * colW + (p.w - 1) * gap) / 2;
    const cy = p.y + (p.h - p.extra) / 2;
    return (cx - target.x) ** 2 + (cy - target.y) ** 2;
  };
  let best = fromIdx, bestD = dist(fromIdx);
  for (let to = 0; to <= rest.length; to++) {
    if (to === fromIdx) continue;
    const d = dist(to);
    if (d < bestD - EPS) { bestD = d; best = to; }
  }
  return best;
}
