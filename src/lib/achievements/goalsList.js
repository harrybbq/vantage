/**
 * The goals as a list you can act on — the phone's Goals page in the
 * console design (owner, 2026-11-23, mockup "Goals on a Phone", option
 * A "Next up"; design/console/sweep/GoalsPhone.jsx).
 *
 * The path player showed one goal at a time: with 22 goals, 11 path
 * chips ran 1,755 px off the side, seven of them single goals dressed
 * as paths, and nothing answered "what can I do now?". This is the same
 * graph and the same rules (pathPlayer.js owns both), arranged by what
 * a goal is waiting for:
 *
 *   next      every goal that can be finished now, across all paths,
 *             each with the path and step it belongs to
 *   paths     the linked paths, named by where they end
 *   locked    goals still waiting on another
 *   finished  completed goals, newest first
 *
 * Every goal is in exactly one of next / locked / finished, so nothing
 * can drop out of reach. Pure: no React, no DOM. goalsList.test.mjs.
 */
import { pathsOf, stateOf, depths, parentsOf } from './pathPlayer.js';
import { endGoals } from './layout.js';

/**
 * A path's name: where it ends. With one end goal that is its name.
 * With several (a path that forks), the one furthest along — the
 * deepest, then the one that pays most, then by name — rather than
 * "2 end goals", which names nothing.
 */
export function pathName(path) {
  if (!path || !path.queue || !path.queue.length) return 'Path';
  const ends = endGoals(path.queue, path.conns);
  if (!ends.length) return path.queue[path.queue.length - 1].name || 'Path';
  if (ends.length === 1) return ends[0].name || 'Path';
  const d = depths(path.ids, path.conns);
  const best = ends.slice().sort((a, b) =>
    (d.get(b.id) - d.get(a.id)) || ((b.coins || 0) - (a.coins || 0)) || String(a.name || '').localeCompare(String(b.name || '')))[0];
  return best.name || 'Path';
}

/**
 * → { total, done, pct, paths, next, locked, finished, at(id), state(goal) }
 *   paths     [{ key, name, total, done, pct, queue, conns, ids, states, next }]
 *   next      [{ goal, path | null, step, of }]   path goals first, in path order
 *   locked    [{ goal, path | null, step, of, needs: [goal] }]
 *   finished  [goal]
 *   at(id)    { path, step, of } | null — where a goal sits on its path
 */
export function goalsView(achievements, connections) {
  const all = Array.isArray(achievements) ? achievements.filter(Boolean) : [];
  const conns = Array.isArray(connections) ? connections : [];
  const paths = pathsOf(all, conns).filter(p => !p.standalone).map(p => ({
    key: p.key, name: pathName(p), total: p.total, done: p.done, pct: p.pct,
    queue: p.queue, conns: p.conns, ids: p.ids,
    states: p.queue.map(g => stateOf(all, p.conns, g)),
    next: p.nextUp,
  }));
  const where = new Map();
  for (const p of paths) p.queue.forEach((g, i) => where.set(g.id, { path: p, step: i + 1, of: p.queue.length }));
  const at = id => where.get(id) || null;
  const state = g => { const w = g && where.get(g.id); return stateOf(all, w ? w.path.conns : [], g); };
  const byId = new Map(all.map(g => [g.id, g]));
  const entry = g => { const w = where.get(g.id); return { goal: g, path: w ? w.path : null, step: w ? w.step : 1, of: w ? w.of : 1 }; };

  // Path goals in path order (biggest path first, then along the path), then the ones on their own in board order.
  const ordered = [...paths.flatMap(p => p.queue), ...all.filter(g => !where.has(g.id))];
  const next = [], locked = [];
  for (const g of ordered) {
    const s = state(g);
    if (s === 'active') next.push(entry(g));
    else if (s === 'locked') {
      const w = where.get(g.id);
      const needs = (w ? parentsOf(w.path.conns, g.id) : []).map(id => byId.get(id)).filter(x => x && !x.completed);
      locked.push({ ...entry(g), needs });
    }
  }
  const finished = all.filter(g => g.completed).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const total = all.length;
  return { total, done: finished.length, pct: total ? finished.length / total : 0, paths, next, locked, finished, at, state };
}
