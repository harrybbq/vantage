/**
 * The Habits page's left column: every habit as a compact card with its
 * own live runner, so the whole field is visible while one is open on
 * the right.
 *
 * Each roster card owns its habit's coin/milestone effects
 * (useHabitAwards) — every habit has exactly one roster card, whichever
 * is selected, so awards fire once and never depend on what is open.
 */
import { useEffect, useRef, useState } from 'react';
import HabitRunner, { stageForDays } from './HabitRunner';
import useHabitAwards from './useHabitAwards';
import { habitView, gapLabel } from '../../lib/habits/view';

export function clockShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export function stageName(habit, v) {
  if (v.allDone) return habit.endless ? 'Still running' : 'Course complete';
  return stageForDays(v.runnerDays).label;
}

/** Runner lane props shared by the roster card and the detail hero. */
export function laneProps(habit, v) {
  const cur = v.cur;
  return {
    progress: v.ladder,
    days: v.runnerDays,
    colour: v.allDone ? 'var(--gold)' : habit.color,
    done: v.allDone,
    endless: !!habit.endless,
    // Quit: a relapse (new start) trips him. Cut down: only going over.
    stumbleKey: cur ? (cur.used > cur.max ? `${cur.start}:${cur.used - cur.max}` : null) : habit.startTime,
    ghost: v.ghost,
    pbAt: v.pbAt,
    flagKey: cur ? Math.min(cur.used, cur.max) : 0,
    scenery: v.scenery,
  };
}

function RosterItem({ habit, selected, onSelect, update, onShowCoinToast }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useHabitAwards(habit, now, update, onShowCoinToast);

  const v = habitView(habit, now);
  const cur = v.cur;
  const lp = laneProps(habit, v);
  const g = v.ghost || v.pbAt != null;
  const chip = !g ? null : v.pbAt != null
    ? { t: `▲ PB +${gapLabel(habit, v)}`, cls: 'is-pb' }
    : { t: `${gapLabel(habit, v)} to best`, cls: '' };

  return (
    <button type="button" className={`hb-item${selected ? ' is-on' : ''}`} style={{ '--hc': habit.color }}
            onClick={onSelect} aria-pressed={selected}>
      <span className="hb-item-top">
        <i className="hb-dot" aria-hidden="true" />
        <span className="hb-item-name">{habit.name}</span>
        {v.cut && <span className="hb-kind">≤ {cur.max}/{cur.per === 'month' ? 'mo' : 'wk'}</span>}
        {!v.cut && habit.endless && <span className="hb-kind is-inf">∞</span>}
      </span>
      <span className="hb-item-lane"><HabitRunner {...lp} /></span>
      <span className="hb-item-meta">
        <span className="hb-item-clock">
          <b className={cur && cur.state === 'over' ? 'is-over' : ''}>
            {v.cut ? `${v.streak} ${cur.per === 'month' ? 'mo' : 'wk'} on target` : clockShort(v.elapsed)}
          </b>
          <em>{stageName(habit, v)}{v.cut ? ` · ${cur.used}/${cur.max} this ${cur.per}` : ''}</em>
        </span>
        {chip && <span className={`hb-delta ${chip.cls}`}>{chip.t}</span>}
      </span>
      <span className="hb-item-bar" aria-hidden="true">
        <i style={{ width: `${v.ladder * 100}%` }} />
        {v.ghost && <s style={{ left: `${v.ghost.progress * 100}%` }} />}
      </span>
    </button>
  );
}

export default function HabitRoster({ habits, selectedId, onSelect, update, onShowCoinToast }) {
  // Keep the open habit in view inside the list (it scrolls on its own),
  // without moving the page.
  const box = useRef(null);
  useEffect(() => {
    const el = box.current;
    const item = el && el.querySelector('.hb-item.is-on');
    if (!item) return;
    const r = item.getBoundingClientRect(), c = el.getBoundingClientRect();
    if (r.top < c.top) el.scrollTop += r.top - c.top - 24;
    else if (r.bottom > c.bottom) el.scrollTop += r.bottom - c.bottom + 8;
  }, [selectedId]);
  return (
    // A div, not <nav>: the app's own navigation styles <nav> globally.
    <div className="hb-roster" role="group" aria-label="Your habits" ref={box}>
      <div className="hb-roster-head"><span>Your habits</span><span>{habits.length}</span></div>
      {habits.map(h => (
        <RosterItem key={h.id} habit={h} selected={h.id === selectedId} onSelect={() => onSelect(h.id)}
                    update={update} onShowCoinToast={onShowCoinToast} />
      ))}
    </div>
  );
}
