/**
 * Applications pipeline: Watching → Applied → Screen → Interview → Offer,
 * plus Closed for anything that ended (rejected, withdrawn, declined).
 *
 *   career.applications = [{
 *     id, companyId?, company, role, url?,
 *     stage: 'watching'|'applied'|'screen'|'interview'|'offer',
 *     closed?: { reason, at },
 *     salary?: number,          // advertised or offered base, £/year
 *     commuteMin?: number,      // overrides the company's commute estimate
 *     cvSent?: string,          // which CV version they have (free text)
 *     next?: { text, due? },    // the next step and its date
 *     events: [{ at, stage?, note }],
 *   }]
 *
 * Each card is checked against the offer guardrails, using the company's
 * researched salary and commute when the application has none of its own.
 *
 * Pure. No React, no network; `today` is a parameter.
 */

export const STAGES = ['watching', 'applied', 'screen', 'interview', 'offer'];
export const STAGE_LABEL = { watching: 'Watching', applied: 'Applied', screen: 'Screen', interview: 'Interview', offer: 'Offer' };
export const CLOSE_REASONS = ['Rejected', 'Withdrew', 'Declined offer', 'Role pulled'];

const DAY = 86400000;
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);
const lowOf = v => { const m = /^(\d+)/.exec(String(v == null ? '' : v)); return m ? Number(m[1]) : null; };

export const isOpen = a => a && !a.closed && STAGES.includes(a.stage);

/** Move one stage forward (+1) or back (−1), recording the move. */
export function move(apps, id, dir, today) {
  return (apps || []).map(a => {
    if (a.id !== id) return a;
    const i = Math.max(0, Math.min(STAGES.length - 1, STAGES.indexOf(a.stage) + dir));
    if (STAGES[i] === a.stage) return a;
    return { ...a, stage: STAGES[i], events: [...(a.events || []), { at: today, stage: STAGES[i], note: `Moved to ${STAGE_LABEL[STAGES[i]]}` }] };
  });
}

/** Close (or reopen with reason null). */
export function close(apps, id, reason, today) {
  return (apps || []).map(a => (a.id !== id ? a : reason
    ? { ...a, closed: { reason, at: today }, events: [...(a.events || []), { at: today, note: `Closed · ${reason}` }] }
    : { ...a, closed: undefined, events: [...(a.events || []), { at: today, note: 'Reopened' }] }));
}

/** Days until the next step: negative = overdue, null = no date. */
export function dueIn(app, today) {
  const d = app && app.next && app.next.due;
  return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? dayDiff(today, d) : null;
}

/** Days since the application last moved. */
export function ageDays(app, today) {
  const last = [...((app && app.events) || [])].reverse().find(e => /^\d{4}-\d{2}-\d{2}$/.test(e.at || ''));
  return last ? dayDiff(last.at, today) : null;
}

/** Open applications with a step due within `within` days or overdue. */
export const needsYou = (apps, today, within = 7) =>
  (apps || []).filter(a => isOpen(a) && a.stage !== 'watching' && dueIn(a, today) != null && dueIn(a, today) <= within);

/** Commute for the check: the application's own, else the company's best area. */
export function commuteOf(app, company) {
  if (Number.isFinite(app && app.commuteMin)) return app.commuteMin;
  const lows = Object.values((company && company.commute) || {}).map(lowOf).filter(n => n != null);
  return lows.length ? Math.min(...lows) : null;
}

/** Salary for the check: the application's figure, else the company's estimate. */
export function salaryOf(app, company) {
  if (Number.isFinite(app && app.salary)) return { low: app.salary, high: app.salary, own: true };
  const s = company && company.salary;
  return s && Number.isFinite(s.low) && Number.isFinite(s.high) ? { low: s.low, high: s.high, own: false } : null;
}

/**
 * Guardrail checks for a card: salary against the floor/target, commute
 * against the limit, and clearance flagged when SC is mentioned.
 * → [{ key, ok: true|false|null, label }]   (null = unknown)
 */
export function checks(app, company, guard, { commuteLimit = 30 } = {}) {
  const out = [];
  const sal = salaryOf(app, company);
  const k = n => `£${Math.round(n / 1000)}k`;
  // Passes when the range reaches the floor; unknown without a figure or a floor.
  out.push({ key: 'salary', ok: !sal || !Number.isFinite(guard && guard.floor) ? null : sal.high >= guard.floor,
    label: sal ? (sal.low === sal.high ? k(sal.low) : `${k(sal.low)}–${Math.round(sal.high / 1000)}k`) + (sal.own ? '' : ' est.') : '£ ?' });
  const c = commuteOf(app, company);
  out.push({ key: 'commute', ok: c == null ? null : c <= commuteLimit, label: c == null ? 'commute ?' : `${c}m` });
  const clr = String((company && company.clearance) || app.clearance || '');
  out.push({ key: 'clearance', ok: /\bSC\b/.test(clr) ? null : true, label: /\bSC\b/.test(clr) ? 'SC' : 'no SC' });
  return out;
}
