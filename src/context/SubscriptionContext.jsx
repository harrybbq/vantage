import { createContext, useContext } from 'react';
import { useSubscription } from '../hooks/useSubscription';

// Exported so Pro-gated surfaces can be rendered under a known tier in
// a test harness. Nothing in the app should consume it directly — use
// useSubscriptionContext().
export const SubscriptionContext = createContext({
  tier: 'free',
  isPro: false,
  isLifetime: false,
  isFree: true,
  hasPro: false,
  proPlan: null,
  isMonthly: false,
  isAnnual: false,
  proIsLive: false,
  loading: true,
});

export function SubscriptionProvider({ userId, children }) {
  const value = useSubscription(userId);
  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscriptionContext() {
  return useContext(SubscriptionContext);
}
