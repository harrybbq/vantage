/**
 * Visited-map arithmetic that does not need the country table.
 *
 * `destinations.js` imports the countries JSON, which plain `node`
 * cannot load, so anything worth a test lives here and takes the lookup
 * (`countryFor`, `nameOf`) as an argument instead.
 *
 * Pure — no React, no DOM, no clock of its own.
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const middayOf = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };
const dayAt = iso => {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

/**
 * Is this trip still ahead (or under way)? Not completed, and not over.
 * A trip with no dates yet counts: it is being planned, which is the
 * point of showing it. One whose dates have passed but was never marked
 * complete does not — it is neither visited nor upcoming, and painting
 * it "coming up" would be a lie.
 */
export function isUpcoming(trip, now = new Date()) {
  if (!trip || trip.status === 'completed') return false;
  const end = dayAt(trip.to) || dayAt(trip.from);
  if (!end) return true;
  return end >= middayOf(now);
}

/**
 * Countries you are going to that you have not been to yet.
 *   → { JP: { iso2, trips: [trip], next: trip } }, `next` the soonest.
 * `visited` is the map from visitedCountries(); `countryFor(trip)` the
 * trip → ISO2 lookup.
 */
export function upcomingNew(trips, visited, countryFor, now = new Date()) {
  const out = {};
  for (const trip of trips || []) {
    if (!isUpcoming(trip, now)) continue;
    const iso2 = countryFor(trip);
    if (!iso2 || (visited && visited[iso2])) continue;
    const e = out[iso2] || (out[iso2] = { iso2, trips: [], next: null });
    e.trips.push(trip);
    const t = dayAt(trip.from);
    const n = e.next && dayAt(e.next.from);
    if (!e.next || (t && (!n || t < n))) e.next = trip;
  }
  return out;
}

/**
 * The numbers the Holidays prime card shows for its Visited block.
 * `visited` as above, `total` the size of the country table.
 *   → { count, total, pct, recent: [{ iso2, name, year }], upcoming: n }
 * Recent is by latest trip year, newest first; hand-ticked places with
 * no trip come after, alphabetically, because they have no date to sort
 * by and the list should still be stable.
 */
export function visitedSummary(visited, total, upcoming = {}, limit = 4) {
  const rows = Object.values(visited || {});
  const count = rows.length;
  const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
  const recent = rows
    .map(v => ({ iso2: v.iso2, name: v.name, year: v.years && v.years.length ? v.years[v.years.length - 1] : null }))
    .sort((a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
  return { count, total, pct, recent, upcoming: Object.keys(upcoming || {}).length };
}
