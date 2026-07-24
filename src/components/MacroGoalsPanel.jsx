import { useState, useEffect } from 'react';
import Icon from './Icon';
import { supabase } from '../lib/supabase';

const UNIT_OPTIONS = ['g', 'mg', 'µg', 'kcal', 'ml', 'IU'];

const EMPTY_FORM = { name: '', unit: 'g', daily_goal: '', color: '#1a7a4a' };

function MacroRow({ macro, isFirst, isLast, onSave, onDelete, onMove }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: macro.name, unit: macro.unit, daily_goal: macro.daily_goal, color: macro.color });

  useEffect(() => {
    setForm({ name: macro.name, unit: macro.unit, daily_goal: macro.daily_goal, color: macro.color });
  }, [macro]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const inputStyle = {
    padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-base)', color: 'var(--text)', fontSize: 'var(--text-sm)', fontFamily: 'var(--sans)',
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px', background: 'rgba(0,0,0,.04)', borderRadius: 'var(--radius-md)', marginBottom: '8px', flexWrap: 'wrap' }}>
        <input value={form.name} onChange={e => set('name', e.target.value)} style={{ ...inputStyle, flex: '1 1 80px', minWidth: '80px' }} placeholder="Name" disabled={macro.is_default} />
        <input type="number" value={form.daily_goal} onChange={e => set('daily_goal', e.target.value)} style={{ ...inputStyle, width: '70px' }} placeholder="Goal" min="0" />
        <select value={form.unit} onChange={e => set('unit', e.target.value)} style={{ ...inputStyle, width: '64px' }}>
          {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
          {!UNIT_OPTIONS.includes(form.unit) && <option value={form.unit}>{form.unit}</option>}
        </select>
        <input type="color" value={form.color} onChange={e => set('color', e.target.value)} style={{ width: '32px', height: '32px', padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }} />
        <button
          onClick={() => { onSave(macro.id, { ...form, daily_goal: Number(form.daily_goal) }); setEditing(false); }}
          style={{ background: 'var(--em)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '5px 10px', cursor: 'pointer', fontSize: 'var(--text-xs)', fontFamily: 'var(--sans)' }}>
          <span style={{display:'inline-flex',alignItems:'center',gap:5}}><Icon name="check" size={13} /> Save</span>
        </button>
        <button onClick={() => setEditing(false)} style={{ background: 'rgba(0,0,0,.06)', color: 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '5px 10px', cursor: 'pointer', fontSize: 'var(--text-xs)', fontFamily: 'var(--sans)' }}>
          ✗
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: macro.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{macro.name}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{macro.daily_goal} {macro.unit} / day</div>
      </div>
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        {!isFirst && (
          <button onClick={() => onMove(macro, -1)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '3px 7px', fontSize: '11px', display:'inline-flex' }} aria-label="Move up"><Icon name="arrow-up" size={12} /></button>
        )}
        {!isLast && (
          <button onClick={() => onMove(macro, 1)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '3px 7px', fontSize: '11px', display:'inline-flex' }} aria-label="Move down"><Icon name="arrow-down" size={12} /></button>
        )}
        <button onClick={() => setEditing(true)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-mid)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '3px 8px', fontSize: 'var(--text-xs)', fontFamily: 'var(--sans)' }}>Edit</button>
        {!macro.is_default && (
          <button onClick={() => onDelete(macro)} style={{ background: 'none', border: '1px solid rgba(220,38,38,.3)', color: '#e05252', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '3px 7px', fontSize: '11px', display:'inline-flex' }} aria-label="Delete"><Icon name="x" size={12} /></button>
        )}
      </div>
    </div>
  );
}

export default function MacroGoalsPanel({ userId }) {
  const [macros, setMacros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM });

  async function load() {
    const { data } = await supabase
      .from('nutrition_macros')
      .select('*')
      .eq('user_id', userId)
      .order('display_order', { ascending: true });
    setMacros(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (userId) load();
  }, [userId]);

  async function handleSave(id, data) {
    await supabase.from('nutrition_macros').update(data).eq('id', id);
    load();
  }

  async function handleDelete(macro) {
    if (!window.confirm(`Delete "${macro.name}"? This removes it from all future logs.`)) return;
    await supabase.from('nutrition_macros').delete().eq('id', macro.id);
    load();
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
    load();
  }

  async function handleAdd() {
    if (!addForm.name.trim() || !addForm.daily_goal) return;
    const maxOrder = macros.reduce((m, x) => Math.max(m, x.display_order), 0);
    await supabase.from('nutrition_macros').insert({
      user_id: userId,
      name: addForm.name.trim(),
      unit: addForm.unit,
      daily_goal: Number(addForm.daily_goal),
      color: addForm.color,
      display_order: maxOrder + 1,
      is_default: false,
    });
    setAddForm({ ...EMPTY_FORM });
    setShowAdd(false);
    load();
  }

  const inputStyle = {
    padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-base)', color: 'var(--text)', fontSize: 'var(--text-sm)', fontFamily: 'var(--sans)',
  };

  if (loading) return null;

  return (
    <div className="card" style={{ padding: '22px' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 'var(--text-md)', color: 'var(--text)' }}>Nutrition Goals</h3>
      <p style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 18px', letterSpacing: '0.5px', lineHeight: '1.6' }}>
        Set daily targets for each macro. These appear as progress bars on the Track page.
      </p>

      {macros.length === 0 && (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 'var(--text-sm)' }}>
          No macros yet — add one below.
        </div>
      )}

      {macros.map((macro, i) => (
        <MacroRow
          key={macro.id}
          macro={macro}
          isFirst={i === 0}
          isLast={i === macros.length - 1}
          onSave={handleSave}
          onDelete={handleDelete}
          onMove={handleMove}
        />
      ))}

      {/* Add new macro inline */}
      {showAdd ? (
        <div style={{ marginTop: '14px', padding: '12px', background: 'rgba(0,0,0,.04)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>New macro</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Name"
              value={addForm.name}
              onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
              style={{ ...inputStyle, flex: '1 1 100px', minWidth: '100px' }}
              autoFocus
            />
            <input
              type="number"
              placeholder="Goal"
              value={addForm.daily_goal}
              onChange={e => setAddForm(f => ({ ...f, daily_goal: e.target.value }))}
              style={{ ...inputStyle, width: '80px' }}
              min="0"
            />
            <select value={addForm.unit} onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))} style={{ ...inputStyle, width: '72px' }}>
              {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input
              type="color"
              value={addForm.color}
              onChange={e => setAddForm(f => ({ ...f, color: e.target.value }))}
              style={{ width: '36px', height: '36px', padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
            />
            <button onClick={handleAdd} style={{ background: 'var(--em)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '7px 14px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>Add</button>
            <button onClick={() => setShowAdd(false)} style={{ background: 'rgba(0,0,0,.06)', color: 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '7px 12px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)' }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          style={{ marginTop: '14px', width: '100%', padding: '9px', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)' }}>
          + Add macro
        </button>
      )}
    </div>
  );
}
