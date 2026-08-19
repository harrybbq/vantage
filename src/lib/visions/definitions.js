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

/**
 * Days — ever, not in a window — on which any tracker of `category` was
 * logged. The per-category equivalent of vitalsLogDays, and the thing
 * the category visions below count.
 *
 * Lifetime on purpose. A rolling window measures whether you are on it
 * this month; a lifetime count measures whether you have been at it,
 * which is what a milestone should be about.
 */
function categoryLogDays(S, category) {
  const ids = new Set((S.trackers || []).filter(t => t.category === category).map(t => t.id));
  if (!ids.size) return 0;
  const logs = S.logs || {};
  let days = 0;
  for (const key of Object.keys(logs)) {
    const day = logs[key] || {};
    for (const id of ids) {
      const v = day[id];
      if (v !== false && v !== 0 && v != null && v !== '') { days++; break; }
    }
  }
  return days;
}

/** Has the category's self-check been taken? */
const tookCheck = (S, key) => !!(S[key] && S[key].result);

// ── definitions ───────────────────────────────────────────────────────
export const VISIONS = [
  // Habit streaks — held a tracked habit clean for N days
  {
    id: 'streak-7',
    category: 'fitness',
    title: 'Week One',
    desc: 'Held a habit clean for 7 days.',
    icon: '🌱',
    xp: 50,
    check: S => maxHabitDaysClean(S) >= 7,
  },
  {
    id: 'streak-30',
    category: 'fitness',
    title: 'Thirty Strong',
    desc: 'Held a habit clean for 30 days.',
    icon: '🌳',
    xp: 200,
    check: S => maxHabitDaysClean(S) >= 30,
  },
  {
    id: 'streak-100',
    category: 'fitness',
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
    category: 'fitness',
    title: 'A Year Clean',
    desc: 'Held a habit clean for a full year.',
    icon: '🏅',
    xp: 1000,
    check: S => maxHabitDaysClean(S) >= 365,
  },
  {
    id: 'habits-3',
    category: 'fitness',
    title: 'Habit Stacker',
    desc: 'Tracking three habits at once.',
    icon: '🧱',
    xp: 50,
    check: S => activeHabitCount(S) >= 3,
  },

  // Savings milestones
  {
    id: 'savings-first',
    category: 'finance',
    title: 'First Pot',
    desc: 'Completed your first savings goal.',
    icon: '🫙',
    xp: 150,
    check: S => savingsGoalsCompleted(S) >= 1,
  },
  {
    id: 'savings-goals-3',
    category: 'finance',
    title: 'Diversified',
    desc: 'Running three savings pots at once.',
    icon: '🗂️',
    xp: 75,
    check: S => activeSavingsGoals(S) >= 3,
  },
  {
    id: 'savings-1k',
    category: 'finance',
    title: 'Four Figures',
    desc: 'Saved £1,000 across your pots.',
    icon: '💷',
    xp: 100,
    check: S => totalSaved(S) >= 1000,
  },
  {
    id: 'savings-10k',
    category: 'finance',
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
    category: 'fitness',
    title: 'Body Aware',
    desc: 'Logged your vitals on seven days.',
    icon: '❤️',
    xp: 75,
    check: S => vitalsLogDays(S) >= 7,
  },
  {
    id: 'macros-7',
    category: 'fitness',
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
  /* ── One ladder per category ────────────────────────────────────────
     Added 2026-08-19, and the reason is worth keeping.

     Every vision above this line was uncategorised, which meant each one
     paid a quarter of its xp into all four ratings. So the four ratings
     moved together no matter what a person actually did, and the largest
     single input to all of them was identical. Categorising the ones
     that clearly belong somewhere — habit streaks to Fitness, savings to
     Finance — fixed that, and immediately exposed the other half of the
     problem: there was not one Brain vision and not one Social vision in
     the entire catalogue. Two of the four categories had nothing of
     their own to earn.

     These twelve are that: a self-check, a thirty-day and a hundred-day
     milestone in each of the four. All of them count data the app
     already keeps — no new state, no migration. The tracker ones count
     lifetime days, not a rolling window, because a milestone should be
     about having been at it rather than being on it this month. */

  { id: 'check-brain',   category: 'brain',   title: 'Know Your Number',
    desc: 'Took the Brain self-check.',       icon: '🧠', xp: 75,
    check: S => tookCheck(S, 'brainScore') },
  { id: 'brain-30',      category: 'brain',   title: 'Thirty Sharp',
    desc: 'Logged a Brain tracker on thirty days.',  icon: '📖', xp: 200,
    check: S => categoryLogDays(S, 'brain') >= 30 },
  { id: 'brain-100',     category: 'brain',   title: 'Hundred Sharp',
    desc: 'Logged a Brain tracker on a hundred days.', icon: '🎓', xp: 500,
    check: S => categoryLogDays(S, 'brain') >= 100 },

  { id: 'check-finance', category: 'finance', title: 'Books Open',
    desc: 'Took the Finance self-check.',     icon: '📊', xp: 75,
    check: S => tookCheck(S, 'financeScore') },
  { id: 'finance-30',    category: 'finance', title: 'Thirty in the Black',
    desc: 'Logged a Finance tracker on thirty days.', icon: '💷', xp: 200,
    check: S => categoryLogDays(S, 'finance') >= 30 },
  { id: 'finance-100',   category: 'finance', title: 'Hundred in the Black',
    desc: 'Logged a Finance tracker on a hundred days.', icon: '🏦', xp: 500,
    check: S => categoryLogDays(S, 'finance') >= 100 },

  { id: 'check-fitness', category: 'fitness', title: 'Baseline Set',
    desc: 'Took the Fitness self-check.',     icon: '🏃', xp: 75,
    check: S => tookCheck(S, 'fitnessScore') },
  { id: 'fitness-30',    category: 'fitness', title: 'Thirty Moved',
    desc: 'Logged a Fitness tracker on thirty days.', icon: '💪', xp: 200,
    check: S => categoryLogDays(S, 'fitness') >= 30 },
  { id: 'fitness-100',   category: 'fitness', title: 'Hundred Moved',
    desc: 'Logged a Fitness tracker on a hundred days.', icon: '🥇', xp: 500,
    check: S => categoryLogDays(S, 'fitness') >= 100 },

  { id: 'check-social',  category: 'social',  title: 'Taking Stock',
    desc: 'Took the Social self-check.',      icon: '🫂', xp: 75,
    check: S => tookCheck(S, 'socialScore') },
  { id: 'social-30',     category: 'social',  title: 'Thirty Together',
    desc: 'Logged a Social tracker on thirty days.',  icon: '☎️', xp: 200,
    check: S => categoryLogDays(S, 'social') >= 30 },
  { id: 'social-100',    category: 'social',  title: 'Hundred Together',
    desc: 'Logged a Social tracker on a hundred days.', icon: '🎉', xp: 500,
    check: S => categoryLogDays(S, 'social') >= 100 },
];

// Quick lookup by ID for the runtime — keeps unlock detection O(n) per
// state change rather than O(n²) scanning the array per stamped vision.
export const VISIONS_BY_ID = Object.fromEntries(VISIONS.map(v => [v.id, v]));
