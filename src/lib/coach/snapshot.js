/**
 * Build a compact, PII-free snapshot of the user's state for the
 * AI Coach. Only sends what the LLM needs to reason about — no
 * photos, no email, no tagline text, no shopping prices, no notes.
 *
 * The snapshot also carries enough recent-history context that the
 * LLM can vary its advice day-to-day (recent_briefs, daily series,
 * recent completions/relapses) — without that, identical numbers on
 * Tuesday and Wednesday produce identical advice.
 */
import { habitElapsed } from '../habits/progress.js';

const DAY_MS = 86_400_000;

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function buildTrackerSummary(t, logs) {
  const today = new Date();
  const series = []; // newest-first daily values, last 14 days
  let last7 = 0, prior7 = 0;
  for (let i = 0; i < 14; i++) {
    const k = ymd(new Date(today - i * DAY_MS));
    const v = logs[k]?.[t.id];
    const n = t.type === 'boolean' ? (v ? 1 : 0) : (Number(v) || 0);
    series.push({ ymd: k, value: n });
    if (i < 7) last7 += n; else prior7 += n;
  }
  // Compute weekly target progress if applicable.
  let weekly_progress = null;
  if (t.weeklyTarget) {
    weekly_progress = {
      target: t.weeklyTarget,
      current: last7,
      pct: Math.min(100, Math.round((last7 / t.weeklyTarget) * 100)),
    };
  }
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    unit: t.unit || null,
    weekly_target: t.weeklyTarget || null,
    goal: t.goal || null,
    last_7_total: last7,
    prior_7_total: prior7,
    delta_pct: prior7 === 0
      ? (last7 > 0 ? 100 : 0)
      : Math.round(((last7 - prior7) / prior7) * 100),
    last_14_days: series, // newest-first
    weekly_progress,
  };
}

function buildHabitSummary(h) {
  const days = Math.floor(habitElapsed(h, Date.now()) / DAY_MS);
  const relapses = h.relapseCount || 0;
  return {
    id: h.id,
    name: h.name,
    days_clean: days,
    relapse_count: relapses,
    avg_run_days: relapses > 0 ? Math.round(days / (relapses + 1)) : null,
  };
}

function buildAchievementSummary(a) {
  return {
    id: a.id,
    name: a.name,
    completed: !!a.completed,
    locked: !!a.locked,
    coins: a.coins || 0,
    completed_recently: !!(a.completed && a.completedAt && a.completedAt >= Date.now() - 7 * DAY_MS),
  };
}

function buildRecentCompletions(S) {
  const cutoff = Date.now() - 7 * DAY_MS;
  return (S.achievements || [])
    .filter(a => a.completed && a.completedAt && a.completedAt >= cutoff)
    .map(a => ({
      id: a.id,
      name: a.name,
      completed_days_ago: Math.floor((Date.now() - a.completedAt) / DAY_MS),
    }));
}

function buildHolidayCountdown(S) {
  const now = Date.now();
  const upcoming = (S.holidays || [])
    .filter(h => h.startDate)
    .map(h => ({
      id: h.id,
      destination: h.destination || h.name || null,
      days_until: Math.ceil((new Date(h.startDate).getTime() - now) / DAY_MS),
    }))
    .filter(h => Number.isFinite(h.days_until) && h.days_until >= 0 && h.days_until <= 90)
    .sort((a, b) => a.days_until - b.days_until);
  return upcoming.slice(0, 2);
}

function buildShopState(S) {
  const items = (S.shopItems || []);
  const open = items.filter(i => !i.bought);
  const coins = S.coins || 0;
  const affordable = open
    .filter(i => typeof i.cost === 'number' && coins >= i.cost)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 2)
    .map(i => ({ id: i.id, name: i.name, cost: i.cost }));
  return {
    open_count: open.length,
    affordable_count: affordable.length,
    can_afford: affordable,
  };
}

/**
 * Build the snapshot. Most important callsite: useDailyBrief, which
 * passes the result to the Netlify function.
 */
export function buildSnapshot(S) {
  const logs = S.logs || {};
  const today = new Date();
  const memory = S.coachMemory || {};

  // Last few briefs the model has produced, so it can avoid repeating
  // itself. Newest-first.
  const recent_briefs = (S.coachBriefHistory || [])
    .slice(-5)
    .reverse()
    .map(b => ({
      date: b.date,
      focus: b.focus,
      watch: b.watch,
      micro: b.micro,
    }));

  // Rule families the user has dismissed in the last 14 days — the LLM
  // can use this to dodge those topic areas. We strip ID payloads
  // (after the first colon) so we send a generic family, not a private
  // entity ID.
  const cutoff = Date.now() - 14 * DAY_MS;
  const recent_dismissed = Object.entries(memory)
    .filter(([, v]) => v?.lastDismissedYmd && new Date(v.lastDismissedYmd).getTime() >= cutoff)
    .map(([id]) => id.split(':')[0])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 8);

  return {
    name: (S.profile?.name || '').split(' ')[0] || 'You',
    today_ymd: ymd(today),
    weekday: today.toLocaleDateString('en-GB', { weekday: 'long' }),
    is_sunday: today.getDay() === 0,
    coins: S.coins || 0,
    habits: (S.habits || []).map(buildHabitSummary),
    achievements: (S.achievements || []).map(buildAchievementSummary),
    trackers: (S.trackers || []).map(t => buildTrackerSummary(t, logs)),
    holidays: buildHolidayCountdown(S),
    shop: buildShopState(S),
    recent_completions: buildRecentCompletions(S),
    recent_briefs,
    recent_dismissed_topics: recent_dismissed,
  };
}
