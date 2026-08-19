/**
 * Enter today's readings.
 *
 * Only the three a person can take without a device — weight, sleep,
 * resting heart rate. Anything a strap reports is left to the strap: a
 * hand-typed HRV that overwrites a synced one is a silent data loss, so
 * the fields simply are not offered.
 *
 * Writes are additive per key. Clearing a field removes that ONE value
 * and leaves the rest of the day alone; emptying a day removes the day.
 */
import { useState } from 'react';
import { backdropClose } from '../../utils/backdropClose';
import { ymd } from '../../lib/vitals/readiness';

const FIELDS = [
  { key: 'weight', label: 'Weight', unit: 'kg',  step: '0.1', max: 400, hint: 'Same time of day is what makes the line readable.' },
  { key: 'sleep',  label: 'Sleep',  unit: 'h',   step: '0.1', max: 24,  hint: 'Hours actually asleep, to the nearest tenth.' },
  { key: 'rhr',    label: 'Rest HR', unit: 'bpm', step: '1',  max: 250, hint: 'Lowest resting figure you saw today.' },
];

export default function VitalsEntryModal({ S, update, onClose }) {
  const today = ymd();
  const existing = (S?.vitalsLog || {})[today] || {};
  const [draft, setDraft] = useState(() => Object.fromEntries(
    FIELDS.map(f => [f.key, existing[f.key] != null ? String(existing[f.key]) : '']),
  ));
  const [error, setError] = useState(null);

  function save() {
    // Validate everything before writing anything — a modal that saves
    // two of three fields and then complains is worse than one that
    // refuses cleanly.
    const next = {};
    for (const f of FIELDS) {
      const raw = (draft[f.key] || '').trim();
      if (raw === '') { next[f.key] = null; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n > f.max) {
        setError(`${f.label} should be a number between 0 and ${f.max}.`);
        return;
      }
      next[f.key] = n;
    }

    update(prev => {
      const log = { ...(prev.vitalsLog || {}) };
      const day = { ...(log[today] || {}) };
      for (const [k, v] of Object.entries(next)) {
        if (v == null) delete day[k]; else day[k] = v;
      }
      if (Object.keys(day).length) log[today] = day; else delete log[today];
      return { ...prev, vitalsLog: log };
    });
    onClose();
  }

  return (
    <div className="modal-overlay open" {...backdropClose(onClose)}>
      <div className="modal tv-entry" style={{ maxWidth: 420 }}>
        <div className="tv-entry-eyebrow">Today · {today}</div>
        <h3 className="tv-entry-title">Enter readings</h3>

        {FIELDS.map(f => (
          <label key={f.key} className="tv-field">
            <span className="tv-field-lbl">{f.label} <em>{f.unit}</em></span>
            <input
              type="number" inputMode="decimal" step={f.step} max={f.max} min="0"
              value={draft[f.key]}
              placeholder="—"
              onChange={e => { setError(null); setDraft(d => ({ ...d, [f.key]: e.target.value })); }}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
            />
            <span className="tv-field-hint">{f.hint}</span>
          </label>
        ))}

        {error && <div className="tv-entry-error">{error}</div>}

        <p className="tv-note">
          HRV, recovery, strain and burn come from your wearable — typing over a synced
          reading would lose it, so they are not offered here.
        </p>

        <div className="tv-entry-actions">
          <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
