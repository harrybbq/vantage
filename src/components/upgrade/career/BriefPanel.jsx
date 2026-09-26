/**
 * Career → Brief: three things that move the plan this week, laid over
 * the rotation. Opens first.
 *
 * Reads what exists (lib/career/brief ranks it); stores only which of
 * this week's actions are ticked (`career.brief`). Each action links to
 * the panel it came from.
 */
import { useMemo } from 'react';
import { KEYS } from '../../../lib/career/schema';
import { briefFor, toggleDone, lastWeek } from '../../../lib/career/brief';
import { isOpen } from '../../../lib/career/pipeline';
import { readiness, monthLabel, monthDiff, monthOf } from '../../../lib/career/money';
import { statusOf } from '../../../lib/career/planTimeline';
import { studyDays } from '../../../lib/career/pacing';
import { holidayDaySet } from '../../../lib/rotation/pattern';
import { usePacing, useLatestVs, todayIso } from './careerData';

const TAG_COL = { PIPELINE: '#d0498f', CERTS: '#5b8cff', PLAN: '#d99114', MONEY: '#1a7a4a' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHIFT = { day: 'D', night: 'N', off: '·', leave: 'L', unknown: '?' };
const gbp = n => '£' + Math.abs(Math.round(n)).toLocaleString('en-GB');
const shortDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export default function BriefPanel({ oc, S, scenarioId, goTo }) {
  const d = oc.data;
  const today = todayIso();
  const apps = useMemo(() => d[KEYS.applications] || [], [d]);
  const certs = useMemo(() => d[KEYS.certs] || [], [d]);
  const plan = d[KEYS.plan] || null;
  const money = d[KEYS.money] || null;
  const statusMap = useMemo(() => d[KEYS.status] || {}, [d]);
  const brief = d[KEYS.brief] || null;
  const pacing = usePacing(S, certs);
  const vs = useLatestVs(S, oc);

  const { week, actions } = useMemo(() => briefFor({
    apps, companies: d[KEYS.companies] || [], plan, statusMap, vs, certs, today,
    pacing: pacing.cert ? { cert: pacing.cert, plan: pacing.plan, examIso: pacing.examIso } : null,
  }, brief), [apps, d, plan, statusMap, vs, certs, today, pacing, brief]);

  const days = useMemo(() => studyDays(week.monIso, 7, {
    overrides: (S.rotation && S.rotation.overrides) || {}, holidayDays: holidayDaySet((S.rotation && S.rotation.holidayBlocks) || []),
  }), [week.monIso, S.rotation]);

  // Clocks
  const nowMonth = monthOf();
  const scen = money && (money.scenarios || []).find(s => s.id === scenarioId) || (money && (money.scenarios || [])[0]);
  const r = scen ? readiness(money, scen) : null;
  const nextDecision = ((plan && plan.items) || [])
    .filter(it => it.decision && /^\d{4}-\d{2}$/.test(it.start) && monthDiff(nowMonth, it.end || it.start) >= 0 && statusOf(it, statusMap) !== 'done')
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const examDays = pacing.examIso ? Math.round((Date.parse(pacing.examIso + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000) : null;
  const clocks = [
    money && money.contractEnd && { k: 'Contract ends', col: '#c8970a', v: `${Math.max(0, monthDiff(nowMonth, money.contractEnd))} mo`, sub: monthLabel(money.contractEnd) },
    r && { k: `Keys ≈ (${scen.label})`, col: '#d99114', v: monthLabel(r.keys) || '—', sub: r.keysBonus && r.keysBonus !== r.keys ? `${monthLabel(r.keysBonus)} if the bonus lands` : 'bonus makes no difference' },
    pacing.cert && { k: `${pacing.cert.name.split(' ·')[0]} exam`, col: '#5b8cff', v: examDays != null ? `${examDays} d` : '—',
      sub: `${shortDate(pacing.examIso)} · ${{ ok: 'on pace', tight: 'tight', late: 'behind', done: 'ready', 'no-exam': '' }[pacing.plan.status]}` },
    nextDecision && { k: 'Next decision', col: '#d0498f', v: `◆ ${monthLabel(nextDecision.start)}`, sub: nextDecision.title },
  ].filter(Boolean);

  async function tick(a) {
    await oc.save(KEYS.brief, toggleDone(brief, week.key, a.id, actions.length));
  }

  const lw = lastWeek(brief, today);
  const studyThisWeek = pacing.cert ? pacing.plan.cal.filter(x => x.iso >= week.monIso && x.iso <= week.sunIso).reduce((s, x) => s + x.hours, 0) : 0;
  const dueByDay = iso => apps.filter(a => isOpen(a) && a.next && a.next.due === iso);
  const [, wm, wd] = week.monIso.split('-').map(Number);
  const [, sm, sd] = week.sunIso.split('-').map(Number);
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  return (
    <div className="cp">
      <header className="cp-sechead">
        <div>
          <span className="cp-eyebrow">// this week · {wd} {MON[wm - 1]} – {sd} {MON[sm - 1]}</span>
          <h3 className="cp-title">{actions.length ? `${['Nothing', 'One thing', 'Two things', 'Three things'][actions.length]} move${actions.length === 1 ? 's' : ''} the plan this week` : 'Nothing pressing this week'}</h3>
        </div>
      </header>

      {clocks.length > 0 && (
        <section className="cp-card cp-clocks">
          {clocks.map(c => (
            <div key={c.k} className="cp-clock">
              <span className="cp-eyebrow"><i style={{ background: c.col }} />{c.k}</span>
              <b>{c.v}</b>
              <span className="cp-clock-sub">{c.sub}</span>
            </div>
          ))}
        </section>
      )}

      <div className="cp-brief-grid">
        <section className="cp-card cp-do">
          <div className="cp-do-head"><span className="cp-eyebrow">// do these</span><span className="cp-muted">ranked by what slips</span></div>
          {!actions.length && <p className="cp-muted cp-do-empty">No overdue steps, decisions or study sessions this week. Add applications or set a cert to Studying and this fills itself.</p>}
          {actions.map((a, i) => (
            <div key={a.id} className={`cp-do-row${a.done ? ' is-done' : ''}`}>
              <span className="cp-do-n" style={{ '--c': TAG_COL[a.tag] }}>{String(i + 1).padStart(2, '0')}</span>
              <div className="cp-do-body">
                <span className="cp-do-t">
                  <button type="button" className="cp-do-link" onClick={() => goTo(a.panel)}>{a.title}</button>
                  <span className="cp-do-tag" style={{ '--c': TAG_COL[a.tag] }}>{a.tag}</span>
                </span>
                <span className="cp-do-why">{a.why}</span>
              </div>
              <button type="button" className={`cp-do-tick${a.done ? ' is-on' : ''}`} onClick={() => tick(a)}
                      aria-label={a.done ? `Mark "${a.title}" not done` : `Mark "${a.title}" done`} aria-pressed={a.done}>{a.done ? '✓' : ''}</button>
            </div>
          ))}
        </section>

        <section className="cp-card cp-week">
          <span className="cp-eyebrow">// the week against your rotation</span>
          <div className="cp-week-row">
            {days.map((x, i) => {
              const study = pacing.cert ? (pacing.plan.cal.find(c => c.iso === x.iso) || {}).hours || 0 : 0;
              const dues = dueByDay(x.iso);
              const exam = pacing.examIso === x.iso;
              const bits = [exam ? 'Exam' : '', study ? `Study ${study}h` : '', ...dues.map(a => `${(a.next.text || 'Next').split(' ')[0]} · ${(a.company || '').split(' ')[0]}`)].filter(Boolean);
              return (
                <div key={x.iso} className={`cp-week-day is-${x.shift}${x.iso === today ? ' is-today' : ''}${x.holiday ? ' is-holiday' : ''}`}>
                  <span className="cp-week-dow">{DOW[i]}</span>
                  <span className="cp-week-shift">{x.holiday ? '✈' : SHIFT[x.shift]}</span>
                  <span className="cp-week-plan">{bits.length ? bits.join(' + ') : x.shift === 'night' ? 'nights' : ''}</span>
                </div>
              );
            })}
          </div>
          <p className="cp-muted">Study sits on {pacing.settings ? [pacing.settings.days && 'day', pacing.settings.nights && 'night'].filter(Boolean).join(' and ') || 'no' : 'day and night'} shifts; days off stay free. Miss a session and the plan moves it to the next shift.</p>
          <div className="cp-week-stats">
            <div><span>Last week</span><b className={lw && lw.done >= lw.total ? 'is-ok' : ''}>{lw ? `${lw.done} / ${lw.total}` : '—'}</b></div>
            <div><span>Study this week</span><b>{studyThisWeek ? `${studyThisWeek} h` : '—'}</b></div>
            <div><span>vs plan</span><b className={vs ? (vs.diff >= 0 ? 'is-ok' : 'is-bad') : ''}>{vs ? `${vs.diff >= 0 ? '+' : '−'}${gbp(vs.diff)}` : '—'}</b></div>
          </div>
        </section>
      </div>
    </div>
  );
}

