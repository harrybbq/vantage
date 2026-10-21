/**
 * Friends' prestige, for the rings round their avatars and their badges.
 *
 * `prestige` is not a public profile column (lib/friends/profileColumns.js),
 * so the friend list cannot select it. The friends leaderboard carries it
 * (read server-side), and useLeaderboard caches that board for 60 s per
 * tab, shared with the leaderboard page and the console hub. This renders
 * nothing; it hands `{ [userId]: prestige }` up to the rail.
 *
 * Mounted only while the user HAS friends, so an account with none never
 * pays for the board fetch.
 */
import { useEffect } from 'react';
import { useLeaderboard } from '../../hooks/useLeaderboard';

export default function FriendsPrestigeSource({ onData }) {
  const { data } = useLeaderboard({ scope: 'friends', timeframe: 'alltime' });
  useEffect(() => {
    const m = {};
    for (const r of (data && data.rows) || []) {
      if (r && r.userId) m[r.userId] = Math.max(0, Math.floor(Number(r.prestige) || 0));
    }
    onData(m);
  }, [data, onData]);
  return null;
}
