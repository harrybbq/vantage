/**
 * Console Habits.
 *
 * Desktop: a console header (title, the three summary figures, "Add
 * habit"), then classic's HabitRoster and HabitDetail mounted as they are
 * (they own the roster's award effects, the runner lanes, the trail and
 * every write) and restyled from outside through the sweep.css token
 * bridge. The runner trail stays: it is the one illustration with a job.
 *
 * Phone: a stack of ConsoleHabitCard, the console counterpart of the
 * classic mobile card (same award pipeline, same modals, same writes).
 *
 * The open habit on desktop is the same per-browser preference classic
 * keeps (vb_habits_selected), so switching design keeps your place.
 */
import { useEffect, useMemo, useState } from 'react';
import HabitRoster from '../../../components/habits/HabitRoster';
import HabitDetail from '../../../components/habits/HabitDetail';
import { habitView, etaLabel, shortSpan } from '../../../lib/habits/view';
import Icon from '../../../components/Icon';
import { Button } from '../ui';
import PageHead from './PageHead';
import ConsoleHabitCard from './ConsoleHabitCard';
// The roster and detail are styled by the classic page sheet; HabitsSection
// normally brings it in, and it only targets classic classes.
import '../../../components/habits/habits-page.css';

const PICK_KEY = 'vb_habits_selected';

/** The three header figures, as classic HabitsSection works them out. Pure. */
export function habitSummary(habits, now) {
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
      ? { k: 'Next milestone', v: next.m.label, sub: `${next.h.name}, in ${etaLabel(next.h, next.v, next.m.duration)}` }
      : { k: 'Next milestone', v: 'All cleared', sub: 'Every ladder is finished' },
    { k: 'Personal bests', v: `${live} ahead`, sub: chasing ? `${chasing} chasing a past best` : live ? 'Nothing left to chase' : 'Bests build as runs end' },
  ];
  if (cuts.length) {
    const ok = cuts.filter(x => x.v.cur.state !== 'over').length;
    out.push({ k: 'Budgets this week', v: `${ok} of ${cuts.length}`, sub: ok === cuts.length ? 'All within budget' : `${cuts.length - ok} over`, bad: ok < cuts.length });
  } else {
    const long = vs.slice().sort((a, b) => b.v.elapsed - a.v.elapsed)[0];
    if (long) out.push({ k: 'Longest run now', v: shortSpan(long.v.elapsed), sub: long.h.name });
  }
  return out;
}

function Empty({ onAdd }) {
  return (
    <div className="cx-panel cx-sweep-empty">
      <Icon name="target" size={22} strokeWidth={1.75} />
      <h2 className="cx-t17">No habits yet</h2>
      <p className="cx-t15 cx-mid">Quit something with a timer, or cut down with a budget of days. The timer starts as soon as you add it.</p>
      <Button variant="primary" icon="plus" onClick={onAdd}>Add a habit</Button>
    </div>
  );
}

export default function ConsoleHabits({ S, update, isMobile, onOpenModal, onShowCoinToast }) {
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
  const add = () => onOpenModal('addHabitModal');
  const selected = habits.find(h => h.id === picked) || habits[0] || null;
  const stats = !isMobile && habits.length ? habitSummary(habits, now) : [];

  const addBtn = (
    <Button variant="primary" icon="plus" onClick={add} data-testid="cx-habits-add">{isMobile ? 'Add' : 'Add habit'}</Button>
  );

  return (
    <section className={`section active cx-page cx-sweep-page cx-sweep-habits${isMobile ? ' is-phone' : ''}`}>
      <PageHead
        title="Habits"
        meta={isMobile ? null : 'Quit with a timer, or cut down with a budget. Every run is kept on the trail.'}
        actions={addBtn}
      >
        {stats.length > 0 && (
          <dl className="cx-sweep-stats">
            {stats.map(s => (
              <div key={s.k} className={s.bad ? 'is-bad' : ''}>
                <dt>{s.k}</dt>
                <dd>{s.v}</dd>
                <span>{s.sub}</span>
              </div>
            ))}
          </dl>
        )}
      </PageHead>

      {!habits.length ? <Empty onAdd={add} /> : isMobile ? (
        <div className="cx-sweep-habit-list">
          {habits.map(h => (
            <ConsoleHabitCard key={h.id} habit={h} update={update} onShowCoinToast={onShowCoinToast} onOpenModal={onOpenModal} />
          ))}
        </div>
      ) : (
        <div className="cx-sweep-scope cx-sweep-hb">
          <div className="hb-layout">
            <HabitRoster habits={habits} selectedId={selected.id} onSelect={pick} update={update} onShowCoinToast={onShowCoinToast} />
            <HabitDetail key={selected.id} habit={selected} update={update} onOpenModal={onOpenModal} />
          </div>
        </div>
      )}
    </section>
  );
}
