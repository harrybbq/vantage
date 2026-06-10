/**
 * PrestigeBadge — colour-band + Roman-numeral chip, e.g. "GREEN IV".
 * Renders nothing at P0. Sizes: 'sm' (leaderboard rows / chips) and
 * 'md' (RatingsPanel hero / modal headers).
 */
import { prestigeBadge } from '../lib/ratings/prestige';

export default function PrestigeBadge({ prestige, size = 'sm', style }) {
  const badge = prestigeBadge(prestige);
  if (!badge) return null;
  return (
    <span
      className={`prestige-badge prestige-badge-${size} prestige-${badge.band.key}`}
      title={`Prestige ${prestige} — ${badge.text}`}
      style={style}
    >
      {badge.text}
    </span>
  );
}
