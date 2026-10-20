/**
 * Lifts UI helpers — the pure half of the shared Lifts layer (Oct 2026
 * redesign). No React, no DOM, no clock: colour maths for the user's
 * accent, how an estimate is rounded and worded, the ± step, Previous by
 * shift, the in-workout PB toast rules, the pad's buffer arithmetic and
 * the layout breakpoints. ui.test.mjs pins every rule.
 *
 * The React pieces that use these live in
 * src/components/upgrade/lifts/ui/ (Sheet, NumPad, RealBest, Estimate…).
 */
import {
  num, stepFor, DEFAULT_STEP, isNewPB, isWarmup, perGymOf, gymOf, workingEntries, shortLiftName, pbHeadline, fmtKg,
} from './lifts.js';
import { liftsOf } from './store.js';
import { activeOf, previousSession, exerciseLift, RPE_STEPS } from './workout.js';
import { NIGHT_LOAD_SCALE } from '../../data/trainingProgramme.js';

export { stepFor, DEFAULT_STEP, RPE_STEPS };

// ── Colour (WCAG 2.x relative luminance) ────────────────────────────
// Lives in lib/design/contrast.js since Oct 2026 (shared with the console
// design layer, which must not import the Lifts graph). Same API here.
import { parseColor, toHex, luminance, contrast, INK_DARK, INK_LIGHT, onAccent, accentFor } from '../design/contrast.js';
export { parseColor, toHex, luminance, contrast, INK_DARK, INK_LIGHT, onAccent, accentFor };

/**
 * The Lifts colour tokens (brief §3.1), the same values lifts-tokens.css
 * carries — here so the contrast rules can be tested and the accent
 * adjusted against the real surfaces.
 */
export const LF_TOKENS = Object.freeze({
  'dark-os': Object.freeze({
    bg: '#0E0E0C', s1: '#151513', s2: '#1D1D1A', s3: '#26251F',
    text: '#E6E1D6', mid: '#B1AB9F', muted: '#928C81', line: '#2A2926', lineStrong: '#6B685F',
    pb: '#E3B341', night: '#9DB0FF', danger: '#F2706B',
  }),
  'cream-pro': Object.freeze({
    bg: '#EDE6D6', s1: '#FAF5E9', s2: '#F1EADB', s3: '#E6DECB',
    text: '#24201B', mid: '#4E463C', muted: '#645A4D', line: '#DCD3C1', lineStrong: '#8A7F70',
    pb: '#7A5000', night: '#3B4FB8', danger: '#B42318',
  }),
});
export const themeTokens = theme => LF_TOKENS[theme === 'dark-os' ? 'dark-os' : 'cream-pro'];

/**
 * The inline custom properties a `.lifts` root (and every portalled sheet)
 * carries for the user's accent in `theme`:
 *   --lf-accent       the fill (≥ 3:1 on s1 — a boundary/graphic colour)
 *   --lf-accent-ink   the accent as TEXT (≥ 4.5:1 on s1 and s2)
 *   --lf-on-accent    label colour on the fill (onAccent)
 */
export function accentVars(hex, theme) {
  const t = themeTokens(theme);
  const fill = accentFor(hex || '#1A7A4A', t.s1, 3);
  const ink = accentFor(accentFor(fill, t.s1, 4.5), t.s2, 4.5);
  return { '--lf-accent': fill, '--lf-accent-ink': ink, '--lf-on-accent': onAccent(fill) };
}

// ── Estimates ──────────────────────────────────────────────────────

/** Round an e1RM for display: 1 kg on tiles ('tile'), 0.5 kg in chart readouts ('readout'). Never 2 decimals. */
export function roundEstimate(kg, ctx = 'tile') {
  const v = num(kg);
  if (v == null) return null;
  const q = ctx === 'readout' ? 0.5 : 1;
  return Math.round(v / q) * q;
}
/**
 * "est. 1RM ~241 kg" — always "est.", always "~" ("≈" past 12 reps, where
 * Epley is a guess). opts: { ctx: 'tile'|'readout', low, label, unit }.
 */
export function fmtEstimate(kg, opts = {}) {
  const { ctx = 'tile', low = false, label = 'est. 1RM', unit = 'kg' } = opts;
  const v = roundEstimate(kg, ctx);
  if (v == null) return `${label} —`;
  return `${label} ${low ? '≈' : '~'}${fmtKg(v)}${unit ? ` ${unit}` : ''}`;
}
export const ESTIMATE_EXPLAINER = 'Estimated from your best real set of 1–10 reps (Epley). Estimates can be off by 10 % or more. PBs only come from sets you actually lifted.';

// ── Real sets ──────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-12' → '12 Oct'; with `withYear` (or another year than `today`'s) → '12 Oct 2025'. */
export function fmtShortDate(iso, today = null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const s = `${Number(m[3])} ${MON[Number(m[2]) - 1]}`;
  return today && String(today).slice(0, 4) !== m[1] ? `${s} ${m[1]}` : s;
}
/**
 * A real set as numbers: "192.5 × 5"; a dip "BW × 8" / "+20 × 8"; a
 * missing value "—". Exact (never rounded past 2 dp) — it was lifted.
 */
export function realSetText(weight, reps, lift = null) {
  const w = num(weight), r = num(reps);
  if (w == null || r == null) return '—';
  const ws = lift && lift.load === 'bodyweight_plus' ? (w === 0 ? 'BW' : `+${fmtKg(w, 2)}`) : fmtKg(w, 2);
  return `${ws} × ${r}`;
}

// ── Compare scope ──────────────────────────────────────────────────

/**
 * How a lift is compared → { perGym, text, short }: a machine "COMPARED
 * WITHIN DXC" (its numbers belong to that gym's machine), a free weight
 * "COMPARED ACROSS GYMS". `gymLabel` is the active gym's name.
 */
export function compareScope(lift, gymLabel = null) {
  const perGym = perGymOf(lift);
  if (perGym) return { perGym, text: `Compared within ${gymLabel || 'one gym'}`, short: gymLabel || 'this gym' };
  return { perGym, text: 'Compared across gyms', short: 'all gyms' };
}

// ── Previous by shift ──────────────────────────────────────────────

const EMPTY_PREV = Object.freeze({ weight: null, reps: null, rpe: null, type: null, source: null, label: '', date: null });
const labelOf = src => (src === 'day×0.8' ? '☾ 80 %' : src === 'night' ? '☾' : '');
const pick = (p, si, clamp) => {
  if (!p || !p.sets.length) return null;
  const i = clamp ? Math.min(si, p.sets.length - 1) : si;
  return p.sets[i] || null;
};

/**
 * Night Previous for set `setIndex` → { weight, reps, rpe, type, source:
 * 'night'|'day×0.8'|null, label, date }: the last NIGHT session's same set;
 * else the last day set × scale (0.8) rounded to stepFor and labelled
 * "☾ 80 %". opts: { gym, scale, clamp } — clamp reuses the last set when
 * this one is past the end (the ✓-fill), else that is "no previous".
 */
export function nightPrevious(S, liftId, setIndex, opts = {}) {
  const { scale = NIGHT_LOAD_SCALE, clamp = false } = opts;
  const g = 'gym' in opts ? { gym: opts.gym } : {};
  const p = previousSession(S, liftId, { ...g, night: true, scale, lift: opts.lift });
  const st = pick(p, setIndex, clamp);
  if (!st) return { ...EMPTY_PREV };
  return { weight: st.weight, reps: st.reps, rpe: st.rpe ?? null, type: st.type || null, source: p.source, label: labelOf(p.source), date: p.date };
}

/**
 * Previous for set `setIndex` of a lift, by shift → same shape as
 * nightPrevious, source 'day'|'night'|'day×0.8'|null. A day session reads
 * the last day time; a night one goes through nightPrevious. A perGym
 * lift reads only `gym`'s history. opts: { gym, night, clamp, lift } or
 * { active } to take the gym and shift from the workout in progress.
 */
export function previousFor(S, liftId, setIndex, opts = {}) {
  const a = opts.active || null;
  const night = a ? a.shift === 'night' : !!opts.night;
  const gym = a ? a.gym || null : opts.gym;
  const lift = opts.lift || (a ? exerciseLift(liftsOf(S).list, a.exercises.find(x => x.liftId === liftId)) : null) || undefined;
  if (night) return nightPrevious(S, liftId, setIndex, { ...(gym !== undefined ? { gym } : {}), clamp: opts.clamp, lift });
  const p = previousSession(S, liftId, { ...(gym !== undefined ? { gym } : {}), night: false, lift });
  const st = pick(p, setIndex, opts.clamp);
  if (!st) return { ...EMPTY_PREV };
  return { weight: st.weight, reps: st.reps, rpe: st.rpe ?? null, type: st.type || null, source: p.source, label: labelOf(p.source), date: p.date };
}

// ── The in-workout PB toast ─────────────────────────────────────────

/** Which toast a real-set PB result earns: 'heaviest' beats 'repmax'; null for none. */
export function pbToastKind(res) {
  if (!res || res.first || res.warmup) return null;
  if (res.heaviest) return 'heaviest';
  if ((res.repMaxes || []).length) return 'repmax';
  return null;
}
/**
 * The toast rules (brief §3.5, owner-accepted): a REAL set (never a
 * warm-up, never an estimate), the lift has ≥ 2 prior sessions, the set
 * wasn't edited after the fact or entered for a past day, and at most one
 * toast per exercise per session. `kind` from pbToastKind.
 */
export function shouldToastPb({ priorSessions = 0, editedSet = false, alreadyToasted = false, kind = null, warmup = false } = {}) {
  return !!kind && !warmup && !editedSet && !alreadyToasted && (num(priorSessions) || 0) >= 2;
}

/** Distinct earlier sessions of a lift (a workout, or a Quick-Log day), warm-ups aside; a perGym lift counts `gym` only. */
export function priorSessionCount(log, lift, gym = null) {
  const keys = new Set();
  for (const e of workingEntries(log, lift)) {
    if (perGymOf(lift) && gymOf(e) !== (gym || null)) continue;
    keys.add(e.sessionId ? `s:${e.sessionId}` : `d:${e.date}`);
  }
  return keys.size;
}

/**
 * Should ticking set `si` of exercise `ei` toast a PB? → null | { kind,
 * text, headline, liftId } — judged against the finished log (gym-scoped
 * for machines, warm-ups out), never against an estimate.
 * opts: { bwOf, toasted: Set of liftIds already toasted this session, edited }.
 */
export function livePb(S, ei, si, opts = {}) {
  const a = activeOf(S);
  const ex = a && a.exercises[ei];
  const st = ex && ex.sets[si];
  if (!st || !st.done || isWarmup(st)) return null;
  const L = liftsOf(S);
  const lift = exerciseLift(L.list, ex);
  if (!lift) return null;
  const entry = { id: '__live', liftId: lift.id, date: a.date, weight: num(st.weight), reps: num(st.reps), createdAt: Number.MAX_SAFE_INTEGER };
  if (a.gym) entry.gym = a.gym;
  if (entry.weight == null || entry.reps == null) return null;
  const res = isNewPB(L.log, entry, lift, { bwOf: opts.bwOf });
  const kind = pbToastKind(res);
  const ok = shouldToastPb({
    kind, priorSessions: priorSessionCount(L.log, lift, a.gym || null), editedSet: !!opts.edited,
    alreadyToasted: !!(opts.toasted && opts.toasted.has && opts.toasted.has(lift.id)),
  });
  if (!ok) return null;
  const headline = pbHeadline(res);
  return { kind, liftId: lift.id, headline, text: `New PB · ${shortLiftName(lift.name)} ${realSetText(entry.weight, entry.reps, lift)}${headline ? ` · ${headline}` : ''}` };
}

// ── RPE ────────────────────────────────────────────────────────────

/** "8 · 2 reps left", "10 · nothing left", "8.5 · 1–2 reps left", "9.5 · maybe 1 left". '' for none. */
export function rpeLine(rpe) {
  const r = num(rpe);
  if (r == null) return '';
  const left = 10 - r;
  const v = fmtKg(r);
  if (left <= 0) return `${v} · nothing left`;
  if (left === 0.5) return `${v} · maybe 1 rep left`;
  if (Number.isInteger(left)) return `${v} · ${left} ${left === 1 ? 'rep' : 'reps'} left`;
  return `${v} · ${Math.floor(left)}–${Math.ceil(left)} reps left`;
}

// ── The pad's buffer ───────────────────────────────────────────────

/**
 * One key into the pad's buffer → the new buffer, or null when the key is
 * refused. `fresh`: the first key after landing on a field replaces it
 * (a keyboard's select-all). Keys: '0'–'9', '.', 'back'. Reps take no
 * decimal; at most 5 digits; a lone '0' is replaced by the next digit.
 */
export function padInput(buf, key, { field = 'weight', fresh = false } = {}) {
  let b = fresh ? '' : String(buf == null ? '' : buf);
  if (key === 'back') return fresh ? '' : b.slice(0, -1);
  if (key === '.') {
    if (field === 'reps' || b.includes('.')) return null;
    return `${b || '0'}.`;
  }
  if (!/^\d$/.test(String(key))) return null;
  if (b.replace('.', '').length >= 5) return null;
  if (b.includes('.') && b.split('.')[1].length >= 2) return null;
  b = b === '0' ? String(key) : b + key;
  return b;
}
/**
 * ± one step from `base` → the new value as a string. Reps and RPE never
 * go below 1, weight never below 0; RPE tops out at 10. Rounded to 2 dp.
 */
export function padStep(base, dir, step, field = 'weight') {
  const b = num(base) ?? 0;
  let v = Math.round((b + (dir < 0 ? -1 : 1) * (num(step) || 1)) * 100) / 100;
  v = Math.max(field === 'reps' || field === 'rpe' ? 1 : 0, v);
  if (field === 'rpe') v = Math.min(10, v);
  return String(v);
}

// ── Layout ─────────────────────────────────────────────────────────

/** Layout follows WIDTH (brief §3.1): < 600 phone, 600–1023 tablet, ≥ 1024 desktop. */
export const BREAKPOINTS = Object.freeze({ tablet: 600, desktop: 1024 });
export function layoutFor(width) {
  const w = num(width) ?? 1024;
  return w >= BREAKPOINTS.desktop ? 'desktop' : w >= BREAKPOINTS.tablet ? 'tablet' : 'phone';
}
