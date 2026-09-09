/**
 * The achievement graph, arranged as something you can play through.
 *
 * ── What was wrong with the tree ─────────────────────────────────────
 * The mobile board was every path drawn in full, one under another. It
 * inherited the desktop's PROBLEM — read the whole graph at once — while
 * losing the desktop's ADVANTAGE, which was 1440px of room to do it in.
 * The four complaints all follow from that: you cannot tell what is
 * next, you scroll forever, unlinked goals read as a hierarchy they are
 * not part of, and there is no sense of the whole.
 *
 * This is the same graph and the same rules, re-presented:
 *
 *   • The board splits into independent PATHS (connected components), so
 *     "the whole picture" is a rail of chips rather than four screens.
 *   • Inside a path, goals are ordered by dependency DEPTH, which is what
 *     makes "step 3 of 5" mean something. Within one depth, what you can
 *     actually do comes first — you never land on a wall while something
 *     workable sits at the same level.
 *   • One step is big; the step either side of it is a single row. Context
 *     costs 44px instead of a screen.
 *
 * Everything here is pure: no React, no DOM. The interesting part is the
 * arrangement, and an arrangement is far easier to trust when it can be
 * asserted on directly.
 */
import { splitComponents, endGoals } from './layout.js';

export const parentsOf = (conns, id) => (conns || []).filter(c => c[1] === id).map(c => c[0]);
export const childrenOf = (conns, id) => (conns || []).filter(c => c[0] === id).map(c => c[1]);

/**
 * A goal's state, from the graph rather than from a cached flag.
 *
 * `a.locked` is maintained by recalcLocks on every mutation, so the two
 * normally agree — but the stored flag is ALSO honoured, because it is
 * what handleToggleComplete consults before it will do anything. Trusting
 * only the derived answer would let the UI offer a Complete button that
 * the handler silently refuses.
 */
export function stateOf(achievements, conns, ach) {
  if (!ach) return 'locked';
  if (ach.completed) return 'completed';
  return isLocked(achievements, conns, ach) ? 'locked' : 'active';
}

export function isLocked(achievements, conns, ach) {
  if (!ach) return true;
  if (ach.locked) return true;
  const ps = parentsOf(conns, ach.id);
  if (!ps.length) return false;
  return !ps.every(p => {
    const g = (achievements || []).find(x => x.id === p);
    return g && g.completed;
  });
}

/**
 * Longest chain of prerequisites behind each goal.
 *
 * This is the number that makes a step count honest. The tree got it
 * wrong by treating every goal without a prerequisite as a root of one
 * shared tree, so an unlinked "Learn guitar" appeared to sit a level
 * above "Save a house deposit".
 */
export function depths(ids, conns) {
  const set = new Set(ids);
  const local = (conns || []).filter(([f, t]) => set.has(f) && set.has(t) && f !== t);
  const d = new Map(ids.map(i => [i, 0]));
  // Bellman-Ford style relaxation, bounded by the node count so a cycle
  // in the data cannot hang this — the graph should not contain one, and
  // nothing enforces that.
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const [f, t] of local) {
      const v = d.get(f) + 1;
      if (v > d.get(t)) { d.set(t, v); moved = true; }
    }
    if (!moved) break;
  }
  return d;
}

const RANK = { active: 0, completed: 1, locked: 2 };

/**
 * The order you walk a path in.
 *
 * Depth first, so every step is genuinely behind the one after it. Then
 * what you can do, then what you have done, then what is still blocked —
 * within a single depth those are interchangeable as far as the graph is
 * concerned, and this is the order that is useful. Name breaks the tie so
 * the sequence never jitters between renders.
 */
export function queueFor(achievements, conns, ids) {
  const d = depths(ids, conns);
  return ids
    .map(id => (achievements || []).find(a => a.id === id))
    .filter(Boolean)
    .sort((a, b) =>
      (d.get(a.id) - d.get(b.id)) ||
      (RANK[stateOf(achievements, conns, a)] - RANK[stateOf(achievements, conns, b)]) ||
      String(a.name || '').localeCompare(String(b.name || '')));
}

/**
 * Every path on the board, biggest first, with the standalone goals
 * after them as paths of one.
 *
 * A goal on no path is not a root of anything and is not hidden either:
 * it is its own one-step path, labelled as standalone, which is what it
 * actually is.
 */
export function pathsOf(achievements, connections) {
  const { paths, loose } = splitComponents(achievements || [], connections || []);

  const built = paths.map(p => build(p.achievements.map(a => a.id), p.connections, achievements));
  const singles = loose.map(a => build([a.id], [], achievements));
  return [...built, ...singles];

  function build(ids, conns, all) {
    const queue = queueFor(all, conns, ids);
    const done = queue.filter(g => g.completed).length;
    const standalone = ids.length === 1;
    const ends = endGoals(queue, conns);
    return {
      key: ids.slice().sort().join('~'),
      ids, conns, queue, done,
      total: queue.length,
      pct: queue.length ? done / queue.length : 0,
      standalone,
      title: standalone ? (queue[0] ? queue[0].name : 'Goal')
        : ends.length === 1 ? ends[0].name
        : `${ends.length} end goals`,
      nextUp: queue.find(g => stateOf(all, conns, g) === 'active') || null,
    };
  }
}

/**
 * Where the player should sit.
 *
 * Until the user moves it themselves, it lands on the first thing they
 * can actually do rather than on step 1 of a chain they finished months
 * ago. Once they have moved it, it stays where they put it.
 */
export function stepIndexFor(path, step, touched, achievements) {
  if (!path || !path.queue.length) return 0;
  if (touched) return Math.max(0, Math.min(step, path.queue.length - 1));
  const i = path.queue.findIndex(g => stateOf(achievements, path.conns, g) === 'active');
  return i === -1 ? 0 : i;
}

/**
 * Would linking `from → to` close a loop?
 *
 * A goal that is its own prerequisite can never be completed, and
 * layoutTree already has to drop such an edge to avoid hanging. Refusing
 * it at the point it would be created is better than drawing a board
 * that quietly omits one of its own links.
 */
export function wouldCycle(conns, from, to) {
  if (!from || !to) return false;
  if (from === to) return true;
  const seen = new Set([to]);
  const stack = [to];
  while (stack.length) {
    const n = stack.pop();
    for (const c of childrenOf(conns, n)) {
      if (c === from) return true;
      if (!seen.has(c)) { seen.add(c); stack.push(c); }
    }
  }
  return false;
}

/** Depth columns → x, siblings spread down y. Shared by both maps. */
function byDepth(ids, conns) {
  const d = depths(ids, conns);
  const cols = new Map();
  for (const id of ids) {
    const k = d.get(id);
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k).push(id);
  }
  return { d, cols, maxD: Math.max(0, ...[...d.values()]) };
}

/**
 * The path as a thumbnail — the whole shape, and where you are in it, in
 * the width of a business card. The point is not to be readable; it is to
 * be recognisable, so the step you are on has somewhere to sit.
 */
export function thumbLayout(path, { w = 120, h = 34, currentId = null } = {}) {
  if (!path || !path.ids.length) return { nodes: [], edges: [], viewBox: `0 0 ${w} ${h}` };
  const { cols, maxD } = byDepth(path.ids, path.conns);
  const pos = new Map();
  for (const [k, ids] of cols) {
    ids.forEach((id, i) => {
      const y = ids.length === 1 ? h / 2 : 6 + (h - 12) * (i / (ids.length - 1));
      pos.set(id, { x: 6 + (w - 12) * (maxD ? k / maxD : 0), y });
    });
  }
  const byId = id => path.queue.find(g => g.id === id);
  const edges = (path.conns || [])
    .filter(([f, t]) => pos.has(f) && pos.has(t))
    .map(([f, t]) => {
      const a = pos.get(f), b = pos.get(t);
      const on = !!(byId(f) && byId(f).completed);
      return { key: `${f}-${t}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, done: on };
    });
  const nodes = path.ids.filter(id => pos.has(id)).map(id => {
    const g = byId(id);
    return {
      id,
      x: pos.get(id).x,
      y: pos.get(id).y,
      here: currentId === id,
      state: g ? (g.completed ? 'completed' : g.locked ? 'locked' : 'active') : 'locked',
    };
  });
  return { nodes, edges, viewBox: `0 0 ${w} ${h}` };
}

/**
 * The same layout at a size you can read and tap.
 *
 * Two cards per row at most: three at 390px leaves ~105px each, which is
 * not a goal name. Rows ARE dependency depth, so everything on a row can
 * be worked in any order — which is worth saying on screen, because it is
 * the one thing a drawn graph never manages to communicate.
 */
export function mapLayout(path, { w = 336, gapY = 62, cardW = 150, cardH = 46, perRow = 2 } = {}) {
  if (!path || !path.ids.length) return { nodes: [], edges: [], w, h: 60, viewBox: `0 0 ${w} 60` };
  const { cols } = byDepth(path.ids, path.conns);
  const rows = [...cols.keys()].sort((a, b) => a - b);
  const pos = new Map();

  // `y` accumulates rather than being ri * gapY: a depth with three goals
  // wraps to two rows of cards, and a fixed stride per depth put the next
  // depth on top of the wrapped row. Four career goals — course,
  // portfolio, references → role — overlapped by 38px.
  const lead = gapY - cardH;      // the gap an edge is drawn through
  let y = 0;
  rows.forEach(k => {
    const ids = cols.get(k);
    const per = Math.min(perRow, ids.length);
    const cw = ids.length > 1 ? Math.min(cardW, (w - 12) / per) : Math.min(220, w);
    ids.forEach((id, i) => {
      const col = i % per, row = Math.floor(i / per);
      const inRow = Math.min(per, ids.length - row * per);
      const spread = inRow * cw + (inRow - 1) * 10;
      pos.set(id, { left: (w - spread) / 2 + col * (cw + 10), top: y + row * (cardH + 8), w: cw });
    });
    const wrapped = Math.ceil(ids.length / per);
    y += wrapped * (cardH + 8) - 8 + lead;
  });

  const h = Math.max(0, ...[...pos.values()].map(v => v.top)) + cardH + 6;
  const byId = id => path.queue.find(g => g.id === id);

  const edges = (path.conns || [])
    .filter(([f, t]) => pos.has(f) && pos.has(t))
    .map(([f, t]) => {
      const a = pos.get(f), b = pos.get(t);
      const x1 = a.left + a.w / 2, y1 = a.top + cardH, x2 = b.left + b.w / 2, y2 = b.top;
      const my = (y1 + y2) / 2;
      return {
        key: `${f}-${t}`,
        d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`,
        done: !!(byId(f) && byId(f).completed),
      };
    });

  const nodes = path.ids.filter(id => pos.has(id)).map(id => {
    const g = byId(id);
    return { id, ...pos.get(id), ach: g };
  });

  return { nodes, edges, w, h, viewBox: `0 0 ${w} ${h}` };
}
