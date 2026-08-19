import { useSubscriptionContext } from '../context/SubscriptionContext';

/**
 * Free-tier caps. Pro and Lifetime have no caps.
 *
 * Numeric caps are { limit, label } where label is shown in the
 * paywall modal so the user understands exactly what they're hitting.
 *
 * Feature gates are { feature: true, label, sub } — used when the thing
 * being gated is a whole Pro-only feature rather than a count limit.
 * The paywall renders `sub` instead of the "you've reached your limit
 * of N label" copy.
 */
export const FREE_CAPS = {
  links:        { limit: 3,  label: 'link widgets' },
  habits:       { limit: 5,  label: 'active habits' },
  achievements: { limit: 10, label: 'achievements' },
  holidays:     { limit: 1,  label: 'holiday' },
  shopItems:    { limit: 50, label: 'shopping items' },
  trackers:     { limit: 5,  label: 'trackers' },
  // Feature gate — the "Our Apps" widget presets (FloorplanStudio,
  // …) are a Pro bonus.
  ourApps: {
    feature: true,
    label: 'Our Apps',
    sub: 'Our Apps are a Pro bonus — add FloorplanStudio and more straight to your hub. Upgrade to unlock them, plus proactive coach nudges, the AI daily brief, and every cap removed.',
  },
  // Generic upgrade entry — used by surfaces that don't have a specific
  // cap to cite (the mobile More-drawer "Go Pro" chip, etc.). The
  // paywall renders its standard feature list with no cap-specific
  // headline.
  generic: {
    feature: true,
    label: 'Vantage Pro',
    sub: 'Unlock unlimited everything, proactive coach nudges, the daily AI brief, accent colours, and every Pro perk across mobile + desktop.',
  },
};

/**
 * Returns helpers for checking free-tier limits.
 *
 *   const { canAdd, atLimit, capFor } = useTierLimits();
 *   if (!canAdd('habits', S.habits.length)) showPaywall();
 *
 * Pro/Lifetime users always pass `canAdd`.
 */
export function useTierLimits() {
  const { isPro, isLifetime, loading } = useSubscriptionContext();
  const isUnlimited = isPro || isLifetime;

  function capFor(key) {
    return FREE_CAPS[key] || null;
  }

  function atLimit(key, currentCount) {
    if (isUnlimited) return false;
    const cap = capFor(key);
    if (!cap) return false;
    return currentCount >= cap.limit;
  }

  function canAdd(key, currentCount) {
    return !atLimit(key, currentCount);
  }

  function remaining(key, currentCount) {
    if (isUnlimited) return Infinity;
    const cap = capFor(key);
    if (!cap) return Infinity;
    return Math.max(0, cap.limit - currentCount);
  }

  return {
    isUnlimited,
    loading,
    canAdd,
    atLimit,
    remaining,
    capFor,
  };
}
