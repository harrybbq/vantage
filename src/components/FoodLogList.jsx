import { useState } from 'react';
import { supabase } from '../lib/supabase';

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
// Mono letter chips instead of emoji — matches the operator-console look.
const MEAL_ICONS = { breakfast: 'B', lunch: 'L', dinner: 'D', snack: 'S' };

function fmt(n) {
  if (!n && n !== 0) return '—';
  const v = Number(n);
  if (v === 0) return '0';
  return v < 1 ? v.toFixed(1) : Math.round(v).toString();
}

function EntryRow({ entry, onDelete, onEdit }) {
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return; }
    await supabase.from('nutrition_log').delete().eq('id', entry.id);
    onDelete?.(entry.id);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {entry.food_name}
          {entry.brand && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '5px', fontSize: 'var(--text-xs)' }}>{entry.brand}</span>}
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '3px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: 'var(--text-mid)' }}>{fmt(entry.calories)} kcal</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>P {fmt(entry.protein_g)}g</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>C {fmt(entry.carbs_g)}g</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>F {fmt(entry.fat_g)}g</span>
          {entry.serving_g !== 100 && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{entry.serving_g}g</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        <button
          onClick={handleDelete}
          onBlur={() => setConfirming(false)}
          style={{ background: confirming ? 'rgba(220,38,38,.12)' : 'none', border: 'none', color: confirming ? '#e05252' : 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', padding: '4px 7px', borderRadius: 'var(--radius-sm)', transition: 'all .15s' }}
          title={confirming ? 'Tap again to confirm delete' : 'Delete entry'}
        >
          {confirming ? '✕ sure?' : '✕'}
        </button>
      </div>
    </div>
  );
}

function MealGroup({ mealType, entries, onDeleteEntry }) {
  const [expanded, setExpanded] = useState(true);
  const total = entries.reduce((s, e) => s + (e.calories || 0), 0);

  return (
    <div style={{ marginBottom: '16px' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(var(--em-rgb),.12)', border: '1px solid rgba(var(--em-rgb),.3)', color: 'var(--em)', fontFamily: 'var(--mono)', fontSize: '10px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{MEAL_ICONS[mealType] || 'M'}</span>
        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text)', textTransform: 'capitalize', flex: 1 }}>{mealType}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{Math.round(total)} kcal</span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && entries.map(entry => (
        <EntryRow key={entry.id} entry={entry} onDelete={onDeleteEntry} />
      ))}
    </div>
  );
}

export default function FoodLogList({ logEntries, onDeleteEntry, onAddFood }) {
  if (!logEntries || logEntries.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginBottom: '12px' }}>
          No entries yet
        </div>
        <button
          onClick={onAddFood}
          style={{ padding: '8px 18px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-mid)', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)' }}>
          + Log first food
        </button>
      </div>
    );
  }

  // Group by meal type in fixed order
  const grouped = MEAL_ORDER.reduce((acc, m) => {
    const entries = logEntries.filter(e => e.meal_type === m);
    if (entries.length) acc.push({ mealType: m, entries });
    return acc;
  }, []);

  // Also catch any unexpected meal types
  const seen = new Set(MEAL_ORDER);
  const extras = logEntries.filter(e => !seen.has(e.meal_type));
  if (extras.length) grouped.push({ mealType: 'snack', entries: extras });

  return (
    <div style={{ marginTop: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Today's log
        </span>
        <button
          onClick={onAddFood}
          style={{ background: 'none', border: 'none', color: 'var(--em)', cursor: 'pointer', fontSize: 'var(--text-xs)', fontFamily: 'var(--sans)', fontWeight: 600 }}>
          + Add
        </button>
      </div>
      {grouped.map(({ mealType, entries }) => (
        <MealGroup key={mealType} mealType={mealType} entries={entries} onDeleteEntry={onDeleteEntry} />
      ))}
    </div>
  );
}
