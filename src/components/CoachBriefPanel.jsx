import { useSubscriptionContext } from '../context/SubscriptionContext';
import Icon from './Icon';
import { useDailyBrief } from '../hooks/useDailyBrief';
import CoachNudges from './CoachNudges';

/**
 * Daily Brief panel — Pro only.
 *
 * Renders three crisp lines (Focus / Watch / Micro-action) plus, on
 * Sundays, a Weekly Review card. Wraps the LLM-suggested verbs in
 * the same coach action handler used by AiCoachWidget.
 */
export default function CoachBriefPanel({ S, update, onCoachAct, userId }) {
  const { isPro, isLifetime } = useSubscriptionContext();
  const isUnlocked = isPro || isLifetime;
  const { brief, loading, error, refresh } = useDailyBrief({ S, update, isPro: isUnlocked });

  if (!isUnlocked) return null; // teaser/upgrade lives in AiCoachWidget

  if (loading && !brief) {
    return (
      <div className="coach-brief-panel coach-brief-loading">
        <div className="coach-brief-header">
          <span className="coach-brief-icon">✦</span>
          <span className="coach-brief-title">Today's Brief</span>
          <span className="coach-brief-pro">Pro</span>
        </div>
        <div className="coach-brief-skeleton">
          <div className="coach-brief-skeleton-line" />
          <div className="coach-brief-skeleton-line" style={{ width: '85%' }} />
          <div className="coach-brief-skeleton-line" style={{ width: '70%' }} />
        </div>
      </div>
    );
  }

  if (error && !brief) {
    return (
      <div className="coach-brief-panel coach-brief-error">
        <div className="coach-brief-header">
          <span className="coach-brief-icon">✦</span>
          <span className="coach-brief-title">Today's Brief</span>
        </div>
        <p className="coach-brief-error-text">{error}</p>
        <button className="btn btn-ghost coach-brief-retry" onClick={refresh}>
          Try again
        </button>
      </div>
    );
  }

  if (!brief) return null;

  return (
    <div className="coach-brief-panel">
      {/* Pattern-based proactive nudges (FEATURE 3). Renders nothing
          when no patterns are detected — daily brief still shows. */}
      <CoachNudges S={S} userId={userId} onCoachAct={onCoachAct} />

      <div className="coach-brief-header">
        <span className="coach-brief-icon">✦</span>
        <span className="coach-brief-title">Today's Brief</span>
        <span className="coach-brief-pro">Pro</span>
        <button
          className="coach-brief-refresh"
          onClick={refresh}
          title="Regenerate"
          aria-label="Regenerate brief"
        >
          <Icon name="refresh-cw" size={15} />
        </button>
      </div>

      <div className="coach-brief-rows">
        {brief.focus && (
          <div className="coach-brief-row coach-brief-focus">
            <span className="coach-brief-row-label">Focus</span>
            <p>{brief.focus}</p>
          </div>
        )}
        {brief.watch && (
          <div className="coach-brief-row coach-brief-watch">
            <span className="coach-brief-row-label">Watch out</span>
            <p>{brief.watch}</p>
          </div>
        )}
        {brief.micro && (
          <div className="coach-brief-row coach-brief-micro">
            <span className="coach-brief-row-label">5-min action</span>
            <p>{brief.micro}</p>
          </div>
        )}
      </div>

      {Array.isArray(brief.verbs) && brief.verbs.length > 0 && (
        <div className="coach-brief-verbs">
          {brief.verbs.map((v, i) => (
            <button
              key={i}
              className="btn btn-primary coach-brief-verb-btn"
              onClick={() => onCoachAct?.(v)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {brief.weekly_review && brief.weekly_review.trim().length > 0 && (
        <div className="coach-brief-weekly">
          <div className="coach-brief-weekly-header">
            <span className="coach-brief-weekly-icon">◇</span>
            <span>Weekly Review</span>
          </div>
          <p>{brief.weekly_review}</p>
        </div>
      )}
    </div>
  );
}
