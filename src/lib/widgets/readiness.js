/**
 * Widget readiness — "is there anything for this widget to show yet?"
 *
 * The problem this solves is the one Finlay named: a hub full of cards
 * saying "No subscriptions tracked yet", "Set up macros in Track first",
 * "Set up your burn profile". Every one of those reads as homework you
 * haven't done, and eight sections of it reads as "500+ apps in one".
 *
 * The fix is not to cut features. It is that **you cannot add a widget
 * whose only possible state is an empty state**. The picker still lists
 * it — a disabled row that says what unlocks it teaches the feature
 * exists, which a hidden row cannot, and that is the same call already
 * made for locked rows in PickList — but it cannot be added until the
 * data behind it exists.
 *
 * Two rules keep this honest:
 *
 *   1. A widget is only gated when its body would render an empty
 *      state. The predicate here mirrors the body's own emptiness test;
 *      if they drift, the picker starts lying. Each one names the body
 *      it mirrors.
 *
 *   2. A widget that IS its own setup surface is never gated. Body Goal
 *      opens a form when there is no goal — gating it on having a goal
 *      would be a catch-22 with no way in. Same for anything fed by an
 *      external source rather than by the user (Market, News, the app
 *      presets), which has data on day one.
 *
 * Pure — no DOM, no React, no network. `S` in, verdict out.
 */

/** Sections a "go and fill this in" link can point at. */
const WHERE = {
  achievements: 'achievements',
  habits: 'habits',
  holiday: 'holiday',
  track: 'track',
  hub: 'hub',
  shop: 'shop',
};

const has = arr => Array.isArray(arr) && arr.length > 0;
const hasKeys = obj => !!obj && typeof obj === 'object' && Object.keys(obj).length > 0;
/** Array-or-nothing. `S` is a JSON blob off the wire; a key that should
 *  be a list arriving as an object must not take the picker down. */
const list = v => (Array.isArray(v) ? v : []);

/**
 * type → { ready(S), need, where }
 *
 * `need` is written as the thing the USER does, not as what the app
 * lacks: "Log a weight" rather than "No weight data". The picker shows
 * it verbatim, and it is the whole value of a disabled row.
 */
const RULES = {
  // Mirrors RecentWinsBody: needs at least one completed achievement.
  'recent-wins': {
    ready: S => list(S.achievements).some(a => a && a.completed),
    need: 'Complete an achievement first',
    where: WHERE.achievements,
  },
  // Mirrors CoinHistoryBody: the ledger is written on earn/spend.
  'coin-history': {
    ready: S => has(S.coinHistory),
    need: 'Earn or spend a coin first',
    where: WHERE.achievements,
  },
  // Mirrors HabitsBody.
  'habits': {
    ready: S => has(S.habits),
    need: 'Add a habit first',
    where: WHERE.habits,
  },
  // Mirrors HolidaysBody.
  'holidays': {
    ready: S => has(S.holidays),
    need: 'Plan a trip first',
    where: WHERE.holiday,
  },
  // Mirrors GithubBody: the first link carrying a ghUser.
  'github': {
    ready: S => list(S.links).some(l => l && l.ghUser),
    need: 'Add a GitHub link first',
    where: WHERE.hub,
  },
  // Mirrors LinkedinBody.
  'linkedin': {
    ready: S => list(S.links).some(l => l && /linkedin\.com/i.test(l.url || '')),
    need: 'Add a LinkedIn link first',
    where: WHERE.hub,
  },
  // Mirrors VitalsBody: any logged weight / sleep / resting HR.
  'vitals': {
    ready: S => hasKeys(S.vitalsLog),
    need: 'Log a weight, sleep or resting HR first',
    where: WHERE.track,
  },
  // Mirrors GoalsBody's pinnable set: achievements, savings, or a body
  // goal. Any one of the three gives it something to pin.
  'goals': {
    ready: S => has(S.achievements) || has(S.savings) || !!(S.bodyGoal && S.bodyGoal.targetKg),
    need: 'Add an achievement or a savings goal first',
    where: WHERE.achievements,
  },
  // Mirrors MacrosBody. The widget reads the nutrition tables, which
  // needs a round trip we cannot do inside a picker — S.macroHistory is
  // written by NutritionSection whenever macros are set up, so it is the
  // synchronous stand-in. Its only failure mode is being conservative:
  // someone who set macros on another device this second sees the row
  // disabled until their state syncs, which it does on open.
  'macros': {
    ready: S => hasKeys(S.macroHistory),
    need: 'Set your daily macros first',
    where: WHERE.track,
  },
  // Mirrors BurnBody, which needs bmrKcal(S) — height, age and sex.
  'calories': {
    ready: S => {
      const p = S.burnProfile;
      return !!(p && p.heightCm && p.age && p.sex);
    },
    need: 'Set your height, age and sex first',
    where: WHERE.track,
  },
  'savings-pots': {
    ready: S => has(S.savings),
    need: 'Add a savings goal first',
    where: WHERE.achievements,
  },
  'savings-projection': {
    ready: S => has(S.savings),
    need: 'Add a savings goal first',
    where: WHERE.achievements,
  },
  'subscriptions': {
    ready: S => has(S.subscriptions),
    need: 'Add a recurring bill first',
    where: WHERE.achievements,
  },
};

/*
 * Deliberately absent, and why — a list, because the next person to add
 * a widget will need to decide which side of it they are on:
 *
 *   body-goal   its own setup form IS the widget when no goal exists.
 *               Gating it would be a catch-22.
 *   market      external prices; real on day one.
 *   news        external feed; real on day one.
 *   mail        already a `requires` stub in the picker.
 *   trading     owner-only, fed by a server function.
 *   rotation    owner-only, reads a pattern that always exists.
 *   body        retired from the picker; kept renderable for old hubs.
 *   app presets external links — nothing to fill in.
 */

/**
 * @returns {{ready: boolean, need: string|null, where: string|null}}
 * Unknown types are ready: a widget with no rule must never be blocked
 * by this file, or adding one becomes a two-file change with a silent
 * failure mode.
 */
export function widgetReadiness(type, S = {}) {
  const rule = RULES[type];
  if (!rule) return { ready: true, need: null, where: null };
  return rule.ready(S || {})
    ? { ready: true, need: null, where: null }
    : { ready: false, need: rule.need, where: rule.where };
}

/** Types this module has an opinion about. Exported for tests. */
export const GATED_WIDGET_TYPES = Object.keys(RULES);
