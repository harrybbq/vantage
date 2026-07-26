/**
 * Routing over the static rail graph (src/data/rail.js).
 *
 * The planner lets you pick a sequence of stops; between each
 * consecutive pair we solve the fastest path so you only have to think
 * about WHERE you want to go, not which junction to change at.
 */
import { STATIONS, STATION_BY_ID, ADJACENCY } from '../../data/rail';

/** Fastest path between two stations. Returns null when unreachable. */
export function shortestPath(fromId, toId) {
  if (fromId === toId) return { stops: [fromId], legs: [], minutes: 0, reservations: 0 };
  if (!ADJACENCY[fromId] || !ADJACENCY[toId]) return null;

  const dist = { [fromId]: 0 };
  const prev = {};
  const seen = new Set();
  // Small graph (~110 nodes), so a linear scan for the next node is
  // cheaper in practice than maintaining a heap.
  const queue = new Set([fromId]);

  while (queue.size) {
    let cur = null, best = Infinity;
    for (const id of queue) {
      if (dist[id] < best) { best = dist[id]; cur = id; }
    }
    if (cur == null) break;
    queue.delete(cur);
    seen.add(cur);
    if (cur === toId) break;

    for (const edge of ADJACENCY[cur]) {
      if (seen.has(edge.to)) continue;
      const alt = dist[cur] + edge.min;
      if (alt < (dist[edge.to] ?? Infinity)) {
        dist[edge.to] = alt;
        prev[edge.to] = { from: cur, ...edge };
        queue.add(edge.to);
      }
    }
  }

  if (dist[toId] == null) return null;

  const stops = [toId];
  const legs = [];
  let node = toId;
  while (node !== fromId) {
    const p = prev[node];
    legs.unshift({ from: p.from, to: node, min: p.min, res: p.res });
    stops.unshift(p.from);
    node = p.from;
  }
  return {
    stops,
    legs,
    minutes: dist[toId],
    reservations: legs.filter(l => l.res).length,
  };
}

/**
 * Expand a user's chosen stop sequence into a full journey, routing
 * through intermediate stations where there's no direct service.
 * Unreachable hops are reported rather than silently dropped — an
 * Interrail plan with a missing leg is worse than one that says so.
 */
export function buildRoute(stopIds) {
  const picks = (stopIds || []).filter(id => STATION_BY_ID[id]);
  if (picks.length < 2) {
    return { picks, legs: [], minutes: 0, reservations: 0, gaps: [], ok: picks.length > 0 };
  }
  const legs = [];
  const gaps = [];
  let minutes = 0, reservations = 0;

  for (let i = 0; i < picks.length - 1; i++) {
    const seg = shortestPath(picks[i], picks[i + 1]);
    if (!seg) { gaps.push([picks[i], picks[i + 1]]); continue; }
    for (const l of seg.legs) legs.push({ ...l, segment: i });
    minutes += seg.minutes;
    reservations += seg.reservations;
  }
  return { picks, legs, minutes, reservations, gaps, ok: gaps.length === 0 };
}

/** "14h 20m" / "45m" */
export function fmtMinutes(min) {
  if (!min) return '0m';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h${m ? ' ' + m + 'm' : ''}` : `${m}m`;
}

/** Distinct countries a route passes through, in visiting order. */
export function routeCountries(route) {
  const seen = [];
  for (const id of route.picks || []) {
    const c = STATION_BY_ID[id]?.c;
    if (c && !seen.includes(c)) seen.push(c);
  }
  for (const leg of route.legs || []) {
    for (const id of [leg.from, leg.to]) {
      const c = STATION_BY_ID[id]?.c;
      if (c && !seen.includes(c)) seen.push(c);
    }
  }
  return seen;
}

/** Stations sorted for a picker, optionally filtered by a search term. */
export function searchStations(term) {
  const q = (term || '').trim().toLowerCase();
  const list = q
    ? STATIONS.filter(s => s.name.toLowerCase().includes(q) || s.c.toLowerCase() === q)
    : STATIONS;
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}
