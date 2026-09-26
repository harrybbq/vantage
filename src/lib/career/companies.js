/**
 * Target-company helpers: how a salary estimate sits against the offer
 * guardrails, and the orderings the Companies panel offers.
 *
 * Company fields (owner content, `career.companies[]`):
 *   difficulty { score: 1–5, why }        1 = very achievable, 5 = very hard
 *   salary     { low, high, role, basis: 'company'|'market'|'pay-scale',
 *                source, url, asOf }       base pay, GBP / year
 *
 * The floor and target are read from the plan's guardrails ("Salary
 * floor · £42k", "Target · ≥ £48.5k") unless `plan.salaryGuard` gives
 * them as numbers — so they are edited in one place, not two.
 *
 * Pure. No React, no network.
 */

/** '£42k' → 42000, '≥ £48.5k (matches current)' → 48500, '£45,000' → 45000. */
export function parseMoney(s) {
  const t = String(s || '').replace(/,/g, '');
  const k = /£?\s*(\d+(?:\.\d+)?)\s*k\b/i.exec(t);
  if (k) return Math.round(Number(k[1]) * 1000);
  const n = /£\s*(\d{4,})/.exec(t);
  return n ? Number(n[1]) : null;
}

/** { floor, target } from `plan.salaryGuard`, else from the guardrail rows. */
export function salaryGuard(plan) {
  const g = (plan && plan.salaryGuard) || {};
  const rows = (plan && plan.guardrails) || [];
  const find = re => rows.find(r => re.test(r.label || ''));
  const floor = Number.isFinite(g.floor) ? g.floor : parseMoney(find(/floor/i)?.value);
  const target = Number.isFinite(g.target) ? g.target : parseMoney(find(/target/i)?.value);
  return { floor: floor ?? null, target: target ?? null };
}

/**
 * Where a salary range sits against the guardrails.
 *   'meets'  the whole range is at or above the target
 *   'spans'  the range reaches the target but starts below it
 *   'floor'  under the target (and not wholly below the floor)
 *   'below'  tops out under the floor
 *   'unknown' no estimate
 */
export function salaryVerdict(salary, guard) {
  if (!salary || !Number.isFinite(salary.low) || !Number.isFinite(salary.high)) return 'unknown';
  const { floor, target } = guard || {};
  if (Number.isFinite(target) && salary.low >= target) return 'meets';
  if (Number.isFinite(target) && salary.high >= target) return 'spans';
  if (Number.isFinite(floor) && salary.high < floor) return 'below';
  return 'floor';
}

export const midOf = s => (s && Number.isFinite(s.low) && Number.isFinite(s.high) ? (s.low + s.high) / 2 : null);

/** Orderings: 'listed' | 'easiest' | 'salary' | area id (commute from it). */
export function orderCompanies(list, order, lowOfCommute) {
  const rows = [...(list || [])];
  const by = (f, dir = 1) => rows.sort((a, b) => {
    const x = f(a), y = f(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  });
  if (!order || order === 'listed') return rows;
  if (order === 'easiest') return by(c => (c.difficulty && Number.isFinite(c.difficulty.score) ? c.difficulty.score : null));
  if (order === 'salary') return by(c => midOf(c.salary), -1);
  return by(c => (lowOfCommute ? lowOfCommute(c.commute && c.commute[order]) : null));
}

/** 'k' formatting for a range: 40000–52000 → '£40k–52k'. */
export function salaryLabel(s) {
  if (!s || !Number.isFinite(s.low) || !Number.isFinite(s.high)) return '—';
  const k = n => (n % 1000 === 0 ? String(n / 1000) : (n / 1000).toFixed(1));
  return s.low === s.high ? `£${k(s.low)}k` : `£${k(s.low)}k–${k(s.high)}k`;
}
