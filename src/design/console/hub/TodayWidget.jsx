/**
 * Today — the day's trackers, ticked and stepped from the hub.
 *
 * A boolean row is the console checkbox; a number row steps by the same
 * amount QuickLog's + does (trackerStep). Every change goes through
 * applyTrackerChange, which is QuickLog's state change verbatim (log,
 * provenance, streaks, symmetric weekly coins). The row label opens Track.
 */
import Icon from '../../../components/Icon';
import { Checkbox } from '../ui';
import { getTodayStr, countWeekLogs } from '../../../utils/helpers';
import { trackerDone, trackerProgress, trackerStep, dailyGoalOf, fmtTrackerValue } from '../../../lib/trackers/done';
import { sourceById } from '../../../lib/trackers/autoLog';
import { RATING_COLOURS } from '../../../lib/ratings/palette';
import { useDarkSurface } from '../../../hooks/useDarkSurface';
import { fireGoal, fireStreak7, fireStreak30 } from '../../../utils/confetti';
import { applyTrackerChange } from './trackerLog';

export default function TodayWidget({ S, update, navigate, size, isMobile, onShowCoinToast }) {
  const dark = useDarkSurface();
  const today = getTodayStr();
  const logs = S.logs || {};
  const todayLogs = logs[today] || {};
  const trackers = (S.trackers || []).filter(t => t && t.id);
  const done = trackers.filter(t => trackerDone(t, todayLogs[t.id])).length;
  const cap = size === 'large' ? (isMobile ? 6 : 12) : (isMobile ? 5 : 5);
  const shown = trackers.slice(0, cap);
  const cat = RATING_COLOURS[dark ? 'dark' : 'light'];
  const fx = { onToast: onShowCoinToast, onGoal: fireGoal, onStreak7: fireStreak7, onStreak30: fireStreak30 };
  const set = (id, v) => update(prev => applyTrackerChange(prev, id, v, today, fx));

  if (!trackers.length) {
    return (
      <div className="cx-hub-empty-cta">
        <p className="cx-hub-empty">No trackers yet.</p>
        <button type="button" className="cx-btn" onClick={() => navigate?.('track')}>Set one up in Track</button>
      </div>
    );
  }
  return (
    <div className="cx-hub-today">
      <div className="cx-hub-bar" role="progressbar" aria-label="Trackers done today" aria-valuemin={0} aria-valuemax={trackers.length} aria-valuenow={done}>
        <i style={{ width: `${Math.round((done / trackers.length) * 100)}%` }} />
      </div>
      <ul className="cx-hub-list">
        {shown.map(t => {
          const v = todayLogs[t.id];
          const isBool = t.type === 'boolean';
          const ok = trackerDone(t, v);
          const wk = t.weeklyTarget ? countWeekLogs(logs, t.id, today, t) : null;
          const goal = dailyGoalOf(t) || (Number(t.goal) > 0 ? Number(t.goal) : null);
          const dot = cat[t.category] || 'var(--cx-muted)';
          return (
            <li key={t.id} className={`cx-hub-trk${ok ? ' is-done' : ''}`}>
              <span className="cx-hub-dot" style={{ background: dot }} aria-hidden="true" />
              <button type="button" className="cx-hub-trk-nm" onClick={() => navigate?.('track')} title={t.name}>{t.name}</button>
              {isBool ? (
                <>
                  {wk != null && <span className="cx-num cx-hub-trk-v">{wk}/{t.weeklyTarget} wk</span>}
                  <Checkbox checked={!!v} label={`${t.name}, done today`} onChange={next => set(t.id, next ? true : false)} />
                </>
              ) : (
                <>
                  <span className={`cx-num cx-hub-trk-v${trackerProgress(t, v) >= 1 ? ' cx-accent' : ''}`}>
                    {fmtTrackerValue(v || 0, true)}{goal ? <span className="cx-muted"> / {fmtTrackerValue(goal, true)}</span> : null}
                    {t.unit && t.unit !== 'steps' ? <span className="cx-muted"> {t.unit}</span> : null}
                  </span>
                  <button
                    type="button"
                    className="cx-hub-step"
                    aria-label={`Add ${trackerStep(t, sourceById(t.auto?.source)?.step)} to ${t.name}`}
                    onClick={() => set(t.id, Math.round(((Number(v) || 0) + trackerStep(t, sourceById(t.auto?.source)?.step)) * 100) / 100)}
                  >
                    <Icon name="plus" size={14} strokeWidth={2} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {trackers.length > shown.length && (
        <button type="button" className="cx-hub-more" onClick={() => navigate?.('track')}>
          All {trackers.length} trackers <Icon name="chevron-right" size={14} />
        </button>
      )}
    </div>
  );
}

export function todayMeta(S) {
  const today = getTodayStr();
  const trackers = (S.trackers || []).filter(t => t && t.id);
  const done = trackers.filter(t => trackerDone(t, (S.logs || {})[today]?.[t.id])).length;
  return trackers.length ? `${done} of ${trackers.length} done` : '';
}
