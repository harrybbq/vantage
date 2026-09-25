/**
 * An achievement that a tracker fills in.
 *
 * "Go to the gym 5 times a week for a month" used to be an achievement
 * you ticked by hand after keeping count somewhere else — while the Gym
 * tracker, on the same app, already knew every day you went. A link
 * lets the tracker do the counting.
 *
 * ── The two ways of counting ─────────────────────────────────────────
 *   weekly  Hit the tracker `perWeek` times in a week, for `weeks`
 *           weeks IN A ROW. Strict on purpose: it is the shape of the
 *           goal as people say it out loud, and a missed week is a
 *           missed week.
 *   count   Log it `count` times, in any pattern. The wiggle-room
 *           option — a bad week costs nothing but time.
 *
 * ── Stored shape (additive, on the achievement) ──────────────────────
 *   link: { trackerId, mode: 'weekly'|'count', perWeek, weeks, count, since }
 * `since` is when the link was made; logs before it do not count, so an
 * old streak cannot complete a goal set today.
 *
 * Nothing here writes. Progress is derived on every render from the
 * logs, so unticking a day in Track takes the progress back with it —
 * which a stored counter would get wrong the first time anyone did.
 *
 * Completion stays a tap on ★. A met goal says so on the card; the tap
 * is what pays the coins, and keeping it there keeps every payout on
 * the one path that already enforces the rating rules.
 */

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
/** Monday 00:00 of the week containing `t` (local time). */
export function weekStart(t) {
  const d = dayStart(t);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Did the tracker count as done on this day? Same rule as Track's
 *  weekly targets: a boolean tick, or any amount for a number tracker
 *  (whose `goal` is a MONTHLY figure, never a daily one). */
function hitOn(tracker, logs, key) {
  const v = logs?.[key]?.[tracker.id];
  return tracker.type === 'number' ? (Number(v) || 0) > 0 : !!v;
}

/** Normalise a stored link; null if it is not a usable one. */
export function readLink(ach) {
  const l = ach && ach.link;
  if (!l || !l.trackerId) return null;
  const mode = l.mode === 'count' ? 'count' : 'weekly';
  return {
    trackerId: l.trackerId,
    mode,
    perWeek: Math.min(7, Math.max(1, Math.round(Number(l.perWeek) || 3))),
    weeks: Math.min(52, Math.max(1, Math.round(Number(l.weeks) || 4))),
    count: Math.min(1000, Math.max(1, Math.round(Number(l.count) || 20))),
    since: Number(l.since) || Number(ach.createdAt) || 0,
  };
}

/**
 * Progress on one linked achievement.
 *
 * @returns null when the achievement has no link, else
 *   { mode, done, target, pct, met, unit, tracker, line, thisWeek?, missing? }
 */
export function linkProgress(ach, trackers, logs, now = Date.now()) {
  const link = readLink(ach);
  if (!link) return null;
  const tracker = (trackers || []).find(t => t.id === link.trackerId);
  if (!tracker) {
    return { mode: link.mode, done: 0, target: 1, pct: 0, met: false, unit: '',
             tracker: null, missing: true, line: 'Linked tracker was deleted' };
  }
  const from = dayStart(link.since || now);
  const today = dayStart(now);

  if (link.mode === 'count') {
    let done = 0;
    for (let d = new Date(from); d <= today; d.setDate(d.getDate() + 1)) {
      if (hitOn(tracker, logs, ymd(d))) done++;
    }
    const target = link.count;
    return {
      mode: 'count', done: Math.min(done, target), target,
      pct: Math.min(100, Math.round((done / target) * 100)),
      met: done >= target, unit: 'logged', tracker: tracker.name,
      line: `${tracker.name} · ${Math.min(done, target)} of ${target} logged`,
    };
  }

  /* Weekly. Walk every week from the one the link was made in to this
     one. A week is `done` when it hit perWeek; the CURRENT week is never
     a miss (it is not over); and the FIRST week is never a miss if the
     link was made part-way through it — asking for five gym sessions
     between a Thursday and the Sunday would fail a goal on day one. It
     still counts if you manage it anyway. */
  const firstWeek = weekStart(from);
  const thisWeekStart = weekStart(today);
  const partialFirst = from.getTime() !== firstWeek.getTime();
  let run = 0;
  let best = 0;
  let thisWeek = { hits: 0, perWeek: link.perWeek };
  // setDate(+7) rather than adding milliseconds: it stays on local
  // midnight through the clock changes, where 7 × 24h would not.
  for (let w = new Date(firstWeek); w <= thisWeekStart; w.setDate(w.getDate() + 7)) {
    let hits = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(w); d.setDate(d.getDate() + i);
      if (d < from || d > today) continue;
      if (hitOn(tracker, logs, ymd(d))) hits++;
    }
    const isCurrent = w.getTime() === thisWeekStart.getTime();
    const isFirst = w.getTime() === firstWeek.getTime();
    if (isCurrent) thisWeek = { hits, perWeek: link.perWeek };
    if (hits >= link.perWeek) { run++; best = Math.max(best, run); }
    else if (isCurrent || (isFirst && partialFirst)) { /* not over / grace */ }
    else run = 0;
  }
  const target = link.weeks;
  const met = best >= target;
  const done = met ? target : run;
  return {
    mode: 'weekly', done, target,
    pct: Math.min(100, Math.round((done / target) * 100)),
    met, unit: done === 1 ? 'week' : 'weeks', tracker: tracker.name, thisWeek,
    line: `${tracker.name} · ${link.perWeek}×/wk · this week ${Math.min(thisWeek.hits, link.perWeek)}/${link.perWeek}`,
  };
}

/** Every linked achievement's progress, keyed by id. */
export function linkProgressMap(achievements, trackers, logs, now = Date.now()) {
  const out = {};
  for (const a of achievements || []) {
    if (a && a.link && a.link.trackerId && !a.completed) {
      const p = linkProgress(a, trackers, logs, now);
      if (p) out[a.id] = p;
    }
  }
  return out;
}
