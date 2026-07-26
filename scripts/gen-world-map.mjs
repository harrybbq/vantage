// Regenerates src/data/worldLow.json + src/data/countries.json.
//
// Vendored output, NOT part of the build — the app imports the JSON, and
// this script exists so the data is reproducible rather than mystery
// bytes. The source packages are devDeps only while regenerating:
//
//   npm i -D world-atlas@2 topojson-client@3 world-countries
//   node scripts/gen-world-map.mjs
//   npm rm -D world-atlas topojson-client world-countries
//
// (CDNs are unreachable from the build environment, hence the npm route.)
import { readFileSync, writeFileSync } from 'fs';
import { feature } from 'topojson-client';

const topo = JSON.parse(readFileSync('node_modules/world-atlas/countries-110m.json', 'utf8'));
const fc = feature(topo, topo.objects.countries);

// Douglas-Peucker, in degrees. 110m data is already coarse; this mostly
// strips collinear noise so the payload shrinks without visible change.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  return [
    ...simplify(pts.slice(0, idx + 1), tol).slice(0, -1),
    ...simplify(pts.slice(idx), tol),
  ];
}

const TOL = 0.12;     // degrees
const MIN_AREA = 0.12; // drop specks that render as sub-pixel dust
const round = v => Math.round(v * 100) / 100;

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += (r[j][0] * r[i][1]) - (r[i][0] * r[j][1]);
  }
  return Math.abs(a / 2);
}

// A closed ring's endpoints coincide, so plain Douglas-Peucker measures
// every point as zero distance from the (degenerate) baseline and
// collapses the whole thing. Split at the point farthest from the start
// and simplify the two open halves instead.
function simplifyRing(r, tol) {
  const pts = r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
    ? r.slice(0, -1) : r.slice();
  if (pts.length < 4) return r;
  let far = 0, farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify([...pts.slice(far), pts[0]], tol);
  const out = [...a.slice(0, -1), ...b];
  return out;
}

// A ring that crosses the antimeridian jumps from ~+180 to ~-180, which
// in a flat projection draws a stripe across the entire map (Russia and
// Fiji both do it). Cut the ring at those jumps and keep the fragments.
function splitDateline(r) {
  const out = [];
  let cur = [r[0]];
  for (let i = 1; i < r.length; i++) {
    if (Math.abs(r[i][0] - r[i - 1][0]) > 180) { out.push(cur); cur = [r[i]]; }
    else cur.push(r[i]);
  }
  out.push(cur);
  if (out.length === 1) return out;
  // Each fragment is now an OPEN path; filling it would close the gap with
  // a diagonal straight through the map. Walk each fragment out to the
  // dateline edge it sits against so it fills against the map border.
  return out.map(fragment => {
    const meanLon = fragment.reduce((s, p) => s + p[0], 0) / fragment.length;
    const edge = meanLon > 0 ? 180 : -180;
    return [
      [edge, fragment[0][1]],
      ...fragment,
      [edge, fragment[fragment.length - 1][1]],
    ];
  });
}

function doRings(rings) {
  return rings
    .map(r => simplifyRing(r, TOL).map(([x, y]) => [round(x), round(y)]))
    .flatMap(splitDateline)
    .filter(r => r.length >= 4 && ringArea(r) >= MIN_AREA);
}

// world-atlas ids are ISO 3166-1 NUMERIC; join to world-countries on
// ccn3 to get the alpha-2 codes everything else in the app will key on.
const meta = JSON.parse(readFileSync('node_modules/world-countries/countries.json', 'utf8'));
const byNum = new Map(meta.map(c => [String(c.ccn3), c]));

const out = [];
const missing = [];
for (const f of fc.features) {
  const m = byNum.get(String(f.id));
  if (!m) { missing.push(f.properties.name); continue; }
  if (m.cca2 === 'AQ') continue;   // Antarctica: nobody is planning a trip
  let polys = [];
  if (f.geometry.type === 'Polygon') polys = [doRings(f.geometry.coordinates)];
  else if (f.geometry.type === 'MultiPolygon') polys = f.geometry.coordinates.map(doRings);
  polys = polys.filter(p => p.length > 0);
  if (!polys.length) continue;
  out.push({ iso2: m.cca2, name: m.name.common, polys });
}
out.sort((a, b) => a.name.localeCompare(b.name));

// Reference list covers every country, including the ones with no drawn
// geometry (microstates), so they can still be picked in the lists.
const ref = meta.map(c => ({
  iso2: c.cca2,
  name: c.name.common,
  region: c.region || '',
  sub: c.subregion || '',
  lat: c.latlng?.[0] ?? 0,
  lon: c.latlng?.[1] ?? 0,
  cur: Object.keys(c.currencies || {})[0] || '',
})).sort((a, b) => a.name.localeCompare(b.name));

const mapJson = JSON.stringify({ polys: out });
writeFileSync('src/data/worldLow.json', mapJson);
writeFileSync('src/data/countries.json', JSON.stringify(ref));
console.log('drawn:', out.length, 'map bytes:', mapJson.length);
console.log('reference countries:', ref.length);
console.log('no ISO match (skipped):', missing.join(', ') || 'none');
