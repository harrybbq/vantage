/**
 * Splitting the achievement board into the paths it is actually made of.
 *
 * Two pure functions, both about the SHAPE of the graph rather than
 * about drawing it. lib/achievements/pathPlayer.js builds on them.
 *
 * This file used to hold a layered (Sugiyama) layout as well —
 * `layoutTree` and `edgePath` — which drew the whole graph as a column
 * for the mobile tree. The player replaced that view on 2026-09-09 and
 * with it the only caller, so the layout went too rather than being
 * left as code nobody runs. It is in git if a desktop auto-arrange ever
 * wants it: see AchievementTree.jsx at f952f4a.
 *
 * No React, no DOM: the interesting part is the arrangement, and an
 * arrangement is much easier to trust when it can be asserted on
 * directly.
 */

/**
 * Split a board into independent paths, plus the goals that aren't on
 * one at all.
 *
 * This exists because longest-path layering treats "has no
 * prerequisites" as "is a root of the tree", and those are not the same
 * claim. A goal nobody linked to anything — go to the gym, read more —
 * has no prerequisites, so it landed in layer 0 alongside the genuine
 * roots, padded that layer out until it wrapped, and pushed the real
 * structure down the screen. Measured on an 11-goal board with 5
 * unlinked: three actual layers rendered as five rows, and "Learn
 * guitar" appeared to sit one level above "Save a house deposit".
 *
 * Separating them first means each path is laid out against only its
 * own nodes, so a row means what it looks like it means.
 *
 * @returns {{ paths: Array<{achievements, connections}>, loose: Array }}
 */
export function splitComponents(achievements, connections) {
  const byId = new Map(achievements.map(a => [a.id, a]));
  const edges = (connections || []).filter(
    ([f, t]) => byId.has(f) && byId.has(t) && f !== t,
  );

  // Union-find over the UNDIRECTED graph: two goals belong to the same
  // path if a chain of prerequisites joins them in either direction.
  const parent = new Map(achievements.map(a => [a.id, a.id]));
  const find = x => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));   // path halving
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const [f, t] of edges) union(f, t);

  const linked = new Set(edges.flat());
  const groups = new Map();
  const order = new Map(achievements.map((a, i) => [a.id, i]));

  for (const a of achievements) {
    if (!linked.has(a.id)) continue;          // loose — handled below
    const root = find(a.id);
    if (!groups.has(root)) groups.set(root, { achievements: [], connections: [] });
    groups.get(root).achievements.push(a);
  }
  for (const e of edges) groups.get(find(e[0])).connections.push(e);

  // Biggest path first, then by board order, so the arrangement is
  // stable across renders and doesn't reshuffle as goals complete.
  const paths = [...groups.values()].sort(
    (x, y) =>
      y.achievements.length - x.achievements.length ||
      order.get(x.achievements[0].id) - order.get(y.achievements[0].id),
  );

  const loose = achievements.filter(a => !linked.has(a.id));
  return { paths, loose };
}

/**
 * The goals a path ends at — nothing depends on them. Used to label a
 * path by where it leads rather than inventing a name for it.
 */
export function endGoals(achievements, connections) {
  const hasChild = new Set((connections || []).map(([f]) => f));
  return achievements.filter(a => !hasChild.has(a.id));
}
