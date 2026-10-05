/**
 * Upgrade's home menu — the shaping behind each card.
 *
 * useHomeLines (src/components/upgrade/home/useHomeLines.js) gathers the
 * inputs — the rotation from S, today's day summary, the owner store for
 * Career, the Security console's `?panel=overview` — and hands them here.
 * Everything in this file is pure: no React, no network, `now` and
 * `today` are parameters, so the tests can pin every string and state.
 *
 * ── The card ──
 *   { loading, figure, figureLabel, text, state, updatedAt, error, retry }
 * `figure` is the short headline ("182 g", "Night 2", "3 critical"),
 * `figureLabel` its caption, `text` the supporting sentence. The hook
 * attaches `retry`; the shapers here leave it null.
 *
 * ── States ──
 *   ok         the thing is fine (a target hit, systems operational)
 *   attention  worth a look (open tickets, behind on protein late in the day)
 *   critical   act now (a system down, a critical ticket)
 *   neutral    information, not a status (the rotation; nothing to judge)
 *   unknown    we couldn't find out — ALWAYS carries `error`, and a retry
 * Hero = worst of the cards: critical > attention > unknown > ok > neutral.
 *
 * ── Per card ──
 * Security (from the overview panel):
 *   critical  verdict 'down', any system down, or criticalTickets > 0
 *   attention verdict 'degraded', any system degraded, open tickets,
 *             open reports or security-advisor errors
 *   ok        verdict 'operational' or every reported system ok
 *   unknown   the fetch failed / forbidden / unavailable, or an answer
 *             with nothing in it to judge
 *   neutral   console not installed (crest-queue fallback stands in) or
 *             not configured
 * Diet (protein target vs today's summary):
 *   ok when the target is hit; attention when under half of it at or
 *   after 18:00 local; otherwise neutral; unknown if the summary failed.
 *   No summary row for today means nothing logged yet — 0 g, not unknown.
 * Rotation: always neutral; derived now, so updatedAt is null.
 * Career: attention when an open brief action is overdue, or an exam is
 *   ≤ 14 days away and the study pacing is 'late'; otherwise neutral;
 *   unknown when the owner store failed (setup-not-run is neutral).
 * Books (this month's income and costs from the books function):
 *   ok when this month is in profit; attention when costs beat income
 *   three months running (this month and the two before); otherwise
 *   neutral. Not installed / SQL not run → neutral "Set up"; a failed
 *   or refused fetch → unknown.
 *
 * ── updatedAt ──
 * The ms epoch of the data the line is built from: the console's own
 * `generatedAt` for Security (it caches 30 s server-side), the moment
 * the day summary / owner rows / crest queue answered for the others,
 * null for the rotation (derived from the calendar, always current).
 */
import { resolveDay, scheduleOf } from '../rotation/pattern.js';
import { num, toMs } from '../security/format.js';
import { pillState } from '../security/status.js';

// ── States ────────────────────────────────────────────────────────

export const STATES = ['critical', 'attention', 'unknown', 'ok', 'neutral'];   // worst first

/** Rank of a state, 0 = worst. Anything unrecognised ranks as neutral. */
export const stateRank = s => (STATES.includes(s) ? STATES.indexOf(s) : STATES.length - 1);

/** The worst of a list of states (or cards). Empty → 'neutral'. */
export function worstState(list) {
  let best = 'neutral';
  for (const x of list || []) {
    const s = x && typeof x === 'object' ? x.state : x;
    if (stateRank(s) < stateRank(best)) best = s;
  }
  return best;
}

/** A card's full shape with defaults, so every card has every field. */
export function card(fields = {}) {
  return {
    loading: false, figure: null, figureLabel: null, text: null,
    state: 'neutral', updatedAt: null, error: null, retry: null,
    ...fields,
  };
}

/** A card still waiting for its first answer. */
export const loadingCard = () => card({ loading: true });

// ── Time ──────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');

/**
 * How long ago, short: "now" (under a minute, or a future time from
 * clock skew), "2 m", "1 h", "3 d". Floors, so 59 min reads "59 m".
 * null for a missing or unreadable time.
 */
export function ago(ms, now = Date.now()) {
  const t = toMs(ms);
  if (t == null) return null;
  const s = Math.floor((now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)} m`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

/** Exact local time for a tooltip: "Fri 2 Oct, 14:26". null when missing. */
export function exactTime(ms) {
  const t = toMs(ms);
  if (t == null) return null;
  const d = new Date(t);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Fri 2 Oct" for a local Date. */
export function dayLabel(date = new Date()) {
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Local 'YYYY-MM-DD' for a Date (the same day the rest of Upgrade uses). */
export function localIso(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from `fromIso` to `toIso` (both 'YYYY-MM-DD'), DST-proof. */
export function daysUntil(toIso, fromIso) {
  return Math.round((Date.parse(toIso + 'T12:00:00Z') - Date.parse(fromIso + 'T12:00:00Z')) / 86400000);
}

const nextIso = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

// ── Rotation ──────────────────────────────────────────────────────

function dayOf(S, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return resolveDay(y, m - 1, d, (S && S.rotation && S.rotation.overrides) || {}, scheduleOf(S));
}

/** "Night 2" | "Day 1" | "Leave" | "Off", or null before the pattern starts. */
export function shiftLabel(r) {
  if (!r || !r.inPattern) return null;
  if (r.shift === 'night') return `Night ${r.shiftNum}`;
  if (r.shift === 'day') return `Day ${r.shiftNum}`;
  if (r.shift === 'leave') return 'Leave';
  return 'Off';
}

/** "Night 2 · Pull", "Off · Rest", "Leave · Rest" — the hero's rotation bit. */
export function rotationLine(S, iso = localIso()) {
  const r = dayOf(S, iso);
  if (!r.inPattern) return 'Before the rotation starts';
  return `${shiftLabel(r)} · ${r.session || 'Rest'}`;
}

/**
 * Figure = today's shift, text = today's session and tomorrow's shift:
 * { figure: 'Night 2', figureLabel: 'today', text: 'Pull · tomorrow Night 3' }.
 */
export function rotationCard(S, iso = localIso()) {
  const r = dayOf(S, iso);
  if (!r.inPattern) return card({ text: 'Before the rotation starts' });
  const next = shiftLabel(dayOf(S, nextIso(iso)));
  return card({
    figure: shiftLabel(r),
    figureLabel: 'today',
    text: `${r.session || 'Rest'}${next ? ` · tomorrow ${next}` : ''}`,
  });
}

// ── Diet ──────────────────────────────────────────────────────────

export const DIET_LATE_HOUR = 18;

/**
 * @param target  protein target in g (planProteinG)
 * @param day     useDaySummary's { loaded, summary, error?, at? }
 * @param hour    local hour now (0–23)
 */
export function dietCard({ target, day, hour }) {
  const t = Math.round(num(target) ?? 0);
  if (!day || !day.loaded) return loadingCard();
  if (day.error) {
    return card({
      figure: t ? `${t} g` : null, figureLabel: t ? 'protein target' : null,
      text: 'Today’s log didn’t load', state: 'unknown',
      updatedAt: toMs(day.at), error: 'Couldn’t load today’s food log',
    });
  }
  const at = toMs(day.at);
  const had = day.summary ? Math.max(0, Math.round(num(day.summary.protein_g) ?? 0)) : 0;
  if (!t) return card({ figure: `${had} g`, figureLabel: 'protein today', text: 'No protein target set', updatedAt: at });
  if (had >= t) {
    return card({ figure: `${had} g`, figureLabel: 'protein today', text: `Target of ${t} g hit`, state: 'ok', updatedAt: at });
  }
  const late = had < t / 2 && hour >= DIET_LATE_HOUR;
  return card({
    figure: `${t - had} g to go`, figureLabel: 'protein',
    text: had ? `${had} of ${t} g so far today` : `Nothing logged yet · target ${t} g`,
    state: late ? 'attention' : 'neutral', updatedAt: at,
  });
}

// ── Career ────────────────────────────────────────────────────────

export const EXAM_SOON_DAYS = 14;

/**
 * @param store    useOwnerContent's { state, message, at }
 * @param actions  briefFor(...).actions — [{ title, done, overdue? }]
 * @param exam     { name, days, behind } | null — `behind` = pacing 'late'
 */
export function careerCard({ store, actions = [], exam = null }) {
  const st = store && store.state;
  if (!st || st === 'loading') return loadingCard();
  if (st === 'setup') return card({ text: 'Plan, money, certs and the pipeline' });
  if (st !== 'ready') {
    return card({
      text: 'Plan, money, certs and the pipeline', state: 'unknown',
      error: 'Couldn’t load the career plan', updatedAt: toMs(store.at),
    });
  }
  const open = (actions || []).filter(a => a && !a.done);
  const overdue = open.find(a => a.overdue) || null;
  const first = overdue || open[0] || null;
  const examDays = exam && num(exam.days) != null ? Math.max(0, exam.days) : null;
  const examSoonBehind = examDays != null && examDays <= EXAM_SOON_DAYS && !!exam.behind;

  const action = first ? `${overdue ? 'Overdue' : 'Next'}: ${first.title}` : 'Nothing pressing this week';
  const examBit = examDays != null ? `${exam.name} exam${exam.behind ? ' · behind pace' : ''}` : null;
  return card({
    // A bare "0" headline reads as a missing number; nothing due says so.
    figure: examDays != null ? `${examDays} d` : open.length ? String(open.length) : 'Clear',
    figureLabel: examDays != null ? 'to exam' : !open.length ? 'this week' : open.length === 1 ? 'action this week' : 'actions this week',
    text: [examBit, action].filter(Boolean).join(' · '),
    state: overdue || examSoonBehind ? 'attention' : 'neutral',
    updatedAt: toMs(store.at),
  });
}

// ── Security ──────────────────────────────────────────────────────

const SYS = [['db', 'Database'], ['netlify', 'Netlify'], ['app', 'App']];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The overview's systems and counts, read once for the card and the hero. */
function readOverview(ov) {
  const st = (ov && ov.status) || {};
  const c = (ov && ov.counts) || {};
  const down = [], degraded = [];
  let ok = 0;
  for (const [k, name] of SYS) {
    const p = pillState(st[k]);
    if (p.key === 'down') down.push(name);
    else if (p.key === 'degraded') degraded.push(name);
    else if (p.key === 'ok') ok++;
  }
  const verdict = typeof (ov && ov.verdict) === 'string' ? ov.verdict : null;
  return {
    down, degraded, ok, verdict,
    open: num(c.openTickets), crit: num(c.criticalTickets) || 0,
    reports: num(c.openReports) || 0, adv: num(c.advisorsError) || 0,
  };
}

/** State of an overview answer, by the rules at the top of this file. */
export function overviewState(ov) {
  const o = readOverview(ov);
  if (o.verdict === 'down' || o.down.length || o.crit > 0) return 'critical';
  if (o.verdict === 'degraded' || o.degraded.length || o.open > 0 || o.reports > 0 || o.adv > 0) return 'attention';
  if (o.verdict === 'operational' || o.ok) return 'ok';
  return 'unknown';
}

/** Card from a successful `?panel=overview`. `at` = when it arrived (fallback for generatedAt). */
export function securityCard(ov, at = null) {
  const o = readOverview(ov);
  const state = overviewState(ov);
  const updatedAt = toMs(ov && ov.generatedAt) ?? toMs(at);
  if (state === 'unknown') {
    return card({ text: 'Status unknown', state, updatedAt, error: 'The console sent no status' });
  }
  let figure = null, figureLabel = null;
  if (o.crit) { figure = `${o.crit} critical`; figureLabel = o.crit === 1 ? 'ticket' : 'tickets'; }
  else if (o.open != null) { figure = `${o.open} open`; figureLabel = o.open === 1 ? 'ticket' : 'tickets'; }
  else if (o.reports) { figure = `${o.reports} open`; figureLabel = o.reports === 1 ? 'report' : 'reports'; }

  const systems = o.down.length || o.degraded.length
    ? [...o.down.map(n => `${n} down`), ...o.degraded.map(n => `${n} degraded`)].join(' · ')
    : o.verdict === 'operational' || o.ok ? 'All systems ok' : null;
  const extras = [];
  if (o.crit && o.open > o.crit) extras.push(`${o.open} open in all`);
  if (o.reports && figureLabel !== 'report' && figureLabel !== 'reports') extras.push(`${plural(o.reports, 'report')} to review`);
  if (o.adv) extras.push(plural(o.adv, 'advisor error'));
  return card({
    figure, figureLabel,
    text: [systems, ...extras].filter(Boolean).join(' · ') || 'Security console',
    state, updatedAt,
  });
}

/** The hero's security bit: "3 critical", "1 ticket open", "Database down", or null. */
export function securityHeroBit(ov) {
  const o = readOverview(ov);
  if (o.crit) return `${o.crit} critical`;
  if (o.down.length) return `${o.down[0]} down`;
  if (o.open) return `${plural(o.open, 'ticket')} open`;
  return null;
}

/**
 * Security while the console function isn't installed: the crest queue
 * stands in (it is still real news), and it reads as neutral — not a
 * status of the systems. `body` is crestQueue()'s answer.
 */
export function crestFallbackCard(body, at = null) {
  if (!body || body.setup === false) {
    return card({ figure: null, text: 'Console not installed yet', updatedAt: toMs(at) });
  }
  const n = Array.isArray(body.queue) ? body.queue.length : 0;
  return card({
    figure: String(n), figureLabel: n === 1 ? 'picture to review' : 'pictures to review',
    text: n ? 'Crest queue · console not installed yet' : 'Nothing to review · console not installed yet',
    updatedAt: toMs(at),
  });
}

export function crestHeroBit(body) {
  const n = body && Array.isArray(body.queue) ? body.queue.length : 0;
  return n ? `${n} to review` : null;
}

/**
 * Security when the overview couldn't be read. `res` is fetchPanel's
 * answer ({ state, error?, hint? }) or null for a thrown fetch.
 */
export function securityFailedCard(res, at = null) {
  const s = res && res.state;
  if (s === 'not_configured') {
    return card({ text: 'Console not configured yet', updatedAt: toMs(at) });
  }
  const error = s === 'forbidden' ? 'Owner only — sign in again'
    : s === 'unavailable' ? (res.hint || 'The console is unavailable')
      : 'Couldn’t reach the console';
  return card({ text: 'Status unknown', state: 'unknown', error, updatedAt: toMs(at) });
}

// ── Books ─────────────────────────────────────────────────────────

/**
 * Pence → a card-sized pounds figure: '£1,240' from £1,000 up (whole
 * pounds — the card is a glance, the tab has the pence), '£86.40' under.
 * Always unsigned; the caption says profit or loss.
 */
export function cardPounds(pence) {
  const p = Math.abs(Math.round(num(pence) ?? 0));
  if (p >= 100000) return `£${Math.round(p / 100).toLocaleString('en-GB')}`;
  return `£${Math.floor(p / 100).toLocaleString('en-GB')}.${String(p % 100).padStart(2, '0')}`;
}

/**
 * @param res     readPanel's answer for `?view=overview` ({ state, error?, hint? })
 * @param months  summarise(...).byMonth for this month and the two before
 *                ([{ month:'YYYY-MM', income, expense }], any order, gaps allowed)
 * @param today   local 'YYYY-MM-DD'
 * @param at      when the answer arrived (ms)
 */
export function booksCard({ res, months = [], today, at = null }) {
  const s = res && res.state;
  if (!s) return loadingCard();
  if (s === 'not-installed') return card({ figure: 'Set up', text: 'Revenue, costs and profit · not installed yet', updatedAt: toMs(at) });
  if (s === 'not_configured') return card({ figure: 'Set up', text: 'Run supabase/books_2026_10.sql to start', updatedAt: toMs(at) });
  if (s !== 'ok') {
    const error = s === 'forbidden' ? 'Owner only — sign in again'
      : s === 'unavailable' ? (res.hint || 'Books is unavailable') : 'Couldn’t load the books';
    return card({ text: 'Profit unknown', state: 'unknown', error, updatedAt: toMs(at) });
  }
  const ym = String(today || '').slice(0, 7);
  const by = Object.fromEntries((months || []).filter(Boolean).map(r => [r.month, r]));
  const read = m => ({ income: Math.max(0, num(by[m] && by[m].income) ?? 0), expense: Math.max(0, num(by[m] && by[m].expense) ?? 0) });
  const cur = read(ym);
  const profit = cur.income - cur.expense;
  const [y, mo] = ym.split('-').map(Number);
  const back = n => { const t = y * 12 + (mo - 1) - n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  const losing = [ym, back(1), back(2)].every(m => { const r = read(m); return r.expense > r.income; });
  if (!cur.income && !cur.expense) {
    return card({
      figure: '£0', figureLabel: 'this month', text: 'Nothing booked yet this month',
      state: losing ? 'attention' : 'neutral', updatedAt: toMs(at),
    });
  }
  return card({
    figure: cardPounds(profit),
    figureLabel: profit >= 0 ? 'profit this month' : 'loss this month',
    text: `${cardPounds(cur.income)} in · ${cardPounds(cur.expense)} out this month${losing ? ' · 3rd month of costs over income' : ''}`,
    state: profit > 0 ? 'ok' : losing ? 'attention' : 'neutral',
    updatedAt: toMs(at),
  });
}

// ── Hero ──────────────────────────────────────────────────────────

/** "Fri 2 Oct · Off · Rest · 1 ticket open" */
export function heroSub({ date = new Date(), rotation = null, security = null } = {}) {
  return [dayLabel(date), rotation, security].filter(Boolean).join(' · ');
}
