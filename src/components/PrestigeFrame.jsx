/**
 * PrestigeFrame — the ring round someone's avatar that says which
 * prestige they have reached (lib/ratings/prestigeRewards.js frameFor).
 * Used by classic surfaces that had no avatar wrapper of their own
 * (leaderboard rows, the invite page, handle search). Where a wrapper
 * already exists, spread `frameAttrs(prestige)` onto it instead.
 *
 * At P0 it renders its child alone, with no wrapper, so a P0 avatar is
 * exactly what it was before prestige rewards existed.
 */
import { frameAttrs } from '../lib/ratings/prestigeRewards';
import './prestige-frame.css';

export default function PrestigeFrame({ prestige, className = '', children }) {
  const a = frameAttrs(prestige);
  if (!a) return children;
  return (
    <span className={`pf-wrap ${a.className}${className ? ` ${className}` : ''}`} style={a.style} title={a.title}>
      {children}
    </span>
  );
}

/** Classes and style to merge onto an existing avatar wrapper. */
export function frameProps(prestige, baseClass) {
  const a = frameAttrs(prestige);
  if (!a) return { className: baseClass };
  return { className: `${baseClass} ${a.className}`, style: a.style };
}
