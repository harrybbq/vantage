/**
 * Read how full the dials should be drawn right now.
 *
 * Returns 1 whenever no boot is running, so `value * useBootFill()` is
 * the value itself for the entire normal life of the app. During the
 * boot it climbs 0 → 1 across the window in which the panels arrive, so
 * every ring, arc and bar winds up to its real reading instead of being
 * there the instant its panel appears.
 */
import { useSyncExternalStore } from 'react';
import { getBootFill, subscribeBootFill, bootFillServerSnapshot } from '../lib/boot/fill.js';

export function useBootFill() {
  return useSyncExternalStore(subscribeBootFill, getBootFill, bootFillServerSnapshot);
}
