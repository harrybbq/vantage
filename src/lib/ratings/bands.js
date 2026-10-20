/**
 * Tier bands for COLOURING rating numbers (console design, Oct 2026).
 *
 * Direction C's idea, adopted into the redesign: every rating number —
 * OVR and the four categories, yours and your friends' — is drawn in the
 * colour of its tier band, so colour is data. The thresholds are the
 * existing prestige tiers in tiers.js (0-19 bronze … 90-99 ruby); this
 * module only names them for styling and never restates the numbers.
 *
 * Colours are tokens (`--band-<key>`, contrast-tuned per theme in
 * src/design/console/tokens.css); the classes `.cx-band-<key>` (text) and
 * `.cx-band-bg-<key>` (fill) are defined there too, scoped to the console.
 *
 *   bandOf(74)                → 'emerald'
 *   bandClass(74)             → 'cx-band-emerald'
 *   bandClass(74, { bg: true }) → 'cx-band-bg-emerald'
 *   bandVar(74)               → 'var(--band-emerald)'
 *
 * A missing rating (null / undefined / '' / NaN) has no band: bandOf
 * returns null and bandClass '' — a number that isn't there must not be
 * painted bronze.
 */
import { OVR_TIERS, ovrTierKey } from './tiers.js';

/** 'bronze' … 'ruby', in ascending order — straight from tiers.js. */
export const BAND_KEYS = Object.freeze(OVR_TIERS.map(t => t.key));

const missing = v => v == null || v === '' || !Number.isFinite(Number(v));

/** The band key for a 0-99 rating, or null when there is no rating. */
export function bandOf(value) {
  if (missing(value)) return null;
  return ovrTierKey(Number(value));
}

/** `cx-band-<key>` (text colour) or `cx-band-bg-<key>` with { bg: true }; '' when no rating. */
export function bandClass(value, { bg = false } = {}) {
  const k = bandOf(value);
  return k ? `cx-band-${bg ? 'bg-' : ''}${k}` : '';
}

/** `var(--band-<key>)` for inline styles (bars, rails), or null when no rating. */
export function bandVar(value) {
  const k = bandOf(value);
  return k ? `var(--band-${k})` : null;
}
