import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useNutrition } from '../hooks/useNutrition';
import { getTodayStr } from '../utils/helpers';
import FoodLogSheet from './FoodLogSheet';
import DietPanel from './track/DietPanel';
import { useFoodFrequency } from '../hooks/useFoodFrequency';
import FoodSearch from './FoodSearch';
import { backdropClose } from '../utils/backdropClose';
import { planDayFor, planGoalFor, planBadge } from '../lib/plan/planDay';
import { FLOOR_MACROS } from '../data/trainingProgramme';

// ── Helpers ───────────────────────────────────────────────────────────────
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  const v = Number(n);
  return v < 1 && v > 0 ? v.toFixed(1) : Math.round(v).toString();
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function getMacroValue(summary, macro) {
  if (!summary) return 0;
  const fieldMap = {
    'Calories': 'calories', 'Protein': 'protein_g', 'Carbs': 'carbs_g',
    'Fat': 'fat_g', 'Fibre': 'fibre_g', 'Sugar': 'sugar_g', 'Sodium': 'sodium_mg',
  };
  const field = fieldMap[macro.name];
  if (field) return Number(summary[field] || 0);
  return Number(summary.additional_nutrients?.[macro.name.toLowerCase().replace(/ /g, '_')] || 0);
}

// ── MacroBar ─────────────────────────────────────────────────────────────
function MacroBar({ macro, consumed, isCal, index, onMenuClick }) {
  const goal = macro.daily_goal || 1;
  const pct = Math.min(100, (consumed / goal) * 100);
  // Under the plan, protein and fat are FLOORS: crossing one is the
  // point of it, so it reads as met rather than as an overshoot.
  // Calories stay a target you land on, and still flag when passed.
  const isFloor = !!macro.plannedGoal && FLOOR_MACROS.has(String(macro.name).toLowerCase());
  const over = consumed > goal && !isFloor;
  const met = isFloor && consumed >= goal;
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(pct), 60 + index * 60);
    return () => clearTimeout(t);
  }, [pct, index]);

  const colour = over ? 'var(--amber)' : macro.color;
  const valueColour = over ? 'var(--amber)' : 'var(--text)';

  return (
    <div style={{ marginBottom: isCal ? '16px' : '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
        <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {macro.name}
          {/* A floor that has been cleared is done, not overshot — say so
              where the number is, or 170 against a 165 floor looks like
              a miss in the other direction. */}
          {isFloor && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.9px', textTransform: 'uppercase',
                           marginLeft: 6, padding: '1px 4px', borderRadius: 3, verticalAlign: 'middle',
                           color: met ? 'var(--em)' : 'var(--text-muted)',
                           border: `1px solid ${met ? 'rgba(var(--em-rgb),.35)' : 'var(--border)'}`,
                           background: met ? 'rgba(var(--em-rgb),.08)' : 'transparent' }}>
              {met ? 'floor met' : 'floor'}
            </span>
          )}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: valueColour, whiteSpace: 'nowrap', opacity: 0.9, fontVariantNumeric: 'tabular-nums' }}>
          {fmt(consumed)}<span style={{ color: 'var(--text-muted)' }}>/{fmt(goal)}{macro.unit}</span>
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: over ? 'var(--amber)' : 'var(--text-mid)', minWidth: '34px', textAlign: 'right' }}>
          {Math.round(pct)}%
        </span>
        <button
          onClick={() => onMenuClick(macro)}
          style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: '14px', padding: '2px 4px', borderRadius: 'var(--radius-sm)', lineHeight: 1 }}
          title="Macro options"
        aria-label="Options"><Icon name="ellipsis" size={16} /></button>
      </div>
      <div style={{ height: isCal ? '12px' : '8px', background: 'rgba(128,128,128,.18)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
        <motion.div
          style={{ height: '100%', borderRadius: 'var(--radius-full)', background: colour, boxShadow: over ? `0 0 8px ${macro.color}66` : 'none' }}
          animate={{ width: `${animated}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

// ── MacroMenu popover ─────────────────────────────────────────────────────
function MacroMenu({ macro, onClose, onEdit, onMoveUp, onMoveDown, onDelete, isFirst, isLast }) {
  const ref = useRef(null);
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const menuStyle = {
    display: 'block', background: 'none', border: 'none', width: '100%',
    textAlign: 'left', padding: '8px 14px', fontSize: 'var(--text-sm)',
    color: 'var(--text)', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
  };

  return (
    <div ref={ref} style={{ position: 'absolute', right: 0, top: '100%', zIndex: 200, background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: '160px', padding: '4px' }}>
      <button style={menuStyle} onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,.05)'} onMouseLeave={e => e.currentTarget.style.background = 'none'} onClick={onEdit}>Edit goal</button>
      {!isFirst && <button style={menuStyle} onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,.05)'} onMouseLeave={e => e.currentTarget.style.background = 'none'} onClick={onMoveUp}><span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="arrow-up" size={13} /> Move up</span></button>}
      {!isLast && <button style={menuStyle} onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,.05)'} onMouseLeave={e => e.currentTarget.style.background = 'none'} onClick={onMoveDown}><span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="arrow-down" size={13} /> Move down</span></button>}
      {!macro.is_default && (
        <button style={{ ...menuStyle, color: '#e05252' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,.06)'} onMouseLeave={e => e.currentTarget.style.background = 'none'} onClick={onDelete}>Delete</button>
      )}
      {macro.is_default && (
        <div style={{ padding: '6px 14px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>Default — cannot delete</div>
      )}
    </div>
  );
}

// ── Inline edit row ───────────────────────────────────────────────────────
function InlineEdit({ macro, onSave, onCancel }) {
  const [name, setName] = useState(macro.name);
  const [goal, setGoal] = useState(macro.daily_goal);
  const [unit, setUnit] = useState(macro.unit);
  const [color, setColor] = useState(macro.color);

  const inputStyle = {
    fontSize: 'var(--text-sm)', padding: '5px 8px',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-base)', color: 'var(--text)', fontFamily: 'var(--sans)',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: 'rgba(0,0,0,.04)', borderRadius: 'var(--radius-md)', marginBottom: '10px', flexWrap: 'wrap' }}>
      <input value={name} onChange={e => setName(e.target.value)} style={{ ...inputStyle, flex: '1 1 80px', minWidth: '80px' }} placeholder="Name" />
      <input type="number" value={goal} onChange={e => setGoal(Number(e.target.value))} style={{ ...inputStyle, width: '70px' }} placeholder="Goal" />
      <input value={unit} onChange={e => setUnit(e.target.value)} style={{ ...inputStyle, width: '50px' }} placeholder="Unit" />
      <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: '32px', height: '32px', padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: 'none' }} />
      <button onClick={() => onSave({ name, daily_goal: goal, unit, color })} style={{ background: 'var(--em)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-xs)', display:'inline-flex' }} aria-label="Save"><Icon name="check" size={13} /></button>
      <button onClick={onCancel} style={{ background: 'rgba(0,0,0,.06)', color: 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-xs)', display:'inline-flex' }} aria-label="Cancel"><Icon name="x" size={13} /></button>
    </div>
  );
}

// ── Add Macro Sheet ───────────────────────────────────────────────────────
const CORE_MACROS = [
  { name: 'Calories', unit: 'kcal', daily_goal: 2000, color: '#e8b830' },
  { name: 'Protein',  unit: 'g',    daily_goal: 150,  color: '#1a7a4a' },
  { name: 'Carbs',    unit: 'g',    daily_goal: 250,  color: '#d4700a' },
  { name: 'Fat',      unit: 'g',    daily_goal: 70,   color: '#c84040' },
];
const SUGGESTED = [
  { name: 'Fibre', unit: 'g' }, { name: 'Sugar', unit: 'g' }, { name: 'Sodium', unit: 'mg' },
  { name: 'Saturated Fat', unit: 'g' }, { name: 'Vitamin C', unit: 'mg' }, { name: 'Vitamin D', unit: 'µg' },
  { name: 'Iron', unit: 'mg' }, { name: 'Calcium', unit: 'mg' }, { name: 'Omega-3', unit: 'g' },
  { name: 'Zinc', unit: 'mg' }, { name: 'Magnesium', unit: 'mg' },
];
const UNIT_CHIPS = ['g', 'mg', 'µg', 'kcal', 'ml'];

function AddMacroSheet({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', unit: 'g', daily_goal: '', color: '#1a7a4a' });

  const inputStyle = {
    padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-base)', color: 'var(--text)', fontSize: 'var(--text-sm)', fontFamily: 'var(--sans)',
  };

  /* Portalled: this sheet renders from inside the .card below, whose
   * backdrop-filter makes it a containing block for position:fixed. */
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'flex-end' }} {...backdropClose(() => onClose())}>
      <div style={{ width: '100%', background: 'var(--bg-base)', borderRadius: '20px 20px 0 0', padding: '24px 20px 40px', animation: 'sheet-up 300ms cubic-bezier(0.34,1.56,0.64,1) both', maxHeight: '85dvh', overflowY: 'auto' }}>
        <div style={{ width: '40px', height: '4px', background: 'var(--border)', borderRadius: '2px', margin: '0 auto 20px' }} />
        <h3 style={{ margin: '0 0 16px', fontSize: 'var(--text-md)', color: 'var(--text)' }}>Add Macro</h3>

        {/* Core macros */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--mono)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Core macros</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {CORE_MACROS.map(s => {
              const active = form.name === s.name;
              return (
                <button key={s.name} onClick={() => setForm(f => ({ ...f, name: s.name, unit: s.unit, daily_goal: s.daily_goal, color: s.color }))}
                  style={{ padding: '6px 14px', borderRadius: 'var(--radius-full)', border: `2px solid ${active ? s.color : 'var(--border)'}`, background: active ? s.color : 'transparent', color: active ? '#fff' : 'var(--text)', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--sans)', transition: 'all .15s' }}>
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Extended nutrients */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--mono)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Other nutrients</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {SUGGESTED.map(s => (
              <button key={s.name} onClick={() => setForm(f => ({ ...f, name: s.name, unit: s.unit }))}
                style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border)', background: form.name === s.name ? 'var(--em)' : 'transparent', color: form.name === s.name ? '#fff' : 'var(--text-mid)', fontSize: 'var(--text-xs)', cursor: 'pointer', fontFamily: 'var(--sans)' }}>
                {s.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input placeholder="Name (e.g. Vitamin B12)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />

          <div>
            <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--mono)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Unit</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {UNIT_CHIPS.map(u => (
                <button key={u} onClick={() => setForm(f => ({ ...f, unit: u }))}
                  style={{ padding: '4px 12px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border)', background: form.unit === u ? 'var(--em)' : 'transparent', color: form.unit === u ? '#fff' : 'var(--text-mid)', fontSize: 'var(--text-xs)', cursor: 'pointer', fontFamily: 'var(--mono)' }}>
                  {u}
                </button>
              ))}
              <input placeholder="other" value={UNIT_CHIPS.includes(form.unit) ? '' : form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                style={{ width: '60px', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', background: 'var(--bg-base)', color: 'var(--text)', fontSize: 'var(--text-xs)', fontFamily: 'var(--mono)' }} />
            </div>
          </div>

          <input type="number" placeholder="Daily goal" value={form.daily_goal} onChange={e => setForm(f => ({ ...f, daily_goal: e.target.value }))} style={inputStyle} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-mid)' }}>Colour</label>
            <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
              style={{ width: '40px', height: '40px', padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }} />
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-mid)', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)' }}>Cancel</button>
            <button
              onClick={() => { if (!form.name || !form.daily_goal) return; onSave({ ...form, daily_goal: Number(form.daily_goal) }); }}
              style={{ flex: 2, padding: '11px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--em)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              Add Macro
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main NutritionSection ────────────────────────────────────────────────
export default function NutritionSection({ userId, S, selectedDate, calYear, calMonth, onShowCoinToast, onMonthDataReady, onOpenModal, update }) {
  const date = selectedDate || getTodayStr();
  const { macros: rawMacros, summary, logEntries, monthSummary, loading, reload, recalcSummary, loadMonth } = useNutrition(userId, date);

  // The recomposition plan for the DATE BEING VIEWED, not for today —
  // scrolling back to a rest day should show that day's target, not
  // this one's. Inactive for anyone but the owner, in which case every
  // goal below is the macro's own and nothing changes.
  const plan = planDayFor(date, S);
  // Overridden once, here, so every downstream reader — the bars, the
  // goal-hit toast, the % written to macroHistory — picks it up without
  // each of them having to know the plan exists.
  const macros = useMemo(() => (rawMacros || []).map(m => {
    const g = planGoalFor(plan, m.name);
    return g == null ? m : { ...m, daily_goal: g, plannedGoal: true };
  }), [rawMacros, plan.active, plan.dayIndex, plan.session]);

  const [menuMacro, setMenuMacro] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showFoodSheet, setShowFoodSheet] = useState(false);
  const [showFoodSearch, setShowFoodSearch] = useState(false);
  const [foodPrefill, setFoodPrefill] = useState(null);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const goalHitRef = useRef({});

  /* What gets eaten often, for the rail's one-tap list. Ranked by count
     rather than recency — the thing you have had thirty times belongs
     at the top whether or not it was yesterday. */
  const freq = useFoodFrequency(userId);

  /** Re-log a frequent food exactly as it was last logged. No sheet:
      the whole point of the list is that it takes one tap. */
  async function quickAdd(row) {
    if (!userId || !row) return;
    const { error } = await supabase.from('nutrition_log').insert({
      user_id: userId,
      log_date: date,
      meal_type: row.meal_type || 'snack',
      food_name: row.food_name,
      brand: row.brand || null,
      serving_g: row.serving_g,
      calories: row.calories,
      protein_g: row.protein_g,
      carbs_g: row.carbs_g,
      fat_g: row.fat_g,
      fibre_g: row.fibre_g || 0,
      sugar_g: row.sugar_g || 0,
      sodium_mg: row.sodium_mg || 0,
      additional_nutrients: row.additional_nutrients || {},
      source: 'again',
    });
    if (error) { window.alert('Could not log that — try again.'); return; }
    await recalcSummary(date);
    reload();
    freq.refresh();
  }

  // Quick log from the hub Macros widget — it sets a one-shot flag and
  // navigates here; consume it and open the food search immediately.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('vb_quicklog_food')) {
        sessionStorage.removeItem('vb_quicklog_food');
        setShowFoodSearch(true);
      }
    } catch { /* ignore */ }
  }, []);

  // Load month summary when calendar month changes, and notify parent
  useEffect(() => {
    if (!userId) return;
    loadMonth(calYear, calMonth).then?.(() => {});
  }, [userId, calYear, calMonth, loadMonth]);

  // Propagate monthSummary up so CalendarView can render nutrition dots
  useEffect(() => {
    onMonthDataReady?.(monthSummary);
  }, [monthSummary, onMonthDataReady]);

  // Goal hit detection
  useEffect(() => {
    if (!summary || !macros.length) return;
    const calMacro = macros.find(m => m.name === 'Calories');
    const protMacro = macros.find(m => m.name === 'Protein');
    if (calMacro && calMacro.daily_goal > 0) {
      const ratio = summary.calories / calMacro.daily_goal;
      if (ratio >= 0.8 && ratio <= 1.1 && !goalHitRef.current[date + '_cal']) {
        goalHitRef.current[date + '_cal'] = true;
        onShowCoinToast?.('Calorie goal hit!', false);
      }
    }
    if (protMacro && protMacro.daily_goal > 0) {
      const ratio = summary.protein_g / protMacro.daily_goal;
      if (ratio >= 0.9 && !goalHitRef.current[date + '_prot']) {
        goalHitRef.current[date + '_prot'] = true;
        onShowCoinToast?.('Protein goal hit!', false);
      }
    }
  }, [summary, macros, date, onShowCoinToast]);

  // Macro % history — simplify each day's summary to "% of goal hit"
  // per core macro and persist it in synced state
  // (S.macroHistory['YYYY-MM-DD'] = { cal, pro, carb, fat }, integers).
  // Snapshotting the % (not the grams) keeps history honest if goals
  // change later. Only writes when a value actually changed so the
  // update→save loop can't spin.
  useEffect(() => {
    if (!update || !summary || !macros.length) return;
    const spec = {
      cal:  ['Calories', 'calories'],
      pro:  ['Protein',  'protein_g'],
      carb: ['Carbs',    'carbs_g'],
      fat:  ['Fat',      'fat_g'],
    };
    const pct = {};
    for (const k of Object.keys(spec)) {
      const [name, field] = spec[k];
      const m = macros.find(x => x.name === name);
      if (!m?.daily_goal) continue;
      pct[k] = Math.min(999, Math.round((Number(summary[field] || 0) / m.daily_goal) * 100));
    }
    if (!Object.keys(pct).length) return;
    update(prev => {
      const cur = (prev.macroHistory || {})[date];
      const same = cur &&
        Object.keys(pct).length === Object.keys(cur).length &&
        Object.keys(pct).every(k => cur[k] === pct[k]);
      if (same) return prev;
      return { ...prev, macroHistory: { ...(prev.macroHistory || {}), [date]: pct } };
    });
  }, [summary, macros, date, update]);

  const calMacro = macros.find(m => m.name === 'Calories');
  const calConsumed = summary?.calories || 0;
  const otherMacros = macros.filter(m => m.name !== 'Calories');

  async function handleSaveMacro(id, data) {
    await supabase.from('nutrition_macros').update(data).eq('id', id);
    setEditingId(null);
    setMenuMacro(null);
    reload();
  }

  async function handleDeleteMacro(macro) {
    if (macro.is_default) return;
    if (!window.confirm(`Delete "${macro.name}" macro?`)) return;
    await supabase.from('nutrition_macros').delete().eq('id', macro.id);
    setMenuMacro(null);
    reload();
  }

  async function handleMove(macro, dir) {
    const idx = macros.findIndex(m => m.id === macro.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= macros.length) return;
    const swap = macros[swapIdx];
    await Promise.all([
      supabase.from('nutrition_macros').update({ display_order: swap.display_order }).eq('id', macro.id),
      supabase.from('nutrition_macros').update({ display_order: macro.display_order }).eq('id', swap.id),
    ]);
    setMenuMacro(null);
    reload();
  }

  async function handleAddMacro(form) {
    const maxOrder = macros.reduce((m, x) => Math.max(m, x.display_order), 0);
    await supabase.from('nutrition_macros').insert({ user_id: userId, ...form, display_order: maxOrder + 1 });
    setShowAddSheet(false);
    reload();
  }

  if (loading) return null;

  /* Today's burn, for the ring inside the calorie ring. Same source the
     fitness rating reads — S.burnLog, one array of activities per day. */
  const burnToday = ((S?.burnLog || {})[date] || [])
    .reduce((sum, a) => sum + (Number(a?.kcal) || 0), 0);

  return (
    <div className="nut-wrap">
      <DietPanel
        S={S}
        date={date}
        summary={summary}
        logEntries={logEntries}
        macros={macros}
        burnKcal={burnToday}
        recents={freq.items}
        onLogFood={() => setShowFoodSearch(true)}
        onOpenGoals={() => setGoalsOpen(o => !o)}
        onQuickAdd={quickAdd}
        onDeleteEntry={async (entry) => {
          if (!window.confirm(`Remove ${entry.food_name}?`)) return;
          await supabase.from('nutrition_log').delete().eq('id', entry.id);
          await recalcSummary(date);
          reload();
          freq.refresh();
        }}
      />

      {/* ── Goals ──
          The macro targets and their editor, folded away by default.
          They are a setting, not a reading: you change them a few times
          a year and look at the rings every day. Opened from the chip on
          the energy card. */}
      {goalsOpen && (
        <div className="card nut-goals">
          <div className="tv-rule">
            <span>Daily targets</span><i />
            <em>{formatDate(date)}</em>
          </div>

          {plan.active && (
            <div className="nut-plan">
              <span className="nut-plan-badge">{planBadge(plan)}</span>
              {plan.targets.kcalDelta !== 0 && (
                <span className={'nut-plan-d' + (plan.targets.kcalDelta > 0 ? ' is-up' : ' is-down')}>
                  {plan.targets.kcalDelta > 0 ? '+' : '\u2212'}{Math.abs(plan.targets.kcalDelta)} kcal
                </span>
              )}
              <span className="nut-plan-why">
                {plan.isRest
                  ? 'Rest day — the training days pay for this one'
                  : plan.isNight
                    ? 'Night shift at maintenance · session at 80%'
                    : `${plan.session} day`}
              </span>
            </div>
          )}

          <div style={{ position: 'relative' }}>
            {calMacro && (
              <>
                {editingId === calMacro.id
                  ? <InlineEdit macro={calMacro} onSave={d => handleSaveMacro(calMacro.id, d)} onCancel={() => setEditingId(null)} />
                  : (
                    <div style={{ position: 'relative' }}>
                      <MacroBar macro={calMacro} consumed={calConsumed} isCal index={0} onMenuClick={m => setMenuMacro(menuMacro?.id === m.id ? null : m)} />
                      {menuMacro?.id === calMacro.id && (
                        <MacroMenu macro={calMacro} onClose={() => setMenuMacro(null)}
                          onEdit={() => { setEditingId(calMacro.id); setMenuMacro(null); }}
                          onMoveUp={() => handleMove(calMacro, -1)} onMoveDown={() => handleMove(calMacro, 1)}
                          onDelete={() => handleDeleteMacro(calMacro)}
                          isFirst isLast={otherMacros.length === 0} />
                      )}
                    </div>
                  )
                }
                {otherMacros.length > 0 && <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0 14px' }} />}
              </>
            )}

            {otherMacros.map((macro, i) => {
              const consumed = getMacroValue(summary, macro);
              return (
                <div key={macro.id} style={{ position: 'relative' }}>
                  {editingId === macro.id
                    ? <InlineEdit macro={macro} onSave={d => handleSaveMacro(macro.id, d)} onCancel={() => setEditingId(null)} />
                    : (
                      <>
                        <MacroBar macro={macro} consumed={consumed} index={i + 1} onMenuClick={m => setMenuMacro(menuMacro?.id === m.id ? null : m)} />
                        {menuMacro?.id === macro.id && (
                          <MacroMenu macro={macro} onClose={() => setMenuMacro(null)}
                            onEdit={() => { setEditingId(macro.id); setMenuMacro(null); }}
                            onMoveUp={() => handleMove(macro, -1)} onMoveDown={() => handleMove(macro, 1)}
                            onDelete={() => handleDeleteMacro(macro)}
                            isFirst={i === 0} isLast={i === otherMacros.length - 1} />
                        )}
                      </>
                    )
                  }
                </div>
              );
            })}

            <button onClick={() => setShowAddSheet(true)}
              style={{ width: '100%', marginTop: '10px', padding: '8px', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)' }}>
              + Add macro
            </button>
          </div>
        </div>
      )}

      {/* Sheets */}
      <AnimatePresence>
        {showAddSheet && <AddMacroSheet onClose={() => setShowAddSheet(false)} onSave={handleAddMacro} />}
      </AnimatePresence>

      {showFoodSearch && (
        <FoodSearch
          onClose={() => setShowFoodSearch(false)}
          onOpenModal={onOpenModal}
          userId={userId}
          savedMeals={S?.savedMeals || []}
          onDeleteMeal={(id) => update?.(prev => ({ ...prev, savedMeals: (prev.savedMeals || []).filter(m => m.id !== id) }))}
          onSelectFood={(prefill) => {
            setShowFoodSearch(false);
            setFoodPrefill(prefill || null);
            setShowFoodSheet(true);
          }}
        />
      )}

      {showFoodSheet && (
        <FoodLogSheet
          userId={userId}
          logDate={date}
          prefill={foodPrefill}
          onSaveMeal={(meal) => update?.(prev => {
            // De-dupe by name (case-insensitive) — re-saving an edited
            // meal replaces the old template rather than piling up.
            const others = (prev.savedMeals || []).filter(m => m.name.trim().toLowerCase() !== meal.name.trim().toLowerCase());
            return { ...prev, savedMeals: [...others, meal] };
          })}
          onClose={() => { setShowFoodSheet(false); setFoodPrefill(null); }}
          onSaved={() => { recalcSummary(date); reload(); }}
        />
      )}
    </div>
  );
}
