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
 * ── What counts as a PB (owner decision, Oct 2026: REAL SETS ONLY) ───
 * A PB is a set that was actually lifted, never a number worked out
 * from one. A night-shift set (the programme runs nights at 80% load)
 * is tagged so it never reads as regression, but it is never scaled
 * up: a PB is what was on the bar.
 *   heaviest   heaviest weight lifted, any reps
 *   repMaxes   N-rep max = heaviest weight lifted for ≥ N reps
 *              (N ∈ 1/3/5/8/10/12; the 1RM is the heaviest, so it is
 *              only named separately when heaviest isn't)
 * Bodyweight-plus (dips) compares the TOTAL load when every set of the
 * lift has a bodyweight reading within 14 days, else the added weight —
 * one basis per lift, so two sets are never compared on different
 * scales (`basis` on the result says which). Per-hand compares the
 * weight of one dumbbell.
 * A PB must BEAT something: strictly greater, so a tie is not a PB, and
 * the first set of a lift is a baseline, not a PB.
 *
 * Warm-up sets (Oct 2026): a set can carry `type` — 'W' warm-up,
 * 'D' drop set, 'F' to failure (absent = a normal working set). A
 * WARM-UP never counts for a PB, a rep max, the e1RM or the trend /
 * chart — it is saved and still counts for volume, it just isn't an
 * attempt at anything. D and F sets are real working sets and count.
 *
 * Estimated 1RM (Epley) is kept as a TREND — the chart line, "est. 1RM
 * ~241 kg" — and is never a PB anywhere: not here, not in a badge, not
 * in a celebration, not on the home card.
 *
 * ── Gyms (Oct 2026) ──────────────────────────────────────────────────
 * The owner trains at two gyms (DXC and Greenock) whose MACHINES are not
 * the same machines: 192.5 kg on one leg press is not 192.5 kg on the
 * other. Every set carries `gym` (an id from S.lifts.gyms), and a lift
 * that is `perGym` compares ONLY within one gym — Previous, suggested
 * weights, heaviest, rep maxes, "would be a PB", PB badges, the summary
 * and the home card. A barbell is a barbell anywhere, so free-weight
 * lifts compare across gyms. A set with no `gym` reads as unassigned:
 * a bucket of its own, never rewritten. perGym defaults from the name
 * (perGymByName) until the owner sets it on the lift.
 */
import { BANNED_LIFTS } from '../../data/trainingProgramme.js';

export const REP_MAX_NS = [1, 3, 5, 8, 10, 12];
export const LOW_CONFIDENCE_REPS = 12;
export const LOAD_TYPES = ['weight', 'bodyweight_plus', 'per_hand'];
export const LOAD_LABEL = { weight: 'Weight', bodyweight_plus: 'Bodyweight + added', per_hand: 'Per dumbbell' };
export const BW_WINDOW_DAYS = 14;
const EPS = 1e-9;
const DAY = 86400000;

// ── Gyms ───────────────────────────────────────────────────────────

/** The gym a set or workout was at, or null (unassigned). */
export const gymOf = e => (e && typeof e.gym === 'string' && e.gym ? e.gym : null);

/*
 * Which lifts are a MACHINE (their numbers depend on the gym) — the rule:
 *   1. "machine", "smith", "assisted", "cable", "selectorised" → machine,
 *      whatever else the name says ("Hip thrust machine", "Assisted dip").
 *   2. otherwise a free-weight word → free: dumbbell, barbell, EZ bar,
 *      kettlebell, trap bar, bodyweight, dip, pull-up, chin-up, push-up,
 *      lunge, hip thrust, plank, hyperextension.
 *   3. otherwise a machine movement → machine: pulldown, leg press, leg
 *      extension, leg curl, pec deck, hack squat, chest press, seated row,
 *      row machine, calf raise, Pallof press, Hammer Strength.
 *   4. anything else → free (compared across gyms).
 */
const MACHINE_STRONG = /\bmachine\b|\bsmith\b|\bassisted\b|\bcable\b|\bselectori[sz]ed\b/i;
const FREE_WORDS = /dumbbell|\bdbs?\b|barbell|\bez[-\s]?bar\b|kettlebell|\btrap[-\s]?bar\b|bodyweight|\bdips?\b|pull-?\s*ups?\b|chin-?\s*ups?\b|push-?\s*ups?\b|\blunges?\b|hip\s*thrust|\bplank|hyperextension/i;
const MACHINE_WORDS = /pull-?\s*down|leg\s*press|leg\s*extension|leg\s*curl|pec\s*deck|hack\s*squat|chest\s*press|seated\s*row|row\s*machine|calf\s*raise|pallof|hammer\s*strength/i;
/** The default for `perGym`, from the lift's name (rule above). */
export function perGymByName(name) {
  const n = String(name || '');
  if (MACHINE_STRONG.test(n)) return true;
  if (FREE_WORDS.test(n)) return false;
  return MACHINE_WORDS.test(n);
}
/** Does this lift compare within one gym? Its own `perGym` wins over the name rule. */
export const perGymOf = lift => !!lift && (typeof lift.perGym === 'boolean' ? lift.perGym : perGymByName(lift.name));

/**
 * The log as one gym sees `lift`: for a perGym lift, only its sets at
 * `gym` (null = the unassigned ones); other lifts' sets, and every set of
 * a free-weight lift, pass through untouched.
 */
export function inGym(log, lift, gym) {
  const arr = Array.isArray(log) ? log : [];
  if (!lift || !perGymOf(lift)) return arr;
  const g = gym || null;
  return arr.filter(e => !e || e.liftId !== lift.id || gymOf(e) === g);
}

/** The gyms a lift's sets were logged at: ids in `order` first, others, then unassigned (null) last. */
export function gymsUsed(log, lift, order = []) {
  const seen = new Set();
  for (const e of Array.isArray(log) ? log : []) if (e && lift && e.liftId === lift.id) seen.add(gymOf(e));
  const known = order.filter(id => seen.has(id));
  const rest = [...seen].filter(id => id && !order.includes(id)).sort();
  return [...known, ...rest, ...(seen.has(null) ? [null] : [])];
}

// ── The ± weight step ──────────────────────────────────────────────

/**
 * The ± step by load type when a lift has none of its own: 2.5 kg on a bar,
 * a stack or a dip belt; 1 kg per dumbbell (what the logger has always used).
 */
export const DEFAULT_STEP = Object.freeze({ weight: 2.5, bodyweight_plus: 2.5, per_hand: 1 });
/**
 * The ± step for `lift` at `gymId`: the gym's own step (a machine's stack
 * differs gym to gym), else the lift's, else DEFAULT_STEP by load type.
 */
export function stepFor(lift, gymId = null) {
  const pos = v => { const n = num(v); return n != null && n > 0 ? n : null; };
  const byGym = lift && gymId && lift.stepByGym && typeof lift.stepByGym === 'object' ? pos(lift.stepByGym[gymId]) : null;
  return byGym ?? pos(lift && lift.step) ?? DEFAULT_STEP[(lift && lift.load) || 'weight'] ?? 2.5;
}

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

// ── Set types ──────────────────────────────────────────────────────

/** 'W' warm-up · 'D' drop set · 'F' to failure. Absent = a normal working set. */
export const SET_TYPES = ['W', 'D', 'F'];
export const SET_TYPE_LABEL = { W: 'Warm-up', D: 'Drop set', F: 'Failure' };
/** A set's type when it is one of SET_TYPES, else null (a normal set). */
export const setTypeOf = e => (e && SET_TYPES.includes(e.type) ? e.type : null);
/** Warm-ups are saved and count for volume, never for PBs, rep maxes, e1RM or the trend. */
export const isWarmup = e => setTypeOf(e) === 'W';

const valid = e => e && num(e.weight) != null && num(e.reps) != null && num(e.reps) >= 1 && isIso(e.date);

/** One lift's valid sets, oldest first — warm-ups included (the log, Previous, counts). */
export function entriesFor(log, lift) {
  if (!lift) return [];
  return (Array.isArray(log) ? log : []).filter(e => valid(e) && e.liftId === lift.id).sort(chrono);
}
/** One lift's WORKING sets (warm-ups left out), oldest first — what PBs, rep maxes, e1RM and the trend read. */
export const workingEntries = (log, lift) => entriesFor(log, lift).filter(e => !isWarmup(e));

// ── Personal bests (real sets only) ─────────────────────────────────

/**
 * Which load a lift's PBs are compared on: 'total' (bodyweight + added)
 * for a dip when every one of `sets` has a bodyweight, else 'weight'
 * (the logged number — added load for a dip, one dumbbell per hand).
 */
export function pbBasis(sets, lift, bwOf) {
  if (!lift || lift.load !== 'bodyweight_plus' || !bwOf) return 'weight';
  const list = (sets || []).filter(Boolean);
  if (!list.length) return 'weight';
  return list.every(e => { const b = bwKg(bwOf, e.date); return b != null && b > 0; }) ? 'total' : 'weight';
}
/** The load a set's PBs are judged on, under `basis`. */
export function pbLoad(entry, lift, basis, bwOf) {
  const w = num(entry && entry.weight);
  if (w == null) return null;
  if (basis !== 'total') return w;
  const bw = bwKg(bwOf, entry.date);
  return bw == null ? w : bw + w;
}

function emptyBests(basis = 'weight') {
  const repMaxes = {};
  for (const n of REP_MAX_NS) repMaxes[n] = null;
  return { heaviest: null, repMaxes, repLoads: {}, bestE1rm: null, basis };
}
/** Fold one set into running bests (mutates `pb`). Ties keep the earlier set. */
function fold(pb, e, lift, bwOf) {
  const r = num(e.reps);
  const load = pbLoad(e, lift, pb.basis, bwOf);
  // The e1RM estimate rides along for the trend tiles — it is NOT a PB.
  const bw = bwKg(bwOf, e.date);
  const v = entryE1rm(e, lift, bw);
  if (v != null && (!pb.bestE1rm || v > pb.bestE1rm.value + EPS)) {
    pb.bestE1rm = { value: v, entry: e, low: isLowConfidence(r), bodyweight: bw };
  }
  // Heaviest is by load; at equal load the set with more reps is the
  // one worth showing (it is not a new PB — see isNewPB).
  if (!pb.heaviest || load > pb.heaviest.value + EPS || (Math.abs(load - pb.heaviest.value) <= EPS && r > num(pb.heaviest.entry.reps))) {
    pb.heaviest = { value: load, entry: e };
  }
  for (const n of REP_MAX_NS) {
    if (r >= n && (!pb.repMaxes[n] || load > pb.repLoads[n] + EPS)) { pb.repMaxes[n] = e; pb.repLoads[n] = load; }
  }
}

/**
 * → { heaviest: { value, entry } | null,
 *     repMaxes: { 1, 3, 5, 8, 10, 12 → entry | null },
 *     repLoads: { N → load compared }, basis: 'weight'|'total',
 *     bestE1rm: { value, entry, low, bodyweight } | null }   ← an ESTIMATE, not a PB
 * opts.bwOf: iso → kg | { kg } | null (makeBwOf), for bodyweight_plus.
 * opts.basis forces the comparison basis (isNewPB judges a candidate on
 * the basis of the whole lift including it).
 * opts.gym (when present, even null): a perGym lift's bests at that gym only.
 */
export function personalBests(log, lift, opts = {}) {
  const sets = workingEntries('gym' in opts ? inGym(log, lift, opts.gym) : log, lift);
  const pb = emptyBests(opts.basis || pbBasis(sets, lift, opts.bwOf));
  for (const e of sets) fold(pb, e, lift, opts.bwOf);
  return pb;
}

/** True when `res` (isNewPB / a pbTimeline event) beat a real-set record. */
export const isRealPB = res => !!res && (!!res.heaviest || (res.repMaxes || []).length > 0);

/**
 * Which real-set PBs `entry` sets against every OTHER set of the lift in
 * `prevLog` (the entry's own id is ignored, so an edit is judged against
 * the rest, not itself). Strictly greater only: a tie is not a PB, and a
 * lift's first set is a baseline.
 * → { first, heaviest, repMaxes: [N…], any, value, basis }
 * `value` is the set's estimated 1RM, for display — it plays no part in `any`.
 * A perGym lift: only sets at the entry's gym count (a DXC PB is not a
 * Greenock PB, and vice versa).
 */
export function isNewPB(prevLog, entry, lift, opts = {}) {
  // A perGym lift is judged against its own gym only.
  const others = inGym(prevLog, lift, gymOf(entry)).filter(e => e && e.id !== entry.id);
  const mine = workingEntries(others, lift);
  const basis = pbBasis([...mine, entry], lift, opts.bwOf);
  // A warm-up is never a PB, never a baseline and carries no estimate.
  if (isWarmup(entry)) return { first: false, heaviest: false, repMaxes: [], any: false, value: null, basis, warmup: true };
  const pb = personalBests(mine, lift, { ...opts, basis });
  const first = !pb.heaviest;
  const value = entryE1rm(entry, lift, bwKg(opts.bwOf, entry.date));
  const out = { first, heaviest: false, repMaxes: [], any: false, value, basis };
  const r = num(entry.reps);
  const load = pbLoad(entry, lift, basis, opts.bwOf);
  if (first || load == null || r == null || r < 1) return out;
  out.heaviest = load > pb.heaviest.value + EPS;
  out.repMaxes = REP_MAX_NS.filter(n => r >= n && pb.repMaxes[n] && load > pb.repLoads[n] + EPS);
  out.any = isRealPB(out);
  return out;
}

/**
 * Sets that were a real-set PB WHEN THEY WERE LIFTED, oldest first:
 * [{ entry, heaviest, repMaxes }]. This is what the chart marks gold and
 * what the home card counts. (isNewPB judges against all other sets,
 * which differs only for a back-dated entry.) A perGym lift is judged
 * gym by gym.
 */
export function pbTimeline(log, lift, opts = {}) {
  if (perGymOf(lift) && !opts.oneGym) {
    // One timeline per gym, merged: a set is a PB against its own gym.
    const out = [];
    for (const g of gymsUsed(log, lift)) out.push(...pbTimeline(inGym(log, lift, g), lift, { ...opts, oneGym: true }));
    return out.sort((a, b) => chrono(a.entry, b.entry));
  }
  const sets = workingEntries(log, lift);
  const pb = emptyBests(pbBasis(sets, lift, opts.bwOf));
  const out = [];
  for (const e of sets) {
    if (pb.heaviest) {
      const r = num(e.reps);
      const load = pbLoad(e, lift, pb.basis, opts.bwOf);
      const ev = {
        entry: e,
        heaviest: load > pb.heaviest.value + EPS,
        repMaxes: REP_MAX_NS.filter(n => r >= n && pb.repMaxes[n] && load > pb.repLoads[n] + EPS),
      };
      if (isRealPB(ev)) out.push(ev);
    }
    fold(pb, e, lift, opts.bwOf);
  }
  return out;
}

// ── Trend ──────────────────────────────────────────────────────────

/**
 * Estimated 1RM over time, best set per day → { series, current, change4w, change12w }.
 * A trend, not a record: nothing here is a PB.
 *   series     [{ date, value, entry, night }] oldest first; `weeks` keeps
 *              only the last N weeks (omit for all of it)
 *   current    best e1RM in the 28 days to `today` ("form"), or null
 *   changeNw   form today − form N weeks ago; null when either window is
 *              empty — a gap in training says "not enough data", it never
 *              invents a drop.
 */
export function trend(log, lift, { weeks = null, today, bwOf } = {}) {
  const byDay = new Map();
  for (const e of workingEntries(log, lift)) {
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
/** Every e1RM the owner reads says it is an estimate: "est. 1RM ~241 kg" (≈ past 12 reps). */
export const estText = (v, low = false) => (num(v) == null ? 'est. 1RM —' : `est. 1RM ${low ? '≈' : '~'}${fmtE1rm(v)} kg`);

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

/** "New PB: Leg press 180 kg × 6" — the real set, nothing estimated. */
export function pbMessage(entry, lift) {
  return `New PB: ${shortLiftName(lift && lift.name)} ${setText(entry, lift)}`;
}
/**
 * Which real-set PBs, in words: ["heaviest", "5RM"]. The 1RM is the
 * heaviest weight for ≥ 1 rep, so beside `heaviest` it would say the
 * same thing twice and is left out.
 */
export function pbKinds(res) {
  if (!res) return [];
  const reps = (res.repMaxes || []).filter(n => !(res.heaviest && n === 1));
  return [res.heaviest && 'heaviest', ...reps.map(n => `${n}RM`)].filter(Boolean);
}
/** The short words for a PB set: "heaviest ever", "new 8RM", or both. */
export function pbHeadline(res) {
  if (!res) return '';
  const reps = (res.repMaxes || []).filter(n => n > 1);
  const top = reps.length ? reps[reps.length - 1] : null;
  if (res.heaviest) return top ? `heaviest ever · new ${top}RM` : 'heaviest ever';
  if (top) return `new ${top}RM`;
  return (res.repMaxes || []).includes(1) ? 'new 1RM' : '';
}
