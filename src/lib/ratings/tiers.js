/**
 * OVR prestige tiers — F5 Sprint 6.
 *
 * Six prestige bands keyed off the 1-99 overall rating. Each band
 * carries a display label, a colour (a CSS var so the four themes can
 * retune it), and a `key` used to build the `.ovr-tier-{key}` glow
 * class in index.css.
 *
 * Bands (inclusive):
 *   0-19   bronze
 *   20-39  silver
 *   40-59  gold
 *   60-79  emerald
 *   80-89  diamond
 *   90-99  ruby
 *
 * NOTE: this is DISTINCT from the 3-tier Starting / Mid / Elite scale
 * used inside RatingsPanel to label individual category bars. That
 * scale answers "where on the journey is this category"; this one is
 * the prestige glow that wraps the headline OVR number.
 */

export const OVR_TIERS = [
  { key: 'bronze',  label: 'Bronze',  min: 0,  max: 19, color: 'var(--tier-bronze)'  },
  { key: 'silver',  label: 'Silver',  min: 20, max: 39, color: 'var(--tier-silver)'  },
  { key: 'gold',    label: 'Gold',    min: 40, max: 59, color: 'var(--tier-gold)'    },
  { key: 'emerald', label: 'Emerald', min: 60, max: 79, color: 'var(--tier-emerald)' },
  { key: 'diamond', label: 'Diamond', min: 80, max: 89, color: 'var(--tier-diamond)' },
  { key: 'ruby',    label: 'Ruby',    min: 90, max: 99, color: 'var(--tier-ruby)'    },
];

/** Map a 1-99 OVR to its prestige band. Values below 0 fall to the
 *  bottom band; values above 99 (shouldn't happen — derive clamps at
 *  99) fall to the top band. */
export function ovrTier(ovr) {
  const n = Number(ovr);
  if (!Number.isFinite(n)) return OVR_TIERS[0];
  for (const t of OVR_TIERS) {
    if (n >= t.min && n <= t.max) return t;
  }
  return n < 0 ? OVR_TIERS[0] : OVR_TIERS[OVR_TIERS.length - 1];
}

/** Convenience for className templates: returns just the tier key. */
export function ovrTierKey(ovr) {
  return ovrTier(ovr).key;
}
