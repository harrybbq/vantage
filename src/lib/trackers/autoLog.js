/**
 * Trackers that tick themselves from data the app already has.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * WHOOP made calories burned automatic, and that — not the integration
 * itself — is the thing that worked: it removed a daily decision rather
 * than a daily typing task. But the sync only got half way. Weight
 * already lands in `vitalsLog` from WHOOP and Apple Health, and a
 * "Weigh in" tracker still had to be ticked by hand. WHOOP already
 * records that a workout happened, and "Gym session" was still a manual
 * tick. The hard half was built and the easy half was left to the user.
 *
 * This module is the easy half: a per-tracker rule mapping a reading
 * that already exists in `S` onto a tick.
 *
 * ── The rules it obeys ───────────────────────────────────────────────
 * 1. It NEVER overwrites. A cell with a value in `S.logs` is left
 *    exactly as it is — same principle as deviceWorkoutDays, which
 *    fills in days the user didn't tick and never touches days they
 *    did.
 * 2. It never deletes. A rule that stops matching does not retract
 *    yesterday's tick; the log is a record of what happened, not a live
 *    query.
 * 3. The user always wins. Any cell the user touches by hand is marked
 *    `manual` in `S.logsAuto` and is never auto-filled again — which is
 *    what stops an un-ticked day quietly coming back.
 * 4. Everything it writes says where it came from. `S.logsAuto[day][id]`
 *    holds the source id, so the Track page can show that a tick came
 *    from a device and what reading produced it. An auto-filled number
 *    the user cannot trace is a number they stop trusting.
 *
 * New state keys, both additive:
 *   S.logsAuto            { [day]: { [trackerId]: sourceId | 'manual' } }
 *   S.trackers[].auto     { source, threshold } — opt-in, per tracker
 *
 * Pure. No React, no network, no DOM.
 */
import { recalcStreaks } from '../../utils/streaks.js';
import { getWeekKey, countWeekLogs } from '../../utils/helpers.js';

/** The marker meaning "the user has spoken; hands off this cell". */
export const MANUAL = 'manual';

/** How far back a newly enabled rule reaches. Bounded: filling in a
 *  fortnight makes the calendar immediately true, filling in a year
 *  rewrites history the user never saw. */
export const BACKFILL_DAYS = 14;

/**
 * A wearable workout on this day.
 *
 * WHOOP and Oura workouts land in `burnLog` as entries whose id carries
 * the provider prefix (see netlify/lib/whoop.js). Step imports use the
 * same store and must not count — owning a phone is not a workout.
 *
 * This is the one definition; deviceWorkoutDays in lib/body/goal.js
 * reads it too, so the training plan and a tracker tick cannot come to
 * different conclusions about whether you trained.
 */
export function hasDeviceWorkout(S, day) {
  const entries = (S && S.burnLog && S.burnLog[day]) || [];
  return entries.some(e => {
    const id = String((e && e.id) || '');
    return /^(whoop|oura)-/.test(id) && !/steps/i.test(id);
  });
}

/** Steps for a day, from whatever wrote them. */
export function stepsOn(S, day) {
  const entries = (S && S.burnLog && S.burnLog[day]) || [];
  for (const e of entries) {
    if (!e) continue;
    // Written as a number since 2026-09. Older imports only put the
    // count in the label, so those are read back out of it rather than
    // being lost — a user with six months of history should not have to
    // re-import to use a steps rule.
    if (Number.isFinite(e.steps)) return e.steps;
    const m = /^([\d,]+)\s*steps$/i.exec(String(e.label || ''));
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

const vital = key => (S, day) => {
  const v = (S && S.vitalsLog && S.vitalsLog[day]) || null;
  const n = v ? Number(v[key]) : null;
  return Number.isFinite(n) ? n : null;
};

/**
 * What a rule can watch.
 *
 * `threshold` is the bar a BOOLEAN tracker has to clear. A NUMBER
 * tracker takes the reading itself — a "Sleep" tracker measured in
 * hours wants 7.4, not a tick — so the threshold does not apply to it.
 *
 * `needs` is which connection makes the source produce anything, used
 * to explain an empty rule rather than offering a dead one.
 */
export const AUTO_SOURCES = [
  {
    id: 'weight',
    label: 'A weight reading arrived',
    short: 'Weight',
    hint: 'Ticks on any day a weight was recorded — by a scale, a wearable or by hand.',
    needs: 'vitals', unit: 'kg', dp: 1, threshold: null,
    read: vital('weight'),
  },
  {
    id: 'sleep',
    label: 'Slept at least',
    short: 'Sleep', chipUnit: 'h',
    hint: 'Hours asleep, from WHOOP, Oura or Apple Health.',
    needs: 'vitals', unit: 'h', dp: 1, threshold: 7, step: 0.5, max: 24,
    read: vital('sleep'),
  },
  {
    id: 'workout',
    label: 'A wearable recorded a workout',
    short: 'Workout',
    hint: 'Any WHOOP or Oura workout that day. Step counts do not count.',
    needs: 'wearable', unit: '', dp: 0, threshold: null,
    read: (S, day) => (hasDeviceWorkout(S, day) ? 1 : null),
  },
  {
    id: 'strain',
    label: 'Strain reached',
    short: 'Strain',
    hint: 'WHOOP day strain, 0–21.',
    needs: 'whoop', unit: '', dp: 1, threshold: 10, step: 0.5, max: 21,
    read: vital('strain'),
  },
  {
    id: 'recovery',
    label: 'Recovery at or above',
    short: 'Recovery', chipUnit: '%',
    hint: 'WHOOP recovery percentage for the morning.',
    needs: 'whoop', unit: '%', dp: 0, threshold: 60, step: 5, max: 100,
    read: vital('recovery'),
  },
  {
    id: 'burn',
    label: 'Burned at least',
    short: 'Burn',
    hint: 'All-day calories out, from WHOOP.',
    needs: 'whoop', unit: 'kcal', dp: 0, threshold: 2500, step: 100, max: 10000,
    read: vital('burnKcal'),
  },
  {
    id: 'steps',
    label: 'Walked at least',
    short: 'Steps',
    hint: 'Steps imported from Apple Health.',
    needs: 'health', unit: 'steps', dp: 0, threshold: 10000, step: 500, max: 60000,
    read: stepsOn,
  },
];

export const sourceById = id => AUTO_SOURCES.find(s => s.id === id) || null;

/** Does any day in the log carry a reading this source could use? */
export function sourceHasData(S, source, days = 60, now = new Date()) {
  if (!source) return false;
  for (const day of recentDays(days, now)) {
    if (source.read(S, day) != null) return true;
  }
  return false;
}

/** Day keys, most recent first, `n` of them ending today. */
export function recentDays(n, now = new Date()) {
  const out = [];
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < n; i++) {
    out.push(dayKey(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const round = (n, dp) => (dp ? Number(n.toFixed(dp)) : Math.round(n));

/** The rule attached to a tracker, resolved, or null. */
export function ruleFor(tracker) {
  const cfg = tracker && tracker.auto;
  const source = cfg && cfg.source ? sourceById(cfg.source) : null;
  if (!source) return null;
  // `Number(null)` is 0, not NaN — so a stored `threshold: null` on a
  // source that has no bar (weight, workout) read back as "at least 0"
  // and printed itself as "Weight ≥ 0". Worse on a source that DOES have
  // a bar: a null there would have ticked every day it saw a reading.
  const raw = cfg.threshold;
  if (raw == null || raw === '') return { source, threshold: source.threshold };
  const t = Number(raw);
  return { source, threshold: Number.isFinite(t) ? t : source.threshold };
}

/**
 * What the rules would write, given the state as it stands.
 *
 * Returns one entry per cell it would fill — never per cell it would
 * change, because it changes nothing. Empty is the normal answer, and
 * an empty answer must produce no state write at all: this runs on
 * every sync, and a `{...prev}` for nothing would queue a save of the
 * whole ~1MB blob (the same trap syncWhoop already guards).
 */
export function proposeAutoLogs(S, { now = new Date(), days = BACKFILL_DAYS } = {}) {
  const trackers = (S && S.trackers) || [];
  const logs = (S && S.logs) || {};
  const auto = (S && S.logsAuto) || {};
  const out = [];

  for (const t of trackers) {
    const rule = ruleFor(t);
    if (!rule) continue;
    for (const day of recentDays(days, now)) {
      // Rule 1: a cell with a value is the user's, or is already ours.
      if (logs[day] && logs[day][t.id] !== undefined) continue;
      // Rule 3: a cell the user has cleared stays cleared.
      if (auto[day] && auto[day][t.id] === MANUAL) continue;

      const reading = rule.source.read(S, day);
      if (reading == null) continue;

      let value;
      if (t.type === 'boolean') {
        if (rule.threshold != null && reading < rule.threshold) continue;
        value = true;
      } else {
        if (!(reading > 0)) continue;
        value = round(reading, rule.source.dp);
      }
      out.push({ day, trackerId: t.id, value, source: rule.source.id, reading });
    }
  }
  return out;
}

/**
 * Apply proposals to state.
 *
 * Returns `prev` UNCHANGED when there is nothing to write, so a caller
 * can run this as often as it likes without touching the save pipeline.
 *
 * Coins: a weekly challenge pays out for the CURRENT week only. Not
 * awarding at all would mean turning automation on cost the user coins
 * they would have earned by ticking, which is a perverse thing to
 * charge for; awarding retrospectively for backfilled history would
 * hand out a fortnight of rewards for connecting a watch. The middle is
 * the honest one. There is no toast and no confetti — the moment it
 * happened, nobody was looking.
 */
export function applyAutoLogs(prev, proposals, { now = new Date() } = {}) {
  if (!proposals || !proposals.length) return prev;

  const logs = { ...(prev.logs || {}) };
  const logsAuto = { ...(prev.logsAuto || {}) };

  for (const p of proposals) {
    logs[p.day] = { ...(logs[p.day] || {}), [p.trackerId]: p.value };
    logsAuto[p.day] = { ...(logsAuto[p.day] || {}), [p.trackerId]: p.source };
  }

  let next = { ...prev, logs, logsAuto };
  next.streaks = recalcStreaks(logs, prev.trackers || [], prev.streaks || {});

  // Weekly challenge, current week only, award-only. Auto-fill never
  // removes a log, so there is no reversal branch to mirror.
  const today = dayKey(now);
  const thisWeek = getWeekKey(today);
  const touched = new Set(
    proposals.filter(p => getWeekKey(p.day) === thisWeek).map(p => p.trackerId)
  );
  for (const t of (prev.trackers || [])) {
    if (!touched.has(t.id) || !t.weeklyTarget || !t.weeklyCoins) continue;
    const awardKey = 'awarded_' + t.id + '_' + thisWeek;
    if (next[awardKey]) continue;
    if (countWeekLogs(logs, t.id, today) < t.weeklyTarget) continue;
    next = {
      ...next,
      [awardKey]: true,
      coins: (next.coins || 0) + t.weeklyCoins,
      coinHistory: [
        { type: 'earn', label: `${t.name} weekly goal (${t.weeklyTarget}x)`, amount: t.weeklyCoins, ts: Date.now() },
        ...(next.coinHistory || []),
      ],
    };
  }

  return next;
}

/**
 * Record that the user decided this cell themselves.
 *
 * Called from every path a person can log by hand. Marking on a WRITE
 * is not enough — the case that matters is the un-tick, where the cell
 * ends up empty and would otherwise be refilled on the next sync and
 * read as the app arguing with you.
 *
 * Returns `prev` unchanged when nothing needs marking.
 */
export function markManual(prev, day, trackerIds) {
  const ids = (Array.isArray(trackerIds) ? trackerIds : [trackerIds]).filter(Boolean);
  if (!day || !ids.length) return prev;
  const auto = prev.logsAuto || {};
  const dayAuto = auto[day] || {};
  if (ids.every(id => dayAuto[id] === MANUAL)) return prev;
  return {
    ...prev,
    logsAuto: { ...auto, [day]: { ...dayAuto, ...Object.fromEntries(ids.map(id => [id, MANUAL])) } },
  };
}

/** Which trackers currently carry a rule that could have filled this day. */
export function autoTrackerIds(S) {
  return ((S && S.trackers) || []).filter(t => ruleFor(t)).map(t => t.id);
}

/** Was this cell filled by a rule rather than by the user? */
export function isAutoFilled(S, day, trackerId) {
  const v = S && S.logsAuto && S.logsAuto[day] && S.logsAuto[day][trackerId];
  return !!v && v !== MANUAL;
}

/**
 * The provenance line for a filled cell: what it came from, and the
 * reading that produced it, re-read live so it cannot go stale against
 * the log.
 */
export function autoProvenance(S, day, trackerId) {
  const src = S && S.logsAuto && S.logsAuto[day] && S.logsAuto[day][trackerId];
  if (!src || src === MANUAL) return null;
  const source = sourceById(src);
  if (!source) return null;
  const reading = source.read(S, day);
  if (reading == null) return { source, text: source.label };
  const shown = source.dp ? reading.toFixed(source.dp) : Math.round(reading).toLocaleString('en-GB');
  return { source, reading, text: `${source.label.replace(/ at least| at or above| reached/, '')}: ${shown}${source.unit ? ' ' + source.unit : ''}` };
}

/** The rule as a sentence, for a tooltip or a longer line. */
export function ruleLabel(tracker) {
  const rule = ruleFor(tracker);
  if (!rule) return null;
  const { source, threshold } = rule;
  if (threshold == null || tracker.type !== 'boolean') return source.label;
  return `${source.label} ${threshold}${source.unit ? source.unit : ''}`;
}

/**
 * The rule as a chip — two or three words, because it sits in a sidebar
 * roughly 300px wide. "A wearable recorded a workout" truncated to
 * "A wearable re…" there, which told the reader nothing at all.
 */
export function ruleChip(tracker) {
  const rule = ruleFor(tracker);
  if (!rule) return null;
  const { source, threshold } = rule;
  if (threshold == null || tracker.type !== 'boolean') return source.short;
  return `${source.short} ≥ ${threshold}${source.chipUnit || ''}`;
}
