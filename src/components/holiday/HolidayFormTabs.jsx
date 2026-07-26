import Icon from '../Icon';
import DestinationPanel from './DestinationPanel';
import { selectableGoals, parseBudget } from '../../lib/holiday/savings';

/**
 * Shared field groups for the Add/Edit trip modals.
 *
 * The Basics tab is BYTE-FOR-BYTE the form that existed before — same
 * fields, same placeholders, same order, same defaults. Everything new
 * lives behind the other tabs and is entirely optional, so the fast
 * path (type a destination, hit save) is untouched.
 */

export const HOLIDAY_TABS = [
  { key: 'basics', label: 'Basics' },
  { key: 'itinerary', label: 'Itinerary' },
  { key: 'budget', label: 'Budget' },
];

/** Fields present on every trip, new or old. A factory, not a shared
 *  constant: a module-level object would hand every new trip the SAME
 *  `items` array reference. */
export const emptyHolidayForm = () => ({
  dest: '', from: '', to: '', accom: '', flight: '', budget: '',
  status: 'planning', notes: '', imageUrl: '',
  // Optional extras — always present in the form so a save can never
  // drop them, but never required.
  items: [], savingsGoalId: '',
});

export function HolidayTabBar({ tab, setTab, counts = {} }) {
  return (
    <div className="hol-modal-tabs" role="tablist">
      {HOLIDAY_TABS.map(t => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          className={`hol-modal-tab${tab === t.key ? ' is-active' : ''}`}
          onClick={() => setTab(t.key)}
        >
          {t.label}
          {counts[t.key] > 0 && <span className="hol-modal-tab-count">{counts[t.key]}</span>}
        </button>
      ))}
    </div>
  );
}

export function BasicsFields({ form, setForm, ImageField }) {
  return (
    <>
      <div className="fg"><label>Destination</label><input type="text" placeholder="e.g. Lisbon, Portugal" value={form.dest} onChange={e => setForm(f => ({ ...f, dest: e.target.value }))} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="fg"><label>Departure</label><input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} /></div>
        <div className="fg"><label>Return</label><input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} /></div>
      </div>
      <div className="fg"><label>Accommodation</label><input type="text" placeholder="e.g. Hotel Lisboa, Airbnb..." value={form.accom} onChange={e => setForm(f => ({ ...f, accom: e.target.value }))} /></div>
      <div className="fg"><label>Flight Info</label><input type="text" placeholder="e.g. EasyJet EZY1234, 06:30 LGW→LIS" value={form.flight} onChange={e => setForm(f => ({ ...f, flight: e.target.value }))} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="fg"><label>Total Budget</label><input type="text" placeholder="£1,200" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} /></div>
        <div className="fg">
          <label>Status</label>
          <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <option value="planning">🟡 Planning</option>
            <option value="booked">🟢 Booked</option>
            <option value="completed">✓ Completed</option>
          </select>
        </div>
      </div>
      <ImageField label="Cover Image (optional)" placeholder="https://… paste any photo URL" value={form.imageUrl} onChange={v => setForm(f => ({ ...f, imageUrl: v }))} />
      <div className="fg"><label>Notes</label><input type="text" placeholder="Things to do, pack list, ideas..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <DestinationPanel dest={form.dest} from={form.from} />
    </>
  );
}

const ITEM_KINDS = [
  { key: 'travel', label: 'Travel', icon: 'plane' },
  { key: 'stay', label: 'Stay', icon: 'bed' },
  { key: 'food', label: 'Food', icon: 'utensils' },
  { key: 'activity', label: 'Activity', icon: 'ticket' },
  { key: 'other', label: 'Other', icon: 'circle-dot' },
];

export function ItineraryFields({ form, setForm }) {
  const items = form.items || [];

  function addItem() {
    const item = {
      id: 'it' + Date.now() + Math.random().toString(36).slice(2, 6),
      kind: 'activity',
      day: form.from || '',
      time: '',
      title: '',
      note: '',
    };
    setForm(f => ({ ...f, items: [...(f.items || []), item] }));
  }
  function patch(id, key, val) {
    setForm(f => ({ ...f, items: (f.items || []).map(i => i.id === id ? { ...i, [key]: val } : i) }));
  }
  function remove(id) {
    setForm(f => ({ ...f, items: (f.items || []).filter(i => i.id !== id) }));
  }

  // Sorted for display only — the stored order is never rewritten, so
  // nothing shifts under the user while they're typing.
  const sorted = [...items].sort((a, b) => (a.day || '~').localeCompare(b.day || '~') || (a.time || '~').localeCompare(b.time || '~'));

  return (
    <div className="hol-itin">
      <p className="hol-itin-intro">
        Entirely optional — a trip works fine with just the Basics tab.
        Add flights, check-ins, bookings or plans and they'll show on the trip card.
      </p>

      {sorted.length === 0 && (
        <div className="hol-itin-empty">Nothing planned yet.</div>
      )}

      {sorted.map(item => (
        <div key={item.id} className="hol-itin-item">
          <div className="hol-itin-row">
            <select value={item.kind} onChange={e => patch(item.id, 'kind', e.target.value)} aria-label="Type">
              {ITEM_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <input
              type="date" value={item.day || ''} min={form.from || undefined} max={form.to || undefined}
              onChange={e => patch(item.id, 'day', e.target.value)} aria-label="Day"
            />
            <input
              type="time" value={item.time || ''}
              onChange={e => patch(item.id, 'time', e.target.value)} aria-label="Time"
            />
            <button type="button" className="hol-itin-x" onClick={() => remove(item.id)} aria-label="Remove item">
              <Icon name="x" size={14} />
            </button>
          </div>
          <input
            className="hol-itin-title" type="text" placeholder="What is it? e.g. Sintra day trip"
            value={item.title} onChange={e => patch(item.id, 'title', e.target.value)}
          />
          {(item.note || item.title) && (
            <input
              className="hol-itin-note" type="text" placeholder="Reference, address, notes (optional)"
              value={item.note || ''} onChange={e => patch(item.id, 'note', e.target.value)}
            />
          )}
        </div>
      ))}

      <button type="button" className="btn btn-ghost hol-itin-add" onClick={addItem}>+ Add item</button>
    </div>
  );
}

export function BudgetFields({ form, setForm, S }) {
  const goals = selectableGoals(S);
  const linked = goals.find(g => g.id === form.savingsGoalId) || null;
  const budgetNum = parseBudget(form.budget);

  return (
    <div className="hol-budgettab">
      <div className="fg">
        <label>Total Budget</label>
        <input type="text" placeholder="£1,200" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
      </div>

      <div className="fg">
        <label>Link to a savings goal</label>
        <select value={form.savingsGoalId || ''} onChange={e => setForm(f => ({ ...f, savingsGoalId: e.target.value }))}>
          <option value="">Not linked</option>
          {goals.map(g => (
            <option key={g.id} value={g.id}>{g.icon || '💰'} {g.name}</option>
          ))}
        </select>
      </div>

      {goals.length === 0 && (
        <p className="hol-budget-hint">
          No savings goals yet — create one under Savings and it'll appear here.
        </p>
      )}

      {linked && (
        <div className="hol-budget-linked">
          <div className="hol-budget-linked-row">
            <span>Saved so far</span>
            <b>£{Math.round(Number(linked.current) || 0).toLocaleString()}</b>
          </div>
          <div className="hol-budget-linked-row">
            <span>Goal target</span>
            <b>£{Math.round(Number(linked.target) || 0).toLocaleString()}</b>
          </div>
          {budgetNum != null && Number(linked.target) > 0 && budgetNum > Number(linked.target) && (
            <div className="hol-budget-warn">
              <Icon name="triangle-alert" size={13} />
              This trip's budget is higher than the goal's target — the goal won't cover it.
            </div>
          )}
          <p className="hol-budget-hint">
            Progress is read live from the savings goal, so contributions logged
            under Savings show up on the trip card automatically.
          </p>
        </div>
      )}
    </div>
  );
}
