/**
 * WHOOP / Oura data, separated from everything else in the state.
 *
 * Two jobs, one rule (2026-10-20, owner decisions D1 and D4; checklist
 * items 124 and the D4 Settings action):
 *
 *   shareableView(S)       What OTHER people's numbers are computed from:
 *                          ratings (src/lib/ratings/derive.js, mirrored
 *                          server-side in netlify/lib/wearableShare.js),
 *                          vision unlocks (and so the level friends and
 *                          handle search see) and the friends heatmap.
 *                          WHOOP's terms count derivatives of its data as
 *                          WHOOP Data and need the user's explicit opt-in
 *                          before anyone else sees them; D1 chose to
 *                          exclude them instead. A read-only view — S is
 *                          never written from it.
 *
 *   stripWearableData(S)   The user-confirmed "Delete data synced from
 *                          WHOOP/Oura" action (Settings → Tools → Health
 *                          & sync). Applied as update(prev =>
 *                          stripWearableData(prev)), never as a whole-
 *                          state replace. Everything else in S comes back
 *                          by reference.
 *
 * What counts as band data. Provenance per value does not exist on a
 * vitals row, so this reuses the rule the AI coach already applies
 * (../coach/wearableProvenance.js), unchanged:
 *   · vitals keys only the syncs write — hrv, recovery, strain, burnKcal,
 *     stepsWhoop, stepsOura (BAND_VITAL_KEYS) — always band;
 *   · `sleep` and `rhr` on a row that also carries one of those keys.
 *     The sync overwrites both every day it runs, so on such a row they
 *     are treated as the band's. A sleep or resting-HR value on a row no
 *     band touched (typed by hand, or Apple Health) is never touched.
 *     For the deletion this part is the user's choice (`sharedVitals`,
 *     on by default, named in the confirm) because a value typed on a
 *     day a band also synced is indistinguishable from the band's;
 *   · `weight` — never. Neither sync writes it;
 *   · burnLog entries whose id starts `whoop-` / `oura-` (how both syncs
 *     file workouts); every other entry — Apple Health steps, a typed
 *     activity — stays;
 *   · tracker cells an auto-fill rule filled from a band reading
 *     (cellFromBand), with their `logsAuto` mark. A cell the user ticked
 *     or touched (no mark, or 'manual') is never touched.
 *
 * Pure. No React, no network.
 */
import {
  BAND_VITAL_KEYS, rowTouchedByBand, cellFromBand,
} from '../coach/wearableProvenance.js';
import { MANUAL, hasVantageWorkout } from '../trackers/autoLog.js';
import { recalcStreaks } from '../../utils/streaks.js';

const BAND_ID = /^(whoop|oura)-/i;
const SHARED_VITAL_KEYS = ['sleep', 'rhr'];
/** State keys that only describe a sync, cleared by the deletion. */
const SYNC_MARKERS = ['whoopLastError', 'ouraLastError'];

const isBandEntry = e => !!e && BAND_ID.test(String(e.id || ''));

/**
 * The core walk. Classifies against the ORIGINAL state (cellFromBand
 * reads the vitals row and burn list as they are) and returns new maps
 * only where something changed.
 *
 * opts.sharedVitals        also remove sleep/rhr on band-touched rows (default true)
 * opts.keepVantageWorkouts keep a 'workout' tick on a day with a workout
 *                          finished in Vantage's own logger (default false:
 *                          the coach's conservative rule — the server has
 *                          no lifts data and must agree with the client)
 */
function walk(S, { sharedVitals = true, keepVantageWorkouts = false } = {}) {
  const counts = { vitalsDays: 0, vitalValues: 0, workouts: 0, ticks: 0, days: new Set(), whoop: false, oura: false };
  if (!S || typeof S !== 'object') return { counts };

  // ── vitalsLog ──
  let vitalsLog;
  const vIn = S.vitalsLog && typeof S.vitalsLog === 'object' ? S.vitalsLog : null;
  if (vIn) {
    for (const day of Object.keys(vIn)) {
      const row = vIn[day];
      if (!row || typeof row !== 'object' || !rowTouchedByBand(S, day)) continue;
      const drop = [...BAND_VITAL_KEYS, ...(sharedVitals ? SHARED_VITAL_KEYS : [])].filter(k => row[k] != null);
      if (!drop.length) continue;
      if (row.strain != null || row.stepsWhoop != null) counts.whoop = true;
      if (row.stepsOura != null) counts.oura = true;
      const next = { ...row };
      for (const k of drop) delete next[k];
      vitalsLog = vitalsLog || { ...vIn };
      if (Object.keys(next).length) vitalsLog[day] = next;
      else delete vitalsLog[day];
      counts.vitalsDays++;
      counts.vitalValues += drop.length;
      counts.days.add(day);
    }
  }

  // ── burnLog ──
  let burnLog;
  const bIn = S.burnLog && typeof S.burnLog === 'object' ? S.burnLog : null;
  if (bIn) {
    for (const day of Object.keys(bIn)) {
      const list = bIn[day];
      if (!Array.isArray(list) || !list.some(isBandEntry)) continue;
      const keep = [];
      for (const e of list) {
        if (!isBandEntry(e)) { keep.push(e); continue; }
        counts.workouts++;
        if (/^whoop-/i.test(String(e.id))) counts.whoop = true; else counts.oura = true;
      }
      burnLog = burnLog || { ...bIn };
      if (keep.length) burnLog[day] = keep;
      else delete burnLog[day];
      counts.days.add(day);
    }
  }

  // ── logs + logsAuto ──
  let logs, logsAuto;
  const aIn = S.logsAuto && typeof S.logsAuto === 'object' ? S.logsAuto : null;
  const lIn = S.logs && typeof S.logs === 'object' ? S.logs : {};
  if (aIn) {
    const trackers = new Map(((S.trackers) || []).filter(Boolean).map(t => [t.id, t]));
    for (const day of Object.keys(aIn)) {
      const marks = aIn[day];
      if (!marks || typeof marks !== 'object') continue;
      for (const id of Object.keys(marks)) {
        const src = marks[id];
        if (!src || src === MANUAL) continue;
        // A cell of a deleted tracker still shows on the heatmap and in
        // the active-day count, so it is classified too, by its source.
        const tracker = trackers.get(id) || { id };
        if (!cellFromBand(S, day, tracker)) continue;
        if (keepVantageWorkouts && src === 'workout' && hasVantageWorkout(S, day)) continue;
        logs = logs || { ...lIn };
        logsAuto = logsAuto || { ...aIn };
        const cell = { ...(logs[day] || {}) };
        delete cell[id];
        if (Object.keys(cell).length) logs[day] = cell; else delete logs[day];
        const mark = { ...(logsAuto[day] || {}) };
        delete mark[id];
        if (Object.keys(mark).length) logsAuto[day] = mark; else delete logsAuto[day];
        counts.ticks++;
        counts.days.add(day);
      }
    }
  }

  return { vitalsLog, burnLog, logs, logsAuto, counts };
}

const viewCache = new WeakMap();

/**
 * S with every WHOOP/Oura-derived value left out — what anything other
 * people see is computed from. Returns S itself when it holds no band
 * data. Memoised per state object (it runs on every render through
 * useVisions and the ratings hook).
 */
export function shareableView(S) {
  if (!S || typeof S !== 'object') return S;
  const hit = viewCache.get(S);
  if (hit) return hit;
  const r = walk(S);
  let out = S;
  if (r.vitalsLog || r.burnLog || r.logs || r.logsAuto) {
    out = { ...S };
    if (r.vitalsLog) out.vitalsLog = r.vitalsLog;
    if (r.burnLog) out.burnLog = r.burnLog;
    if (r.logs) out.logs = r.logs;
    if (r.logsAuto) out.logsAuto = r.logsAuto;
  }
  viewCache.set(S, out);
  return out;
}

/**
 * What the deletion would remove, for the confirm step.
 * → { days, vitalsDays, vitalValues, workouts, ticks, providers: ['WHOOP'|'Oura'], any }
 */
export function wearableDataSummary(S, opts = {}) {
  const { counts } = walk(S, { keepVantageWorkouts: true, ...opts });
  const providers = [];
  if (counts.whoop || (S && S.whoopConnected)) providers.push('WHOOP');
  if (counts.oura || (S && S.ouraConnected)) providers.push('Oura');
  const any = counts.vitalsDays + counts.workouts + counts.ticks > 0;
  return {
    days: counts.days.size,
    vitalsDays: counts.vitalsDays,
    vitalValues: counts.vitalValues,
    workouts: counts.workouts,
    ticks: counts.ticks,
    providers,
    any,
  };
}

/** "WHOOP", "Oura", "WHOOP and Oura", or "WHOOP/Oura" when unknown. */
export function providerLabel(providers) {
  if (!providers || !providers.length) return 'WHOOP/Oura';
  return providers.join(' and ');
}

/**
 * Remove WHOOP/Oura-synced data from a state, surgically. For
 * update(prev => stripWearableData(prev)).
 *
 * Returns `prev` UNCHANGED (same reference) when there is nothing to
 * remove, so a second tap queues no save. Otherwise a shallow copy with
 * only vitalsLog / burnLog / logs / logsAuto / streaks replaced and the
 * sync error markers cleared. The connection flags are left alone —
 * disconnecting is its own action.
 *
 * opts.sharedVitals: also remove sleep/rhr on rows a band synced
 * (default true). Off keeps every sleep and resting-HR value.
 */
export function stripWearableData(prev, opts = {}) {
  if (!prev || typeof prev !== 'object') return prev;
  const r = walk(prev, { sharedVitals: opts.sharedVitals !== false, keepVantageWorkouts: true });
  const markers = SYNC_MARKERS.filter(k => prev[k] != null);
  if (!r.vitalsLog && !r.burnLog && !r.logs && !r.logsAuto && !markers.length) return prev;
  const next = { ...prev };
  if (r.vitalsLog) next.vitalsLog = r.vitalsLog;
  if (r.burnLog) next.burnLog = r.burnLog;
  if (r.logsAuto) next.logsAuto = r.logsAuto;
  if (r.logs) {
    next.logs = r.logs;
    // Same as applyAutoLogs: streaks follow the log. Best streaks are
    // kept by recalcStreaks itself.
    next.streaks = recalcStreaks(r.logs, prev.trackers || [], prev.streaks || {});
  }
  for (const k of markers) delete next[k];
  return next;
}
