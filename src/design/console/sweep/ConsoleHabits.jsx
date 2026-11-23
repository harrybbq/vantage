/**
 * Console Habits — the track (owner, Nov 2026; mockup A).
 *
 * Every habit is a lane with its own live runner (HabitTrack.jsx), on
 * desktop and phone alike. This page owns the two things a lane cannot:
 * which lane is open, and the bar that follows a slip.
 *
 * ONE-TAP SLIP. "I slipped" logs it now, through the same applyRelapse
 * as the dialog. For a few seconds a bar offers Undo (the habit is put
 * back exactly as it was; lib/habits/relapse.js undoRelapse refuses if
 * anything else has touched it since) and "It was earlier", which takes
 * the slip back and opens the dialog to date it. The dialog is now only
 * ever seen for back-dating.
 *
 * Which lane is open is the same per-browser preference classic keeps
 * (vb_habits_selected), so switching design keeps your place. Nothing
 * is open until a lane is pressed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icon';
import { applyRelapse, undoRelapse } from '../../../lib/habits/relapse';
import { Button } from '../ui';
import PageHead from './PageHead';
import HabitLane, { faceClock } from './HabitTrack';

const OPEN_KEY = 'vb_habits_open';
/** How long the slip bar stays (ms). Long enough to read and reach; short enough not to sit there. */
export const SLIP_BAR_MS = 9000;

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
  const habits = useMemo(() => (S.habits || []).filter(h => h && h.id), [S.habits]);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) || null; } catch { return null; } });
  const toggle = id => {
    const next = open === id ? null : id;
    setOpen(next);
    try { if (next) localStorage.setItem(OPEN_KEY, next); else localStorage.removeItem(OPEN_KEY); } catch { /* private mode */ }
  };
  const add = () => onOpenModal('addHabitModal');

  // The slip bar. `last` holds the habit as it was the moment before the
  // slip, captured INSIDE the update so it is the state's own object, not
  // a render-old copy; Undo reads it later, well after that update ran.
  const [bar, setBar] = useState(null);                 // { id, name, ran }
  const last = useRef(null);                            // { before, at }
  const timer = useRef(0);
  const closeBar = useCallback(() => { clearTimeout(timer.current); setBar(null); }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const slip = habit => {
    const at = Date.now();
    update(prev => {
      const cur = (prev.habits || []).find(h => h && h.id === habit.id);
      if (!cur) return prev;
      last.current = { before: cur, at };
      return applyRelapse(prev, habit.id, at);
    });
    setBar({ id: habit.id, name: habit.name, ran: Math.max(0, at - (Number(habit.startTime) || at)) });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setBar(null), SLIP_BAR_MS);
  };
  const undo = () => {
    const l = last.current;
    if (l) update(prev => undoRelapse(prev, l.before, l.at));
    last.current = null;
    closeBar();
  };
  const earlier = () => {
    const id = bar && bar.id;
    undo();
    if (id) onOpenModal('relapseModal:' + id);
  };

  return (
    <section className={`section active cx-page cx-sweep-page cx-sweep-habits${isMobile ? ' is-phone' : ''}`}>
      <PageHead
        title="Habits"
        meta={isMobile || !habits.length ? null : 'Every habit runs its own lane. Press one for what’s ahead and its history.'}
        actions={<Button variant="primary" icon="plus" onClick={add} data-testid="cx-habits-add" data-ob="add-habit">{isMobile ? 'Add' : 'Add habit'}</Button>}
      />

      {!habits.length ? <Empty onAdd={add} /> : (
        <div className="cx-ht" data-testid="cx-habit-track">
          {habits.map(h => (
            <HabitLane key={h.id} habit={h} phone={!!isMobile} open={open === h.id} onToggle={() => toggle(h.id)}
                       update={update} onOpenModal={onOpenModal} onShowCoinToast={onShowCoinToast} onSlip={slip} />
          ))}
        </div>
      )}

      {bar && (
        <div className={`cx-ht-bar${isMobile ? ' is-phone' : ''}`} role="status" aria-live="polite" data-testid="cx-habit-slipbar">
          <span><b>{bar.name}:</b> run ended at {faceClock(bar.ran)}.</span>
          <span className="cx-ht-bar-acts">
            <Button onClick={undo} data-testid="cx-habit-undo">Undo</Button>
            <Button variant="ghost" onClick={earlier}>It was earlier</Button>
          </span>
        </div>
      )}
    </section>
  );
}
