/** Pacing, pipeline and brief. Invented data only — this file is public. */
import assert from 'node:assert/strict';
import { studyDays, planStudy, hoursFor, examIsoOf, pacedCert, daysBetween } from './pacing.js';
import { STAGES, move, close, dueIn, ageDays, needsYou, commuteOf, salaryOf, checks, isOpen } from './pipeline.js';
import { weekOf, candidates, briefFor, toggleDone, lastWeek } from './brief.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };

/* pacing */
const mk = shifts => shifts.split('').map((s, i) => ({ iso: `2026-10-${String(i + 1).padStart(2, '0')}`, dow: i % 7, holiday: false,
  shift: { O: 'off', D: 'day', N: 'night', L: 'leave' }[s] }));
t('hoursFor: off and leave get perOff, day gets afterDay, night none, holiday none', () => {
  assert.equal(hoursFor({ shift: 'off' }, { perOff: 2 }), 2);
  assert.equal(hoursFor({ shift: 'leave' }, { perOff: 2 }), 2);
  assert.equal(hoursFor({ shift: 'day' }, { afterDay: 0.75 }), 0.75);
  assert.equal(hoursFor({ shift: 'night' }, { perOff: 2 }), 0);
  assert.equal(hoursFor({ shift: 'off', holiday: true }, { perOff: 2 }), 0);
});
t('planStudy fills off days until covered and names the ready day', () => {
  const p = planStudy(mk('DDOOOONNOO'), { remaining: 7, perOff: 2, examIso: '2026-10-10' });
  assert.deepEqual(p.cal.map(d => d.hours), [0, 0, 2, 2, 2, 1, 0, 0, 0, 0]);
  assert.equal(p.readyIso, '2026-10-06');
  assert.equal(p.sessions, 4);
  assert.equal(p.status, 'ok');
  assert.equal(p.spare, 4);
});
t('planStudy: after-day-shift hours bring it forward', () => {
  const p = planStudy(mk('DDOOOONNOO'), { remaining: 7, perOff: 2, afterDay: 1, examIso: '2026-10-10' });
  assert.equal(p.readyIso, '2026-10-05');
});
t('planStudy: nothing on or after the exam day, late if not covered', () => {
  const p = planStudy(mk('DDOOOONNOO'), { remaining: 20, perOff: 2, examIso: '2026-10-06' });
  assert.equal(p.status, 'late');
  assert.equal(p.readyIso, null);
  assert.equal(p.cal[5].hours, 0);
  assert.equal(p.cal[5].exam, true);
});
t('planStudy: tight when ready within 3 days of the exam; done when nothing is left', () => {
  assert.equal(planStudy(mk('DDOOOONNOO'), { remaining: 8, perOff: 2, examIso: '2026-10-08' }).status, 'tight');
  assert.equal(planStudy(mk('DDOO'), { remaining: 0, examIso: '2026-10-04' }).status, 'done');
  assert.equal(planStudy(mk('DDOO'), { remaining: 2 }).status, 'no-exam');
});
t('studyDays reads the real rotation and marks holidays', () => {
  const d = studyDays('2026-09-26', 16, { holidayDays: new Set(['2026-09-27']) });
  assert.equal(d.length, 16);
  assert.ok(d.every(x => ['day', 'night', 'off', 'leave', 'unknown'].includes(x.shift)));
  assert.equal(d[1].holiday, true);
  assert.ok(d.some(x => x.shift === 'off') && d.some(x => x.shift === 'night'));
});
t('examIsoOf: booked date, else the end of the target window', () => {
  assert.equal(examIsoOf({ examDate: '2026-12-04', target: '2026-12' }), '2026-12-04');
  assert.equal(examIsoOf({ target: '2027-04', targetEnd: '2027-05' }), '2027-05-31');
  assert.equal(examIsoOf({ target: '2027-02' }), '2027-02-28');
  assert.equal(examIsoOf({}), null);
});
t('pacedCert: studying/booked with hours, soonest first', () => {
  const c = pacedCert([
    { id: 'a', status: 'studying', studyHours: 50, target: '2027-05' },
    { id: 'b', status: 'booked', studyHours: 80, examDate: '2026-12-10' },
    { id: 'c', status: 'planned', studyHours: 10, target: '2026-11' },
    { id: 'd', status: 'studying', target: '2026-11' },
  ]);
  assert.equal(c.id, 'b');
});
t('daysBetween', () => assert.equal(daysBetween('2026-10-01', '2026-10-11'), 10));

/* pipeline */
const apps = [
  { id: 'x', company: 'Alpha', role: 'SOC', stage: 'applied', next: { text: 'Chase', due: '2026-10-01' }, events: [{ at: '2026-09-20', stage: 'applied' }] },
  { id: 'y', companyId: 'beta', role: 'Eng', stage: 'screen', next: { text: 'Prep', due: '2026-10-06' }, events: [] },
  { id: 'z', company: 'Gamma', role: 'Analyst', stage: 'watching', events: [] },
  { id: 'w', company: 'Delta', role: 'Analyst', stage: 'interview', closed: { reason: 'Rejected', at: '2026-09-30' }, next: { due: '2026-10-02' } },
];
const TODAY = '2026-10-03';
t('move steps stages and logs the event; clamps at the ends', () => {
  const a = move(apps, 'x', 1, TODAY).find(q => q.id === 'x');
  assert.equal(a.stage, 'screen');
  assert.equal(a.events.at(-1).at, TODAY);
  assert.equal(move(apps, 'z', -1, TODAY).find(q => q.id === 'z').stage, 'watching');
  assert.equal(STAGES.at(-1), 'offer');
});
t('close and reopen', () => {
  const c = close(apps, 'x', 'Withdrew', TODAY).find(q => q.id === 'x');
  assert.equal(c.closed.reason, 'Withdrew');
  assert.equal(isOpen(c), false);
  assert.equal(isOpen(close([c], 'x', null, TODAY)[0]), true);
});
t('dueIn, ageDays and needsYou (open, not watching, due within a week)', () => {
  assert.equal(dueIn(apps[0], TODAY), -2);
  assert.equal(ageDays(apps[0], TODAY), 13);
  assert.deepEqual(needsYou(apps, TODAY).map(a => a.id), ['x', 'y']);
});
t('commute and salary fall back to the company', () => {
  const co = { commute: { a: '20–25', b: '15–20', c: '—' }, salary: { low: 40000, high: 50000 }, clearance: 'SC commonly required' };
  assert.equal(commuteOf({}, co), 15);
  assert.equal(commuteOf({ commuteMin: 40 }, co), 40);
  assert.deepEqual(salaryOf({}, co), { low: 40000, high: 50000, own: false });
  assert.deepEqual(salaryOf({ salary: 45000 }, co), { low: 45000, high: 45000, own: true });
  const ck = checks({}, co, { floor: 42000, target: 48500 });
  assert.deepEqual(ck.map(c => [c.key, c.ok]), [['salary', true], ['commute', true], ['clearance', null]]);
  assert.equal(checks({ salary: 35000, commuteMin: 45 }, {}, { floor: 42000 })[0].ok, false);
  assert.equal(checks({}, {}, { floor: 42000 })[0].ok, null);
});

/* brief */
t('weekOf: ISO weeks, including across a year end', () => {
  assert.deepEqual(weekOf('2026-10-03'), { key: '2026-W40', monIso: '2026-09-28', sunIso: '2026-10-04' });
  assert.equal(weekOf('2027-01-01').key, '2026-W53');
  assert.equal(weekOf('2026-01-01').key, '2026-W01');
});
t('candidates rank overdue steps first, then decisions, pace, plan, money', () => {
  const plan = { items: [
    { id: 'd1', stream: 'HOUSE', start: '2026-10', decision: true, title: 'Decide' },
    { id: 'p1', stream: 'MONEY', start: '2026-10', title: 'Monthly thing' },
    { id: 'p2', stream: 'MONEY', start: '2026-10', title: 'Already done' },
    { id: 'old', stream: 'JOB', start: '2026-08', title: 'Past' },
  ] };
  const c = candidates({
    apps, companies: [{ id: 'beta', name: 'Beta' }], plan, statusMap: { p2: { status: 'done' } },
    vs: { month: '2026-09', diff: -300, actual: 10000, planned: 10300 },
    certs: [{ id: 'k', name: 'Cert K', status: 'planned', target: '2026-11' }], today: TODAY,
  });
  assert.deepEqual(c.map(x => x.id), ['app:x:2026-10-01', 'plan:d1', 'app:y:2026-10-06', 'book:k', 'money:2026-09', 'plan:p1']);
  assert.ok(c[0].why.includes('overdue by 2 days'));
  assert.ok(c[2].title.endsWith('Beta'));
});
t('pacing candidates: late beats a normal study week', () => {
  const cal = [{ iso: '2026-10-03', hours: 2 }, { iso: '2026-10-04', hours: 2 }];
  const late = candidates({ pacing: { cert: { id: 'c', name: 'Cert' }, plan: { status: 'late', cal, readyIso: null }, examIso: '2026-10-20' }, today: TODAY });
  assert.equal(late[0].id, 'pace:c:late:2026-W40');
  const ok = candidates({ pacing: { cert: { id: 'c', name: 'Cert · Long' }, plan: { status: 'ok', cal, readyIso: '2026-10-10' }, examIso: '2026-10-20' }, today: TODAY });
  assert.equal(ok[0].title, 'Cert: 4 h over 2 sessions');
});
t('briefFor, toggleDone and lastWeek', () => {
  const input = { apps, today: TODAY };
  let brief = toggleDone({}, '2026-W40', 'app:x:2026-10-01', 2);
  const b = briefFor(input, brief);
  assert.equal(b.actions.length, 2);
  assert.equal(b.actions[0].done, true);
  brief = toggleDone(brief, '2026-W40', 'app:x:2026-10-01', 2);
  assert.equal(briefFor(input, brief).actions[0].done, false);
  assert.deepEqual(lastWeek({ weeks: { '2026-W40': { done: ['a', 'b'], total: 3 } } }, '2026-10-07'), { done: 2, total: 3 });
  assert.equal(lastWeek({}, '2026-10-07'), null);
});

console.log(`career next: ${n} passed`);
