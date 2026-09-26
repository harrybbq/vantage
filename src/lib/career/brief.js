/**
 * The weekly brief: seven tabs turned into three things to do this week.
 *
 * It only reads what already exists — the pipeline, the study pacing, the
 * plan's timeline and decisions, the savings against the plan — scores
 * every candidate by how much it slips if left, and keeps the top three.
 * The one thing it stores is which of this week's actions are ticked,
 * keyed by ISO week (`career.brief.weeks['2026-W40']`).
 *
 * Scores (higher first), roughly "what breaks soonest":
 *   overdue pipeline step        100 + days overdue
 *   offer awaiting a decision     95
 *   study pace late / tight       90 / 75
 *   decision point this month     85 (next month 65)
 *   pipeline step due this week   80 − days away
 *   exam not booked, ≤ 60 days    70
 *   study sessions this week      60
 *   savings behind plan           55
 *   plan item this month          50 (in progress 45)
 *
 * Pure. No React, no network; `today` is a parameter.
 */
import { needsYou, dueIn, STAGE_LABEL, isOpen } from './pipeline.js';
import { statusOf } from './planTimeline.js';
import { monthLabel, addMonths } from './money.js';

const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const isoOfDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** ISO week of a 'YYYY-MM-DD': { key: '2026-W40', monIso, sunIso }. */
export function weekOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = (t.getUTCDay() + 6) % 7;                    // Mon = 0
  const mon = new Date(t.getTime() - dow * DAY);
  const thu = new Date(mon.getTime() + 3 * DAY);          // ISO week-year is the Thursday's year
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const wk1Mon = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY);
  const n = 1 + Math.round((mon - wk1Mon) / (7 * DAY));
  return { key: `${thu.getUTCFullYear()}-W${pad(n)}`, monIso: isoOfDate(mon), sunIso: isoOfDate(new Date(mon.getTime() + 6 * DAY)) };
}

const fmtDay = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/**
 * Ranked candidates. Inputs are all optional:
 *   apps, companies, pacing ({ cert, plan: planStudy result, examIso }),
 *   plan (career.plan), statusMap, vs (latest closed actual-vs-plan),
 *   certs, today ('YYYY-MM-DD')
 * → [{ id, tag, title, why, score, panel }]
 */
export function candidates({ apps = [], companies = [], pacing = null, plan = null, statusMap = {}, vs = null, certs = [], today }) {
  const out = [];
  const coName = a => a.company || (companies.find(c => c.id === a.companyId) || {}).name || 'an application';
  const week = weekOf(today);

  for (const a of needsYou(apps, today, 7)) {
    const d = dueIn(a, today);
    const what = (a.next && a.next.text) || 'Next step';
    out.push({
      id: `app:${a.id}:${a.next && a.next.due}`, tag: 'PIPELINE', panel: 'pipeline',
      title: `${what} — ${coName(a)}`,
      why: `${STAGE_LABEL[a.stage]} · ${d < 0 ? `overdue by ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'due today' : `due ${fmtDay(a.next.due)}`}${a.cvSent ? ` · they have your "${a.cvSent}" CV` : ''}`,
      score: d < 0 ? 100 - d : 80 - d,
    });
  }
  for (const a of apps.filter(x => isOpen(x) && x.stage === 'offer')) {
    if (out.some(o => o.id.startsWith(`app:${a.id}:`))) continue;
    out.push({ id: `offer:${a.id}`, tag: 'PIPELINE', panel: 'pipeline', title: `Decide on the ${coName(a)} offer`, why: 'An offer is open — check it against the guardrails and the keys month.', score: 95 });
  }

  if (pacing && pacing.cert && pacing.plan) {
    const { cert, plan: ps, examIso } = pacing;
    if (ps.status === 'late') {
      out.push({ id: `pace:${cert.id}:late:${week.key}`, tag: 'CERTS', panel: 'certs', title: `Add study hours for ${cert.name}`, why: `At this pace you won't be ready by ${fmtDay(examIso)} — add hours, or move the exam.`, score: 90 });
    } else if (ps.status === 'tight') {
      out.push({ id: `pace:${cert.id}:tight:${week.key}`, tag: 'CERTS', panel: 'certs', title: `Protect every study session for ${cert.name}`, why: `Exam-ready ${fmtDay(ps.readyIso)} — under three days before the exam, so one missed block makes it late.`, score: 75 });
    }
    const thisWeek = ps.cal.filter(d => d.iso >= week.monIso && d.iso <= week.sunIso && d.hours > 0);
    if (thisWeek.length && ps.status !== 'late') {
      const h = thisWeek.reduce((s, d) => s + d.hours, 0);
      out.push({ id: `study:${cert.id}:${week.key}`, tag: 'CERTS', panel: 'certs',
        title: `${cert.name.split(' ·')[0]}: ${h} h over ${thisWeek.length} session${thisWeek.length === 1 ? '' : 's'}`,
        why: `${thisWeek.map(d => fmtDay(d.iso).split(' ')[0]).join(', ')}${ps.readyIso ? ` · keeps exam-ready on ${fmtDay(ps.readyIso)}` : ''}.`, score: 60 });
    }
  }

  const month = today.slice(0, 7);
  for (const it of (plan && plan.items) || []) {
    if (!/^\d{4}-\d{2}$/.test(it.start || '')) continue;
    const st = statusOf(it, statusMap);
    if (st === 'done') continue;
    const end = it.end || it.start;
    if (it.decision && (it.start === month || it.start === addMonths(month, 1))) {
      out.push({ id: `plan:${it.id}`, tag: 'PLAN', panel: 'plan', title: it.title, why: `Decision point · ${monthLabel(it.start)}${it.detail ? ` — ${it.detail}` : ''}`, score: it.start === month ? 85 : 65 });
    } else if (it.start <= month && end >= month) {
      out.push({ id: `plan:${it.id}`, tag: 'PLAN', panel: 'plan', title: it.title, why: it.detail || `Planned for ${monthLabel(it.start)}.`, score: st === 'in_progress' ? 45 : 50 });
    }
  }

  for (const c of certs || []) {
    if (c.completed || c.status === 'booked' || c.status === 'passed' || !/^\d{4}-\d{2}$/.test(c.target || '')) continue;
    const days = Math.round((Date.parse(c.target + '-01T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / DAY);
    if (days <= 60) out.push({ id: `book:${c.id}`, tag: 'CERTS', panel: 'certs', title: `Book the ${c.name.split(' ·')[0]} exam`, why: `Target ${monthLabel(c.target)} and it isn't booked — a date makes the pacing real.`, score: 70 });
  }

  if (vs && vs.diff < 0) {
    out.push({ id: `money:${vs.month}`, tag: 'MONEY', panel: 'money', title: `Savings ${'£' + Math.abs(Math.round(vs.diff)).toLocaleString('en-GB')} behind plan`, why: `End of ${monthLabel(vs.month)}: ${'£' + Math.round(vs.actual).toLocaleString('en-GB')} against ${'£' + Math.round(vs.planned).toLocaleString('en-GB')} on the no-bonus plan.`, score: 55 });
  }

  const seen = new Set();
  return out.filter(o => (seen.has(o.id) ? false : seen.add(o.id))).sort((a, b) => b.score - a.score);
}

/** The top `n`, ticked state applied from `career.brief`. */
export function briefFor(input, brief, n = 3) {
  const week = weekOf(input.today);
  const done = new Set((((brief && brief.weeks) || {})[week.key] || {}).done || []);
  return { week, actions: candidates(input).slice(0, n).map(a => ({ ...a, done: done.has(a.id) })) };
}

/** The brief after ticking/unticking an action (records this week's total too). */
export function toggleDone(brief, weekKey, id, total) {
  const weeks = { ...((brief && brief.weeks) || {}) };
  const cur = new Set((weeks[weekKey] || {}).done || []);
  if (cur.has(id)) cur.delete(id); else cur.add(id);
  weeks[weekKey] = { done: [...cur], total };
  return { ...(brief || {}), weeks };
}

/** Last week's score, e.g. { done: 2, total: 3 }, or null. */
export function lastWeek(brief, today) {
  const { monIso } = weekOf(today);
  const [y, m, d] = monIso.split('-').map(Number);
  const prev = weekOf(isoOfDate(new Date(Date.UTC(y, m - 1, d - 7))));
  const w = ((brief && brief.weeks) || {})[prev.key];
  return w ? { done: (w.done || []).length, total: w.total || 3 } : null;
}
