/**
 * Habits — desktop.
 *
 * Every habit down the left as a compact card with its own live runner;
 * the selected one in full on the right, with the runner drawn large.
 * Built to fit a laptop screen without scrolling: the three summary
 * figures sit in the header row rather than taking a band of their own,
 * and the list scrolls on its own when there are more habits than fit.
 *
 * Which habit is open is a view preference, kept in this browser only.
 * The phone keeps its stacked cards (mobile/MobileHabitsSection).
 */
import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import SectionHelp from './SectionHelp';
import HabitRoster from './habits/HabitRoster';
import HabitDetail from './habits/HabitDetail';
import { habitView, etaLabel, shortSpan } from '../lib/habits/view';
import './habits/habits-page.css';

const PICK_KEY = 'vb_habits_selected';

/** The three figures in the header: next milestone, bests, and budgets or the longest run. */
function summary(habits, now) {
  const vs = habits.map(h => ({ h, v: habitView(h, now) }));
  const next = vs
    .filter(x => x.v.nextIdx >= 0)
    .map(x => ({ ...x, m: x.v.sorted[x.v.nextIdx], left: x.v.sorted[x.v.nextIdx].duration - x.v.elapsed }))
    .sort((a, b) => a.left - b.left)[0];
  const live = vs.filter(x => x.v.pbAt != null).length;
  const chasing = vs.filter(x => x.v.ghost).length;
  const cuts = vs.filter(x => x.v.cut);
  const out = [
    next
      ? { k: 'Next milestone', v: next.m.label, sub: `${next.h.name} · in ${etaLabel(next.h, next.v, next.m.duration)}` }
      : { k: 'Next milestone', v: 'All cleared', sub: 'every ladder finished' },
    { k: 'Personal bests', v: `${live} ahead`, sub: chasing ? `${chasing} chasing the ghost` : live ? 'nothing left to chase' : 'bests build as runs end' },
  ];
  if (cuts.length) {
    const ok = cuts.filter(x => x.v.cur.state !== 'over').length;
    out.push({ k: 'Budgets this week', v: `${ok} of ${cuts.length}`, sub: ok === cuts.length ? 'all within budget' : `${cuts.length - ok} over`, bad: ok < cuts.length });
  } else {
    const long = vs.slice().sort((a, b) => b.v.elapsed - a.v.elapsed)[0];
    if (long) out.push({ k: 'Longest run now', v: shortSpan(long.v.elapsed), sub: long.h.name });
  }
  return out;
}

export default function HabitsSection({ S, update, active, onOpenModal, onShowCoinToast }) {
  const habits = useMemo(() => S.habits || [], [S.habits]);
  const [picked, setPicked] = useState(() => { try { return localStorage.getItem(PICK_KEY); } catch { return null; } });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);
  const pick = id => {
    setPicked(id);
    try { localStorage.setItem(PICK_KEY, id); } catch { /* private mode */ }
  };
  const selected = habits.find(h => h.id === picked) || habits[0] || null;
  const stats = habits.length ? summary(habits, now) : [];

  return (
    <section id="habits" className={`section hb-page${active ? ' active' : ''}`}>
      <div className="hb-head">
        <div className="hb-head-title">
          <div className="eyebrow">Break the Cycle</div>
          <div className="sec-title">Habits <SectionHelp
            title="Habits"
            rows={[
              { term: 'Quit', def: 'A timer that counts up from your last relapse.' },
              { term: 'Cut down', def: 'A budget, such as 2 days a week. Logging a day resets nothing; weeks kept within budget are the streak.' },
              { term: 'Ghost', def: 'Your best previous run. Pass it for a personal best.' },
              { term: 'Trail', def: 'Every run, or every week against the budget, on one strip.' },
            ]}
          /></div>
        </div>
        {stats.length > 0 && (
          <dl className="hb-stats">
            {stats.map(s => (
              <div key={s.k} className={s.bad ? 'is-bad' : ''}><dt>{s.k}</dt><dd>{s.v}</dd><span>{s.sub}</span></div>
            ))}
          </dl>
        )}
        <button className="btn btn-primary hb-add" onClick={() => onOpenModal('addHabitModal')}>+ Add Habit</button>
      </div>

      {!habits.length ? (
        <div className="habits-empty">
          <div className="habits-empty-icon"><Icon name="target" size={32} strokeWidth={1.5} /></div>
          <div>No habits tracked yet</div>
          <div style={{ fontSize: '12px', marginTop: '6px', opacity: 0.6 }}>
            Quit something with a timer, or cut down with a budget of days.
          </div>
        </div>
      ) : (
        <div className="hb-layout">
          <HabitRoster habits={habits} selectedId={selected.id} onSelect={pick} update={update} onShowCoinToast={onShowCoinToast} />
          <HabitDetail key={selected.id} habit={selected} update={update} onOpenModal={onOpenModal} />
        </div>
      )}
    </section>
  );
}
