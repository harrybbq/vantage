/**
 * The server's copy of "leave WHOOP / Oura data out of what other
 * people see" (item 124, owner decision D1 = exclude, 2026-10-20).
 *
 * recompute.js builds the ratings friends, groups and the leaderboard
 * see from the user's own state. WHOOP's terms count derivatives of its
 * data — a rating that moved because WHOOP logged your sleep — as WHOOP
 * Data, shown to others only with the user's explicit opt-in. D1 chose
 * to exclude them instead. So derivePoints runs on shareableState(state).
 *
 * Mirror of shareableView in src/lib/wearables/strip.js, which reuses
 * src/lib/coach/wearableProvenance.js. The functions are CommonJS and
 * cannot import those ES modules, so the rule is restated here, and
 * `npm run check:parity` runs both over the same states and fails the
 * build if they disagree.
 *
 * The rule (same as the AI coach guard):
 *   · vitals keys only the syncs write (hrv, recovery, strain, burnKcal,
 *     stepsWhoop, stepsOura) are dropped, and with them `sleep` / `rhr`
 *     on any row that carried one — the sync overwrites both;
 *   · `weight` is kept — neither sync writes it;
 *   · burnLog entries with a `whoop-` / `oura-` id are dropped;
 *   · a tracker cell an auto-fill rule filled from a band reading
 *     (S.logsAuto source workout / strain / recovery / burn; sleep on a
 *     band-touched row; steps above the phone's own count) is dropped.
 *     A cell with no mark or a 'manual' mark is always kept.
 *
 * Read-only: the input is never modified and nothing is written back.
 * Pure. CommonJS.
 */

const BAND_VITAL_KEYS = ['hrv', 'recovery', 'strain', 'burnKcal', 'stepsWhoop', 'stepsOura'];
const BAND_ONLY_SOURCES = new Set(['workout', 'strain', 'recovery', 'burn']);
const SHARED_VITAL_KEYS = ['sleep', 'rhr'];
const MANUAL = 'manual';
const BAND_ID = /^(whoop|oura)-/i;
/* The steps rule's default bar — AUTO_SOURCES 'steps'.threshold in
   src/lib/trackers/autoLog.js. A boolean steps tracker with no stored
   threshold uses it. */
const STEPS_DEFAULT_THRESHOLD = 10000;

const isBandEntry = e => !!e && BAND_ID.test(String(e.id || ''));

function rowTouchedByBand(state, day) {
  const v = state && state.vitalsLog && state.vitalsLog[day];
  if (!v || typeof v !== 'object') return false;
  return BAND_VITAL_KEYS.some(k => v[k] != null);
}

/** Apple Health's step count for a day (non-band burn entries), or null. */
function phoneSteps(state, day) {
  let best = null;
  const entries = (state && state.burnLog && state.burnLog[day]) || [];
  if (!Array.isArray(entries)) return null;
  for (const e of entries) {
    if (!e || isBandEntry(e)) continue;
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

/** ruleFor(tracker).threshold for the steps source (autoLog.js). */
function stepsThreshold(tracker) {
  const cfg = tracker && tracker.auto;
  if (!cfg || cfg.source !== 'steps') return STEPS_DEFAULT_THRESHOLD;
  const raw = cfg.threshold;
  if (raw == null || raw === '') return STEPS_DEFAULT_THRESHOLD;
  const t = Number(raw);
  return Number.isFinite(t) ? t : STEPS_DEFAULT_THRESHOLD;
}

/** cellFromBand in src/lib/coach/wearableProvenance.js. */
function cellFromBand(state, day, tracker) {
  if (!tracker) return false;
  const auto = state.logsAuto && state.logsAuto[day] ? state.logsAuto[day][tracker.id] : undefined;
  if (!auto || auto === MANUAL) return false;
  const logs = state.logs || {};
  const value = logs[day] ? logs[day][tracker.id] : undefined;
  if (value === undefined || value === null || value === false) return false;
  if (BAND_ONLY_SOURCES.has(auto)) return true;
  if (auto === 'steps') {
    const phone = phoneSteps(state, day);
    if (phone == null) return true;
    if (tracker.type === 'boolean') return !(phone >= stepsThreshold(tracker));
    return !(phone >= Number(value));
  }
  if (auto === 'sleep') return rowTouchedByBand(state, day);
  return false;
}

/**
 * The state with every WHOOP/Oura-derived value left out. Returns the
 * input itself when it holds none. Only vitalsLog, burnLog, logs and
 * logsAuto can differ.
 */
function shareableState(state) {
  if (!state || typeof state !== 'object') return state;
  let vitalsLog, burnLog, logs, logsAuto;

  const vIn = state.vitalsLog && typeof state.vitalsLog === 'object' ? state.vitalsLog : null;
  if (vIn) {
    for (const day of Object.keys(vIn)) {
      const row = vIn[day];
      if (!row || typeof row !== 'object' || !rowTouchedByBand(state, day)) continue;
      const drop = [...BAND_VITAL_KEYS, ...SHARED_VITAL_KEYS].filter(k => row[k] != null);
      if (!drop.length) continue;
      const next = { ...row };
      for (const k of drop) delete next[k];
      vitalsLog = vitalsLog || { ...vIn };
      if (Object.keys(next).length) vitalsLog[day] = next; else delete vitalsLog[day];
    }
  }

  const bIn = state.burnLog && typeof state.burnLog === 'object' ? state.burnLog : null;
  if (bIn) {
    for (const day of Object.keys(bIn)) {
      const list = bIn[day];
      if (!Array.isArray(list) || !list.some(isBandEntry)) continue;
      const keep = list.filter(e => !isBandEntry(e));
      burnLog = burnLog || { ...bIn };
      if (keep.length) burnLog[day] = keep; else delete burnLog[day];
    }
  }

  const aIn = state.logsAuto && typeof state.logsAuto === 'object' ? state.logsAuto : null;
  const lIn = state.logs && typeof state.logs === 'object' ? state.logs : {};
  if (aIn) {
    const trackers = new Map((Array.isArray(state.trackers) ? state.trackers : []).filter(Boolean).map(t => [t.id, t]));
    for (const day of Object.keys(aIn)) {
      const marks = aIn[day];
      if (!marks || typeof marks !== 'object') continue;
      for (const id of Object.keys(marks)) {
        const src = marks[id];
        if (!src || src === MANUAL) continue;
        if (!cellFromBand(state, day, trackers.get(id) || { id })) continue;
        logs = logs || { ...lIn };
        logsAuto = logsAuto || { ...aIn };
        const cell = { ...(logs[day] || {}) };
        delete cell[id];
        if (Object.keys(cell).length) logs[day] = cell; else delete logs[day];
        const mark = { ...(logsAuto[day] || {}) };
        delete mark[id];
        if (Object.keys(mark).length) logsAuto[day] = mark; else delete logsAuto[day];
      }
    }
  }

  if (!vitalsLog && !burnLog && !logs && !logsAuto) return state;
  const out = { ...state };
  if (vitalsLog) out.vitalsLog = vitalsLog;
  if (burnLog) out.burnLog = burnLog;
  if (logs) out.logs = logs;
  if (logsAuto) out.logsAuto = logsAuto;
  return out;
}

module.exports = { shareableState, cellFromBand, rowTouchedByBand, BAND_VITAL_KEYS, STEPS_DEFAULT_THRESHOLD };
