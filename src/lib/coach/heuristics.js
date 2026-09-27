/**
 * AI Coach — heuristic insight engine
 *
 * Pure functions. No side effects, no API calls. Given the user's state,
 * returns a ranked list of candidate insights. The widget picks the
 * highest-priority one that isn't on cooldown.
 *
 * Insight shape:
 *   { id, priority, cooldownDays?, title, body, verb? }
 *
 *   id            STABLE identifier (no dates baked in). Used as the
 *                 cooldown key. Two rules that point at the same
 *                 underlying thing must share an id.
 *   priority      0–100; higher wins. Risk/decline outranks celebration.
 *   cooldownDays  How many days to suppress this id after it's been
 *                 shown / dismissed / acted on. Defaults to 4 / 7 / 14
 *                 respectively if not provided. Set to 0 to allow
 *                 instant re-show (rarely useful).
 *   title         short hook (5–8 words)
 *   body          one-sentence elaboration referencing real numbers
 *   verb?         optional { label, action, args } — wired in App.jsx
 */
import { habitElapsed } from '../habits/progress.js';

const DAY_MS = 86_400_000;

// ── Date helpers ──────────────────────────────────────────────────────────

export function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgoYmd(n) {
  return ymd(new Date(Date.now() - n * DAY_MS));
}

function rangeYmd(startDaysAgo, endDaysAgo) {
  const out = [];
  for (let i = startDaysAgo; i >= endDaysAgo; i--) out.push(daysAgoYmd(i));
  return out;
}

function daysBetween(ymdA, ymdB) {
  if (!ymdA || !ymdB) return Infinity;
  return Math.round((new Date(ymdB) - new Date(ymdA)) / DAY_MS);
}

// ── Tracker analysis ──────────────────────────────────────────────────────

/**
 * Compare last 7 days vs prior 7 days for each tracker.
 * Returns { trackerId: { current, previous, deltaPct } }.
 */
function trackerTrends(S) {
  const logs = S.logs || {};
  const trackers = S.trackers || [];
  const last7 = rangeYmd(6, 0);
  const prior7 = rangeYmd(13, 7);

  const sumRange = (id, dates, type) =>
    dates.reduce((acc, k) => {
      const v = logs[k]?.[id];
      if (type === 'boolean') return acc + (v ? 1 : 0);
      const n = Number(v);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);

  const out = {};
  trackers.forEach(t => {
    const current = sumRange(t.id, last7, t.type);
    const previous = sumRange(t.id, prior7, t.type);
    const deltaPct = previous === 0
      ? (current > 0 ? 100 : 0)
      : Math.round(((current - previous) / previous) * 100);
    out[t.id] = { current, previous, deltaPct };
  });
  return out;
}

// ── Habit analysis ────────────────────────────────────────────────────────

function habitDanger(habit) {
  const days = Math.floor(habitElapsed(habit, Date.now()) / DAY_MS);
  const relapses = habit.relapseCount || 0;
  const avgDaysBetween = relapses > 0 ? days / (relapses + 1) : Infinity;
  return { days, relapses, avgDaysBetween };
}

function habitPersonalBest(habit) {
  // The habit's own data only has start time + total relapses. We can't
  // recover historical streak peaks from that, so personal-best logic
  // here is a soft heuristic: if the user has accumulated relapses but
  // the *current* run is longer than the lifetime average, treat that
  // as beating their personal best.
  const { days, relapses, avgDaysBetween } = habitDanger(habit);
  if (relapses === 0 || days < 7) return null;
  // Current clean streak isn't tracked, so use total days / (relapses+1)
  // as a proxy for "running average between slips" and compare to 1.5×.
  if (avgDaysBetween === Infinity) return null;
  const currentRunGuess = avgDaysBetween; // best we can do without per-relapse log
  if (currentRunGuess >= avgDaysBetween * 1.4 && currentRunGuess >= 10) {
    return { currentRunGuess: Math.round(currentRunGuess), avg: Math.round(avgDaysBetween) };
  }
  return null;
}

// ── Achievement analysis ──────────────────────────────────────────────────

function staleAchievements(S) {
  const open = (S.achievements || []).filter(a => !a.completed && !a.locked);
  return open;
}

function recentlyCompletedAchievements(S) {
  // Achievements with completedAt within the last 48 hours (if app
  // records it). If no timestamp, this rule simply doesn't fire.
  const cutoff = Date.now() - 2 * DAY_MS;
  return (S.achievements || []).filter(a => a.completed && a.completedAt && a.completedAt >= cutoff);
}

// ── Shop / Holiday analysis ───────────────────────────────────────────────

function affordableUnboughtShopItem(S) {
  const coins = S.coins || 0;
  const items = (S.shopItems || []).filter(i => !i.bought && typeof i.cost === 'number');
  if (!items.length) return null;
  // Pick the most expensive thing they can afford (most satisfying nudge).
  const affordable = items.filter(i => coins >= i.cost).sort((a, b) => b.cost - a.cost);
  return affordable[0] || null;
}

function nearestUpcomingHoliday(S) {
  const now = Date.now();
  const items = (S.holidays || [])
    .filter(h => h.startDate)
    .map(h => ({ ...h, _start: new Date(h.startDate).getTime() }))
    .filter(h => Number.isFinite(h._start) && h._start >= now)
    .sort((a, b) => a._start - b._start);
  if (!items.length) return null;
  const days = Math.ceil((items[0]._start - now) / DAY_MS);
  if (days > 60) return null; // too far out to be motivating
  return { holiday: items[0], days };
}

// ── Cross-domain ──────────────────────────────────────────────────────────

function activeStreaks(S) {
  const trends = trackerTrends(S);
  return Object.entries(trends)
    .filter(([, v]) => v.current >= 4 && v.deltaPct >= 0)
    .map(([id]) => (S.trackers || []).find(t => t.id === id))
    .filter(Boolean);
}

// ── Onboarding signals ────────────────────────────────────────────────────

function newestEntity(items, key = 'createdAt') {
  if (!items?.length) return null;
  const withTs = items.filter(i => Number.isFinite(i[key]));
  if (!withTs.length) return null;
  withTs.sort((a, b) => b[key] - a[key]);
  const newest = withTs[0];
  const ageDays = Math.floor((Date.now() - newest[key]) / DAY_MS);
  if (ageDays > 7) return null; // older than a week → not "new" anymore
  return { entity: newest, ageDays };
}

// ── Insight builders ──────────────────────────────────────────────────────

function firstName(S) {
  return (S.profile?.name || '').split(' ')[0] || 'You';
}

// Rotate between equivalent copy variants so evergreen rules don't read
// the same week after week. The chosen variant is deterministic per day
// — same day → same copy, next day → next variant.
function pickVariant(variants, salt = 0) {
  const today = new Date();
  const dayOfYear = Math.floor(
    (today - new Date(today.getFullYear(), 0, 0)) / DAY_MS
  );
  return variants[(dayOfYear + salt) % variants.length];
}

function buildInsights(S) {
  const name = firstName(S);
  const out = [];
  const today = new Date();
  const weekday = today.getDay(); // 0 Sun ... 6 Sat

  // 1. Tracker decline (highest priority — catch problems early)
  const trends = trackerTrends(S);
  Object.entries(trends).forEach(([id, t]) => {
    const tr = (S.trackers || []).find(x => x.id === id);
    if (!tr) return;
    if (t.previous >= 3 && t.deltaPct <= -40) {
      out.push({
        id: `decline:${id}`,
        priority: 90,
        cooldownDays: 3, // re-flag if still slipping after 3 days
        title: `${tr.name} is slipping`,
        body: `${name}, you logged ${t.current} ${tr.type === 'boolean' ? 'sessions' : (tr.unit || '')} this week — down ${Math.abs(t.deltaPct)}% from last week. What changed?`,
        verb: { label: `Log ${tr.name}`, action: 'navigate', args: { section: 'track' } },
      });
    }
  });

  // 2. Habit danger window (if relapses are clustering)
  (S.habits || []).forEach(h => {
    const d = habitDanger(h);
    if (d.relapses > 0 && d.days >= 14 && d.avgDaysBetween < 7) {
      out.push({
        id: `habit-risk:${h.id}`,
        priority: 85,
        cooldownDays: 4,
        title: `Watch out with "${h.name}"`,
        body: `${name}, your average clean streak on this habit is ${Math.round(d.avgDaysBetween)} days. Plan around your usual trigger window today.`,
      });
    }
    // Milestone celebration — id keyed by week count so each new week
    // is a new milestone, but the same one isn't re-shown.
    if (d.relapses === 0 && d.days >= 7 && d.days % 7 <= 1) {
      const weeks = Math.floor(d.days / 7);
      out.push({
        id: `habit-week:${h.id}:${weeks}`,
        priority: 70,
        cooldownDays: 2,
        title: `${weeks} week${weeks > 1 ? 's' : ''} clean on "${h.name}"`,
        body: `${name}, that's ${d.days} days. The hardest part is behind you — protect tonight.`,
      });
    }
    // Personal-best beat
    const pb = habitPersonalBest(h);
    if (pb) {
      out.push({
        id: `habit-pb:${h.id}`,
        priority: 78,
        cooldownDays: 14,
        title: `New personal best on "${h.name}"`,
        body: `${name}, you're past your typical run-length. This is the one to remember when the next urge hits.`,
      });
    }
  });

  // 3. Stale achievement (active too long)
  const stale = staleAchievements(S);
  if (stale.length > 0) {
    // Rotate which stale achievement we surface — the day-of-year salt
    // keeps it varied without ever being random/jumpy mid-day.
    const dayOfYear = Math.floor(
      (today - new Date(today.getFullYear(), 0, 0)) / DAY_MS
    );
    const a = stale[dayOfYear % stale.length];
    out.push({
      id: `stale-ach:${a.id}`,
      priority: 60,
      cooldownDays: 6,
      title: `"${a.name}" has been waiting`,
      body: `${name}, big goals are easier in pieces. Want to break this into a few stepping-stone milestones?`,
      verb: { label: 'Split into milestones', action: 'split-achievement', args: { id: a.id } },
    });
  }

  // 4. Recently completed achievement — celebrate within 48h
  const justDone = recentlyCompletedAchievements(S);
  if (justDone.length > 0) {
    const a = justDone[0];
    out.push({
      id: `just-done:${a.id}`,
      priority: 75,
      cooldownDays: 3,
      title: `Nice — "${a.name}" is done`,
      body: `${name}, momentum is the most under-rated coin. Pick the next one while you've got it.`,
      verb: { label: 'Add the next one', action: 'open-modal', args: { modalId: 'addAchievementModal' } },
    });
  }

  // 5. Cross-domain win — multiple trackers up at once
  const streaks = activeStreaks(S);
  if (streaks.length >= 2) {
    const names = streaks.slice(0, 2).map(s => s.name).join(' and ');
    out.push({
      id: `cross-win:${streaks.map(s => s.id).sort().join(',')}`,
      priority: 55,
      cooldownDays: 5,
      title: 'You\'re firing on multiple fronts',
      body: `${name}, ${names} are both trending up this week. Momentum compounds — protect it.`,
    });
  }

  // 6. Coin milestones (cooldown long — these are landmark moments)
  const coins = S.coins || 0;
  if (coins >= 1000) {
    out.push({
      id: `coins:1000`,
      priority: 50,
      cooldownDays: 21,
      title: `${coins} coins earned`,
      body: `${name}, that's serious consistency. Treat yourself from the shop — you've earned it.`,
      verb: { label: 'Open shop', action: 'navigate', args: { section: 'shop' } },
    });
  } else if (coins >= 200) {
    out.push({
      id: `coins:200`,
      priority: 45,
      cooldownDays: 14,
      title: `${coins} coins and counting`,
      body: `${name}, your balance reflects real follow-through. Keep the streak.`,
    });
  }

  // 7. Affordable shop item (you've actually got the coins)
  const affordable = affordableUnboughtShopItem(S);
  if (affordable) {
    out.push({
      id: `shop-afford:${affordable.id}`,
      priority: 48,
      cooldownDays: 7,
      title: `You can afford "${affordable.name}"`,
      body: `${name}, ${affordable.cost} coins is sitting in the wallet. Spending earned coins makes the next ones feel sweeter.`,
      verb: { label: 'Open shop', action: 'navigate', args: { section: 'shop' } },
    });
  }

  // 8. Holiday countdown — under 60 days out
  const upcoming = nearestUpcomingHoliday(S);
  if (upcoming) {
    out.push({
      id: `holiday:${upcoming.holiday.id}`,
      priority: 40,
      cooldownDays: 5,
      title: `${upcoming.days} day${upcoming.days === 1 ? '' : 's'} until ${upcoming.holiday.destination || upcoming.holiday.name || 'your trip'}`,
      body: `${name}, what's one thing on the prep list you can knock out this week?`,
    });
  }

  // 9. All achievements done
  const completedAchs = (S.achievements || []).filter(a => a.completed).length;
  const totalAchs = (S.achievements || []).length;
  if (totalAchs > 0 && completedAchs === totalAchs) {
    out.push({
      id: `all-done:${totalAchs}`,
      priority: 65,
      cooldownDays: 7,
      title: 'Every achievement complete',
      body: `${name}, you've finished the board. Time to dream bigger — what's next?`,
      verb: { label: 'Add new achievement', action: 'open-modal', args: { modalId: 'addAchievementModal' } },
    });
  }

  // 10. Onboarding nudge — new tracker/habit/achievement (within 7 days)
  const newTracker = newestEntity(S.trackers);
  if (newTracker && newTracker.ageDays >= 1 && newTracker.ageDays <= 5) {
    out.push({
      id: `onboard-tracker:${newTracker.entity.id}`,
      priority: 42,
      cooldownDays: 3,
      title: `Keep "${newTracker.entity.name}" alive`,
      body: `${name}, you set this up ${newTracker.ageDays} day${newTracker.ageDays === 1 ? '' : 's'} ago. The first week is the one that decides if it sticks.`,
      verb: { label: 'Log it now', action: 'navigate', args: { section: 'track' } },
    });
  }

  // 11. Day-of-week framers — light, encouraging, only fire when there
  // is no risk-tier insight. Lower priority so heavy stuff outranks them.
  if (weekday === 1) { // Monday
    out.push({
      id: 'dow:monday',
      priority: 35,
      cooldownDays: 6, // basically once per Monday
      title: pickVariant(['Fresh week, fresh log', 'Set the week\'s tone today', 'Monday is a soft reset'], 0),
      body: `${name}, what's the one tracker you want to nail every day this week? Start it now and the rest gets easier.`,
    });
  }
  if (weekday === 3) { // Wednesday
    out.push({
      id: 'dow:wednesday',
      priority: 32,
      cooldownDays: 6,
      title: pickVariant(['Midweek check-in', 'Halfway through — how\'s it going?', 'Wednesday is the test'], 0),
      body: `${name}, the week's pattern is locked in by today. If something's slipping, today's the day to redirect it.`,
    });
  }
  if (weekday === 5) { // Friday
    out.push({
      id: 'dow:friday',
      priority: 32,
      cooldownDays: 6,
      title: pickVariant(['Don\'t let Friday undo the week', 'Two days, one decision', 'Weekend\'s where streaks die'], 0),
      body: `${name}, weekends are where most habits break. Decide now what's non-negotiable for the next 48 hours.`,
    });
  }
  if (weekday === 0) { // Sunday
    out.push({
      id: 'dow:sunday',
      priority: 33,
      cooldownDays: 6,
      title: pickVariant(['Look back to plan forward', 'Sunday is for review', 'One question before next week'], 0),
      body: `${name}, what worked this week? Whatever it is, schedule more of it before tomorrow morning.`,
    });
  }

  // 12. Empty state nudges (lowest priority, with rotated copy)
  if ((S.habits || []).length === 0) {
    out.push({
      id: `empty:habits`,
      priority: 30,
      cooldownDays: 3,
      title: pickVariant([
        'Pick a habit to break',
        'One habit can shift a year',
        'The streak timer is waiting',
      ], 1),
      body: pickVariant([
        `${name}, a single bad habit removed can transform a year. The streak timer starts the moment you add one.`,
        `${name}, you don't need a list — pick the one habit that's costing you most. Add it and start the clock.`,
        `${name}, the timer counts up the moment you commit. The first 72 hours are the hardest — and they start when you add it.`,
      ], 1),
      verb: { label: 'Add a habit', action: 'open-modal', args: { modalId: 'addHabitModal' } },
    });
  }
  if ((S.achievements || []).length === 0) {
    out.push({
      id: `empty:achs`,
      priority: 30,
      cooldownDays: 3,
      title: pickVariant([
        'Set your first achievement',
        'A blank board is a quiet board',
        'Name one thing you want this year',
      ], 2),
      body: pickVariant([
        `${name}, your board is blank. What's one thing you want this year?`,
        `${name}, write it down before you forget you wanted it. The board only works when there's something on it.`,
        `${name}, a goal you can see beats one you can only feel. Start with one — small counts.`,
      ], 2),
      verb: { label: 'Add achievement', action: 'open-modal', args: { modalId: 'addAchievementModal' } },
    });
  }

  // 13. Fallback — never return empty (rotated 5 ways so it doesn't read identical)
  if (out.length === 0) {
    const variants = [
      { title: 'Small actions compound', body: `${name}, your board is set. Show up today — that's the whole game.` },
      { title: 'The boring days are the work', body: `${name}, today doesn't feel important. That's exactly when consistency pays.` },
      { title: 'One log keeps the chain alive', body: `${name}, you don't need a perfect day — you need the streak to survive it.` },
      { title: 'What\'s the smallest version?', body: `${name}, if today is messy, do the 2-minute version of every habit. Showing up beats skipping.` },
      { title: 'Future-you is watching', body: `${name}, every entry today is a vote for the person you said you wanted to be.` },
    ];
    const v = pickVariant(variants, 3);
    out.push({
      id: `default`,
      priority: 10,
      cooldownDays: 1, // rotates daily anyway via pickVariant
      title: v.title,
      body: v.body,
    });
  }

  return out;
}

// ── Cooldown / dedup ──────────────────────────────────────────────────────

const DEFAULT_COOLDOWNS = {
  shown: 4,     // recently shown
  dismissed: 7, // user actively dismissed
  acted: 14,    // user clicked the verb — definitely don't re-suggest
};

function isOnCooldown(memEntry, ruleCooldownDays) {
  if (!memEntry) return false;
  const today = ymd();
  const baseShown = ruleCooldownDays ?? DEFAULT_COOLDOWNS.shown;
  if (memEntry.lastActedYmd && daysBetween(memEntry.lastActedYmd, today) < DEFAULT_COOLDOWNS.acted) return true;
  if (memEntry.lastDismissedYmd && daysBetween(memEntry.lastDismissedYmd, today) < DEFAULT_COOLDOWNS.dismissed) return true;
  if (memEntry.lastShownYmd && daysBetween(memEntry.lastShownYmd, today) < baseShown) return true;
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Pick the best insight for right now.
 *   S       — full app state
 *   memory  — S.coachMemory (record { [id]: { lastShownYmd, ... } }).
 *             Pass undefined if not yet initialised.
 *
 * Returns a single insight, or null if nothing fits.
 */
export function pickInsight(S, memory) {
  const candidates = buildInsights(S);
  const mem = memory || {};
  const fresh = candidates.filter(c => !isOnCooldown(mem[c.id], c.cooldownDays));
  // If everything is on cooldown, fall back to the highest-priority
  // candidate anyway — better to repeat than show nothing.
  const pool = fresh.length > 0 ? fresh : candidates;
  pool.sort((a, b) => b.priority - a.priority);
  return pool[0] || null;
}

/**
 * Return all candidate insights (for debugging / coach panel).
 */
export function allInsights(S) {
  return buildInsights(S).sort((a, b) => b.priority - a.priority);
}

// ── Memory helpers (used by the widget) ───────────────────────────────────

/**
 * Migrate the legacy `coachSeen` array into the new `coachMemory` map.
 * Existing IDs included a `:${ymd()}` suffix that's no longer present
 * in candidate IDs, so we treat the legacy data as ambient noise and
 * just start fresh. Returns the input unchanged if memory already
 * exists.
 */
export function migrateCoachMemory(S) {
  if (S.coachMemory && typeof S.coachMemory === 'object') return S.coachMemory;
  return {};
}

export function recordShown(memory, id) {
  const today = ymd();
  const prev = memory?.[id] || {};
  return {
    ...(memory || {}),
    [id]: { ...prev, lastShownYmd: today, showCount: (prev.showCount || 0) + 1 },
  };
}

export function recordDismissed(memory, id) {
  const today = ymd();
  const prev = memory?.[id] || {};
  return {
    ...(memory || {}),
    [id]: {
      ...prev,
      lastShownYmd: today,
      lastDismissedYmd: today,
      dismissCount: (prev.dismissCount || 0) + 1,
    },
  };
}

export function recordActed(memory, id) {
  const today = ymd();
  const prev = memory?.[id] || {};
  return {
    ...(memory || {}),
    [id]: {
      ...prev,
      lastShownYmd: today,
      lastActedYmd: today,
      actCount: (prev.actCount || 0) + 1,
    },
  };
}

// Exported for testing
export const _internal = {
  trackerTrends, habitDanger, staleAchievements, activeStreaks,
  recentlyCompletedAchievements, affordableUnboughtShopItem,
  nearestUpcomingHoliday, isOnCooldown,
};
