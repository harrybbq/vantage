import { trainingAdherence } from '../body/goal.js';
/**
 * Pattern snapshot — extended user state for proactive nudge detection.
 *
 * The existing buildSnapshot in snapshot.js is tuned for the daily
 * brief: 14 days of history, current state, recent_briefs for
 * variety. Pattern detection wants more:
 *
 *   - Longer horizon (90 days default) so weekly cadence patterns
 *     have enough data to be statistically real, not noise.
 *   - Day-of-week rollups per tracker — finds "always dips on
 *     Wednesday" type patterns.
 *   - Streak histogram per tracker — finds "never gets past 5 days"
 *     ceilings or recent regressions.
 *   - Consistency score — fraction of days with any activity at all
 *     vs total days. A lazy week stands out.
 *   - Habit gap analysis — for each habit, time since last relapse,
 *     longest run vs current run, recent run trend.
 *   - Achievement velocity — completed in last 30/60/90 days for
 *     surfacing "you've been quiet on goals lately".
 *
 * Stays PII-free. Same redaction rules as snapshot.js: no notes, no
 * photos, no money amounts (savings goals are coming in F4 — they'll
 * come through as a count/names only, never £ figures).
 *
 * Pure function — no I/O, no clock side effects beyond `Date.now()`
 * captured up front so the same snapshot is reproducible within a
 * single call.
 */

const DAY_MS = 86_400_000;
const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function parseYmd(s) {
  // Treat as local-noon to avoid timezone drift around DST boundaries.
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * For a tracker, walk N days of logs, returning per-day numeric value.
 * Booleans collapse to 0/1, numbers pass through. Returns oldest-first
 * so chart-style rendering / windowed stats are direct.
 */
function dailySeries(t, logs, days, today) {
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today - i * DAY_MS);
    const k = ymd(date);
    const v = logs[k]?.[t.id];
    const n = t.type === 'boolean' ? (v ? 1 : 0) : (Number(v) || 0);
    series.push({ ymd: k, weekday: WEEKDAY_NAMES[date.getDay()], value: n });
  }
  return series;
}

/**
 * Day-of-week rollup. Returns {sun: {hits, days, rate}, mon: {...}, ...}
 * where `hits` is days with value > 0, `days` is total occurrences of
 * that weekday in the window, `rate` is hits/days × 100.
 *
 * For number trackers, also returns avg value on weekdays where the
 * tracker had any activity (avoids skewing the average toward zero
 * on rest days).
 */
function weekdayRollup(series, type) {
  const buckets = {};
  for (const w of WEEKDAY_NAMES) buckets[w] = { hits: 0, days: 0, sum: 0 };
  for (const point of series) {
    const b = buckets[point.weekday];
    b.days++;
    if (point.value > 0) {
      b.hits++;
      b.sum += point.value;
    }
  }
  const result = {};
  for (const w of WEEKDAY_NAMES) {
    const b = buckets[w];
    const rate = b.days === 0 ? 0 : Math.round((b.hits / b.days) * 100);
    const avg  = type === 'number' && b.hits > 0
      ? Math.round((b.sum / b.hits) * 10) / 10
      : null;
    result[w] = { hits: b.hits, days: b.days, rate, avg_active: avg };
  }
  return result;
}

/**
 * Reconstruct streak history from a daily series (oldest-first).
 * Returns the lengths of every "run" (consecutive days with value > 0)
 * found in the window, plus the current run if it's still open at the
 * end of the window. Used for "longest ever" / "typical run" stats
 * the LLM can quote.
 */
function streakHistogram(series) {
  const runs = [];
  let cur = 0;
  for (const p of series) {
    if (p.value > 0) {
      cur++;
    } else if (cur > 0) {
      runs.push(cur);
      cur = 0;
    }
  }
  // Final open run (still going at end of window) — included separately
  // so the LLM can see it's not a closed historical run.
  const open = cur;
  const closed = runs;
  return {
    runs_closed: closed,
    longest_closed: closed.length ? Math.max(...closed) : 0,
    median_closed: closed.length ? medianOf(closed) : 0,
    current_open: open,
  };
}

function medianOf(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Consistency = fraction of days in the window where the user logged
 * SOMETHING (any tracker). Coarse signal but useful — a 90-day
 * consistency of 12% is a different shape of user than 78%.
 */
function consistencyScore(logs, days, today) {
  let active = 0;
  for (let i = 0; i < days; i++) {
    const k = ymd(new Date(today - i * DAY_MS));
    const day = logs[k];
    if (day && Object.keys(day).length > 0) active++;
  }
  return {
    active_days: active,
    total_days:  days,
    pct: Math.round((active / days) * 100),
  };
}

/**
 * Per-habit gap analysis. The habit object has startTime (last relapse)
 * and relapseCount (lifetime count). We can't reconstruct individual
 * relapse timestamps from the current schema, but we CAN report
 * current run length and lifetime relapse rate.
 */
function habitSummary(h, today) {
  const startMs = h.startTime || today;
  const currentRunDays = Math.floor((today - startMs) / DAY_MS);
  const totalRelapses = h.relapseCount || 0;
  // Account-lifetime average: total relapses / total days on the habit.
  // Without per-relapse history we use start-of-time = original
  // startTime (which gets reset on relapse), so this is approximate.
  // Better than nothing for the LLM.
  const milestonesHit = (h.milestones || []).filter(m => m.awarded).length;
  const milestonesTotal = (h.milestones || []).length;
  const nextMilestone = (h.milestones || [])
    .filter(m => !m.awarded)
    .sort((a, b) => a.duration - b.duration)[0];
  return {
    id: h.id,
    name: h.name,
    current_run_days: currentRunDays,
    total_relapses: totalRelapses,
    milestones_hit: milestonesHit,
    milestones_total: milestonesTotal,
    next_milestone: nextMilestone ? {
      label: nextMilestone.label,
      days_remaining: Math.max(0, Math.ceil((nextMilestone.duration - (today - startMs)) / DAY_MS)),
      coins: nextMilestone.coins,
    } : null,
  };
}

/**
 * Achievement velocity — bucketed counts of achievements completed
 * in the last 30 / 60 / 90 days. Helps the LLM nudge "you crushed
 * three goals in October — November's been quiet."
 *
 * Achievements don't carry a completedAt timestamp in the current
 * schema (only `completed: bool`). This means we can't time-bucket
 * historically — we can only report total completed and total
 * outstanding. When the schema gains completedAt we'll backfill the
 * buckets here.
 */
function achievementSummary(achievements) {
  const total = achievements.length;
  const done = achievements.filter(a => a.completed).length;
  return {
    total,
    completed_total: done,
    completion_pct: total === 0 ? 0 : Math.round((done / total) * 100),
    outstanding: achievements.filter(a => !a.completed).map(a => ({
      id: a.id,
      name: a.name,
      coins: a.coins || 0,
      locked: !!a.locked,
    })),
  };
}

/**
 * Build the full pattern snapshot. Defaults to 90 days; pass a
 * different window via opts.days for shorter or longer horizons.
 *
 *   buildPatternSnapshot(S)             // 90 days
 *   buildPatternSnapshot(S, { days: 60 })
 *
 * Returned shape is documented in line comments throughout — when
 * you change it, update the system prompt in ai-coach-patterns to
 * match. Drift is a silent root cause of bad nudges.
 */
export function buildPatternSnapshot(S, opts = {}) {
  const days = opts.days || 90;
  const today = Date.now();

  // Body-goal adherence, when a target is set. Null otherwise, so the
  // pattern below simply never fires for users without one.
  const adh = S.bodyGoal ? trainingAdherence(S, S.bodyGoal) : null;
  const bodyGoal = adh ? { ...adh, targetKg: S.bodyGoal.targetKg } : null;

  const trackers = (S.trackers || []).map(t => {
    const series = dailySeries(t, S.logs || {}, days, today);
    return {
      id: t.id,
      name: t.name,
      type: t.type,
      unit: t.unit || null,
      weekly_target: t.weeklyTarget || null,
      goal: t.goal || null,
      // Per-weekday rollup — the headline pattern signal
      weekday: weekdayRollup(series, t.type),
      // Streak shape over the window
      streaks: streakHistogram(series),
      // Hand the model the raw daily series too — lets it reason
      // about explicit dates ("the dip started Oct 18") rather than
      // just rollups. Capped at 90 entries so payload stays small.
      series,
    };
  });

  const habits = (S.habits || []).map(h => habitSummary(h, today));
  const achievements = achievementSummary(S.achievements || []);
  const consistency = consistencyScore(S.logs || {}, days, today);

  return {
    bodyGoal,
    window: {
      days,
      from_ymd: ymd(new Date(today - (days - 1) * DAY_MS)),
      to_ymd:   ymd(new Date(today)),
      generated_at: new Date(today).toISOString(),
    },
    profile: {
      // Just the name for personalisation. No tagline / no email / no photo.
      name: (S.profile?.name || '').trim() || null,
    },
    trackers,
    habits,
    achievements,
    consistency,
    // Lifetime totals for ambient context
    coins_balance: S.coins || 0,
    visions_unlocked: Object.keys(S.visions || {}).length,
  };
}

/**
 * Detect candidate patterns purely client-side, without an LLM call.
 * The Netlify scheduled function will use the snapshot above + an LLM
 * for the headline patterns; this is a cheaper local fallback that
 * also serves as a sanity check on what the LLM is seeing.
 *
 * Returns an array of plain-language pattern strings, ranked roughly
 * by signal strength. Empty array means nothing notable.
 *
 * Examples emitted:
 *   "Wednesday is your weakest day for Gym Session (28% vs 71% other days)"
 *   "Streak broken yesterday after 9 days on Protein Goal"
 *   "Consistency dropped to 14% this fortnight (was 62% before)"
 */
export function detectPatternsHeuristic(snapshot) {
  const out = [];

  // 1. Weekday outliers — flag any tracker where one weekday is
  //    materially weaker than the rest.
  for (const t of snapshot.trackers) {
    const buckets = Object.entries(t.weekday)
      .filter(([, b]) => b.days > 0);
    if (buckets.length < 5) continue; // not enough days in window
    const allRates = buckets.map(([, b]) => b.rate);
    const avgOther = (sum, n) => sum / n;
    for (const [day, b] of buckets) {
      if (b.rate >= 50) continue; // only flag low days
      const others = buckets.filter(([d]) => d !== day).map(([, x]) => x.rate);
      const otherAvg = avgOther(others.reduce((a, b) => a + b, 0), others.length);
      if (otherAvg - b.rate >= 30) {
        const pretty = day[0].toUpperCase() + day.slice(1);
        out.push(`${pretty} is your weakest day for ${t.name} (${b.rate}% vs ${Math.round(otherAvg)}% other days).`);
      }
    }
  }

  // 2. Recent streak breaks — current_open=0 but longest_closed >= 5
  for (const t of snapshot.trackers) {
    if (t.streaks.current_open === 0 && t.streaks.longest_closed >= 5) {
      // Look at the last few days to see when the streak ended
      const recent = t.series.slice(-7);
      const lastHit = [...recent].reverse().findIndex(p => p.value > 0);
      if (lastHit >= 0 && lastHit < 4) {
        out.push(`${t.name} streak broke ${lastHit === 0 ? 'today' : lastHit + ' days ago'} after a ${t.streaks.longest_closed}-day run.`);
      }
    }
  }

  // 2b. Body goal — training has drifted below the cadence the user
  //     committed to when they set the target. Phrased as the cost to
  //     the goal, not as a telling-off: the point is that the timeline
  //     moves, which is a fact they can act on.
  if (snapshot.bodyGoal && snapshot.bodyGoal.slacking) {
    const g = snapshot.bodyGoal;
    out.push(
      `Training is down to ${g.recent} sessions a week against the ${g.planned} you set for your ${g.targetKg} kg goal` +
      (g.shortBy > 0 ? ` — about ${g.shortBy} sessions behind over the last three weeks.` : '.')
    );
  }

  // 3. Consistency drop — last 14 days vs prior 14 days
  if (snapshot.consistency.total_days >= 28) {
    const series = snapshot.trackers[0]?.series || [];
    if (series.length >= 28) {
      const last14 = series.slice(-14);
      const prior14 = series.slice(-28, -14);
      // count days where ANY tracker had activity
      // (cheap proxy: just look at this tracker)
      const last14Active = last14.filter(p => p.value > 0).length;
      const prior14Active = prior14.filter(p => p.value > 0).length;
      if (prior14Active >= 7 && last14Active <= 3) {
        out.push(`Activity dropped sharply this fortnight (${last14Active}/14 vs ${prior14Active}/14 before).`);
      }
    }
  }

  // 4. Habit milestone within reach
  for (const h of snapshot.habits) {
    if (h.next_milestone && h.next_milestone.days_remaining > 0 && h.next_milestone.days_remaining <= 3) {
      out.push(`${h.name} is ${h.next_milestone.days_remaining} day${h.next_milestone.days_remaining === 1 ? '' : 's'} from the ${h.next_milestone.label} milestone (+${h.next_milestone.coins} coins).`);
    }
  }

  return out;
}
