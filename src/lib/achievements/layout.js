/**
 * Layered layout for the achievement graph.
 *
 * The desktop board stores hand-placed x/y per node, which is exactly
 * what cannot work on a 390px screen — a 2D arrangement someone dragged
 * out on a 1440px canvas needs panning and pinching to read. This
 * derives a layout from the GRAPH instead, so the same nodes and the
 * same dependencies come out as a column you only ever scroll.
 *
 * Pure functions, no React and no DOM: the interesting part is the
 * arrangement, and arrangement is much easier to trust when you can
 * assert on it directly.
 *
 * The pipeline is the classic Sugiyama one, minus the parts that don't
 * earn their keep at this size:
 *
 *   1. layer      — longest path from a root, so every edge points down
 *   2. dummies    — an edge spanning >1 layer gets waypoints, so it
 *                   routes through the gaps instead of cutting across
 *                   whatever happens to sit between its ends
 *   3. order      — barycentre sweeps, so children sit under their
 *                   parents and lines stop crossing for no reason
 *   4. position   — even columns per row
 *
 * Cycles: the data model shouldn't contain any (a goal can't be its own
 * prerequisite) but nothing enforces that, and a cycle would hang the
 * layering loop. Any edge that would close one is dropped from the
 * layout — the node still renders, it just loses that one arrow, which
 * beats a frozen page.
 */

/** @returns {{ rows, nodes, edges, width, height }} */
export function layoutTree(achievements, connections, opts = {}) {
  const {
    width = 362,        // usable canvas width in px
    colGap = 10,
    rowGap = 44,
    cardH = 66,
    maxPerRow = 3,      // beyond this, cards get too narrow to read
    minCardW = 104,     // below this a name can't survive two lines
  } = opts;

  const byId = new Map(achievements.map(a => [a.id, a]));
  // Only edges whose both ends still exist — a deleted goal can leave a
  // dangling connection behind.
  const edges = (connections || []).filter(([f, t]) => byId.has(f) && byId.has(t) && f !== t);

  // ── 1. Layer by longest path, dropping any edge that closes a cycle ──
  const parents = new Map(achievements.map(a => [a.id, []]));
  const kept = [];
  for (const [f, t] of edges) {
    if (createsCycle(parents, f, t)) continue;
    parents.get(t).push(f);
    kept.push([f, t]);
  }

  const depth = new Map(achievements.map(a => [a.id, 0]));
  for (let pass = 0; pass < achievements.length + 1; pass++) {
    let moved = false;
    for (const [f, t] of kept) {
      if (depth.get(t) < depth.get(f) + 1) { depth.set(t, depth.get(f) + 1); moved = true; }
    }
    if (!moved) break;
  }

  // ── 2. Dummy waypoints for edges that span more than one layer ──
  const rows = [];
  const push = (d, item) => { (rows[d] = rows[d] || []).push(item); };
  for (const a of achievements) push(depth.get(a.id), { kind: 'node', id: a.id, ach: a });

  const routed = [];
  let dummySeq = 0;
  for (const [f, t] of kept) {
    const df = depth.get(f), dt = depth.get(t);
    if (dt - df <= 1) { routed.push({ from: f, to: t, via: [] }); continue; }
    const via = [];
    for (let d = df + 1; d < dt; d++) {
      const id = `__d${dummySeq++}`;
      via.push(id);
      push(d, { kind: 'dummy', id, of: [f, t] });
    }
    routed.push({ from: f, to: t, via });
  }
  for (let d = 0; d < rows.length; d++) rows[d] = rows[d] || [];

  // ── 3. Barycentre ordering, sweeping down then up ──
  const index = new Map();
  rows.forEach(row => row.forEach((it, i) => index.set(it.id, i)));
  const inbound = new Map();   // id -> [ids feeding it in the layout graph]
  const outbound = new Map();
  const link = (a, b) => {
    if (!inbound.has(b)) inbound.set(b, []);
    if (!outbound.has(a)) outbound.set(a, []);
    inbound.get(b).push(a);
    outbound.get(a).push(b);
  };
  for (const r of routed) {
    const chain = [r.from, ...r.via, r.to];
    for (let i = 0; i < chain.length - 1; i++) link(chain[i], chain[i + 1]);
  }
  const mean = ids => ids.reduce((s, id) => s + (index.get(id) ?? 0), 0) / (ids.length || 1);
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? [...rows.keys()] : [...rows.keys()].reverse();
    for (const d of order) {
      if (down ? d === 0 : d === rows.length - 1) continue;
      const rel = down ? inbound : outbound;
      rows[d] = rows[d]
        .map(it => ({ it, b: rel.has(it.id) ? mean(rel.get(it.id)) : (index.get(it.id) ?? 0) }))
        .sort((a, b) => a.b - b.b)
        .map(x => x.it);
      rows[d].forEach((it, i) => index.set(it.id, i));
    }
  }

  // ── 4. Positions ──
  const nodes = new Map();
  let y = 0;
  const laidRows = [];
  for (const row of rows) {
    // Widths are shared out between REAL cards only. Waypoints are
    // invisible — letting one claim a column made a three-goal layer
    // think it was a four-goal layer and wrap, which is what pushed a
    // sibling onto a row of its own for no reason a reader could see.
    const real = row.filter(it => it.kind === 'node');
    const dummies = row.filter(it => it.kind === 'dummy');

    // Keep a layer on ONE line wherever it still reads: splitting a
    // layer across two lines makes it look like two layers, and the
    // edges then run alongside each other for no visible reason. Only
    // wrap once cards would fall below the legible floor.
    const fits = n => (width - colGap * (n - 1)) / n >= minCardW;
    const perLine = Math.max(1, Math.min(real.length || 1, fits(real.length) ? real.length : maxPerRow));
    const lines = [];
    for (let i = 0; i < real.length; i += perLine) lines.push(real.slice(i, i + perLine));

    const rowTop = y;
    for (const line of lines) {
      const w = (width - colGap * (line.length - 1)) / line.length;
      line.forEach((it, i) => {
        const x = i * (w + colGap);
        nodes.set(it.id, { ...it, x, y, w, h: cardH, cx: x + w / 2, top: y, bottom: y + cardH });
      });
      y += cardH + rowGap;
    }

    // Waypoints ride in the band this layer occupies, spread evenly so a
    // long edge passes between the cards rather than through one.
    const bandTop = rowTop;
    const bandBottom = Math.max(rowTop, y - rowGap);
    dummies.forEach((it, i) => {
      const cx = ((i + 1) / (dummies.length + 1)) * width;
      nodes.set(it.id, {
        ...it, x: cx, y: bandTop, w: 0, h: 0, cx,
        top: bandTop, bottom: bandBottom,
      });
    });
    // A layer of nothing but waypoints still needs a little height to
    // route through.
    if (!real.length) y += rowGap;
    laidRows.push({ top: rowTop, bottom: y - rowGap });
  }
  const height = Math.max(0, y - rowGap);

  return { rows, nodes, edges: routed, width, height, parents, depth };
}

/** Would adding f→t close a loop back to f? Walks up from f's ancestors. */
function createsCycle(parents, f, t) {
  if (f === t) return true;
  const seen = new Set();
  const stack = [f];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === t) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const p of parents.get(cur) || []) stack.push(p);
  }
  return false;
}

/**
 * Points for one edge, anchored to card edges rather than centres so a
 * line never emerges from the middle of a card.
 */
export function edgePath(layout, edge) {
  const { nodes } = layout;
  const a = nodes.get(edge.from);
  const b = nodes.get(edge.to);
  if (!a || !b) return null;
  const pts = [{ x: a.cx, y: a.bottom }];
  for (const v of edge.via) {
    const d = nodes.get(v);
    if (d) pts.push({ x: d.cx, y: d.top });
  }
  pts.push({ x: b.cx, y: b.top });

  let d = `M${round(pts[0].x)},${round(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i];
    const my = (p0.y + p1.y) / 2;
    d += ` C${round(p0.x)},${round(my)} ${round(p1.x)},${round(my)} ${round(p1.x)},${round(p1.y)}`;
  }
  return d;
}

const round = n => Math.round(n * 10) / 10;
