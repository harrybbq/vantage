/**
 * Edit a trip: Basics · Itinerary · Budget, then Save, or Delete.
 *
 * The form is seeded exactly as the classic EditHolidayModal seeds it
 * (every optional extra included, because the save spreads the form
 * over the record and a field missing here would be written back
 * empty), and saved through trips.js editTrip — classic's
 * handleEditHoliday. Itinerary and Budget are the classic field groups
 * themselves (components/holiday/HolidayFormTabs.jsx).
 */
import { useState } from 'react';
import { Sheet, Button, Segmented } from '../ui';
import { ItineraryFields } from '../../../components/holiday/HolidayFormTabs';
import { editTrip, deleteTrip } from './trips';
import { BasicsFields, SavingsPotField } from './TripFields';

const TABS = [
  { value: 'basics', label: 'Basics' },
  { value: 'itinerary', label: 'Itinerary' },
  { value: 'budget', label: 'Budget' },
];

const seed = h => ({
  dest: h.dest || '',
  from: h.from || '',
  to: h.to || '',
  accom: h.accom || '',
  flight: h.flight || '',
  budget: h.budget || '',
  status: h.status || 'planning',
  notes: h.notes || '',
  imageUrl: h.imageUrl || '',
  items: Array.isArray(h.items) ? h.items : [],
  savingsGoalId: h.savingsGoalId || '',
});

export default function TripEditSheet({ trip, S, update, tab: initialTab = 'basics', onClose, onDeleted }) {
  const [form, setForm] = useState(() => seed(trip));
  const [tab, setTab] = useState(TABS.some(t => t.value === initialTab) ? initialTab : 'basics');
  const canSave = !!form.dest.trim();

  function save() {
    if (!canSave) return;
    update(prev => editTrip(prev, trip.id, form));
    onClose();
  }
  function del() {
    if (!window.confirm('Delete this trip? This cannot be undone.')) return;
    update(prev => deleteTrip(prev, trip.id));
    onDeleted?.();
  }
  const count = (form.items || []).length;

  return (
    <Sheet title="Edit trip" eyebrow={trip.dest || 'Trip'} onClose={onClose} className="cx-track-editsheet" testId="track-trip-edit"
           footer={(
             <div className="cx-track-foot3">
               <Button variant="danger" onClick={del}>Delete</Button>
               <span className="cx-track-sp" />
               <Button variant="ghost" onClick={onClose}>Cancel</Button>
               <Button variant="primary" onClick={save} disabled={!canSave}>Save</Button>
             </div>
           )}>
      <Segmented label="Trip details" value={tab} onChange={setTab}
                 options={TABS.map(t => ({ ...t, label: t.value === 'itinerary' && count ? `Itinerary · ${count}` : t.label }))} />
      <div className="cx-track-tabbody">
        {tab === 'basics' && <BasicsFields form={form} setForm={setForm} idPrefix="trip-edit" />}
        {tab === 'itinerary' && <div className="cx-track-classic"><ItineraryFields form={form} setForm={setForm} /></div>}
        {tab === 'budget' && (
          <div className="cx-track-form">
            <div className="cx-field">
              <label className="cx-label" htmlFor="trip-edit-budget2">Total budget</label>
              <input id="trip-edit-budget2" className="cx-input" type="text" placeholder="£1,200" value={form.budget}
                     onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
            </div>
            <SavingsPotField S={S} value={form.savingsGoalId} idPrefix="trip-edit"
                             onChange={v => setForm(f => ({ ...f, savingsGoalId: v }))} />
            <p className="cx-track-hint">Progress is read live from the pot, so money added under Savings shows on the trip.</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
