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
import { getWeekKey, countWeekLogs, trackerWeeklyCoins } from '../../utils/helpers.js';
import { isRealIso } from '../rotation/pattern.js';
import { trainingDayFor, wallClock, dayBefore, dayAfter } from '../rotation/trainingDay.js';
import { recoveryProviderOn, recoveryName, recoveryShort } from '../vitals/recoverySource.js';

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
 *
 * The day a workout counts for is not always the day it is filed under.
 * Entries synced since Oct 2026 carry `start` (local wall clock), and a
 * 3:30am session after a night shift counts for the shift's day — see
 * lib/rotation/trainingDay.js. So a day is answered from its own entries
 * and both neighbours'. The entry stays where it is: calories burned are
 * still that calendar day's.
 */
const isDeviceWorkout = e => {
  const id = String((e && e.id) || '');
  return /^(whoop|oura)-/.test(id) && !/steps/i.test(id);
};

/** The day a wearable workout filed under `filedDay` counts for. */
export function deviceWorkoutDayOf(S, entry, filedDay) {
  const at = wallClock(entry && entry.start);
  return at ? trainingDayFor(S, at.iso, at.hour) : filedDay;
}

export function hasDeviceWorkout(S, day) {
  const burn = (S && S.burnLog) || {};
  if (!isRealIso(day)) return (burn[day] || []).some(isDeviceWorkout);
  for (const filed of [dayBefore(day), day, dayAfter(day)]) {
    for (const e of burn[filed] || []) {
      if (isDeviceWorkout(e) && deviceWorkoutDayOf(S, e, filed) === day) return true;
    }
  }
  return false;
}

/**
 * A workout finished in Vantage's own logger (Upgrade → Lifts) on this
 * day — S.lifts.sessions holds finished workouts only, so an abandoned
 * or in-progress one never counts.
 */
export function hasVantageWorkout(S, day) {
  const sessions = S && S.lifts && Array.isArray(S.lifts.sessions) ? S.lifts.sessions : [];
  return sessions.some(s => s && s.date === day && Array.isArray(s.exercises) && s.exercises.length > 0);
}

/** A workout from either: a wearable, or a finished Vantage workout. */
export const hasWorkout = (S, day) => hasDeviceWorkout(S, day) || hasVantageWorkout(S, day);

/**
 * Steps for a day — the highest count any source reported.
 *
 * Three writers, three places, all kept: Apple Health imports a burnLog
 * entry ("8,214 steps"); WHOOP's daily cycle and Oura's daily activity
 * land on the vitals row as `stepsWhoop` / `stepsOura` (separate keys so
 * one device's sync never overwrites the other's). The highest wins: a
 * phone left on the desk under-counts, it never over-counts, and a
 * tracker should not miss its 10,000 because the phone stayed home.
 */
export function stepsOn(S, day) {
  let best = null;
  const take = n => { if (Number.isFinite(n) && n > 0 && (best == null || n > best)) best = n; };
  const v = (S && S.vitalsLog && S.vitalsLog[day]) || null;
  if (v) { take(Number(v.stepsWhoop)); take(Number(v.stepsOura)); }
  const entries = (S && S.burnLog && S.burnLog[day]) || [];
  for (const e of entries) {
    if (!e) continue;
    // Written as a number since 2026-09. Older imports only put the
    // count in the label, so those are read back out of it rather than
    // being lost — a user with six months of history should not have to
    // re-import to use a steps rule.
    if (Number.isFinite(e.steps)) { take(e.steps); continue; }
    const m = /^([\d,]+)\s*steps$/i.exec(String(e.label || ''));
    if (m) take(parseInt(m[1].replace(/,/g, ''), 10));
  }
  return best;
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
    hint: 'Hours asleep, from WHOOP, Oura or entered by hand.',
    needs: 'vitals', unit: 'h', dp: 1, threshold: 7, step: 0.5, max: 24,
    read: vital('sleep'),
  },
  {
    id: 'workout',
    label: 'A workout was recorded',
    short: 'Workout',
    hint: 'A workout was recorded — wearable or Vantage: any WHOOP or Oura workout, or a workout finished in Vantage, that day. Step counts do not count.',
    needs: 'wearable', unit: '', dp: 0, threshold: null, flag: true,
    read: (S, day) => (hasWorkout(S, day) ? 1 : null),
  },
  {
    // Lifts is owner-gated, so the option is too (AutoFillModal hides an
    // ownerOnly source from everyone else). Unlike 'workout', a WHOOP
    // walk or an Oura bike ride never ticks it: only a workout saved in
    // Lifts does — what a "Gym" tracker usually means.
    id: 'lifts',
    label: 'I finished a workout in Lifts',
    short: 'Lifts',
    hint: 'Ticks on any day you save a workout in Upgrade → Lifts. Wearable workouts don’t count.',
    needs: 'lifts', unit: '', dp: 0, threshold: null, flag: true, ownerOnly: true,
    read: (S, day) => (hasVantageWorkout(S, day) ? 1 : null),
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
    // The key holds WHOOP's Recovery or Oura's Readiness, so the words
    // here are neutral; sourceWords() names the provider where it is known.
    id: 'recovery',
    label: 'Recovery / Readiness at or above',
    short: 'Score', chipUnit: '%', // the chip truncates; "Recovery / R…" read as WHOOP's name
    hint: 'The morning score your device reports — WHOOP Recovery or Oura Readiness.',
    needs: 'score', unit: '%', dp: 0, threshold: 60, step: 5, max: 100,
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
    hint: 'Steps from WHOOP or Oura — the highest count wins.',
    needs: 'steps', unit: 'steps', dp: 0, threshold: 10000, step: 500, max: 60000,
    // Today's count keeps climbing after the first sync, so a cell this
    // rule filled itself may RISE as later syncs arrive (never fall, and
    // never a cell the user touched). See proposeAutoLogs.
    refresh: true,
    read: stepsOn,
  },
];

export const sourceById = id => AUTO_SOURCES.find(s => s.id === id) || null;

/**
 * A source's words for a known provider ('whoop' | 'oura' | null, from
 * lib/vitals/recoverySource.js). Only `recovery` changes: WHOOP's score is
 * called Recovery and Oura's Readiness, and neither is renamed as the
 * other (item 126). Unknown → the neutral words above. Display only.
 */
export function sourceWords(source, provider) {
  if (!source || source.id !== 'recovery' || (provider !== 'whoop' && provider !== 'oura')) return source;
  return {
    ...source,
    label: `${recoveryName(provider)} at or above`,
    short: recoveryShort(provider),
    hint: provider === 'whoop' ? 'WHOOP Recovery for the morning, as a percentage.' : 'Oura Readiness for the day, 0–100.',
  };
}

/** Sources a person can pick: an ownerOnly one only for the owner. */
export const pickableSources = owner => AUTO_SOURCES.filter(s => !s.ownerOnly || owner);

/** Trackers that a finished Lifts workout ticks (either rule reads it). */
export function liftsLinkedTrackers(S) {
  return ((S && S.trackers) || []).filter(t => {
    const r = ruleFor(t);
    return r && (r.source.id === 'lifts' || r.source.id === 'workout');
  });
}

/**
 * Point a tracker at finished Lifts workouts. Clears `autoOff` (this is
 * the user asking for a rule) and replaces any rule it had. `prev`
 * unchanged for an unknown tracker or one already on the rule.
 */
export function linkTrackerToLifts(prev, trackerId) {
  const trackers = (prev && prev.trackers) || [];
  const t = trackers.find(x => x && x.id === trackerId);
  if (!t || (t.auto && t.auto.source === 'lifts')) return prev;
  return {
    ...prev,
    trackers: trackers.map(x => {
      if (x.id !== trackerId) return x;
      const { autoOff, ...rest } = x;
      return { ...rest, auto: { source: 'lifts', threshold: null } };
    }),
  };
}

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

/* ── Step trackers switch themselves on ────────────────────────────────
 *
 * A tracker called "Steps" or "10k steps", or counted in steps, on an
 * account whose WHOOP, Oura or Apple Health is already sending a step
 * count, gets the steps rule attached once — the user asked for this to
 * happen without visiting Auto-fill. It is still an ordinary rule: the
 * chip on the tracker says so, Auto-fill can change or remove it, and
 * removing it sets `autoOff`, which this never overrides. Never touches a
 * tracker that already has a rule.
 */

/** Does this tracker look like it counts steps? */
export function isStepTracker(t) {
  if (!t) return false;
  if (/^steps?$/i.test(String(t.unit || '').trim())) return true;
  return /\bsteps?\b/i.test(String(t.name || ''));
}

/** Trackers that would get the steps rule now. */
export function suggestStepRules(S, { now = new Date(), days = BACKFILL_DAYS } = {}) {
  const trackers = (S && S.trackers) || [];
  const candidates = trackers.filter(t => t && !t.auto && !t.autoOff && isStepTracker(t));
  if (!candidates.length) return [];
  const source = sourceById('steps');
  if (!sourceHasData(S, source, days, now)) return [];
  return candidates.map(t => t.id);
}

/** Attach the steps rule to those trackers. `prev` unchanged when none. */
export function applyStepRules(prev, { now = new Date() } = {}) {
  const ids = new Set(suggestStepRules(prev, { now }));
  if (!ids.size) return prev;
  return {
    ...prev,
    trackers: (prev.trackers || []).map(t => {
      if (!ids.has(t.id)) return t;
      const goal = Number(t.dailyGoal);
      const threshold = t.type === 'boolean' ? (Number.isFinite(goal) && goal > 0 ? goal : 10000) : null;
      return { ...t, auto: { source: 'steps', threshold, suggested: true } };
    }),
  };
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
      // Rule 3: a cell the user has touched stays exactly as they left it.
      if (auto[day] && auto[day][t.id] === MANUAL) continue;
      const has = logs[day] && logs[day][t.id] !== undefined;
      // Rule 1: a cell with a value is the user's, or is already ours.
      // One exception, for counts that keep growing through the day
      // (steps): a NUMBER cell this same source filled may be raised to
      // a higher reading. Never lowered, never a boolean, never a cell
      // marked as anyone else's.
      const ours = has && auto[day] && auto[day][t.id] === rule.source.id;
      if (has && !(ours && rule.source.refresh && t.type !== 'boolean')) continue;

      const reading = rule.source.read(S, day);
      if (reading == null) continue;
      if (has) {
        const next = round(reading, rule.source.dp);
        if (!(next > Number(logs[day][t.id]))) continue;
        out.push({ day, trackerId: t.id, value: next, source: rule.source.id, reading, raised: true });
        continue;
      }

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
    // Capped at read time, like the manual award paths.
    const reward = trackerWeeklyCoins(t);
    if (!touched.has(t.id) || !t.weeklyTarget || !reward) continue;
    const awardKey = 'awarded_' + t.id + '_' + thisWeek;
    if (next[awardKey]) continue;
    if (countWeekLogs(logs, t.id, today, t) < t.weeklyTarget) continue;
    next = {
      ...next,
      [awardKey]: true,
      coins: (next.coins || 0) + reward,
      coinHistory: [
        { type: 'earn', label: `${t.name} weekly goal (${t.weeklyTarget}x)`, amount: reward, ts: Date.now() },
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
  const base = sourceById(src);
  if (!base) return null;
  // Whose score filled THIS day, so the line names the right company.
  const source = base.id === 'recovery' ? sourceWords(base, recoveryProviderOn(S, day)) : base;
  const reading = source.read(S, day);
  // A yes/no source has no reading worth printing ("…: 1").
  if (reading == null || source.flag) return { source, reading, text: source.label };
  const shown = source.dp ? reading.toFixed(source.dp) : Math.round(reading).toLocaleString('en-GB');
  return { source, reading, text: `${source.label.replace(/ at least| at or above| reached/, '')}: ${shown}${source.unit ? ' ' + source.unit : ''}` };
}

/** The rule as a sentence, for a tooltip or a longer line. `provider`
 *  names whose recovery score it reads (see sourceWords). */
export function ruleLabel(tracker, provider = null) {
  const rule = ruleFor(tracker);
  if (!rule) return null;
  const { threshold } = rule;
  const source = sourceWords(rule.source, provider);
  if (threshold == null || tracker.type !== 'boolean') return source.label;
  return `${source.label} ${threshold}${source.unit ? source.unit : ''}`;
}

/**
 * The rule as a chip — two or three words, because it sits in a sidebar
 * roughly 300px wide. "A wearable recorded a workout" truncated to
 * "A wearable re…" there, which told the reader nothing at all.
 */
export function ruleChip(tracker, provider = null) {
  const rule = ruleFor(tracker);
  if (!rule) return null;
  const { threshold } = rule;
  const source = sourceWords(rule.source, provider);
  if (threshold == null || tracker.type !== 'boolean') return source.short;
  return `${source.short} ≥ ${threshold}${source.chipUnit || ''}`;
}
