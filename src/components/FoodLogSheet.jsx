import { useState, useRef } from 'react';
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
  serving_unit: 'g',  // 'g' | 'ml' — ml accommodates liquids; the
                      // number still drives macro scaling identically
  calories: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
  fibre_g: '',
  sugar_g: '',
  sodium_mg: '',
};

const NUTRIENT_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g', 'sugar_g', 'sodium_mg'];

// Fallback liquid detection for prefills that don't carry a serving_unit
// (older saved meals, older API responses). Search results and AI scans
// now send serving_unit themselves, which always wins.
const LIQUID_WORDS = /\b(milk|juice|water|cola|soda|lemonade|drink|smoothie|shake|coffee|latte|tea|beer|lager|cider|wine|vodka|gin|rum|whisky|kombucha|squash|cordial|broth|beverage)\b/i;
function withLiquidDefault(prefill) {
  if (!prefill) return null;
  if (prefill.serving_unit) return prefill;
  if (LIQUID_WORDS.test(prefill.food_name || '')) return { ...prefill, serving_unit: 'ml' };
  return prefill;
}

export default function FoodLogSheet({ userId, logDate, onClose, onSaved, prefill, onSaveMeal }) {
  const [form, setForm] = useState(() => {
    const p = withLiquidDefault(prefill);
    return p ? { ...EMPTY_FORM, ...p } : { ...EMPTY_FORM };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Per-gram nutrient densities so editing the serving size rescales
  // every macro proportionally (e.g. search prefills per-100g; typing
  // 150g lifts calories/protein/etc by 1.5×). Seeded from the initial
  // values; a manual edit to a nutrient re-derives that field's
  // density at the current serving, so hand-tuned numbers keep
  // scaling correctly afterwards.
  const perGramRef = useRef((() => {
    const initial = prefill ? { ...EMPTY_FORM, ...prefill } : EMPTY_FORM;
    const serving = parseFloat(initial.serving_g) || 100;
    const map = {};
    for (const k of NUTRIENT_KEYS) {
      const v = parseFloat(initial[k]);
      map[k] = Number.isFinite(v) && serving > 0 ? v / serving : null;
    }
    return map;
  })());

  function set(key, val) {
    if (key === 'serving_g') {
      setForm(f => {
        const next = { ...f, serving_g: val };
        const g = parseFloat(val);
        if (Number.isFinite(g) && g > 0) {
          for (const k of NUTRIENT_KEYS) {
            const density = perGramRef.current[k];
            if (density == null) continue;
            const scaled = density * g;
            next[k] = k === 'calories' || k === 'sodium_mg'
              ? String(Math.round(scaled))
              : String(Math.round(scaled * 10) / 10);
          }
        }
        return next;
      });
      return;
    }
    // Manual nutrient edit → that field's density follows the new
    // value at the current serving size.
    if (NUTRIENT_KEYS.includes(key)) {
      setForm(f => {
        const g = parseFloat(f.serving_g);
        const v = parseFloat(val);
        perGramRef.current[key] = Number.isFinite(v) && Number.isFinite(g) && g > 0 ? v / g : null;
        return { ...f, [key]: val };
      });
      return;
    }
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
      // serving_g column stays numeric; the unit (g/ml) rides in the
      // JSON so liquid servings display correctly without a schema change.
      additional_nutrients: form.serving_unit === 'ml' ? { serving_unit: 'ml' } : {},
      source: 'manual',
    };
    // Race the insert against a timeout. Without this, a stalled request
    // (auth-token refresh hanging, DB briefly unresponsive, flaky mobile
    // connection) leaves the button pinned on "Saving…" forever with no
    // error and no way to retry.
    let err;
    try {
      const insert = supabase.from('nutrition_log').insert(row);
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 12000));
      const res = await Promise.race([insert, timeout]);
      err = res?.error;
    } catch {
      err = { message: 'timeout' };
    }
    if (err) { setError('Couldn’t save — check your connection and try again.'); setSaving(false); return; }
    setSaving(false);
    onSaved?.();
    onClose();
  }

  const [savedMeal, setSavedMeal] = useState(false);
  function handleSaveMeal() {
    if (!form.food_name.trim()) { setError('Give the meal a name before saving it.'); return; }
    onSaveMeal?.({
      id: 'meal' + Date.now(),
      name: form.food_name.trim(),
      food_name: form.food_name.trim(),
      brand: form.brand.trim(),
      meal_type: form.meal_type,
      serving_g: form.serving_g,
      serving_unit: form.serving_unit,
      calories: form.calories,
      protein_g: form.protein_g,
      carbs_g: form.carbs_g,
      fat_g: form.fat_g,
      fibre_g: form.fibre_g,
      sugar_g: form.sugar_g,
      sodium_mg: form.sodium_mg,
    });
    setSavedMeal(true);
    setTimeout(() => setSavedMeal(false), 2000);
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
              <label style={labelStyle}>Serving ({form.serving_unit})</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="number" value={form.serving_g} onChange={e => set('serving_g', e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 0 }} placeholder="100" min="0" step="1" />
                <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', flexShrink: 0 }}>
                  {['g', 'ml'].map(u => (
                    <button key={u} type="button" onClick={() => set('serving_unit', u)}
                      style={{ padding: '0 10px', border: 'none', background: form.serving_unit === u ? 'var(--em)' : 'transparent', color: form.serving_unit === u ? '#fff' : 'var(--text-mid)', fontFamily: 'var(--mono)', fontSize: '11px', cursor: 'pointer' }}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
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

        {/* Save as reusable meal template */}
        {onSaveMeal && (
          <button onClick={handleSaveMeal} type="button"
            style={{ width: '100%', marginTop: '6px', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)', background: 'transparent', color: savedMeal ? 'var(--em)' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', transition: 'color .15s' }}>
            {savedMeal ? 'Saved to your meals' : 'Save as a meal for later'}
          </button>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
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
