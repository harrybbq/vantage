/**
 * Weight trend for the Diet tab's build card: the recent weights, and
 * whether they are heading for the target at the planned rate.
 *
 * Pace is a least-squares slope over the last `paceDays` of logged
 * weights, in kg per 30 days — one noisy weigh-in cannot swing it the way
 * "latest minus first" would. It is compared with the plan's rate IN THE
 * DIRECTION OF THE TARGET, so the same function works for a cut and a
 * gain.
 *
 * Pure. No React, no network; `now` is a parameter.
 */

const DAY = 86400000;
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Logged weights in the last `days`, oldest first: [{ date, t, kg }]. */
export function weightSeries(vitalsLog, days = 90, now = new Date()) {
  const from = isoOf(new Date(now.getTime() - (days - 1) * DAY));
  const to = isoOf(now);
  return Object.keys(vitalsLog || {})
    .filter(k => k >= from && k <= to)
    .sort()
    .map(k => ({ date: k, kg: Number(vitalsLog[k] && vitalsLog[k].weight) }))
    .filter(p => Number.isFinite(p.kg) && p.kg > 0)
    .map(p => ({ ...p, t: new Date(p.date + 'T12:00:00').getTime() }));
}

/** Least-squares slope, kg per 30 days. null with fewer than 3 points or no time span. */
export function slopePer30(points) {
  if (!points || points.length < 3) return null;
  const n = points.length;
  const xs = points.map(p => p.t / (30 * DAY)), ys = points.map(p => p.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : null;
}

/**
 * On pace for the target?
 * → { rate, planned, direction, status: 'on'|'slow'|'wrong'|'there'|'unknown' }
 *   rate      kg/30d, signed (negative = losing)
 *   planned   the plan's rate, signed toward the target
 *   'on'      moving toward the target at ≥ 75% of the planned rate
 *   'slow'    toward it, but slower than that
 *   'wrong'   moving away from it by more than 0.1 kg/30d
 *   'there'   within 0.3 kg of the target
 */
export function pace(series, targetKg, ratePerMonth, { paceDays = 30, now = new Date() } = {}) {
  const last = series && series[series.length - 1];
  if (!last || !Number.isFinite(targetKg)) return { status: 'unknown', rate: null, planned: null, direction: 0 };
  const gap = targetKg - last.kg;
  const direction = Math.abs(gap) <= 0.3 ? 0 : Math.sign(gap);
  const recent = series.filter(p => p.t >= now.getTime() - paceDays * DAY);
  const rate = slopePer30(recent);
  const planned = direction * Math.abs(Number(ratePerMonth) || 0);
  if (direction === 0) return { status: 'there', rate, planned, direction };
  if (rate == null) return { status: 'unknown', rate, planned, direction };
  const toward = rate * direction;                 // + when heading for the target
  if (toward < -0.1) return { status: 'wrong', rate, planned, direction };
  if (planned && toward >= 0.75 * Math.abs(planned)) return { status: 'on', rate, planned, direction };
  return { status: 'slow', rate, planned, direction };
}
