/**
 * Lifts — personal bests on the main lifts (Upgrade → Lifts, owner-only).
 *
 * Pure: no React, no network, no clock. `today` and any bodyweight
 * lookup are parameters, so lifts.test.mjs can pin every number.
 *
 * ── The maths ────────────────────────────────────────────────────────
 * e1RM is Epley: w × (1 + reps / 30), with a single exactly the weight
 * lifted. Past 12 reps the formula drifts (it was fitted on low-rep
 * sets), so those estimates are flagged low-confidence rather than
 * hidden — a 20-rep leg-press set is still a set.
 *
 * ── Load types ───────────────────────────────────────────────────────
 *   weight           the number on the stack / bar
 *   bodyweight_plus  bodyweight + added (dips). The log stores the ADDED
 *                    load; e1RM is on the total, so it needs a
 *                    bodyweight — the nearest earlier S.vitalsLog weight
 *                    within 14 days. With none, the set has no e1RM
 *                    (it still counts for heaviest and the rep maxes).
 *   per_hand         shown per dumbbell; e1RM is on the per-hand weight.
 *
 * ── What counts as a PB ──────────────────────────────────────────────
 * Raw weight, always. A night-shift set (the programme runs nights at
 * 80% load) is tagged so it never reads as regression, but it is never
 * scaled up: a PB is what was on the bar.
 *   bestE1rm   highest e1RM (needs a bodyweight for bodyweight_plus)
 *   heaviest   heaviest weight (the added load for bodyweight_plus)
 *   repMaxes   N-rep max = heaviest weight lifted for ≥ N reps
 * A PB must BEAT something: strictly greater, so a tie is not a PB, and
 * the first set of a lift is a baseline, not a PB.
 */
import { BANNED_LIFTS } from '../../data/trainingProgramme.js';

export const REP_MAX_NS = [1, 3, 5, 8, 10, 12];
export const LOW_CONFIDENCE_REPS = 12;
export const LOAD_TYPES = ['weight', 'bodyweight_plus', 'per_hand'];
export const LOAD_LABEL = { weight: 'Weight', bodyweight_plus: 'Bodyweight + added', per_hand: 'Per dumbbell' };
export const BW_WINDOW_DAYS = 14;
const EPS = 1e-9;
const DAY = 86400000;

// ── Small readers ──────────────────────────────────────────────────

/** A finite number from a number or numeric string, else null. */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** True for a real calendar date written YYYY-MM-DD. */
export function isIso(iso) {
  const m = typeof iso === 'string' && ISO_RE.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
/** Whole days since the epoch for an ISO date (UTC, so DST never shifts it). */
export function dayNo(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY);
}
/** ISO date `n` days after `iso` (negative goes back). */
export function addDays(iso, n) {
  const t = new Date((dayNo(iso) + n) * DAY);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
/** Whole days from a to b (b later → positive). */
export const daysBetween = (a, b) => dayNo(b) - dayNo(a);

/** Chronological order: date, then when it was entered, then id. */
export function chrono(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = num(a.createdAt) ?? 0, cb = num(b.createdAt) ?? 0;
  if (ca !== cb) return ca - cb;
  return String(a.id).localeCompare(String(b.id));
}

// ── e1RM ───────────────────────────────────────────────────────────

/** Epley estimated one-rep max. reps 1 → the weight itself. null for nonsense. */
export function e1rm(weight, reps) {
  const w = num(weight), r = num(reps);
  if (w == null || r == null || w < 0 || r < 1) return null;
  if (r === 1) return w;
  return w * (1 + r / 30);
}
/** Above 12 reps Epley is a guess; say so. */
export const isLowConfidence = reps => { const r = num(reps); return r != null && r > LOW_CONFIDENCE_REPS; };
export const e1rmInfo = (weight, reps) => ({ value: e1rm(weight, reps), low: isLowConfidence(reps) });

// ── Bodyweight ─────────────────────────────────────────────────────

/**
 * A lookup over S.vitalsLog: iso → { kg, date } for the nearest reading
 * on or before that day within `windowDays`, else null. Sorted once and
 * binary-searched, so a 600-set history costs nothing to walk.
 */
export function makeBwOf(vitalsLog, windowDays = BW_WINDOW_DAYS) {
  const rows = [];
  for (const k of Object.keys(vitalsLog || {})) {
    if (!isIso(k)) continue;
    const v = vitalsLog[k];
    const kg = num(v && v.weight);
    if (kg == null || kg <= 0) continue;
    rows.push({ n: dayNo(k), kg, date: k });
  }
  rows.sort((a, b) => a.n - b.n);
  return iso => {
    if (!isIso(iso) || !rows.length) return null;
    const t = dayNo(iso);
    let lo = 0, hi = rows.length - 1, at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].n <= t) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (at < 0 || t - rows[at].n > windowDays) return null;
    return { kg: rows[at].kg, date: rows[at].date };
  };
}
/** Bodyweight in kg on a date (see makeBwOf), or null. */
export const bodyweightOn = (vitalsLog, iso, windowDays) => {
  const r = makeBwOf(vitalsLog, windowDays)(iso);
  return r ? r.kg : null;
};
const bwKg = (bwOf, iso) => {
  if (!bwOf) return null;
  const r = bwOf(iso);
  return r == null ? null : typeof r === 'object' ? num(r.kg) : num(r);
};

// ── Loads ──────────────────────────────────────────────────────────

/**
 * The load the e1RM is worked on. bodyweight_plus = bodyweight + added
 * (null with no bodyweight); per_hand and weight = the logged weight.
 */
export function effectiveLoad(entry, lift, bodyweight) {
  const w = num(entry && entry.weight);
  if (w == null) return null;
  if (lift && lift.load === 'bodyweight_plus') {
    const bw = num(bodyweight);
    return bw == null || bw <= 0 ? null : bw + w;
  }
  return w;
}
/** e1RM for one logged set, or null. */
export function entryE1rm(entry, lift, bodyweight) {
  const l = effectiveLoad(entry, lift, bodyweight);
  return l == null ? null : e1rm(l, entry.reps);
}

const valid = e => e && num(e.weight) != null && num(e.reps) != null && num(e.reps) >= 1 && isIso(e.date);

/** One lift's valid sets, oldest first. */
export function entriesFor(log, lift) {
  if (!lift) return [];
  return (Array.isArray(log) ? log : []).filter(e => valid(e) && e.liftId === lift.id).sort(chrono);
}

// ── Personal bests ─────────────────────────────────────────────────

function emptyBests() {
  const repMaxes = {};
  for (const n of REP_MAX_NS) repMaxes[n] = null;
  return { bestE1rm: null, heaviest: null, repMaxes };
}
/** Fold one set into running bests (mutates `pb`). Ties keep the earlier set. */
function fold(pb, e, lift, bwOf) {
  const w = num(e.weight), r = num(e.reps);
  const bw = bwKg(bwOf, e.date);
  const v = entryE1rm(e, lift, bw);
  if (v != null && (!pb.bestE1rm || v > pb.bestE1rm.value + EPS)) {
    pb.bestE1rm = { value: v, entry: e, low: isLowConfidence(r), bodyweight: bw };
  }
  // Heaviest is by weight; at equal weight the set with more reps is the
  // one worth showing (it is not a new PB — see isNewPB).
  if (!pb.heaviest || w > pb.heaviest.value + EPS || (Math.abs(w - pb.heaviest.value) <= EPS && r > num(pb.heaviest.entry.reps))) {
    pb.heaviest = { value: w, entry: e };
  }
  for (const n of REP_MAX_NS) {
    if (r >= n && (!pb.repMaxes[n] || w > num(pb.repMaxes[n].weight) + EPS)) pb.repMaxes[n] = e;
  }
}

/**
 * → { bestE1rm: { value, entry, low, bodyweight } | null,
 *     heaviest: { value, entry } | null,
 *     repMaxes: { 1, 3, 5, 8, 10, 12 → entry | null } }
 * opts.bwOf: iso → kg | { kg } | null (makeBwOf), for bodyweight_plus.
 */
export function personalBests(log, lift, opts = {}) {
  const pb = emptyBests();
  for (const e of entriesFor(log, lift)) fold(pb, e, lift, opts.bwOf);
  return pb;
}

/**
 * Which PBs `entry` sets against every OTHER set of the lift in
 * `prevLog` (the entry's own id is ignored, so an edit is judged against
 * the rest, not itself). Strictly greater only: a tie is not a PB, and a
 * lift's first set is a baseline.
 * → { first, e1rm, heaviest, repMaxes: [N…], any, value }
 */
export function isNewPB(prevLog, entry, lift, opts = {}) {
  const others = (Array.isArray(prevLog) ? prevLog : []).filter(e => e && e.id !== entry.id);
  const pb = personalBests(others, lift, opts);
  const first = !pb.heaviest;
  const value = entryE1rm(entry, lift, bwKg(opts.bwOf, entry.date));
  const out = { first, e1rm: false, heaviest: false, repMaxes: [], any: false, value };
  const w = num(entry.weight), r = num(entry.reps);
  if (first || w == null || r == null || r < 1) return out;
  out.e1rm = value != null && !!pb.bestE1rm && value > pb.bestE1rm.value + EPS;
  out.heaviest = w > pb.heaviest.value + EPS;
  out.repMaxes = REP_MAX_NS.filter(n => r >= n && pb.repMaxes[n] && w > num(pb.repMaxes[n].weight) + EPS);
  out.any = out.e1rm || out.heaviest || out.repMaxes.length > 0;
  return out;
}

/**
 * Sets that were a PB WHEN THEY WERE LIFTED, oldest first:
 * [{ entry, e1rm, heaviest, repMaxes }]. This is what the chart marks and
 * what the home card counts. (isNewPB judges against all other sets,
 * which differs only for a back-dated entry.)
 */
export function pbTimeline(log, lift, opts = {}) {
  const pb = emptyBests();
  const out = [];
  for (const e of entriesFor(log, lift)) {
    if (pb.heaviest) {
      const w = num(e.weight), r = num(e.reps);
      const v = entryE1rm(e, lift, bwKg(opts.bwOf, e.date));
      const ev = {
        entry: e,
        e1rm: v != null && !!pb.bestE1rm && v > pb.bestE1rm.value + EPS,
        heaviest: w > pb.heaviest.value + EPS,
        repMaxes: REP_MAX_NS.filter(n => r >= n && pb.repMaxes[n] && w > num(pb.repMaxes[n].weight) + EPS),
      };
      if (ev.e1rm || ev.heaviest || ev.repMaxes.length) out.push(ev);
    }
    fold(pb, e, lift, opts.bwOf);
  }
  return out;
}

// ── Trend ──────────────────────────────────────────────────────────

/**
 * e1RM over time, best set per day → { series, current, change4w, change12w }.
 *   series     [{ date, value, entry, night }] oldest first; `weeks` keeps
 *              only the last N weeks (omit for all of it)
 *   current    best e1RM in the 28 days to `today` ("form"), or null
 *   changeNw   form today − form N weeks ago; null when either window is
 *              empty — a gap in training says "not enough data", it never
 *              invents a drop.
 */
export function trend(log, lift, { weeks = null, today, bwOf } = {}) {
  const byDay = new Map();
  for (const e of entriesFor(log, lift)) {
    const v = entryE1rm(e, lift, bwKg(bwOf, e.date));
    if (v == null) continue;
    const cur = byDay.get(e.date);
    if (!cur || v > cur.value + EPS) byDay.set(e.date, { date: e.date, value: v, entry: e, night: e.shift === 'night' });
  }
  const all = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const end = isIso(today) ? today : (all.length ? all[all.length - 1].date : null);
  const form = iso => {
    if (!iso) return null;
    const t = dayNo(iso);
    let best = null;
    for (const p of all) {
      const n = dayNo(p.date);
      if (n > t - 28 && n <= t && (best == null || p.value > best)) best = p.value;
    }
    return best;
  };
  const current = form(end);
  const change = days => {
    if (current == null || !end) return null;
    const then = form(addDays(end, -days));
    return then == null ? null : current - then;
  };
  const series = weeks && end ? all.filter(p => dayNo(p.date) > dayNo(end) - weeks * 7) : all;
  return { series, current, change4w: change(28), change12w: change(84) };
}

// ── Bodyweight ratio ───────────────────────────────────────────────

const BW_RATIO_RE = /leg\s*press|hip\s*thrust|squat|deadlift|bench|pull-?\s*up|chin-?\s*up|\brdl\b/i;
/** Lifts where "× bodyweight" means something (not a cable stack, not one dumbbell). */
export function showsBodyweightRatio(lift) {
  if (!lift || lift.load === 'per_hand') return false;
  return lift.load === 'bodyweight_plus' || BW_RATIO_RE.test(String(lift.name || ''));
}
/** value ÷ bodyweight, 2 dp (1.6 → "1.6× BW"), or null where it makes no sense. */
export function relativeToBodyweight(value, bodyweight, lift) {
  const v = num(value), bw = num(bodyweight);
  if (!showsBodyweightRatio(lift) || v == null || bw == null || bw <= 0) return null;
  return Math.round((v / bw) * 100) / 100;
}

// ── The programme ──────────────────────────────────────────────────

/** The BANNED_LIFTS rule a lift's name trips, or null. The log keeps it — it's a record, not a plan. */
export function bannedRule(lift) {
  const name = String((lift && lift.name) || '');
  return BANNED_LIFTS.find(b => b.re.test(name)) || null;
}
export const BANNED_NOTE = 'Not in your programme — logged as a record';

// ── Words ──────────────────────────────────────────────────────────

/** 180 → "180", 182.5 → "182.5", 216.04 → "216". */
export function fmtKg(v, dp = 1) {
  const n = num(v);
  if (n == null) return '—';
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
}
/** e1RM to the nearest kg. */
export const fmtE1rm = v => (num(v) == null ? '—' : String(Math.round(num(v))));

/** The weight of a set as the lift reads it: "180 kg", "+20 kg", "BW", "32 kg/hand". */
export function weightText(entry, lift) {
  const w = num(entry && entry.weight);
  if (w == null) return '—';
  if (lift && lift.load === 'bodyweight_plus') return w === 0 ? 'BW' : `BW +${fmtKg(w)} kg`;
  if (lift && lift.load === 'per_hand') return `${fmtKg(w)} kg/hand`;
  return `${fmtKg(w)} kg`;
}
/** "180 kg × 6" */
export const setText = (entry, lift) => `${weightText(entry, lift)} × ${num(entry && entry.reps) ?? '—'}`;

/** "Machine leg press" → "Leg press", "Single-arm cable row" → "Cable row" for tight spaces. */
export function shortLiftName(name) {
  const s = String(name || '').trim().replace(/^(machine|single[-\s]arm)\s+/i, '');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** "New PB: Leg press 180 kg × 6 (e1RM 216 kg)" */
export function pbMessage(entry, lift, value) {
  const e = num(value) != null ? ` (e1RM ${fmtE1rm(value)} kg)` : '';
  return `New PB: ${shortLiftName(lift && lift.name)} ${setText(entry, lift)}${e}`;
}
/** Which PBs, in words: ["e1RM", "heaviest", "5RM"]. */
export function pbKinds(res) {
  if (!res) return [];
  return [res.e1rm && 'e1RM', res.heaviest && 'heaviest', ...(res.repMaxes || []).map(n => `${n}RM`)].filter(Boolean);
}
