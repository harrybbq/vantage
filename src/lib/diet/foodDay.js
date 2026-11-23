/**
 * The food page's arithmetic (console design, Nov 2026; mockup "Food and
 * Motion"): how a day's entries are grouped, how a macro's bar is drawn,
 * and the week behind it. Pure — no React, no DOM, no Supabase.
 * foodDay.test.mjs.
 *
 * GROUPS. The day was one card an entry, so a breakfast of three things
 * logged at 07:12, 07:14 and 07:15 was three cards. Entries logged
 * within GAP_MIN minutes of the one before share a block, with the
 * block's time and total. There are still no "Breakfast / Lunch"
 * labels: a night shift has neither (DietPanel's own reasoning).
 *
 * BARS. A ring cannot show "over": 117 % and 124 % are the same full
 * circle. A bar has a MARK at the target, MARK of the way along, and
 * runs past it when the day does. Its state says what that means:
 *   under   short of the target
 *   met     a floor reached (protein, fibre; fat too under the owner's
 *           plan), or a target landed within GRACE of itself
 *   over    a target passed by more than GRACE
 *   none    no target set
 * The words beside it ("505 over", "200 left") are always the plain
 * difference, whatever the state.
 */
export const GAP_MIN = 20;
export const MARK = 0.8;        // where the target sits along the track
export const GRACE = 0.05;      // a target within 5 % either side counts as landed
/** More is the point of these, with or without a plan. */
export const FLOORS = new Set(['protein', 'fibre']);

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pad = n => String(n).padStart(2, '0');

/** Minutes past midnight a row was logged at (nutrition_log has no time column: created_at is it), or -1. */
export function minutesOf(entry) {
  const t = entry && entry.created_at ? new Date(entry.created_at) : null;
  return !t || Number.isNaN(t.getTime()) ? -1 : t.getHours() * 60 + t.getMinutes();
}
export const clockOf = mins => (mins < 0 ? '' : `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);

/**
 * → [{ key, mins, time, items, kcal, protein }] in the order eaten.
 * A block starts when an entry is more than `gap` minutes after the one
 * before it (so a slow meal chains), or has no time at all.
 */
export function groupByTime(entries, gap = GAP_MIN) {
  const rows = (Array.isArray(entries) ? entries.filter(Boolean) : [])
    .map((e, i) => ({ e, i, m: minutesOf(e) }))
    .sort((a, b) => (a.m - b.m) || (a.i - b.i));
  const out = [];
  let last = null;
  for (const r of rows) {
    const cur = out[out.length - 1];
    if (cur && r.m >= 0 && last != null && last >= 0 && r.m - last <= gap) cur.items.push(r.e);
    else out.push({ key: String(r.e.id != null ? r.e.id : `${r.m}-${r.i}`), mins: r.m, time: clockOf(r.m), items: [r.e] });
    last = r.m;
  }
  for (const g of out) {
    g.kcal = g.items.reduce((s, e) => s + num(e.calories), 0);
    g.protein = g.items.reduce((s, e) => s + num(e.protein_g), 0);
  }
  return out;
}

/** Is this macro a floor? `planned`: the owner's plan is setting it, and `planFloors` are its floors. */
export function isFloor(name, { planned = false, planFloors = null } = {}) {
  const k = String(name || '').toLowerCase();
  return FLOORS.has(k) || (planned && !!planFloors && planFloors.has(k));
}

/**
 * A macro's bar → { fill, state, diff, pct }.
 *   fill   0–1 along the track (the target is at MARK; capped at 1)
 *   diff   value − goal, rounded (negative = left to go)
 *   pct    whole per cent of the target, uncapped (null with no target)
 */
export function barOf(value, goal, { floor = false } = {}) {
  const v = Math.max(0, num(value)), g = num(goal);
  if (!(g > 0)) return { fill: 0, state: 'none', diff: 0, pct: null };
  const r = v / g;
  const state = floor ? (r >= 1 ? 'met' : 'under') : r > 1 + GRACE ? 'over' : r >= 1 - GRACE ? 'met' : 'under';
  return { fill: Math.min(1, r * MARK), state, diff: Math.round(v - g), pct: Math.round(r * 100) };
}

/** "505 over" · "200 left" · "on target" (exactly), in the macro's unit. */
export function diffText(bar, unit = '') {
  if (!bar || bar.state === 'none') return '';
  const u = unit && unit !== 'kcal' ? ` ${unit}` : '';
  if (bar.diff === 0) return 'on target';
  return bar.diff > 0 ? `${bar.diff.toLocaleString('en-GB')}${u} over` : `${Math.abs(bar.diff).toLocaleString('en-GB')}${u} left`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parse = iso => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12); };
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The day `n` days from `iso` (noon-anchored, so a clock change cannot skip one). */
export function shiftDay(iso, n) {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

/** "Today · Mon 23 Nov" · "Yesterday · Sun 22 Nov" · "Fri 20 Nov". */
export function dayLabel(iso, today) {
  const d = parse(iso);
  const base = `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
  if (iso === today) return `Today · ${base}`;
  if (iso === shiftDay(today, -1)) return `Yesterday · ${base}`;
  return base;
}

/**
 * The seven days ending at `day`, from the % history the food section
 * writes (S.macroHistory[date].cal) → [{ key, label, pct | null, on, sel, future }].
 * `on`: within 15 % of the calorie target, DietPanel's own band.
 */
export function weekOf(history, day, today = day) {
  const hist = history && typeof history === 'object' ? history : {};
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const key = shiftDay(day, -i);
    const raw = hist[key] && hist[key].cal;
    const pct = raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
    out.push({ key, label: DOW[parse(key).getDay()], pct, on: pct != null && pct >= 85 && pct <= 115, sel: key === day, future: key > today });
  }
  return out;
}
