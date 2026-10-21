/**
 * PrestigeBadge — colour-band + Roman-numeral chip, e.g. "GREEN IV".
 * Renders nothing at P0. Sizes: 'sm' (leaderboard rows / chips) and
 * 'md' (RatingsPanel hero / modal headers).
 *
 * From Prestige VII the badge is SOLID (filled with its band colour) —
 * a prestige reward (lib/ratings/prestigeRewards.js). Below that it is
 * the outlined chip it always was.
 */
import { prestigeBadge } from '../lib/ratings/prestige';
import { solidBadgeStyle } from '../lib/ratings/prestigeRewards';

export default function PrestigeBadge({ prestige, size = 'sm', style }) {
  const badge = prestigeBadge(prestige);
  if (!badge) return null;
  const solid = solidBadgeStyle(prestige);
  return (
    <span
      className={`prestige-badge prestige-badge-${size} prestige-${badge.band.key}${solid ? ' is-solid' : ''}`}
      title={`Prestige ${prestige} — ${badge.text}`}
      style={solid ? { ...solid, ...style } : style}
    >
      {badge.text}
    </span>
  );
}
