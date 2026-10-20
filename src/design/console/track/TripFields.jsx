/**
 * Console trip form fields. Same form SHAPE as the classic trip modals
 * (emptyHolidayForm in components/holiday/HolidayFormTabs.jsx) and the
 * same save path (trips.js), drawn in console controls. Basics is
 * re-drawn here because the classic Basics group carries emoji status
 * options and its own image field; Itinerary and Budget reuse the
 * classic field groups as they are (re-skinned by track.css).
 */
import { useRef, useState } from 'react';
import { Segmented, Button } from '../ui';
import { selectableGoals } from '../../../lib/holiday/savings';
import { resizePhoto } from './photo';
import { photoOf } from './trips';
import TIcon from './icons';

export const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'booked', label: 'Booked' },
  { value: 'completed', label: 'Done' },
];

export function CoverField({ value, onChange, idPrefix }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const photo = photoOf({ imageUrl: value });
  const isData = (value || '').startsWith('data:');
  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { onChange(await resizePhoto(file, 900)); } catch { /* not an image */ }
    setBusy(false);
  }
  return (
    <div className="cx-field cx-track-coverfield">
      <span className="cx-label">Cover photo</span>
      <button type="button" className={`cx-track-coverpick${photo ? ' has-photo' : ''}`}
              style={photo ? { backgroundImage: `url("${photo}")` } : undefined}
              onClick={() => fileRef.current?.click()} aria-label={photo ? 'Change cover photo' : 'Choose a cover photo'}>
        <span className="cx-track-cover-ov" />
        <span className="cx-track-photo-btn"><TIcon name="camera" size={14} />{busy ? 'Adding…' : photo ? 'Change photo' : 'Cover photo'}</span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {!isData && (
        <input id={`${idPrefix}-url`} className="cx-input" type="url" placeholder="Or paste a photo link" value={value || ''}
               onChange={e => onChange(e.target.value)} aria-label="Cover photo link" />
      )}
      {value && <Button variant="ghost" onClick={() => onChange('')}>Remove photo</Button>}
    </div>
  );
}

export function SavingsPotField({ S, value, onChange, idPrefix }) {
  const goals = selectableGoals(S);
  const linked = goals.find(g => g.id === value) || null;
  return (
    <div className="cx-field">
      <label className="cx-label" htmlFor={`${idPrefix}-pot`}>Link a savings pot</label>
      <select id={`${idPrefix}-pot`} className="cx-input" value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">Not linked</option>
        {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {linked && (
        <span className="cx-track-hint cx-num">
          £{Math.round(Number(linked.current) || 0).toLocaleString('en-GB')} of £{Math.round(Number(linked.target) || 0).toLocaleString('en-GB')}
        </span>
      )}
      {!goals.length && <span className="cx-track-hint">No savings pots yet. Make one under Savings and it shows here.</span>}
    </div>
  );
}

export function BasicsFields({ form, setForm, idPrefix = 'trip' }) {
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  return (
    <div className="cx-track-form">
      <CoverField value={form.imageUrl} onChange={v => setForm(f => ({ ...f, imageUrl: v }))} idPrefix={idPrefix} />
      <div className="cx-field">
        <label className="cx-label" htmlFor={`${idPrefix}-dest`}>Trip</label>
        <input id={`${idPrefix}-dest`} className="cx-input" type="text" placeholder="Lisbon, Portugal" value={form.dest} onChange={set('dest')} />
      </div>
      <div className="cx-track-two">
        <div className="cx-field">
          <label className="cx-label" htmlFor={`${idPrefix}-from`}>From</label>
          <input id={`${idPrefix}-from`} className="cx-input" type="date" value={form.from} onChange={set('from')} />
        </div>
        <div className="cx-field">
          <label className="cx-label" htmlFor={`${idPrefix}-to`}>To</label>
          <input id={`${idPrefix}-to`} className="cx-input" type="date" value={form.to} min={form.from || undefined} onChange={set('to')} />
        </div>
      </div>
      <div className="cx-field">
        <span className="cx-label">Status</span>
        <Segmented label="Status" options={STATUS_OPTIONS} value={form.status || 'planning'} onChange={v => setForm(f => ({ ...f, status: v }))} />
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor={`${idPrefix}-flight`}>Flight</label>
        <input id={`${idPrefix}-flight`} className="cx-input" type="text" placeholder="EasyJet EZY1234, 06:30 LGW → LIS" value={form.flight} onChange={set('flight')} />
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor={`${idPrefix}-accom`}>Stay</label>
        <input id={`${idPrefix}-accom`} className="cx-input" type="text" placeholder="Hotel, Airbnb…" value={form.accom} onChange={set('accom')} />
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor={`${idPrefix}-budget`}>Budget</label>
        <input id={`${idPrefix}-budget`} className="cx-input" type="text" placeholder="£1,200" value={form.budget} onChange={set('budget')} />
      </div>
      <div className="cx-field">
        <label className="cx-label" htmlFor={`${idPrefix}-notes`}>Notes</label>
        <textarea id={`${idPrefix}-notes`} className="cx-input" rows={3} placeholder="Things to do, packing, ideas" value={form.notes} onChange={set('notes')} />
      </div>
    </div>
  );
}
