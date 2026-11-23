/**
 * The track — the console Habits page (owner, Nov 2026; mockup A).
 *
 * Every habit is a lane, and they all run at once. A lane's face says
 * three things and no more: how long this run is, what it is working
 * toward, and the record that does not reset (lib/habits/record.js).
 * The action sits at the end of the lane: "I slipped" for a Quit habit
 * (one tap; the page offers Undo), the week's days for a Cut-down one.
 * Pressing a lane opens it in place: what is ahead (the user's
 * milestones, then the road past them, and the runner's six stages) and
 * the history, drawn as bars that can be read.
 *
 * What it replaces on this page: the roster + detail pair, the three
 * header figures, the race bar and the trail strip. The runner, his
 * stages, the ghost, the stumble, strikes, budgets, back-dating and
 * every rule behind them are exactly as they were; this file only draws.
 *
 * Each lane owns its habit's coin and milestone effects (useHabitAwards),
 * as each roster card did: one lane per habit, so they fire once.
 *
 * Writes go through the same updaters as before (applyRelapse via the
 * page, toggleUse here). Phones get the same lane, stacked.
 */
import { useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import HabitRunner, { STAGES, paramsForDays, stageForDays } from '../../../components/habits/HabitRunner';
import useHabitAwards from '../../../components/habits/useHabitAwards';
import { laneProps } from '../../../components/habits/HabitRoster';
import { habitView, etaLabel, shortSpan, resetsLabel, STAGE_WEEKS } from '../../../lib/habits/view';
import { recordOf, recordLabel } from '../../../lib/habits/record';
import { nextTarget, roadAhead } from '../../../lib/habits/road';
import { strikeState, replenishLabel } from '../../../lib/habits/strikes';
import { toggleUse, periodDays, periods, budgetOf, bestStreak, dryTotal } from '../../../lib/habits/cutdown';
import { runsOf } from '../../../lib/habits/progress';
import { Button } from '../ui';
import './habit-track.css';

const DAY = 86400000;
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const cx = (...a) => a.filter(Boolean).join(' ');

/** The run so far, for the face: "40d 0h", "5h 12m", "12m 04s". */
export function faceClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/** The console's screen scale (design/console/screen.css), so the runner grows with the page. */
function useUiScale() {
  const [ui, setUi] = useState(1);
  useEffect(() => {
    const read = () => setUi(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cx-ui')) || 1);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return ui;
}

function Record({ rec }) {
  const label = recordLabel(rec);
  if (!label) return null;
  return (
    <span className="cx-ht-rec">
      {rec.marks.length > 1 && (
        <span className={cx('cx-ht-marks', rec.kind === 'periods' && 'is-periods')} aria-hidden="true">
          {rec.marks.map(m => <i key={m.iso} className={m.ok ? (m.dry ? 'is-dry' : '') : 'is-slip'} />)}
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}

/** This week's seven days (week budgets), or one "had one today" toggle (month budgets). */
function CutAction({ habit, v, now, onToggle }) {
  const cur = v.cur;
  const month = cur.per === 'month';
  const note = `${cur.used} of ${cur.max} this ${cur.per}${cur.state === 'over' ? ', over budget' : ''}`;
  return (
    <>
      {month ? (
        <Button className={cx('cx-ht-slip', cur.usedToday && 'is-on')} aria-pressed={cur.usedToday} onClick={() => onToggle(cur.today)}>
          {cur.usedToday ? 'Logged today' : 'Had one today'}
        </Button>
      ) : (
        <span className="cx-ht-week" role="group" aria-label="This week, tap a day to log it">
          {periodDays(habit, now).map((d, i) => {
            const when = new Date(d.iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
            return (
              <button key={d.iso} type="button" disabled={d.future} aria-pressed={d.used}
                      className={cx(d.used && (d.over ? 'is-over' : 'is-used'), d.today && 'is-today')}
                      aria-label={`${when}${d.used ? ', logged' + (d.over ? ', over budget' : '') : ''}`}
                      onClick={() => onToggle(d.iso)}>{DOW[i]}</button>
            );
          })}
        </span>
      )}
      <span className={cx('cx-ht-note', cur.state === 'over' && 'is-over')}>{note} · {resetsLabel(cur)}</span>
    </>
  );
}

function QuitAction({ habit, now, onSlip }) {
  const strikes = strikeState(habit, now);
  const refill = replenishLabel(strikes, now);
  return (
    <>
      <Button className="cx-ht-slip" icon="rotate-ccw" onClick={() => onSlip(habit)}>I slipped</Button>
      {strikes.state !== 'off' && (
        <span className={cx('cx-ht-note', strikes.state === 'maxed' && 'is-over')}>
          <span className="cx-ht-pips" aria-hidden="true">
            {Array.from({ length: strikes.allowed }, (_, i) => <i key={i} className={i < strikes.used ? 'is-used' : ''} />)}
          </span>
          {strikes.used} of {strikes.allowed} {strikes.allowed === 1 ? 'strike' : 'strikes'}{refill ? ` · ${refill}` : ''}
        </span>
      )}
    </>
  );
}

/** What is ahead: their milestones, the road past them, and the runner's stages. */
function Ahead({ habit, v }) {
  const target = nextTarget(habit, v.elapsed);
  const road = roadAhead(habit, Math.max(v.elapsed, target && target.auto ? target.duration - 1 : 0), 3)
    .filter(st => !target || st.id !== target.id);
  const upcoming = target && target.auto ? [target, ...road].slice(0, 3) : road.slice(0, 2);
  const days = v.runnerDays;
  let ci = 0;
  STAGES.forEach((st, i) => { if (days >= st.at) ci = i; });
  const frac = paramsForDays(days).frac;
  const per = v.cut ? budgetOf(habit).per : null;
  const weeksNow = v.cut ? (per === 'month' ? (v.streak * 30) / 7 : v.streak) : 0;
  return (
    <div className="cx-ht-ahead">
      <h3 className="cx-ht-eb">What&rsquo;s ahead</h3>
      {v.sorted.length === 0 ? <p className="cx-ht-quiet">No milestones set. Add some from Edit to earn coins along the way.</p> : (
        <ul className="cx-ht-steps">
          {v.sorted.map(m => {
            const done = v.elapsed >= m.duration, next = target && target.id === m.id;
            return (
              <li key={m.id} className={done ? 'is-done' : next ? 'is-next' : ''}>
                {done && <Icon name="check" size={13} strokeWidth={2.25} />}
                <span>{m.label}{v.cut ? ' on target' : ''}</span>
                <b className="cx-ht-coin">⬡ {m.coins}</b>
                {next && <em>in {etaLabel(habit, v, m.duration)}</em>}
              </li>
            );
          })}
          {upcoming.map(st => (
            <li key={st.id} className={target && target.id === st.id ? 'is-next' : ''}>
              <span>{st.label}{v.cut ? ' on target' : ''}</span>
              <b className="cx-ht-coin">⬡ {st.coins}</b>
              {target && target.id === st.id && <em>in {etaLabel(habit, v, st.duration)}</em>}
            </li>
          ))}
          {habit.endless && upcoming.length > 0 && <li className="is-more" aria-hidden="true">and on</li>}
        </ul>
      )}
      <ol className="cx-ht-stages" aria-label="Runner stages">
        {STAGES.map((st, i) => {
          const past = i < ci, cur = i === ci, next = i === ci + 1;
          const at = v.cut ? (STAGE_WEEKS[i] ? `${STAGE_WEEKS[i]} wk` : 'start') : (st.at ? `day ${st.at}` : 'start');
          const eta = next ? (v.cut ? `in ${Math.max(1, Math.ceil(STAGE_WEEKS[i] - weeksNow))} wk` : `in ${shortSpan((st.at - days) * DAY)}`) : null;
          return (
            <li key={st.label} className={past ? 'is-past' : cur ? 'is-cur' : ''} aria-current={cur ? 'step' : undefined}>
              <span className="cx-ht-stage-bar"><i style={{ width: past ? '100%' : cur ? `${Math.round(frac * 100)}%` : 0 }} /></span>
              <b>{st.label}</b>
              <span>{eta || at}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** History: every kept run (Quit) or closed period (Cut down) as a bar, and the totals said once. */
function History({ habit, v, now }) {
  let bars, facts, caption;
  if (v.cut) {
    const per = budgetOf(habit).per, u = per === 'month' ? 'mo' : 'wk';
    const ps = periods(habit, now).filter(p => p.tracked).slice(-26);
    const top = Math.max(budgetOf(habit).max, ...ps.map(p => p.used), 1);
    bars = ps.map(p => ({ key: p.start, h: p.used / top, cls: p.current ? 'is-now' : p.over ? 'is-over' : p.used === 0 ? 'is-dry' : '', title: `${p.used} used` }));
    const closed = ps.filter(p => !p.current);
    facts = [['Best run', `${bestStreak(habit, now)} ${u}`], ['On budget', `${closed.filter(p => p.onTarget).length} of ${closed.length}`],
      [per === 'month' ? 'Dry months' : 'Dry weeks', String(dryTotal(habit, now))], ['Budget', `${budgetOf(habit).max} a ${per}`]];
    caption = `${ps.length} ${per === 'month' ? 'months' : 'weeks'}, oldest first. The last bar is this ${per}.`;
  } else {
    const runs = runsOf(habit).slice(-29).map(r => r.end - r.start);
    const best = Math.max(0, ...runs);
    const top = Math.max(best, v.elapsed, 1);
    bars = [...runs.map((r, i) => ({ key: i, h: r / top, cls: r === best && r > v.elapsed ? 'is-best' : '', title: shortSpan(r) })),
      { key: 'now', h: v.elapsed / top, cls: v.elapsed >= best && best > 0 ? 'is-now is-best' : 'is-now', title: shortSpan(v.elapsed) }];
    facts = [['Best run', shortSpan(Math.max(v.best, v.elapsed))], ['Clean in all', shortSpan(v.odometer)],
      ['Runs', String(runsOf(habit).length + 1)], ['Slips', String(habit.relapseCount || 0)]];
    caption = bars.length > 1 ? `Your last ${bars.length} runs, oldest first. The last bar is this one.` : 'Your first run.';
  }
  return (
    <div className="cx-ht-history">
      <h3 className="cx-ht-eb">History</h3>
      <div className="cx-ht-bars" role="img" aria-label={caption}>
        {bars.map(b => <i key={b.key} className={b.cls} style={{ height: `${Math.max(4, Math.round(b.h * 100))}%` }} title={b.title} />)}
      </div>
      <div className="cx-ht-barcap">{caption}</div>
      <dl className="cx-ht-facts">
        {facts.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}
      </dl>
    </div>
  );
}

export default function HabitLane({ habit, open, onToggle, phone = false, update, onOpenModal, onShowCoinToast, onSlip }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useHabitAwards(habit, now, update, onShowCoinToast);
  const ui = useUiScale();

  const v = habitView(habit, now);
  const cur = v.cur;
  const rec = recordOf(habit, now);
  const target = nextTarget(habit, v.elapsed);
  // The runner's own stage. Classic says "Still running" once a ladder is finished; with the
  // road going on past it (lib/habits/road.js) there is always a stage worth naming.
  const stage = v.allDone && !habit.endless ? 'Course complete' : stageForDays(v.runnerDays).label;
  const toggleDay = iso => update(prev => toggleUse(prev, habit.id, iso));
  const panelId = `cx-ht-more-${habit.id}`;

  const time = v.cut
    ? <><b>{v.streak}</b> <span>{cur.per === 'month' ? (v.streak === 1 ? 'month' : 'months') : (v.streak === 1 ? 'week' : 'weeks')} on budget</span></>
    : <><b>{faceClock(v.elapsed)}</b> <span>clean</span></>;
  const next = target
    ? <>{phone ? '' : 'Next: '}<b>{target.label}</b> in {etaLabel(habit, v, target.duration)} <span className="cx-ht-coin">⬡ {target.coins}</span></>
    : v.sorted.length ? 'Course complete' : 'No milestones set';
  const kind = v.cut ? `Up to ${cur.max} a ${cur.per}` : 'Quit';
  const action = v.cut
    ? <CutAction habit={habit} v={v} now={now} onToggle={toggleDay} />
    : <QuitAction habit={habit} now={now} onSlip={onSlip} />;
  const lane = <HabitRunner key={habit.id} {...laneProps(habit, v)} scale={(phone ? 1 : 1.25) * ui} />;

  return (
    <article className={cx('cx-ht-lane', open && 'is-open', phone && 'is-phone', cur && cur.state === 'over' && 'is-over')}
             style={{ '--hc': v.allDone && !habit.endless ? 'var(--cx-gold)' : habit.color }} data-habit={habit.id}>
      <div className="cx-ht-row">
        <button type="button" className="cx-ht-face" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          {phone ? (
            <>
              <span className="cx-ht-top">
                <span className="cx-ht-name"><i aria-hidden="true" /><span>{habit.name}</span></span>
                <span className="cx-ht-time">{time}</span>
              </span>
              <span className="cx-ht-run">{lane}</span>
            </>
          ) : (
            <>
              <span className="cx-ht-id">
                <span className="cx-ht-name"><i aria-hidden="true" /><span>{habit.name}</span></span>
                <span className="cx-ht-kind">{kind}</span>
                <span className="cx-ht-stage">{stage}</span>
              </span>
              <span className="cx-ht-run">{lane}</span>
              <span className="cx-ht-fig">
                <span className="cx-ht-time">{time}</span>
                <span className="cx-ht-next">{next}</span>
                <Record rec={rec} />
              </span>
            </>
          )}
        </button>
        {phone ? (
          <div className="cx-ht-foot"><span className="cx-ht-next">{next}</span><div className="cx-ht-act">{action}</div></div>
        ) : (
          <div className="cx-ht-act">{action}</div>
        )}
      </div>
      {open && (
        <div className="cx-ht-more" id={panelId}>
          {phone && <div className="cx-ht-phonehead"><span className="cx-ht-kind">{kind} · {stage}</span><Record rec={rec} /></div>}
          <Ahead habit={habit} v={v} />
          <History habit={habit} v={v} now={now} />
          <div className="cx-ht-tools">
            <Button variant="ghost" icon="pencil" onClick={() => onOpenModal('editHabitModal:' + habit.id)}>Edit habit</Button>
            {!v.cut && <Button variant="ghost" icon="calendar-days" onClick={() => onOpenModal('relapseModal:' + habit.id)}>Log an earlier slip</Button>}
          </div>
        </div>
      )}
    </article>
  );
}
