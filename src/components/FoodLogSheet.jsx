import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { backdropClose } from '../utils/backdropClose';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

const FIELD_DEFS = [
  { key: 'calories',  label: 'Calories', unit: 'kcal', step: '1' },
  { key: 'protein_g', label: 'Protein',  unit: 'g',    step: '0.1' },
  { key: 'carbs_g',   label: 'Carbs',    unit: 'g',    step: '0.1' },
  { key: 'fat_g',     label: 'Fat',      unit: 'g',    step: '0.1' },
  { key: 'fibre_g',   label: 'Fibre',    unit: 'g',    step: '0.1' },
  { key: 'sugar_g',   label: 'Sugar',    unit: 'g',    step: '0.1' },
  { key: 'sodium_mg', label: 'Sodium',   unit: 'mg',   step: '1'   },
];

const EMPTY_FORM = {
  meal_type: 'breakfast',
  food_name: '',
  brand: '',
  serving_g: '100',
  calories: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
  fibre_g: '',
  sugar_g: '',
  sodium_mg: '',
};

export default function FoodLogSheet({ userId, logDate, onClose, onSaved, prefill }) {
  const [form, setForm] = useState(prefill ? { ...EMPTY_FORM, ...prefill } : { ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSave() {
    if (!form.food_name.trim()) { setError('Food name is required.'); return; }
    setSaving(true);
    setError('');
    const row = {
      user_id: userId,
      log_date: logDate,
      meal_type: form.meal_type,
      food_name: form.food_name.trim(),
      brand: form.brand.trim() || null,
      serving_g: parseFloat(form.serving_g) || 100,
      calories:  parseFloat(form.calories)  || 0,
      protein_g: parseFloat(form.protein_g) || 0,
      carbs_g:   parseFloat(form.carbs_g)   || 0,
      fat_g:     parseFloat(form.fat_g)     || 0,
      fibre_g:   parseFloat(form.fibre_g)   || 0,
      sugar_g:   parseFloat(form.sugar_g)   || 0,
      sodium_mg: parseFloat(form.sodium_mg) || 0,
      additional_nutrients: {},
      source: 'manual',
    };
    const { error: err } = await supabase.from('nutrition_log').insert(row);
    if (err) { setError('Failed to save. Please try again.'); setSaving(false); return; }
    setSaving(false);
    onSaved?.();
    onClose();
  }

  const inputStyle = {
    padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-base)', color: 'var(--text)', fontSize: 'var(--text-sm)',
    fontFamily: 'var(--sans)', width: '100%', boxSizing: 'border-box',
  };
  const labelStyle = {
    fontSize: 'var(--text-xs)', fontFamily: 'var(--mono)', color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px', display: 'block',
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}
      {...backdropClose(() => onClose())}
    >
      <div style={{ width: '100%', background: 'var(--bg-base)', borderRadius: '20px 20px 0 0', padding: '24px 20px 44px', animation: 'sheet-up 300ms cubic-bezier(0.34,1.56,0.64,1) both', maxHeight: '92dvh', overflowY: 'auto' }}>
        {/* Handle */}
        <div style={{ width: '40px', height: '4px', background: 'var(--border)', borderRadius: '2px', margin: '0 auto 20px' }} />

        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text)', fontFamily: 'var(--serif)' }}>Log Food</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
        </div>

        {/* Meal type chips */}
        <div style={{ marginBottom: '18px' }}>
          <span style={labelStyle}>Meal</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {MEAL_TYPES.map(m => (
              <button key={m} onClick={() => set('meal_type', m)}
                style={{ padding: '6px 14px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border)', background: form.meal_type === m ? 'var(--em)' : 'transparent', color: form.meal_type === m ? '#fff' : 'var(--text-mid)', fontSize: 'var(--text-sm)', cursor: 'pointer', fontFamily: 'var(--sans)', textTransform: 'capitalize' }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Food name + brand */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '18px' }}>
          <div>
            <label style={labelStyle}>Food name *</label>
            <input value={form.food_name} onChange={e => set('food_name', e.target.value)} style={inputStyle} placeholder="e.g. Chicken breast" autoFocus />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>Brand (optional)</label>
              <input value={form.brand} onChange={e => set('brand', e.target.value)} style={inputStyle} placeholder="e.g. Tesco" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Serving (g)</label>
              <input type="number" value={form.serving_g} onChange={e => set('serving_g', e.target.value)} style={inputStyle} placeholder="100" min="0" step="1" />
            </div>
          </div>
        </div>

        {/* Macro fields — 2 column grid */}
        <div style={{ marginBottom: '8px' }}>
          <span style={labelStyle}>Nutrition per serving</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {FIELD_DEFS.map(f => (
              <div key={f.key}>
                <label style={{ ...labelStyle, marginBottom: '3px' }}>{f.label} <span style={{ color: 'var(--text-muted)', fontStyle: 'normal' }}>({f.unit})</span></label>
                <input
                  type="number"
                  value={form[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                  style={inputStyle}
                  placeholder="0"
                  min="0"
                  step={f.step}
                />
              </div>
            ))}
          </div>
        </div>

        {error && <div style={{ color: '#e05252', fontSize: 'var(--text-xs)', marginBottom: '10px', fontFamily: 'var(--mono)' }}>{error}</div>}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-mid)', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 2, padding: '12px', borderRadius: 'var(--radius-md)', border: 'none', background: saving ? 'var(--border)' : 'var(--em)', color: '#fff', cursor: saving ? 'default' : 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Save Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
