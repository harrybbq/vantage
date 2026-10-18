/**
 * Which coach-snapshot values came from a WHOOP or Oura band?
 *
 * Why (2026-10-17): Oura's and WHOOP's 2026 API terms reportedly limit
 * using their data with AI. That is unverified from here and the owner
 * is asking both in writing; until they answer, nothing a band produced
 * is sent to the AI coach. The server enforces the same rule on its own
 * (netlify/lib/coachWearableGuard.js) — this half keeps the data from
 * leaving the device in the first place.
 *
 * What reaches the coach today: buildSnapshot() sends tracker series,
 * habits, achievements, holidays and shop counts — never vitalsLog or
 * burnLog directly. The ONE path band data takes is a tracker cell that
 * an auto-fill rule (lib/trackers/autoLog.js) filled from a reading, so
 * that is what this classifies.
 *
 * Provenance per value does not exist on a vitals row: WHOOP, Oura,
 * Apple Health and a hand entry all write `sleep` and `rhr` under the
 * same keys. So:
 *   · workout, strain, recovery, burn  → band-only sources. Always band.
 *   · steps   → band unless Apple Health's own count for that day is at
 *               least the value in the cell (the rule takes the highest,
 *               so a cell above Apple Health's count came from a band).
 *   · sleep   → band when that day's vitals row also carries a band-only
 *               key (hrv, recovery, strain, burnKcal, stepsWhoop,
 *               stepsOura): a band synced that day, and its sync
 *               overwrites `sleep`. Conservative: an Apple Health night
 *               on a day a band also synced is withheld too.
 *   · weight  → never band. Neither the WHOOP nor the Oura sync writes
 *               weight; it comes from Apple Health or a hand entry.
 *   · a hand-ticked cell (no logsAuto entry, or 'manual') → never band.
 *
 * A tracker with ANY band cell in the window is withheld whole, rather
 * than sent with holes: a steps tracker whose days all came from WHOOP
 * would otherwise read as "0 steps, down 100%" and the coach would
 * coach a slump that never happened.
 *
 * Pure. No React, no network.
 */
import { ruleFor, MANUAL } from '../trackers/autoLog.js';

/** Auto-fill sources that only a band can produce. */
export const BAND_ONLY_SOURCES = new Set(['workout', 'strain', 'recovery', 'burn']);

/** vitalsLog keys only the WHOOP / Oura syncs write. */
export const BAND_VITAL_KEYS = ['hrv', 'recovery', 'strain', 'burnKcal', 'stepsWhoop', 'stepsOura'];

/** Did a band sync write to this day's vitals row? */
export function rowTouchedByBand(S, day) {
  const v = (S && S.vitalsLog && S.vitalsLog[day]) || null;
  if (!v) return false;
  return BAND_VITAL_KEYS.some(k => v[k] != null);
}

/** Apple Health's step count for a day (burnLog entries that are not
 *  a band's), or null. Same parsing as stepsOn. */
export function phoneSteps(S, day) {
  let best = null;
  const entries = (S && S.burnLog && S.burnLog[day]) || [];
  for (const e of entries) {
    if (!e || /^(whoop|oura)-/i.test(String(e.id || ''))) continue;
    let n = null;
    if (Number.isFinite(e.steps)) n = e.steps;
    else {
      const m = /^([\d,]+)\s*steps$/i.exec(String(e.label || ''));
      if (m) n = parseInt(m[1].replace(/,/g, ''), 10);
    }
    if (Number.isFinite(n) && n > 0 && (best == null || n > best)) best = n;
  }
  return best;
}

/**
 * Did this tracker cell come from a band?
 * @param {object} S        app state
 * @param {string} day      the logs key the cell lives under
 * @param {object} tracker
 */
export function cellFromBand(S, day, tracker) {
  if (!tracker) return false;
  const auto = S && S.logsAuto && S.logsAuto[day] ? S.logsAuto[day][tracker.id] : undefined;
  if (!auto || auto === MANUAL) return false;
  const logs = (S && S.logs) || {};
  const value = logs[day] ? logs[day][tracker.id] : undefined;
  if (value === undefined || value === null || value === false) return false;
  if (BAND_ONLY_SOURCES.has(auto)) return true;
  if (auto === 'steps') {
    const phone = phoneSteps(S, day);
    // No phone count that day: a band filled it — or the reading has
    // gone and the source cannot be shown, which is treated the same.
    if (phone == null) return true;
    if (tracker.type === 'boolean') {
      const rule = ruleFor(tracker);
      const bar = rule && rule.threshold != null ? rule.threshold : 0;
      return !(phone >= bar);
    }
    return !(phone >= Number(value));
  }
  if (auto === 'sleep') return rowTouchedByBand(S, day);
  return false; // weight, or a source added later that a band cannot write
}

/**
 * Does this tracker carry band data in the given days? A tracker whose
 * rule watches a band-only source counts even on days it has not filled.
 */
export function trackerUsesBandData(S, tracker, days) {
  const rule = ruleFor(tracker);
  if (rule && BAND_ONLY_SOURCES.has(rule.source.id)) return true;
  return (days || []).some(day => cellFromBand(S, day, tracker));
}
