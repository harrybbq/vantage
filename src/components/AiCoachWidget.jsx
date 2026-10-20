import { useEffect, useMemo, useRef } from 'react';
import Icon from './Icon';
import ProGate from './ProGate';
import {
  pickInsight,
  allInsights,
  migrateCoachMemory,
  recordShown,
  recordDismissed,
  recordActed,
} from '../lib/coach/heuristics';

// ── Insight wrapper ───────────────────────────────────────────────────────
function useCurrentInsight(S) {
  return useMemo(() => {
    const memory = migrateCoachMemory(S);
    return pickInsight(S, memory);
  // Re-pick when the things heuristics actually read change. Includes
  // coachMemory so a dismiss immediately rotates to the next insight
  // without re-rendering the whole tree.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S?.trackers, S?.habits, S?.achievements, S?.shopItems, S?.holidays,
      S?.logs, S?.coins, S?.profile?.name, S?.coachMemory]);
}

function flattenForLegacy(insight) {
  if (!insight) return 'Your board is set. Small daily actions compound.';
  return `${insight.title}. ${insight.body}`;
}

// ── Compact teaser banner (Pro not on sale yet) ──────────────────────────
// Labelled "Coach", not "AI Coach" (item 120): the insights in this
// widget come from rules in lib/coach/heuristics, not from a model.
// The waitlist this used to point at was removed (2026-10-20): it collected
// emails for marketing, which the privacy policy says Vantage doesn't do.
function AiCoachBanner({ insight, onOpenPaywall }) {
  const text = flattenForLegacy(insight);
  const words = text.split(' ');
  const hook = words.slice(0, 5).join(' ');
  const rest = words.slice(5).join(' ');

  return (
    <div className="ai-coach-banner">
      <span className="ai-coach-banner-icon">✦</span>
      <div className="ai-coach-banner-body">
        <span className="ai-coach-banner-label">Coach</span>
        <span className="ai-coach-banner-insight">
          {hook}
          {rest && <span className="ai-coach-banner-blurred"> {rest}</span>}
        </span>
      </div>
      {onOpenPaywall && (
        <button className="btn btn-primary ai-coach-banner-btn" onClick={onOpenPaywall}>
          See Pro
        </button>
      )}
    </div>
  );
}

// ── Compact upgrade CTA (post-launch) ────────────────────────────────────
function AiCoachUpgradeBanner({ insight, onOpenPaywall }) {
  const text = flattenForLegacy(insight);
  const words = text.split(' ');
  const hook = words.slice(0, 5).join(' ');
  const rest = words.slice(5).join(' ');

  return (
    <div className="ai-coach-banner">
      <span className="ai-coach-banner-icon">✦</span>
      <div className="ai-coach-banner-body">
        <span className="ai-coach-banner-label">Coach</span>
        <span className="ai-coach-banner-insight">
          {hook}
          {rest && <span className="ai-coach-banner-blurred"> {rest}</span>}
        </span>
      </div>
      <button className="btn btn-primary ai-coach-banner-btn" onClick={onOpenPaywall} disabled={!onOpenPaywall}>
        Upgrade to Pro
      </button>
    </div>
  );
}

// ── Full insight (Pro users) ──────────────────────────────────────────────
function AiCoachFull({ insight, onAct, onDismiss }) {
  if (!insight) return null;
  return (
    <div className="ai-coach-banner ai-coach-banner-pro">
      <span className="ai-coach-banner-icon">✦</span>
      <div className="ai-coach-banner-body">
        <span className="ai-coach-banner-label">
          Coach <span className="ai-coach-pro-badge">Pro</span>
        </span>
        <span className="ai-coach-banner-insight-full">
          <strong>{insight.title}.</strong> {insight.body}
        </span>
        {insight.verb && onAct && (
          <button
            className="btn btn-primary ai-coach-verb-btn"
            onClick={() => onAct(insight.verb, insight.id)}
          >
            {insight.verb.label}
          </button>
        )}
        {/* These tips are rule-based (lib/coach/heuristics), so the label
            is "Coach", not "AI Coach" — the AI daily brief keeps its own
            name and its own "AI-generated · not medical advice" line.
            Some tips touch sleep, weight or training: item 120. */}
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-floor)', color: 'var(--text-muted)', letterSpacing: 0.4, marginTop: 4 }}>
          Tips from your own logs · not medical advice
        </span>
      </div>
      {onDismiss && (
        <button
          className="ai-coach-dismiss"
          onClick={() => onDismiss(insight.id)}
          title="Dismiss"
          aria-label="Dismiss insight"
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────
export default function AiCoachWidget({ S, update, onOpenPaywall, onCoachAct }) {
  const insight = useCurrentInsight(S);
  // Track which id we've already auto-stamped as "shown" today so we
  // don't write to coachMemory on every render. Resets per insight id.
  const shownStamped = useRef(null);

  // Stamp `lastShownYmd` the first time a given insight is rendered to
  // a Pro user. This lets the cooldown logic count "saw it once" even
  // if the user never dismisses or acts. Without this, an evergreen
  // rule that the user never interacts with would show forever.
  useEffect(() => {
    if (!insight || !update) return;
    if (shownStamped.current === insight.id) return;
    shownStamped.current = insight.id;
    update(prev => ({
      ...prev,
      coachMemory: recordShown(prev.coachMemory, insight.id),
    }));
  }, [insight, update]);

  function handleDismiss(id) {
    if (!update || !id) return;
    update(prev => ({
      ...prev,
      coachMemory: recordDismissed(prev.coachMemory, id),
    }));
  }

  function handleAct(verb, id) {
    if (update && id) {
      update(prev => ({
        ...prev,
        coachMemory: recordActed(prev.coachMemory, id),
      }));
    }
    if (onCoachAct) onCoachAct(verb);
  }

  return (
    <ProGate
      teaser={<AiCoachBanner insight={insight} onOpenPaywall={onOpenPaywall} />}
      upgradeCta={<AiCoachUpgradeBanner insight={insight} onOpenPaywall={onOpenPaywall} />}
    >
      <AiCoachFull insight={insight} onAct={handleAct} onDismiss={handleDismiss} />
    </ProGate>
  );
}

// Re-export for the dedicated coach panel (step 2 daily-brief UI)
export { useCurrentInsight, allInsights };
