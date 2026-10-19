/**
 * The gym switch — ONE segmented control for every place a gym is picked
 * (Today, the live header sheet, Quick log, Lift detail) (A8).
 *
 * <GymSwitch gyms={[{ id, name }]} value onChange label testId className
 *            allowAll lift allLabel size>
 *   value     a gym id; null = nothing selected (an unassigned set being
 *             edited); ALL_GYMS = the "All" segment when shown
 *   allowAll  offer "All" (ALL_GYMS) — ignored for a machine (`lift` that
 *             compares per gym): its numbers only mean something within
 *             one gym, so a machine never gets "All"
 * parts.jsx re-exports this under the same name, so older callers work.
 */
import { perGymOf } from '../../../../lib/lifts/lifts';
import { Segmented } from './controls';

export const ALL_GYMS = '__all';

export default function GymSwitch({ gyms, value, onChange, label = 'Gym', className = '', testId, allowAll = false, lift = null, allLabel = 'All', size = 'md' }) {
  if (!gyms || !gyms.length) return null;
  const all = allowAll && !(lift && perGymOf(lift));
  const options = [
    ...(all ? [{ value: ALL_GYMS, label: allLabel, title: 'Every gym — one record for this lift' }] : []),
    ...gyms.map(g => ({ value: g.id, label: g.name })),
  ];
  const v = value === ALL_GYMS && !all ? null : value;
  return <Segmented options={options} value={v} onChange={onChange} label={label} className={`lf-gymswitch${className ? ` ${className}` : ''}`} testId={testId} size={size} />;
}
export { GymSwitch };
