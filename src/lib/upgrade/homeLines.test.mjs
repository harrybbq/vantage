/**
 * Upgrade home menu shaping: per-card state, worst-state ordering, the
 * figure / label / text each card shows, and the two time helpers.
 * Invented data only — this file is public. Run: npm run check:homelines
 *
 * Time-zone stable: times are built with the local Date constructor and
 * read back in local time, so the assertions hold in any TZ.
 */
import assert from 'node:assert/strict';
import {
  STATES, stateRank, worstState, card, loadingCard, ago, exactTime, dayLabel, localIso, daysUntil,
  shiftLabel, rotationLine, rotationCard, dietCard, DIET_LATE_HOUR, careerCard, EXAM_SOON_DAYS,
  overviewState, securityCard, securityHeroBit, crestFallbackCard, crestHeroBit, securityFailedCard, heroSub,
} from './homeLines.js';
import { briefFor } from '../career/brief.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const KEYS = ['loading', 'figure', 'figureLabel', 'text', 'state', 'updatedAt', 'error', 'retry'];
const shape = c => assert.deepEqual(Object.keys(c).sort(), [...KEYS].sort(), 'every card has every field');
/** unknown always explains itself; no other state carries an error */
const honest = c => {
  shape(c);
  if (c.state === 'unknown') assert.ok(c.error, 'unknown carries an error'); else assert.equal(c.error, null);
  assert.equal(c.retry, null, 'shapers never attach retry — the hook does');
};

const at = (y, mo, d, h = 12, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const NOW = at(2026, 10, 2, 14, 26);

// ── States ──
t('state order: critical > attention > unknown > ok > neutral', () => {
  assert.deepEqual(STATES, ['critical', 'attention', 'unknown', 'ok', 'neutral']);
  assert.ok(stateRank('critical') < stateRank('attention'));
  assert.ok(stateRank('attention') < stateRank('unknown'));
  assert.ok(stateRank('unknown') < stateRank('ok'));
  assert.ok(stateRank('ok') < stateRank('neutral'));
  assert.equal(stateRank('banana'), stateRank('neutral'));
});
t('worstState over states and over cards', () => {
  assert.equal(worstState([]), 'neutral');
  assert.equal(worstState(null), 'neutral');
  assert.equal(worstState(['neutral', 'ok']), 'ok');
  assert.equal(worstState(['ok', 'unknown', 'neutral']), 'unknown');
  assert.equal(worstState(['unknown', 'attention', 'ok']), 'attention');
  assert.equal(worstState(['attention', 'critical', 'unknown']), 'critical');
  assert.equal(worstState([card({ state: 'ok' }), card({ state: 'attention' }), loadingCard()]), 'attention');
  assert.equal(worstState([loadingCard(), loadingCard()]), 'neutral', 'loading cards do not colour the hero');
  assert.equal(worstState(['neutral', 'bogus']), 'neutral');
});
t('card() fills defaults; loadingCard is loading and neutral', () => {
  shape(card());
  assert.deepEqual(loadingCard(), { loading: true, figure: null, figureLabel: null, text: null, state: 'neutral', updatedAt: null, error: null, retry: null });
});

// ── Time ──
t('ago: now / minutes / hours / days, floored', () => {
  assert.equal(ago(NOW, NOW), 'now');
  assert.equal(ago(NOW - 59e3, NOW), 'now');
  assert.equal(ago(NOW + 30e3, NOW), 'now', 'clock skew reads as now');
  assert.equal(ago(NOW - 60e3, NOW), '1 m');
  assert.equal(ago(NOW - 2 * 60e3 - 5e3, NOW), '2 m');
  assert.equal(ago(NOW - 59 * 60e3 - 59e3, NOW), '59 m');
  assert.equal(ago(NOW - 3600e3, NOW), '1 h');
  assert.equal(ago(NOW - 23.9 * 3600e3, NOW), '23 h');
  assert.equal(ago(NOW - 3 * 86400e3, NOW), '3 d');
  assert.equal(ago(NOW - 45 * 86400e3, NOW), '45 d');
  assert.equal(ago(new Date(NOW - 7200e3).toISOString(), NOW), '2 h', 'ISO strings too');
  assert.equal(ago(null, NOW), null);
  assert.equal(ago('nonsense', NOW), null);
});
t('exactTime: "Fri 2 Oct, 14:26" in local time', () => {
  assert.equal(exactTime(NOW), 'Fri 2 Oct, 14:26');
  assert.equal(exactTime(at(2026, 1, 5, 9, 3)), 'Mon 5 Jan, 09:03');
  assert.equal(exactTime(at(2026, 12, 31, 0, 0)), 'Thu 31 Dec, 00:00');
  assert.equal(exactTime(new Date(NOW).toISOString()), 'Fri 2 Oct, 14:26');
  assert.equal(exactTime(null), null);
  assert.equal(exactTime(''), null);
});
t('dayLabel, localIso, daysUntil', () => {
  assert.equal(dayLabel(new Date(NOW)), 'Fri 2 Oct');
  assert.equal(localIso(new Date(NOW)), '2026-10-02');
  assert.equal(localIso(new Date(at(2026, 3, 9, 0, 5))), '2026-03-09');
  assert.equal(daysUntil('2026-12-31', '2026-10-02'), 90);
  assert.equal(daysUntil('2026-10-02', '2026-10-02'), 0);
  assert.equal(daysUntil('2026-03-30', '2026-03-28'), 2, 'across the clocks going forward');
});

// ── Rotation ──
// Anchor 15 Jul 2026 = Night 1. 2 Oct = cycle position 15 (Off, Rest).
t('shiftLabel', () => {
  assert.equal(shiftLabel({ inPattern: true, shift: 'night', shiftNum: 2 }), 'Night 2');
  assert.equal(shiftLabel({ inPattern: true, shift: 'day', shiftNum: 1 }), 'Day 1');
  assert.equal(shiftLabel({ inPattern: true, shift: 'leave', shiftNum: null }), 'Leave');
  assert.equal(shiftLabel({ inPattern: true, shift: 'off', shiftNum: null }), 'Off');
  assert.equal(shiftLabel({ inPattern: false }), null);
  assert.equal(shiftLabel(null), null);
});
t('rotationLine keeps its old strings', () => {
  assert.equal(rotationLine({}, '2026-10-02'), 'Off · Rest');
  assert.equal(rotationLine({}, '2026-09-18'), 'Night 2 · Pull');
  assert.equal(rotationLine({}, '2026-09-25'), 'Day 1 · Push');
  assert.equal(rotationLine({}, '2026-07-01'), 'Before the rotation starts');
  assert.equal(rotationLine({ rotation: { overrides: { '2026-09-18': { leave: 'annual' } } } }, '2026-09-18'), 'Leave · Pull');
});
t('rotationCard: Night 2 · Pull, always neutral, derived (updatedAt null)', () => {
  const c = rotationCard({}, '2026-09-18');
  honest(c);
  assert.equal(c.figure, 'Night 2');
  assert.equal(c.figureLabel, 'today');
  assert.equal(c.text, 'Pull · tomorrow Night 3');
  assert.equal(c.state, 'neutral');
  assert.equal(c.updatedAt, null);
  assert.equal(c.loading, false);
});
t('rotationCard: Off, Day 1, Leave, last night shift, month end, before the pattern', () => {
  assert.deepEqual([rotationCard({}, '2026-10-02').figure, rotationCard({}, '2026-10-02').text], ['Off', 'Rest · tomorrow Night 1']);
  assert.equal(rotationCard({}, '2026-09-25').figure, 'Day 1');
  assert.equal(rotationCard({}, '2026-09-20').text, 'Upper · tomorrow Off');
  assert.equal(rotationCard({}, '2026-09-30').text, 'Rest · tomorrow Off', 'September → October');
  const leave = rotationCard({ rotation: { overrides: { '2026-09-25': { leave: 'annual' }, '2026-09-26': { leave: 'annual' } } } }, '2026-09-25');
  assert.equal(leave.figure, 'Leave');
  assert.equal(leave.text, 'Push · tomorrow Leave');
  const early = rotationCard({}, '2026-07-01');
  honest(early);
  assert.equal(early.figure, null);
  assert.equal(early.text, 'Before the rotation starts');
  assert.equal(early.state, 'neutral');
});

// ── Diet ──
const FETCHED = NOW - 2 * 60e3;
const day = (protein, extra = {}) => ({ loaded: true, summary: protein == null ? null : { protein_g: protein, calories: 2100 }, error: null, at: FETCHED, ...extra });
t('diet: target hit → ok, figure is what was eaten', () => {
  const c = dietCard({ target: 182, day: day(186.6), hour: 14 });
  honest(c);
  assert.deepEqual([c.figure, c.figureLabel, c.text, c.state, c.updatedAt], ['187 g', 'protein today', 'Target of 182 g hit', 'ok', FETCHED]);
  assert.equal(dietCard({ target: 182, day: day(182), hour: 9 }).state, 'ok', 'exactly on target counts');
});
t('diet: 40 g to go → neutral before 18:00 and while over half', () => {
  const c = dietCard({ target: 182, day: day(142), hour: 14 });
  honest(c);
  assert.deepEqual([c.figure, c.figureLabel, c.text, c.state], ['40 g to go', 'protein', '142 of 182 g so far today', 'neutral']);
  assert.equal(dietCard({ target: 182, day: day(142), hour: 21 }).state, 'neutral', 'over half late on is fine');
});
t('diet: under half at or after 18:00 → attention', () => {
  assert.equal(DIET_LATE_HOUR, 18);
  assert.equal(dietCard({ target: 182, day: day(80), hour: 17 }).state, 'neutral');
  const c = dietCard({ target: 182, day: day(80), hour: 18 });
  assert.deepEqual([c.figure, c.state], ['102 g to go', 'attention']);
  assert.equal(dietCard({ target: 182, day: day(91), hour: 20 }).state, 'neutral', 'exactly half is not under half');
});
t('diet: no row today = nothing logged (0 g), not unknown', () => {
  const c = dietCard({ target: 182, day: day(null), hour: 10 });
  honest(c);
  assert.deepEqual([c.figure, c.text, c.state], ['182 g to go', 'Nothing logged yet · target 182 g', 'neutral']);
  assert.equal(dietCard({ target: 182, day: day(null), hour: 19 }).state, 'attention');
});
t('diet: loading until the summary answers', () => {
  assert.equal(dietCard({ target: 182, day: { loaded: false, summary: null }, hour: 10 }).loading, true);
  assert.equal(dietCard({ target: 182, day: null, hour: 10 }).loading, true);
});
t('diet: fetch failed → unknown with an error, target still shown', () => {
  const c = dietCard({ target: 182, day: day(null, { error: 'relation does not exist' }), hour: 10 });
  honest(c);
  assert.deepEqual([c.state, c.error, c.figure, c.figureLabel], ['unknown', 'Couldn’t load today’s food log', '182 g', 'protein target']);
  assert.ok(!c.text.includes('relation'), 'raw database messages stay out of the card');
  assert.equal(c.updatedAt, FETCHED);
});
t('diet: junk protein reads as 0; missing at → updatedAt null', () => {
  assert.equal(dietCard({ target: 182, day: day('n/a'), hour: 10 }).figure, '182 g to go');
  assert.equal(dietCard({ target: 182, day: { loaded: true, summary: null }, hour: 10 }).updatedAt, null);
});

// ── Career ──
const store = (state, extra = {}) => ({ state, at: FETCHED, message: '', ...extra });
const TODAY = '2026-10-02';
const apps = [
  { id: 'a1', company: 'Northwind', role: 'SOC Analyst', stage: 'applied', next: { text: 'Chase recruiter', due: '2026-09-29' }, events: [] },
  { id: 'a2', company: 'Fabrikam', role: 'Security Engineer', stage: 'screen', next: { text: 'Prep screen call', due: '2026-10-05' }, events: [] },
];
const cal = [{ iso: '2026-10-03', hours: 2 }, { iso: '2026-10-04', hours: 2 }];
t('brief marks only an overdue pipeline step as overdue', () => {
  const { actions } = briefFor({ apps, today: TODAY }, null);
  assert.equal(actions[0].title, 'Chase recruiter — Northwind');
  assert.equal(actions[0].overdue, true);
  assert.equal(actions[1].overdue, false);
});
t('career: exam in 90 d, on pace, nothing overdue → neutral', () => {
  const exam = { name: 'Security+', days: daysUntil('2026-12-31', TODAY), behind: false };
  const actions = [{ title: 'Security+: 4 h over 2 sessions', done: false }];
  const c = careerCard({ store: store('ready'), actions, exam });
  honest(c);
  assert.deepEqual([c.figure, c.figureLabel, c.text, c.state, c.updatedAt],
    ['90 d', 'to exam', 'Security+ exam · Next: Security+: 4 h over 2 sessions', 'neutral', FETCHED]);
});
t('career: an overdue brief action → attention and leads the text', () => {
  const { actions } = briefFor({ apps, today: TODAY }, null);
  const c = careerCard({ store: store('ready'), actions, exam: null });
  honest(c);
  assert.deepEqual([c.figure, c.figureLabel, c.state], ['2', 'actions this week', 'attention']);
  assert.equal(c.text, 'Overdue: Chase recruiter — Northwind');
});
t('career: a ticked overdue action no longer counts', () => {
  const { actions } = briefFor({ apps, today: TODAY }, { weeks: { '2026-W40': { done: ['app:a1:2026-09-29'] } } });
  const c = careerCard({ store: store('ready'), actions, exam: null });
  assert.deepEqual([c.figure, c.figureLabel, c.state, c.text], ['1', 'action this week', 'neutral', 'Next: Prep screen call — Fabrikam']);
});
t('career: exam ≤ 14 d and pacing late → attention; > 14 d late → neutral but says so', () => {
  assert.equal(EXAM_SOON_DAYS, 14);
  const late = { pacing: { cert: { id: 'c', name: 'Security+' }, plan: { status: 'late', cal, readyIso: null }, examIso: '2026-10-14' }, today: TODAY };
  const { actions } = briefFor(late, null);
  const soon = careerCard({ store: store('ready'), actions, exam: { name: 'Security+', days: 12, behind: true } });
  assert.deepEqual([soon.figure, soon.state], ['12 d', 'attention']);
  assert.equal(soon.text, 'Security+ exam · behind pace · Next: Add study hours for Security+');
  assert.equal(careerCard({ store: store('ready'), actions, exam: { name: 'Security+', days: 14, behind: true } }).state, 'attention');
  const far = careerCard({ store: store('ready'), actions, exam: { name: 'Security+', days: 15, behind: true } });
  assert.equal(far.state, 'neutral');
  assert.ok(far.text.includes('behind pace'));
  assert.equal(careerCard({ store: store('ready'), actions: [], exam: { name: 'Security+', days: 5, behind: false } }).state, 'neutral', 'close but on pace');
});
t('career: exam day and past exam read 0 d', () => {
  assert.equal(careerCard({ store: store('ready'), exam: { name: 'X', days: 0, behind: false } }).figure, '0 d');
  assert.equal(careerCard({ store: store('ready'), exam: { name: 'X', days: -3, behind: false } }).figure, '0 d');
});
t('career: nothing to do', () => {
  const c = careerCard({ store: store('ready'), actions: [], exam: null });
  assert.deepEqual([c.figure, c.figureLabel, c.text, c.state], ['Clear', 'this week', 'Nothing pressing this week', 'neutral']);
});
t('career: loading, setup (neutral), failed (unknown + error)', () => {
  assert.equal(careerCard({ store: store('loading') }).loading, true);
  assert.equal(careerCard({ store: null }).loading, true);
  const setup = careerCard({ store: store('setup') });
  honest(setup);
  assert.deepEqual([setup.state, setup.text], ['neutral', 'Plan, money, certs and the pipeline']);
  const err = careerCard({ store: store('error', { message: 'Offline — couldn’t reach the server.' }) });
  honest(err);
  assert.deepEqual([err.state, err.error, err.figure], ['unknown', 'Couldn’t load the career plan', null]);
});

// ── Security ──
const GEN = '2026-10-02T13:20:00.000Z';
const ov = (o = {}) => ({
  ok: true, verdict: 'operational', issues: [], generatedAt: GEN,
  status: { db: 'ok', netlify: 'ok', app: 'ok' },
  counts: { openTickets: 0, criticalTickets: 0, openReports: 0, suspended: 0, errors24h: 4, advisorsError: 0 },
  ...o,
});
const counts = c => ({ openTickets: 0, criticalTickets: 0, openReports: 0, advisorsError: 0, ...c });
t('security: all clear → ok, updatedAt = generatedAt', () => {
  const c = securityCard(ov(), NOW);
  honest(c);
  assert.deepEqual([c.figure, c.figureLabel, c.text, c.state, c.updatedAt], ['0 open', 'tickets', 'All systems ok', 'ok', Date.parse(GEN)]);
  assert.equal(securityHeroBit(ov()), null);
});
t('security: 1 ticket open → attention', () => {
  const o = ov({ counts: counts({ openTickets: 1 }) });
  const c = securityCard(o, NOW);
  assert.deepEqual([c.figure, c.figureLabel, c.text, c.state], ['1 open', 'ticket', 'All systems ok', 'attention']);
  assert.equal(securityHeroBit(o), '1 ticket open');
  assert.equal(heroSub({ date: new Date(NOW), rotation: 'Off · Rest', security: securityHeroBit(o) }), 'Fri 2 Oct · Off · Rest · 1 ticket open');
});
t('security: 3 critical tickets → critical', () => {
  const o = ov({ verdict: 'degraded', status: { db: 'ok', netlify: 'ok', app: 'degraded' }, counts: counts({ openTickets: 5, criticalTickets: 3, openReports: 2 }) });
  const c = securityCard(o, NOW);
  honest(c);
  assert.deepEqual([c.figure, c.figureLabel, c.state], ['3 critical', 'tickets', 'critical']);
  assert.equal(c.text, 'App degraded · 5 open in all · 2 reports to review');
  assert.equal(securityHeroBit(o), '3 critical');
});
t('security: verdict down / a system down → critical', () => {
  assert.equal(overviewState(ov({ verdict: 'down' })), 'critical');
  const o = ov({ verdict: undefined, status: { db: 'down', netlify: 'ok', app: 'down' }, counts: counts({ openTickets: null, criticalTickets: null }) });
  const c = securityCard(o, NOW);
  assert.deepEqual([c.state, c.figure, c.text], ['critical', null, 'Database down · App down']);
  assert.equal(securityHeroBit(o), 'Database down');
});
t('security: attention from degraded, reports or advisor errors alone', () => {
  assert.equal(overviewState(ov({ verdict: 'degraded' })), 'attention');
  assert.equal(overviewState(ov({ verdict: undefined, status: { db: 'ok', netlify: 'degraded', app: 'ok' } })), 'attention');
  const r = securityCard(ov({ counts: counts({ openTickets: null, openReports: 2 }) }), NOW);
  assert.deepEqual([r.state, r.figure, r.figureLabel, r.text], ['attention', '2 open', 'reports', 'All systems ok']);
  const a = securityCard(ov({ counts: counts({ advisorsError: 1 }) }), NOW);
  assert.deepEqual([a.state, a.text], ['attention', 'All systems ok · 1 advisor error']);
});
t('security: not-configured systems are left out; nothing judged → unknown with error', () => {
  const partial = securityCard(ov({ verdict: undefined, status: { db: 'ok', netlify: 'not_configured', app: 'ok' } }), NOW);
  assert.deepEqual([partial.state, partial.text], ['ok', 'All systems ok']);
  const blank = securityCard({ ok: true }, NOW);
  honest(blank);
  assert.deepEqual([blank.state, blank.error, blank.updatedAt], ['unknown', 'The console sent no status', NOW], 'no generatedAt → arrival time');
});
t('security: fetch failed → unknown + error; forbidden and unavailable say why', () => {
  const failed = securityFailedCard({ state: 'error', error: "Couldn't reach the server." }, NOW);
  honest(failed);
  assert.deepEqual([failed.state, failed.error, failed.text, failed.updatedAt], ['unknown', 'Couldn’t reach the console', 'Status unknown', NOW]);
  assert.equal(securityFailedCard(null, NOW).error, 'Couldn’t reach the console', 'a thrown fetch');
  assert.equal(securityFailedCard({ state: 'forbidden' }).error, 'Owner only — sign in again');
  assert.equal(securityFailedCard({ state: 'unavailable', hint: 'Service key missing.' }).error, 'Service key missing.');
  const nc = securityFailedCard({ state: 'not_configured', hint: 'x' });
  honest(nc);
  assert.equal(nc.state, 'neutral');
});
t('security: console not installed → crest queue stands in, neutral', () => {
  const none = crestFallbackCard({ setup: false }, NOW);
  honest(none);
  assert.deepEqual([none.state, none.figure, none.text], ['neutral', null, 'Console not installed yet']);
  const two = crestFallbackCard({ queue: [{ id: 'g1' }, { id: 'g2' }] }, NOW);
  assert.deepEqual([two.state, two.figure, two.figureLabel, two.text, two.updatedAt], ['neutral', '2', 'pictures to review', 'Crest queue · console not installed yet', NOW]);
  const zero = crestFallbackCard({ queue: [] }, NOW);
  assert.deepEqual([zero.figure, zero.figureLabel, zero.text], ['0', 'pictures to review', 'Nothing to review · console not installed yet']);
  assert.equal(crestFallbackCard({ queue: [{ id: 'g1' }] }).figureLabel, 'picture to review');
  assert.equal(crestHeroBit({ queue: [{ id: 'g1' }, { id: 'g2' }] }), '2 to review');
  assert.equal(crestHeroBit({ queue: [] }), null);
  assert.equal(crestHeroBit(null), null);
});

// ── Hero ──
t('heroSub drops what is missing', () => {
  assert.equal(heroSub({ date: new Date(NOW), rotation: 'Night 2 · Pull' }), 'Fri 2 Oct · Night 2 · Pull');
  assert.equal(heroSub({ date: new Date(NOW) }), 'Fri 2 Oct');
});
t('hero state is the worst card: a failed console outranks a hit target', () => {
  const cards = [
    dietCard({ target: 182, day: day(190), hour: 14 }),
    rotationCard({}, '2026-09-18'),
    careerCard({ store: store('ready'), actions: [], exam: null }),
    securityFailedCard(null, NOW),
  ];
  assert.equal(worstState(cards), 'unknown');
  cards[2] = careerCard({ store: store('ready'), actions: briefFor({ apps, today: TODAY }, null).actions });
  assert.equal(worstState(cards), 'attention');
  cards[3] = securityCard(ov({ counts: counts({ criticalTickets: 1, openTickets: 1 }) }), NOW);
  assert.equal(worstState(cards), 'critical');
});

console.log(`homeLines: ${n} tests passed`);
