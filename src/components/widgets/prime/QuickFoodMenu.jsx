/**
 * The "+" on a Nutrition card: log something you have had before.
 *
 * A small menu anchored to the button, not a sheet over the page — the
 * card you are adding to should stay in view, because its rings are how
 * you see the log land. It stays open after a tap, so breakfast's three
 * things are three taps, not three trips.
 *
 * Search, barcode, camera and serving edits live on the Track diet page;
 * "Search all foods" goes there with the food search already open.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchRecentFoods, quickLogFood, mealForHour, historyEntry } from '../../../lib/diet/quickLog';
import { useDaySummary } from '../../../lib/diet/daySummary';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const W = 290;

export default function QuickFoodMenu({ anchorRect, userId, update, onSearch, onClose }) {
  const ref = useRef(null);
  const [items, setItems] = useState(null);      // null = loading
  const [loadErr, setLoadErr] = useState(false);
  const [meal, setMeal] = useState(() => mealForHour(new Date().getHours()));
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(() => new Set());
  const [note, setNote] = useState(null);         // { ok, text }
  const day = useDaySummary(userId);

  useEffect(() => {
    let live = true;
    fetchRecentFoods(userId)
      .then(list => { if (live) setItems(list); })
      .catch(() => { if (live) { setItems([]); setLoadErr(true); } });
    return () => { live = false; };
  }, [userId]);

  useEffect(() => {
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function log(food, i) {
    if (busy != null) return;
    setBusy(i);
    setNote(null);
    try {
      const { day: d, summary } = await quickLogFood(userId, food, meal);
      // The same % entry the Track page writes, so the 14-day trend and
      // the rest of the app see today's log without a trip to Track.
      const pct = historyEntry(summary, day.macros);
      if (pct && update) {
        update(prev => ({ ...prev, macroHistory: { ...(prev.macroHistory || {}), [d]: pct } }));
      }
      setDone(s => new Set(s).add(i));
      setNote({ ok: true, text: `Logged ${food.food_name} · ${Math.round(Number(food.calories) || 0)} kcal` });
    } catch {
      setNote({ ok: false, text: 'Couldn’t log that. Check your connection and tap it again.' });
    } finally {
      setBusy(null);
    }
  }

  // Below the button when there is room, above it when not; never off
  // either side. On a phone it spans the screen less a margin.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = anchorRect || { left: vw / 2, right: vw / 2, top: vh / 2, bottom: vh / 2 };
  const width = vw < 480 ? vw - 24 : Math.min(W, vw - 24);
  const left = Math.max(12, Math.min(r.left + (r.right - r.left) / 2 - width / 2, vw - width - 12));
  const below = vh - r.bottom > 300 || r.top < 300;
  const style = below
    ? { left, top: r.bottom + 8, width, maxHeight: Math.max(220, vh - r.bottom - 20) }
    : { left, bottom: vh - r.top + 8, width, maxHeight: Math.max(220, r.top - 20) };

  return createPortal(
    <div className="qf" ref={ref} style={style} role="dialog" aria-label="Log a recent food">
      <div className="qf-head">
        <span className="qf-title">Log again</span>
        <div className="qf-meals" role="radiogroup" aria-label="Meal">
          {MEALS.map(m => (
            <button key={m} type="button" role="radio" aria-checked={meal === m}
                    className={`qf-meal${meal === m ? ' is-on' : ''}`} onClick={() => setMeal(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="qf-list">
        {items == null && <div className="qf-empty">Loading your recent foods…</div>}
        {items && items.length === 0 && (
          <div className="qf-empty">
            {loadErr ? 'Couldn’t load your recent foods.' : 'Nothing logged yet. Search for your first food below.'}
          </div>
        )}
        {items && items.map((f, i) => {
          const isDone = done.has(i);
          const unit = f.additional_nutrients && f.additional_nutrients.serving_unit === 'ml' ? 'ml' : 'g';
          return (
            <button key={f.id || f.food_name} type="button" className={`qf-row${isDone ? ' is-done' : ''}`}
                    onClick={() => log(f, i)} disabled={busy != null}
                    aria-label={`Log ${f.food_name}, ${Math.round(Number(f.calories) || 0)} kcal, for ${meal}`}>
              <span className="qf-name">{f.food_name}{f.brand ? <span className="qf-brand"> · {f.brand}</span> : null}</span>
              <span className="qf-meta">{Math.round(Number(f.calories) || 0)} kcal · {Math.round(Number(f.serving_g) || 0)}{unit}</span>
              <span className="qf-add" aria-hidden="true">{busy === i ? '…' : isDone ? '✓' : '+'}</span>
            </button>
          );
        })}
      </div>

      {note && <div className={`qf-note${note.ok ? '' : ' is-err'}`} role="status">{note.text}</div>}

      <button type="button" className="qf-search" onClick={onSearch}>Search all foods →</button>
    </div>,
    document.body,
  );
}
