/**
 * Vision definitions — system-tracked milestones that grant XP toward
 * the displayed Level. Each definition is a pure { check(S) → bool }
 * predicate; the visions runtime stamps `unlockedAt` the first time a
 * predicate flips true and never un-stamps after.
 *
 * Why not events?
 *   The rest of the app already mutates state in 30+ places (logs,
 *   habits, achievements, trackers). Hooking each callsite would be
 *   noisy. Instead we re-derive on every state change — cheap, no
 *   missed unlocks, no event-firing race conditions.
 *
 * Adding a new vision:
 *   1. Append a stable `id` (used as the key in S.visions — DO NOT
 *      rename existing IDs or users will lose unlocks).
 *   2. Pick an XP value that scales with effort (see XP curve below).
 *   3. Write a pure check(S) — must not throw on missing fields.
 *
 * XP scale (rough):
 *    50  — first nudge ("you've started")
 *   200  — committed (a few weeks of effort)
 *   500  — long-haul (multi-month)
 *
 * User-created achievement completions also drip a small amount of
 * XP per completion via derive.js — that's intentional so people who
 * mostly use the board view still see their level move.
 */

const DAY_MS = 86_400_000;

// ── helpers ───────────────────────────────────────────────────────────
function maxHabitDaysClean(S) {
  const now = Date.now();
  return (S.habits || []).reduce((max, h) => {
    if (!h.startTime) return max;
    const days = Math.floor((now - h.startTime) / DAY_MS);
    return days > max ? days : max;
  }, 0);
}

function completedAchievementCount(S) {
  return (S.achievements || []).filter(a => a.completed).length;
}

// Walk backward from today, count consecutive days with at least one
// truthy log entry. Caps at 365 to bound runtime.
function consecutiveLogDays(S) {
  const logs = S.logs || {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const ymd = d.toISOString().slice(0, 10);
    const day = logs[ymd];
    if (!day) break;
    const hasLog = Object.values(day).some(v => v !== false && v !== 0 && v != null && v !== '');
    if (!hasLog) break;
    streak++;
  }
  return streak;
}

// Have all weekly trackers met their target in the last 7 days?
// Excludes trackers without weeklyTarget (number-type savings goals
// don't have a weekly target — they shouldn't gate this vision).
function hadPerfectTrackerWeek(S) {
  const trackers = (S.trackers || []).filter(t => t.weeklyTarget);
  if (trackers.length === 0) return false;
  const logs = S.logs || {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() - i * DAY_MS);
    days.push(logs[d.toISOString().slice(0, 10)] || {});
  }
  return trackers.every(t => {
    const total = days.reduce((sum, day) => {
      const v = day[t.id];
      return sum + (t.type === 'boolean' ? (v ? 1 : 0) : (Number(v) || 0));
    }, 0);
    return total >= t.weeklyTarget;
  });
}

function savingsGoalsCompleted(S) {
  return (S.savings || []).filter(g => (g.target || 0) > 0 && (g.current || 0) >= g.target).length;
}
function activeSavingsGoals(S) {
  return (S.savings || []).filter(g => (g.target || 0) > 0).length;
}
function totalSaved(S) {
  return (S.savings || []).reduce((sum, g) => sum + (g.current || 0), 0);
}
// Lifetime coins earned (positive coin-history entries only) — survives
// spending, unlike the current balance.
function coinsEarned(S) {
  return (S.coinHistory || []).reduce((sum, h) => sum + (h.amount > 0 ? h.amount : 0), 0);
}
function activeHabitCount(S) {
  return (S.habits || []).filter(h => h.startTime).length;
}
function macroLogDays(S) {
  return Object.keys(S.macroHistory || {}).length;
}
function vitalsLogDays(S) {
  return Object.keys(S.vitalsLog || {}).length;
}
function holidaysCompleted(S) {
  return (S.holidays || []).filter(h => h.status === 'completed').length;
}

// ── definitions ───────────────────────────────────────────────────────
export const VISIONS = [
  // Habit streaks — held a tracked habit clean for N days
  {
    id: 'streak-7',
    title: 'Week One',
    desc: 'Held a habit clean for 7 days.',
    icon: '🌱',
    xp: 50,
    check: S => maxHabitDaysClean(S) >= 7,
  },
  {
    id: 'streak-30',
    title: 'Thirty Strong',
    desc: 'Held a habit clean for 30 days.',
    icon: '🌳',
    xp: 200,
    check: S => maxHabitDaysClean(S) >= 30,
  },
  {
    id: 'streak-100',
    title: 'Century',
    desc: 'Held a habit clean for 100 days.',
    icon: '💎',
    xp: 500,
    check: S => maxHabitDaysClean(S) >= 100,
  },

  // Logging consistency — opened the app and logged something N days running
  {
    id: 'log-7',
    title: 'Consistent',
    desc: 'Logged something seven days in a row.',
    icon: '📒',
    xp: 50,
    check: S => consecutiveLogDays(S) >= 7,
  },
  {
    id: 'log-30',
    title: 'In the Groove',
    desc: 'Logged something thirty days in a row.',
    icon: '🔥',
    xp: 200,
    check: S => consecutiveLogDays(S) >= 30,
  },

  // Tracker discipline — every weekly target hit in a single 7-day window
  {
    id: 'tracker-perfect-week',
    title: 'Perfect Week',
    desc: 'Hit every weekly tracker target in a single week.',
    icon: '🎯',
    xp: 100,
    check: hadPerfectTrackerWeek,
  },

  // User-achievement completion thresholds — your own goals
  {
    id: 'ach-3',
    title: 'Three for Three',
    desc: 'Completed three of your own achievements.',
    icon: '⭐',
    xp: 75,
    check: S => completedAchievementCount(S) >= 3,
  },
  {
    id: 'ach-10',
    title: 'Builder',
    desc: 'Completed ten of your own achievements.',
    icon: '🏆',
    xp: 300,
    check: S => completedAchievementCount(S) >= 10,
  },
  {
    id: 'ach-25',
    title: 'Prolific',
    desc: 'Completed twenty-five of your own achievements.',
    icon: '👑',
    xp: 600,
    check: S => completedAchievementCount(S) >= 25,
  },

  // Long-haul consistency
  {
    id: 'log-100',
    title: 'Centurion',
    desc: 'Logged something a hundred days in a row.',
    icon: '🗓️',
    xp: 500,
    check: S => consecutiveLogDays(S) >= 100,
  },
  {
    id: 'streak-365',
    title: 'A Year Clean',
    desc: 'Held a habit clean for a full year.',
    icon: '🏅',
    xp: 1000,
    check: S => maxHabitDaysClean(S) >= 365,
  },
  {
    id: 'habits-3',
    title: 'Habit Stacker',
    desc: 'Tracking three habits at once.',
    icon: '🧱',
    xp: 50,
    check: S => activeHabitCount(S) >= 3,
  },

  // Savings milestones
  {
    id: 'savings-first',
    title: 'First Pot',
    desc: 'Completed your first savings goal.',
    icon: '🫙',
    xp: 150,
    check: S => savingsGoalsCompleted(S) >= 1,
  },
  {
    id: 'savings-goals-3',
    title: 'Diversified',
    desc: 'Running three savings pots at once.',
    icon: '🗂️',
    xp: 75,
    check: S => activeSavingsGoals(S) >= 3,
  },
  {
    id: 'savings-1k',
    title: 'Four Figures',
    desc: 'Saved £1,000 across your pots.',
    icon: '💷',
    xp: 100,
    check: S => totalSaved(S) >= 1000,
  },
  {
    id: 'savings-10k',
    title: 'Five Figures',
    desc: 'Saved £10,000 across your pots.',
    icon: '💰',
    xp: 400,
    check: S => totalSaved(S) >= 10000,
  },

  // Coins earned (lifetime)
  {
    id: 'coins-1k',
    title: 'Coin Collector',
    desc: 'Earned 1,000 coins in total.',
    icon: '🪙',
    xp: 100,
    check: S => coinsEarned(S) >= 1000,
  },
  {
    id: 'coins-5k',
    title: 'Coin Baron',
    desc: 'Earned 5,000 coins in total.',
    icon: '⬡',
    xp: 300,
    check: S => coinsEarned(S) >= 5000,
  },

  // Tracking breadth — vitals & macros
  {
    id: 'vitals-7',
    title: 'Body Aware',
    desc: 'Logged your vitals on seven days.',
    icon: '❤️',
    xp: 75,
    check: S => vitalsLogDays(S) >= 7,
  },
  {
    id: 'macros-7',
    title: 'Macro Minded',
    desc: 'Logged your macros on seven days.',
    icon: '🥗',
    xp: 75,
    check: S => macroLogDays(S) >= 7,
  },

  // Holidays
  {
    id: 'holiday-planned',
    title: 'Wanderlust',
    desc: 'Planned your first trip.',
    icon: '🧳',
    xp: 50,
    check: S => (S.holidays || []).length >= 1,
  },
  {
    id: 'holiday-done',
    title: 'Bon Voyage',
    desc: 'Completed a planned trip.',
    icon: '✈️',
    xp: 150,
    check: S => holidaysCompleted(S) >= 1,
  },
];

// Quick lookup by ID for the runtime — keeps unlock detection O(n) per
// state change rather than O(n²) scanning the array per stamped vision.
export const VISIONS_BY_ID = Object.fromEntries(VISIONS.map(v => [v.id, v]));
