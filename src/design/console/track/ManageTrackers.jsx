/**
 * Manage trackers: what fills each one in (auto-fill), add, remove.
 *
 * Same actions as the classic Trackers list on Track: "Add tracker"
 * opens the app's add-tracker modal through onOpenModal (so App's
 * free-tier cap still applies), auto-fill opens the classic
 * AutoFillModal (the caller mounts it), and remove is the classic
 * filter on S.trackers, after a confirm.
 */
import { Sheet, Button } from '../ui';
import { ruleChip, ruleLabel } from '../../../lib/trackers/autoLog';
import { recoveryProvider } from '../../../lib/vitals/recoverySource';
import { trackerWeeklyCoins } from '../../../utils/helpers';
import TIcon from './icons';

export default function ManageTrackers({ S, update, onClose, onOpenModal, onAuto }) {
  const trackers = S.trackers || [];
  // WHOOP Recovery / Oura Readiness by name on a recovery rule's chip.
  const recProvider = recoveryProvider(S);
  function remove(t) {
    if (!window.confirm(`Remove “${t.name}”? Its past ticks stay in your history.`)) return;
    update(prev => ({ ...prev, trackers: prev.trackers.filter(x => x.id !== t.id) }));
  }
  return (
    <Sheet title="Manage trackers" eyebrow={`${trackers.length} tracker${trackers.length === 1 ? '' : 's'}`} onClose={onClose}
           className="cx-track-manage" testId="track-manage"
           footer={<Button variant="primary" block icon="plus" onClick={() => { onClose(); onOpenModal('addTrackerModal'); }}>Add tracker</Button>}>
      {!trackers.length && <p className="cx-track-empty">No trackers yet. Add one for anything you want to do regularly.</p>}
      <ul className="cx-track-mlist">
        {trackers.map(t => {
          const chip = ruleChip(t, recProvider);
          const coins = t.weeklyTarget ? trackerWeeklyCoins(t) : 0;
          return (
            <li key={t.id} className="cx-track-mrow">
              <span className="cx-track-mdot" style={{ background: t.color || 'var(--cx-accent)' }} aria-hidden="true" />
              <span className="cx-track-mmain">
                <span className="cx-track-mname">{t.name}</span>
                <span className="cx-track-mmeta">
                  {t.type === 'boolean' ? 'Yes or no' : (t.unit ? `Number · ${t.unit}` : 'Number')}
                  {t.weeklyTarget ? ` · ${t.weeklyTarget} a week` : ''}
                  {coins ? ` · ${coins} coins` : ''}
                </span>
              </span>
              <button type="button" className={`cx-chip cx-track-autochip${chip ? ' is-on' : ''}`}
                      title={ruleLabel(t, recProvider) ? `Filled in automatically: ${ruleLabel(t, recProvider)}` : 'Fill this in from synced data'}
                      onClick={() => onAuto(t)}>
                <TIcon name="zap" size={12} />{chip || 'Auto-fill'}
              </button>
              <Button variant="ghost" iconOnly icon="trash-2" label={`Remove ${t.name}`} onClick={() => remove(t)} />
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
