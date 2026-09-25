/**
 * Packing a prime widget's blocks into whatever box it has been dragged to.
 *
 * ── The problem this solves ──────────────────────────────────────────
 * A prime widget is one card per section — Savings, Habits, Trackers —
 * and the user picks which blocks it shows and in what order. On desktop
 * they then drag it to any width and height they like; on mobile it is
 * full-width with no height at all. The same chosen blocks have to fill
 * every one of those boxes without dead space and without a scrollbar
 * appearing at the first awkward size.
 *
 * ── The rule, in order ───────────────────────────────────────────────
 *   1. COLUMNS. A banner (very wide, short) gives each block its own
 *      column so the card reads left to right. A card at least 520px
 *      wide inside its padding splits: a hero in first place becomes a
 *      full-width header, the next block takes the main column at 58%,
 *      and everything after it stacks in the side column. Anything else
 *      is one column.
 *   2. FIT. Every block starts at full detail. While a column overflows,
 *      walk it from the BOTTOM up dropping full → compact; then, if it
 *      still overflows, walk it again dropping compact → fact. Two
 *      separate passes, so every block is compact before any block is a
 *      one-line fact — detail leaves the card evenly rather than
 *      gutting whatever happens to be last.
 *   3. FLOOR. If everything is a fact and it still does not fit, the
 *      facts pair up two to a row. A ticked block is never hidden: the
 *      whole point of the fact level is that there is always something
 *      smaller to fall back to.
 *   4. SPARE HEIGHT. Whatever is left over goes to the blocks still at
 *      full detail that asked to grow, in proportion, up to each one's
 *      ceiling — a list stops growing when it runs out of rows. Lists
 *      then snap to whole rows and hand the remainder to a grower that
 *      is not a list, so a card never ends with half a row drawn.
 *
 * Mobile skips 2 and 3 entirely: height is unbounded, so everything
 * renders at full detail and the card reports the height it needs.
 *
 * Pure. No React, no DOM, no clock. `meta` is the block registry for one
 * prime — see primeBlocks.js.
 */

/** Card chrome, in px. HEAD is the title row; PAD the body inset. */
export const S_H = 26;     // a fact is one line and always exactly this tall
export const PAD = 12;
export const HEAD = 32;
export const GAP = 8;

export const LEVEL_NAMES = ['full', 'compact', 'fact'];

/**
 * The card's proportions, as a word.
 *
 * Shared with the existing `observeShape` vocabulary so a prime card and
 * a legacy widget describe themselves the same way.
 */
export function classify(w, h) {
  const a = w / h;
  if (a >= 2.6 && h <= 210) return 'banner';
  if (a >= 1.55) return 'wide';
  if (a <= 0.55) return 'column';
  if (a <= 0.85) return 'tall';
  return 'square';
}

/** Height band. Coarse on purpose: it is a styling hook, not a measurement. */
export function bandOf(h) {
  return h < 170 ? 'xs' : h < 280 ? 'sm' : h < 420 ? 'md' : 'lg';
}

/** How many columns a given box will use — for the editor's readout. */
export function colsOf(w, h) {
  return classify(w, h) === 'banner' ? 'row' : w - PAD * 2 >= 520 ? '2 col' : '1 col';
}

/**
 * Build a packer bound to one prime's block registry.
 *
 * Returns `pack(ids, W, H) → { items, height }`, where each item is an
 * absolutely-positioned slot: `{ key, x, y, w, h, level, view, tag }`.
 * The caller renders the block's Body into the slot at `view`; it never
 * measures anything itself.
 *
 * `head` is the chrome above the blocks. A prime card draws its own
 * title row, but on mobile the host card already has one — passing 0
 * there stops the two stacking up and wasting 32px of every card.
 */
export function makePacker(meta, head = HEAD) {
  /* Both EDGES are snapped, not the offset and the size independently.
     Rounding x and w apart lets a right-hand column end a pixel past the
     card's padding — which is exactly the sort of thing that shows up as
     a hairline of clipped content at one width in fifty and is never
     reproducible by hand. Snapping edges also makes adjacent slots share
     a boundary exactly, so no seam appears between them. */
  function slot(id, level, x, y, w, h) {
    const m = meta[id];
    const view = level === 2 ? 'fact' : m.views[level];
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    return {
      key: id,
      x: PAD + x0,
      y: head + y0,
      w: Math.max(0, Math.round(x + w) - x0),
      h: Math.max(0, Math.round(y + h) - y0),
      level,
      view,
      tag: id + ' · ' + LEVEL_NAMES[level],
    };
  }

  function fit(col) {
    const ids = col.ids;
    const n = ids.length;
    const lv = ids.map(() => 0);
    const hOf = i => {
      const m = meta[ids[i]];
      return lv[i] === 0 ? m.L : lv[i] === 1 ? m.M : S_H;
    };
    const need = () => ids.reduce((s, _, i) => s + hOf(i), 0) + GAP * (n - 1);

    // Two passes, bottom-up. Pass 0 takes full → compact; pass 1 takes
    // compact → fact. Separating them is what stops the last block being
    // reduced to a single line while the first is still at full size.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0 && need() > col.h; i--) {
        if (lv[i] === pass) lv[i] = pass + 1;
      }
    }

    // Then give back what fits, top-down. Shedding is coarse: dropping
    // the top block to compact can free far more than was needed, and
    // without this the card ends up all-compact with the surplus
    // stretched into gaps (a 318×280 Trackers card had 62px of it). A
    // block is only promoted if the whole column still fits afterwards,
    // and never to full while anything in the column is a fact.
    for (let pass = 1; pass >= 0; pass--) {
      for (let i = 0; i < n; i++) {
        if (lv[i] !== pass + 1) continue;
        if (pass === 0 && lv.some(l => l === 2)) break;
        lv[i] = pass;
        if (need() > col.h) lv[i] = pass + 1;
      }
    }

    const out = [];

    // The floor: everything is a fact and it STILL does not fit, so pair
    // them two to a row. Narrower than 230px there is no room for two,
    // so the column scrolls instead — but nothing is ever dropped.
    if (need() > col.h && n > 1 && col.w >= 230) {
      const rows = Math.ceil(n / 2);
      const rh = Math.max(S_H, Math.min(40, (col.h - GAP * (rows - 1)) / rows));
      const cw = (col.w - GAP) / 2;
      ids.forEach((id, i) => {
        const r = Math.floor(i / 2);
        const k = i % 2;
        const solo = i === n - 1 && n % 2 === 1;
        out.push(slot(id, 2, col.x + k * (cw + GAP), col.y + r * (rh + GAP), solo ? col.w : cw, rh));
      });
      return out;
    }

    const hs = ids.map((_, i) => hOf(i));
    let slack = col.h - need();

    if (slack > 0 && !col.fixed) {
      // Proportional by `grow`, capped by `max`. Looped because capping
      // one block frees its share for the others — six rounds is far
      // more than any real block list needs and bounds the work.
      let pool = ids.map((_, i) => i).filter(i => meta[ids[i]].grow > 0 && lv[i] === 0);
      for (let round = 0; round < 6 && slack > 0.5 && pool.length; round++) {
        const weight = pool.reduce((s, i) => s + meta[ids[i]].grow, 0);
        let used = 0;
        pool.forEach(i => {
          const m = meta[ids[i]];
          let add = (slack * m.grow) / weight;
          if (m.max) add = Math.min(add, m.max - hs[i]);
          hs[i] += add;
          used += add;
        });
        slack -= used;
        pool = pool.filter(i => !meta[ids[i]].max || hs[i] < meta[ids[i]].max - 0.5);
      }
      /* Nobody wants it, or everyone is capped. Spread it so the column
         reaches the bottom edge — but NOT into a row-stepped list. A
         list draws fixed-height rows and has exactly as many as it has
         records, so stretching it to 456px paints 68px of rows and a
         wall of nothing. Blocks that centre their content (hero, chart,
         seg, stat) absorb the space invisibly, so they take it.

         If every block here is a list, the slack stays. That is honest:
         two habits do not fill half a metre of card, and a gap beside a
         full column reads as "this side has less to say" rather than as
         a bug. */
      if (slack > 0.5) {
        const stretchy = ids.map((_, i) => i).filter(i => !meta[ids[i]].row || lv[i] !== 0);
        if (stretchy.length) {
          stretchy.forEach(i => { hs[i] += slack / stretchy.length; });
        }
      }
    }

    /* A list drawn 1.4 rows tall looks broken, so snap it to whole rows
       — but the remainder has to go somewhere, or the column stops short
       of the bottom edge and the card shows a gap.

       First choice is a grower that is not itself a list, which will
       simply absorb it. Failing that, any other block takes it: slightly
       over-tall is invisible, a 16px hole at the bottom of the card is
       not. A lone list keeps its gap, because the only alternative is
       drawing an empty row. */
    ids.forEach((id, i) => {
      const m = meta[id];
      if (!m.row || lv[i] !== 0) return;
      const snapped = m.L + Math.floor((hs[i] - m.L) / m.row) * m.row;
      const spare = hs[i] - snapped;
      if (spare <= 0.5) return;
      hs[i] = snapped;
      let j = ids.findIndex((x, k) => k !== i && meta[x].grow > 0 && !meta[x].row);
      if (j < 0) j = ids.findIndex((x, k) => k !== i && !meta[x].row);
      if (j < 0) j = ids.findIndex((x, k) => k !== i);
      if (j >= 0) hs[j] += spare;
      else hs[i] = snapped + spare;      // nothing else here: keep the height
    });

    let y = col.y;
    ids.forEach((id, i) => {
      out.push(slot(id, lv[i], col.x, y, col.w, hs[i]));
      y += hs[i] + GAP;
    });
    return out;
  }

  return function pack(ids, W, H) {
    const iw = W - PAD * 2;

    // ── Mobile: one column, no ceiling, everything at full detail ──
    if (H == null) {
      let y = 0;
      const items = [];
      ids.forEach(id => {
        const m = meta[id];
        const h = m.kind === 'chart'
          ? Math.round(iw / 2.3)                       // charts keep an aspect
          : m.views[0] === 'vesselsL' ? 140            // vessels want depth
            : (m.max || m.L);
        items.push(slot(id, 0, 0, y, iw, h));
        y += h + GAP;
      });
      return { items, height: head + y - GAP + PAD };
    }

    const ih = H - head - PAD;
    const n = ids.length;
    let cols;

    if (classify(W, H) === 'banner' && n >= 2) {
      // Very wide and short: read left to right, one block per column.
      const cw = (iw - GAP * (n - 1)) / n;
      cols = ids.map((id, i) => ({ x: i * (cw + GAP), w: cw, ids: [id], y: 0, h: ih }));
    } else if (iw >= 520 && n >= 2) {
      cols = [];
      let y = 0;
      let rest = ids;
      // "Move total saved to the top as a large header": a hero FIRST is
      // the instruction, and it spans. Order alone produces the layout.
      if (meta[ids[0]].kind === 'hero') {
        const hh = ih >= 300 ? meta[ids[0]].L + 20 : meta[ids[0]].M;
        cols.push({ x: 0, w: iw, ids: [ids[0]], y: 0, h: hh, fixed: true });
        rest = ids.slice(1);
        y = hh + GAP;
      }
      if (rest.length === 1) {
        cols.push({ x: 0, w: iw, ids: rest, y, h: ih - y });
      } else {
        const mw = Math.round((iw - GAP) * 0.58);
        cols.push(
          { x: 0, w: mw, ids: [rest[0]], y, h: ih - y },
          { x: mw + GAP, w: iw - mw - GAP, ids: rest.slice(1), y, h: ih - y },
        );
      }
    } else {
      cols = [{ x: 0, w: iw, ids, y: 0, h: ih }];
    }

    return { items: cols.flatMap(fit), height: H };
  };
}
