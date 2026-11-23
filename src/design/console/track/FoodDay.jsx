/**
 * The food page, console design (owner, 2026-11-23, mockup "Food and
 * Motion": bars with a goal mark, the day grouped by time).
 *
 * NutritionSection mounts this in place of its DietPanel and goals card
 * when it is given one (`view`), and keeps everything else: the data
 * hooks, the plan's day targets, the goal-hit toasts, the % history it
 * writes, and every way of LOGGING (search, barcode, photo, saved meals,
 * in the sheets they already have). So this is a new way of reading the
 * day, as DietPanel was, and classic is untouched.
 *
 *   day       ‹ Today · Mon 23 Nov ›  — the page's own day switcher (the
 *             day used to be chosen on the calendar)
 *   summary   calories as a number and a bar, then Protein / Carbs / Fat.
 *             Each bar has a mark at its target and runs past it when
 *             the day does (lib/diet/foodDay.js barOf): accent while
 *             short or landed, a tick when met, the warning colour only
 *             when a target is passed. One line of the rest.
 *   again     the foods logged most often, one tap each
 *   the day   entries logged within 20 minutes of each other share a
 *             block with its time and total (groupByTime). Names in
 *             full. Tap one for its sheet: Log again, Remove (with Undo
 *             in place of the browser's confirm box).
 *   week      seven bars against the target line; tap one to open it
 *   targets   a sheet, opened where it was asked for (the old panel
 *             appeared 2,000 px down the page). A row a target; tap to
 *             change it.
 *   log       the + in the app's bar, as on the calendar and Goals.
 *
 * Motion (the same rules as training: short, once, on what changed):
 * the calorie number counts to its new value, the bars grow with it, a
 * new entry drops into the day, and a bar that becomes met gets its
 * tick with a spring. No burst: hitting a macro is a daily event.
 *
 * Writes nothing itself; every handler is NutritionSection's.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icon';
import { Button, Sheet } from '../ui';
import TopBarActions from '../shell/TopBarActions';
import useWide from './useWide';
import { useCountUp } from '../../../hooks/useCountUp';
import { planBadge } from '../../../lib/plan/planDay';
import { FLOOR_MACROS } from '../../../data/trainingProgramme';
import { groupByTime, barOf, diffText, isFloor, shiftDay, dayLabel, weekOf } from '../../../lib/diet/foodDay';
import './food.css';

const CORE = ['Protein', 'Carbs', 'Fat'];
const UNDO_MS = 7000;
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const int = v => Math.round(num(v)).toLocaleString('en-GB');

/** The track: a fill, and a mark where the target is. */
function Bar({ bar, big = false }) {
  return (
    <span className={`cx-fd-track${big ? ' is-big' : ''} is-${bar.state}`} aria-hidden="true">
      <i style={{ width: `${(bar.fill * 100).toFixed(1)}%` }} />
      {bar.state !== 'none' && <u />}
    </span>
  );
}

/** A met tick that springs the moment its bar becomes met (and sits still if it already was). */
function Met({ on }) {
  const was = useRef(on);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (on && !was.current) { setFresh(true); const t = setTimeout(() => setFresh(false), 600); was.current = on; return () => clearTimeout(t); }
    was.current = on;
    return undefined;
  }, [on]);
  if (!on) return null;
  return <span className={`cx-fd-met${fresh ? ' is-fresh' : ''}`} aria-label="met"><Icon name="check" size={10} strokeWidth={3.4} /></span>;
}

function EntrySheet({ entry, onClose, onAgain, onRemove }) {
  const bits = [['Protein', entry.protein_g, 'g'], ['Carbs', entry.carbs_g, 'g'], ['Fat', entry.fat_g, 'g'], ['Fibre', entry.fibre_g, 'g'], ['Sugar', entry.sugar_g, 'g'], ['Sodium', entry.sodium_mg, 'mg']]
    .filter(([, v]) => num(v) > 0);
  return (
    <Sheet title={entry.food_name} eyebrow={[entry.brand, `${int(entry.serving_g)} g`].filter(Boolean).join(' · ')} onClose={onClose} testId="cx-fd-entry" className="cx-fd-sheet"
           footer={<Button variant="primary" block icon="plus" onClick={onAgain} data-testid="cx-fd-again">Log again</Button>}>
      <div className="cx-fd-sheet-in">
        <p className="cx-fd-ek"><b className="cx-num">{int(entry.calories)}</b> kcal</p>
        {bits.length > 0 && (
          <dl className="cx-fd-ebits">
            {bits.map(([l, v, u]) => <div key={l}><dt>{l}</dt><dd className="cx-num">{int(v)} {u}</dd></div>)}
          </dl>
        )}
        <Button variant="danger" icon="trash-2" onClick={onRemove} data-testid="cx-fd-remove">Remove from the day</Button>
      </div>
    </Sheet>
  );
}

function TargetsSheet({ macros, valueOf, floorOf, plan, onClose, onSave, onDelete, onMove, onAdd }) {
  const [edit, setEdit] = useState(null);     // macro id
  const [form, setForm] = useState({ name: '', goal: '', unit: '' });
  const [sure, setSure] = useState(false);
  const open = m => { setEdit(m.id); setSure(false); setForm({ name: m.name, goal: String(m.daily_goal ?? ''), unit: m.unit || '' }); };
  const save = m => {
    const goal = Number(form.goal);
    if (!Number.isFinite(goal) || goal < 0) return;
    onSave(m.id, { name: m.is_default ? m.name : (form.name.trim() || m.name), daily_goal: goal, unit: form.unit.trim() || m.unit });
    setEdit(null);
  };
  return (
    <Sheet title="Daily targets" eyebrow={plan.active ? planBadge(plan) : null} onClose={onClose} testId="cx-fd-targets" className="cx-fd-sheet"
           footer={<Button block icon="plus" onClick={onAdd} data-testid="cx-fd-target-add">Add a target</Button>}>
      <div className="cx-fd-sheet-in">
        {plan.active && <p className="cx-fd-note">Your plan is setting today&rsquo;s targets. The numbers you save here are the ones used when it is off.</p>}
        <ul className="cx-fd-targets">
          {macros.map((m, i) => {
            const bar = barOf(valueOf(m), m.daily_goal, { floor: floorOf(m) });
            if (edit === m.id) {
              return (
                <li key={m.id} className="is-edit">
                  <form onSubmit={e => { e.preventDefault(); save(m); }}>
                    <div className="cx-fd-fields">
                      {!m.is_default && (
                        <label><span>Name</span><input id={`cx-fd-n-${m.id}`} value={form.name} maxLength={40} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
                      )}
                      <label><span>{m.is_default ? `${m.name} target` : 'Target'}</span><input id={`cx-fd-g-${m.id}`} inputMode="decimal" value={form.goal} onChange={e => setForm(f => ({ ...f, goal: e.target.value.replace(/[^\d.]/g, '') }))} data-testid="cx-fd-target-goal" /></label>
                      <label className="is-unit"><span>Unit</span><input id={`cx-fd-u-${m.id}`} value={form.unit} maxLength={8} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} /></label>
                    </div>
                    <div className="cx-fd-editacts">
                      <Button variant="primary" type="submit" data-testid="cx-fd-target-save">Save</Button>
                      <Button onClick={() => setEdit(null)}>Cancel</Button>
                      <span className="cx-fd-sp" />
                      <Button icon="arrow-up" iconOnly label="Move up" disabled={i === 0} onClick={() => onMove(m, -1)} />
                      <Button icon="arrow-down" iconOnly label="Move down" disabled={i === macros.length - 1} onClick={() => onMove(m, 1)} />
                      {!m.is_default && (sure
                        ? <Button variant="danger" onClick={() => { onDelete(m); setEdit(null); }} data-testid="cx-fd-target-delete-yes">Delete it</Button>
                        : <Button variant="danger" icon="trash-2" iconOnly label={`Delete ${m.name}`} onClick={() => setSure(true)} />)}
                    </div>
                  </form>
                </li>
              );
            }
            return (
              <li key={m.id}>
                <button type="button" className="cx-fd-target" onClick={() => open(m)} data-testid="cx-fd-target">
                  <span className="cx-fd-target-n">{m.name}</span>
                  <Bar bar={bar} />
                  <span className="cx-fd-target-v cx-num">{int(m.daily_goal)} {m.unit}</span>
                  <Icon name="chevron-right" size={15} strokeWidth={1.75} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}

export default function FoodDay({
  S, date, today, summary, logEntries = [], macros = [], plan, burnKcal = 0, recents = [], valueOf,
  onLogFood, onQuickAdd, onRemoveEntry, onRestoreEntry, onDate, onSaveMacro, onDeleteMacro, onMoveMacro, onAddMacro,
}) {
  const wide = useWide(1024);
  const [entryId, setEntryId] = useState(null);
  const [targets, setTargets] = useState(false);
  const [busy, setBusy] = useState(null);
  const [undo, setUndo] = useState(null);     // { entry, n }
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const floorOf = m => isFloor(m.name, { planned: !!m.plannedGoal, planFloors: FLOOR_MACROS });
  const cal = macros.find(m => m.name === 'Calories') || null;
  const calBar = barOf(summary?.calories, cal?.daily_goal);
  const shownKcal = useCountUp(num(summary?.calories));
  const core = CORE.map(n => macros.find(m => m.name === n)).filter(Boolean);
  const groups = useMemo(() => groupByTime(logEntries), [logEntries]);
  const week = useMemo(() => weekOf(S?.macroHistory, date, today), [S?.macroHistory, date, today]);
  const weekHas = week.filter(w => w.pct != null);
  const weekAvg = weekHas.length ? Math.round(weekHas.reduce((s, w) => s + w.pct, 0) / weekHas.length) : null;

  // Entries that arrived since the last look at this day drop in (not the first load of a day).
  const seen = useRef({ date: null, ids: null });
  const [fresh, setFresh] = useState(() => new Set());
  useEffect(() => {
    const ids = new Set(logEntries.map(e => e.id));
    const first = seen.current.date !== date || !seen.current.ids;
    const added = first ? [] : [...ids].filter(id => !seen.current.ids.has(id));
    seen.current = { date, ids };
    if (!added.length) return undefined;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 1600);
    return () => clearTimeout(t);
  }, [logEntries, date]);

  const entry = entryId ? logEntries.find(e => e.id === entryId) || null : null;
  const again = async row => {
    if (busy) return;
    setBusy(row.id || row.food_name);
    try { await onQuickAdd?.(row); } finally { setBusy(null); }
  };
  const remove = async e => {
    setEntryId(null);
    await onRemoveEntry?.(e);
    clearTimeout(timer.current);
    setUndo({ entry: e, n: Date.now() });
    timer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };
  const undoIt = async () => { const e = undo && undo.entry; clearTimeout(timer.current); setUndo(null); if (e) await onRestoreEntry?.(e); };

  const burn = num(burnKcal);
  const rest = [
    burn > 0 && ['Burned', int(burn)], burn > 0 && ['Net', int(num(summary?.calories) - burn)],
    ['Fibre', `${int(summary?.fibre_g)} g`], ['Sugar', `${int(summary?.sugar_g)} g`], ['Sodium', `${int(summary?.sodium_mg)} mg`],
  ].filter(Boolean);

  const summaryCard = (
    <section className="cx-fd-card cx-fd-sum" aria-label="Energy and macros" data-testid="cx-fd-sum">
      <div className="cx-fd-kcal">
        <b className="cx-num" data-testid="cx-fd-kcal">{int(shownKcal)}</b>
        <span>{cal && cal.daily_goal > 0 ? `/ ${int(cal.daily_goal)} kcal` : 'kcal · no target set'}</span>
        {calBar.state !== 'none' && <em className={`is-${calBar.state}`}>{diffText(calBar)}</em>}
      </div>
      <Bar bar={calBar} big />
      {core.map(m => {
        const bar = barOf(valueOf(m), m.daily_goal, { floor: floorOf(m) });
        return (
          <div key={m.id} className={`cx-fd-macro is-${bar.state}`} data-macro={m.name}>
            <span className="cx-fd-macro-n">{m.name}<Met on={bar.state === 'met'} /></span>
            <Bar bar={bar} />
            <span className="cx-fd-macro-v cx-num">{int(valueOf(m))}<small>/{int(m.daily_goal)} {m.unit}</small></span>
          </div>
        );
      })}
      <div className="cx-fd-rest">
        <p>{rest.map(([l, v], i) => <span key={l}>{i > 0 && ' · '}{l} <b className="cx-num">{v}</b></span>)}</p>
        <button type="button" className="cx-fd-link" onClick={() => setTargets(true)} data-testid="cx-fd-targets-open">
          {plan.active ? planBadge(plan) : 'Targets'} <Icon name="chevron-right" size={14} strokeWidth={1.75} />
        </button>
      </div>
    </section>
  );

  const againList = recents.length > 0 && (
    wide ? (
      <section className="cx-fd-card" aria-label="One tap again">
        <h2 className="cx-fd-h">One tap again <span>your most logged</span></h2>
        <ul className="cx-fd-again">
          {recents.map(r => (
            <li key={r.id || r.food_name}>
              <button type="button" onClick={() => again(r)} disabled={!!busy} data-testid="cx-fd-quick">
                <span className="cx-fd-again-t"><b>{r.food_name}</b><small>{[r.brand, `${int(r.serving_g)} g`, `${r.count || 1}×`].filter(Boolean).join(' · ')}</small></span>
                <span className="cx-num cx-fd-again-k">{int(r.calories)}</span>
                <Icon name="plus" size={16} strokeWidth={2.2} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : (
      <div className="cx-fd-chips" role="group" aria-label="One tap again">
        {recents.map(r => (
          <button key={r.id || r.food_name} type="button" className="cx-fd-chip" onClick={() => again(r)} disabled={!!busy} data-testid="cx-fd-quick"
                  aria-label={`Log ${r.food_name} again, ${int(r.calories)} kcal`}>
            <Icon name="plus" size={13} strokeWidth={2.6} />{r.food_name}
          </button>
        ))}
      </div>
    )
  );

  const dayList = (
    <section className="cx-fd-day" aria-label="The day" data-testid="cx-fd-day">
      {groups.length === 0 ? (
        <p className="cx-fd-empty">Nothing logged {date === today ? 'yet' : 'on this day'}. Tap + to search, scan a barcode or take a photo.</p>
      ) : groups.map(g => (
        <div key={g.key} className="cx-fd-meal" data-testid="cx-fd-meal">
          <div className="cx-fd-meal-h">
            <span className="cx-num">{g.time || 'No time'}</span>
            <span>{g.items.length} {g.items.length === 1 ? 'item' : 'items'}</span>
            <span className="cx-num cx-fd-meal-k">{int(g.kcal)} kcal</span>
          </div>
          <ul>
            {g.items.map(e => (
              <li key={e.id} className={fresh.has(e.id) ? 'is-new' : ''}>
                <button type="button" className="cx-fd-row" onClick={() => setEntryId(e.id)} data-testid="cx-fd-row">
                  <span className="cx-fd-row-t">
                    <b>{e.food_name}</b>
                    <small>{int(e.serving_g)} g · P {int(e.protein_g)} · C {int(e.carbs_g)} · F {int(e.fat_g)}</small>
                  </span>
                  <span className="cx-num cx-fd-row-k">{int(e.calories)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );

  const weekCard = (
    <section className="cx-fd-card" aria-label="The last seven days">
      <h2 className="cx-fd-h">Seven days {weekAvg != null && <span>averaging {weekAvg}% of target</span>}</h2>
      <div className="cx-fd-week">
        {week.map(w => (
          <button key={w.key} type="button" className={`cx-fd-wk${w.sel ? ' is-sel' : ''}${w.pct == null ? ' is-none' : w.on ? ' is-on' : ' is-off'}`}
                  onClick={() => onDate?.(w.key)} disabled={w.future || w.sel} aria-label={`${w.label}: ${w.pct == null ? 'nothing logged' : `${w.pct}% of target`}`} data-testid="cx-fd-wk">
            <span className="cx-fd-wk-bar"><i style={{ height: `${w.pct == null ? 4 : Math.max(6, Math.min(100, (w.pct / 125) * 100))}%` }} /></span>
            <span className="cx-fd-wk-l">{w.label}</span>
          </button>
        ))}
      </div>
      <p className="cx-fd-note">Each bar is that day&rsquo;s calories against the target it had then. The line is the target. Tap a day to open it.</p>
    </section>
  );

  return (
    <div className={`cx-fd${wide ? ' is-wide' : ''}`} data-testid="cx-fd">
      <TopBarActions placement="end">
        {wide
          ? <Button variant="primary" icon="plus" onClick={onLogFood} data-testid="cx-fd-log">Log food</Button>
          : <Button variant="primary" icon="plus" iconOnly label="Log food" onClick={onLogFood} data-testid="cx-fd-log" />}
      </TopBarActions>

      <div className="cx-fd-main">
        <div className="cx-fd-dayswitch">
          <button type="button" onClick={() => onDate?.(shiftDay(date, -1))} aria-label="The day before" data-testid="cx-fd-prev"><Icon name="chevron-left" size={18} strokeWidth={1.75} /></button>
          <span className="cx-fd-daylabel" data-testid="cx-fd-date">{dayLabel(date, today)}</span>
          {date !== today && <button type="button" className="cx-fd-today" onClick={() => onDate?.(today)} data-testid="cx-fd-today">Today</button>}
          <button type="button" onClick={() => onDate?.(shiftDay(date, 1))} disabled={date >= today} aria-label="The day after" data-testid="cx-fd-next"><Icon name="chevron-right" size={18} strokeWidth={1.75} /></button>
        </div>
        {summaryCard}
        {!wide && againList}
        {dayList}
        {!wide && weekCard}
      </div>
      {wide && <aside className="cx-fd-rail">{againList}{weekCard}</aside>}

      {undo && (
        <div className="cx-fd-undo" role="status" data-testid="cx-fd-undo">
          <span><b>{undo.entry.food_name}</b> removed</span>
          <button type="button" onClick={undoIt}>Undo</button>
        </div>
      )}
      {entry && <EntrySheet entry={entry} onClose={() => setEntryId(null)} onAgain={() => { setEntryId(null); again(entry); }} onRemove={() => remove(entry)} />}
      {targets && (
        <TargetsSheet macros={macros} valueOf={valueOf} floorOf={floorOf} plan={plan} onClose={() => setTargets(false)}
                      onSave={onSaveMacro} onDelete={onDeleteMacro} onMove={onMoveMacro} onAdd={() => { setTargets(false); onAddMacro?.(); }} />
      )}
    </div>
  );
}
