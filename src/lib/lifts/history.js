/**
 * Workout history: how many workouts each day had, for the year grids on
 * the Lifts home (brief: one cell per day, Monday-first columns, darker
 * for more).
 *
 * A day's count is the larger of
 *   · what Vantage logged: one per finished workout (`sessions`), plus one
 *     for sets quick-logged outside a workout on a day with no workout;
 *   · what was imported (`S.lifts.pastDays`, { 'YYYY-MM-DD': n }) — years
 *     of training from another app, added by hand in "Add past workouts".
 * The larger, never the sum: a day that is in both is the same gym visit
 * counted twice.
 *
 * `pastDays` is written only by mergePastDays, and only ever grows: a day
 * already there keeps the higher count, nothing is removed.
 *
 * Pure.
 */
import { liftsOf, withLifts } from './store.js';
import { isIso } from './lifts.js';

const MAX_PER_DAY = 9;
const MAX_IMPORT_DAYS = 5000;

/** iso → workouts that day (only days with at least one). */
export function workoutDays(S) {
  const L = liftsOf(S);
  const out = new Map();
  const sessionDays = new Set();
  for (const s of Array.isArray(L.sessions) ? L.sessions : []) {
    if (!s || !isIso(s.date) || !Array.isArray(s.exercises) || !s.exercises.length) continue;
    out.set(s.date, (out.get(s.date) || 0) + 1);
    sessionDays.add(s.date);
  }
  for (const e of L.log) {
    if (!e || e.sessionId || !isIso(e.date) || sessionDays.has(e.date)) continue;
    out.set(e.date, 1);
  }
  const past = L.pastDays && typeof L.pastDays === 'object' && !Array.isArray(L.pastDays) ? L.pastDays : {};
  for (const [d, n] of Object.entries(past)) {
    const k = Math.min(MAX_PER_DAY, Math.floor(Number(n)));
    if (!isIso(d) || !(k > 0)) continue;
    if (k > (out.get(d) || 0)) out.set(d, k);
  }
  return out;
}

/** 0 none · 1 · 2 · 3 = three or more — the four shades of the legend. */
export const shadeOf = n => (n >= 3 ? 3 : n > 0 ? n : 0);

const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * One year as week columns, Monday-first:
 * { year, total, days, cols: [[cell × 7]], months: [{ label, col }] }
 * A cell is null outside the year, else { iso, n, shade, future }.
 */
export function yearGrid(year, counts, today = '') {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const lead = (jan1.getUTCDay() + 6) % 7;               // Monday = 0
  const start = new Date(Date.UTC(year, 0, 1 - lead));
  const cols = [];
  const months = [];
  let total = 0, days = 0;
  for (let c = 0; ; c++) {
    const col = [];
    for (let r = 0; r < 7; r++) {
      const d = new Date(start.getTime() + (c * 7 + r) * 86400000);
      if (d.getUTCFullYear() !== year) { col.push(null); continue; }
      const iso = isoOf(d);
      const n = counts.get(iso) || 0;
      if (d.getUTCDate() === 1) months.push({ label: MONTHS[d.getUTCMonth()], col: c });
      total += n; if (n) days++;
      col.push({ iso, n, shade: shadeOf(n), future: !!today && iso > today });
    }
    cols.push(col);
    if (col.some(x => x && x.iso.endsWith('-12-31'))) break;
  }
  return { year, total, days, cols, months };
}

/** Years to show, newest first: this year back to the first year with a workout. */
export function historyYears(counts, today) {
  const now = Number(String(today).slice(0, 4)) || new Date().getFullYear();
  let first = now;
  for (const d of counts.keys()) first = Math.min(first, Number(d.slice(0, 4)));
  const out = [];
  for (let y = now; y >= first; y--) out.push(y);
  return out;
}

/**
 * Parse pasted history: any "YYYY-MM-DD", optionally followed by a count
 * ("2024-12-23 x3", "×3", ":3", "*3"). A date given twice keeps the larger
 * count. → { days: { iso: n }, workouts, bad: [tokens that look like a date
 * but aren't one, or are after `today`] }.
 */
export function parsePastDays(text, today = '') {
  const days = {};
  const bad = [];
  const re = /(\d{4}-\d{2}-\d{2})(?:\s*[x×*:]\s*(\d{1,2}))?/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const iso = m[1];
    const n = m[2] ? Math.min(MAX_PER_DAY, Math.max(1, parseInt(m[2], 10))) : 1;
    if (!isIso(iso) || (today && iso > today)) { bad.push(iso); continue; }
    days[iso] = Math.max(days[iso] || 0, n);
  }
  const workouts = Object.values(days).reduce((a, b) => a + b, 0);
  return { days, workouts, bad };
}

/** Add imported days. Additive: a day keeps its higher count; `prev` back when nothing changes. */
export function mergePastDays(prev, days) {
  const add = Object.entries(days || {}).filter(([d, n]) => isIso(d) && Number(n) > 0);
  if (!add.length) return prev;
  return withLifts(prev, l => {
    const cur = l.pastDays && typeof l.pastDays === 'object' && !Array.isArray(l.pastDays) ? l.pastDays : {};
    const next = { ...cur };
    let changed = false;
    for (const [d, n0] of add) {
      const n = Math.min(MAX_PER_DAY, Math.floor(Number(n0)));
      if (n > (next[d] || 0)) { next[d] = n; changed = true; }
    }
    if (!changed || Object.keys(next).length > MAX_IMPORT_DAYS) return l;
    return { ...l, pastDays: next };
  });
}

/**
 * Weight lifted across the whole log, with volume()'s rule (lib/lifts/
 * workout.js): weight × reps for every logged set, both dumbbells for a
 * per-dumbbell lift, and only the ADDED weight for a bodyweight lift
 * (bodyweight is not load you put on). Warm-ups count: it was lifted.
 * Imported past days carry no sets, so they add nothing here.
 * → { all, year, month, sets } in kg, `today` 'YYYY-MM-DD' for the windows.
 */
export function liftedTotals(S, today = '') {
  const L = liftsOf(S);
  const per = new Map(L.list.map(l => [l.id, l && l.load === 'per_hand' ? 2 : 1]));
  const y = String(today).slice(0, 4), ym = String(today).slice(0, 7);
  let all = 0, year = 0, month = 0, sets = 0;
  for (const e of L.log) {
    if (!e) continue;
    const w = Number(e.weight), r = Number(e.reps);
    if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) continue;
    const v = w * r * (per.get(e.liftId) || 1);
    all += v; sets++;
    if (y && String(e.date).startsWith(y)) year += v;
    if (ym && String(e.date).startsWith(ym)) month += v;
  }
  const r2 = n => Math.round(n * 100) / 100;
  return { all: r2(all), year: r2(year), month: r2(month), sets };
}

/** Always kilograms, whole numbers: "8,450 kg", "1,203,900 kg". */
export function liftedText(kg) {
  return `${Math.round(Number(kg) || 0).toLocaleString('en-GB')} kg`;
}

/** How many imported days the store holds. */
export const pastDayCount = S => {
  const p = liftsOf(S).pastDays;
  return p && typeof p === 'object' && !Array.isArray(p) ? Object.keys(p).length : 0;
};
