import { useEffect, useState } from 'react';
import { getOwnProfile } from '../lib/friends/queries';

// Module cache so the handle is fetched once per session per user and
// shared across the profile surfaces that show it (hub card, OS panel,
// mobile profile) without repeat round-trips.
const cache = new Map();

/**
 * The current user's @handle (without the @), or null if they haven't
 * claimed one / the social schema isn't present. Fails soft.
 */
export function useOwnHandle(userId) {
  const [handle, setHandle] = useState(() => cache.get(userId) ?? null);
  useEffect(() => {
    if (!userId) return undefined;
    if (cache.has(userId)) { setHandle(cache.get(userId)); return undefined; }
    let cancelled = false;
    getOwnProfile(userId)
      .then(p => { const h = p?.handle || null; cache.set(userId, h); if (!cancelled) setHandle(h); })
      .catch(() => { if (!cancelled) setHandle(null); });
    return () => { cancelled = true; };
  }, [userId]);
  return handle;
}
