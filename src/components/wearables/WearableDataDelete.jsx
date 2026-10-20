import { useMemo, useState } from 'react';
import { stripWearableData, wearableDataSummary, providerLabel } from '../../lib/wearables/strip';
import './wearables.css';

/**
 * "Delete data synced from WHOOP/Oura" — owner decision D4 (2026-10-20):
 * disconnecting never asks; this is the separate, deliberate action.
 * Self-contained: mounted with one line inside WearableSync (Settings →
 * Tools → Health & sync). Hidden when there is nothing to delete.
 *
 * It removes ONLY what the bands wrote (lib/wearables/strip.js): their
 * vitals keys, their workouts, the tracker ticks an auto-fill rule made
 * from them — and, if the box stays ticked, sleep / resting HR on the
 * days a band synced (a band's sync overwrites both, but a value typed
 * on one of those days cannot be told apart, so the person decides).
 * Applied as update(prev => stripWearableData(prev)) — never a
 * whole-state replace; everything else comes back by reference.
 */

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export default function WearableDataDelete({ S, update }) {
  const [open, setOpen] = useState(false);
  const [sharedVitals, setSharedVitals] = useState(true);
  const [msg, setMsg] = useState('');

  const summary = useMemo(
    () => wearableDataSummary(S, { sharedVitals }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [S?.vitalsLog, S?.burnLog, S?.logs, S?.logsAuto, S?.trackers, S?.lifts, S?.whoopConnected, S?.ouraConnected, sharedVitals],
  );

  if (!summary.any && !msg) return null;
  const who = providerLabel(summary.providers);
  const stillConnected = [S?.whoopConnected && 'WHOOP', S?.ouraConnected && 'Oura'].filter(Boolean);

  function confirmDelete() {
    update(prev => stripWearableData(prev, { sharedVitals }));
    setOpen(false);
    setMsg(`Deleted the data synced from ${who}. Your manual entries are unchanged.`);
  }

  const parts = [];
  if (summary.vitalsDays) parts.push(`readings on ${plural(summary.vitalsDays, 'day')}`);
  if (summary.workouts) parts.push(plural(summary.workouts, 'workout'));
  if (summary.ticks) parts.push(plural(summary.ticks, 'auto-filled tracker tick'));

  return (
    <div className="wx-delete">
      {!open ? (
        <div className="wx-delete-row">
          {summary.any && (
            <button type="button" className="vitals-ah-btn vitals-ah-btn-alt" onClick={() => { setOpen(true); setMsg(''); }}>
              Delete data synced from {who}…
            </button>
          )}
          <span className="vitals-ah-hint" role="status">
            {msg || `Removes only what ${who} sent. Anything you entered yourself stays.`}
          </span>
        </div>
      ) : (
        <div className="wx-confirm" role="alertdialog" aria-label={`Delete data synced from ${who}`}>
          <p className="wx-confirm-text">
            This deletes {plural(summary.days, 'day')} of {who} data — {parts.join(', ')}. Your manual entries stay.
          </p>
          <label className="wx-check">
            <input type="checkbox" checked={sharedVitals} onChange={e => setSharedVitals(e.target.checked)} />
            <span>
              Also remove sleep and resting heart rate on the days {who} synced. Untick this if you typed
              any of those yourself on a synced day — they can’t be told apart.
            </span>
          </label>
          {stillConnected.length > 0 && (
            <p className="wx-confirm-note">
              {stillConnected.join(' and ')} is still connected, so its next sync brings back the last 7 days.
              Disconnect first to stop that.
            </p>
          )}
          <div className="wx-confirm-actions">
            <button type="button" className="vitals-ah-btn vitals-ah-btn-alt" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="vitals-ah-btn wx-btn-danger" onClick={confirmDelete}>Delete {who} data</button>
          </div>
        </div>
      )}
    </div>
  );
}
