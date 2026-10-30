/**
 * Onboarding — "pick what it's for, then do the first thing" (owner,
 * Oct 2026; mockups approved). It replaces both earlier tours (classic
 * TutorialOverlay, console ConsoleTutorial) in both designs.
 *
 *   1. Pick: "What do you want Vantage for?" — any of PICKS, or "Show me
 *      everything" (no picks).
 *   2. Do: one stop per pick. Each opens the real screen and its real
 *      add flow (App's navigate + handleOpenModal, so free-tier caps
 *      still apply) and is done when the state says so — never because
 *      a button was pressed.
 *   3. Keep going: a Getting started card on the hub lists the picks'
 *      first things, ticks them off as they happen, and goes once all
 *      are done or the user hides it.
 *
 * Pure (no React, no Supabase, no window). State:
 *   S.tutorialCompleted   true once the onboarding overlay is finished
 *                         or skipped (the same flag the old tours used, so
 *                         nobody who already finished one sees this again,
 *                         and the consent sheet still waits for it)
 *   S.onboarding          NEW key, additive: { picks: [id], pickedAt,
 *                         hidden, invited } — absent for everyone who
 *                         onboarded before this existed (they see no card)
 * Nothing here deletes or rewrites anything else in S.
 */

/** The default state ships example goals; your OWN goal is what counts. */
const SEEDED_GOALS = new Set(['a1', 'a2', 'a3', 'a4']);

const anyLog = S => Object.values((S && S.logs) || {}).some(day => day && typeof day === 'object'
  && Object.values(day).some(v => v !== false && v !== 0 && v != null && v !== ''));
const len = v => (Array.isArray(v) ? v.length : 0);

/**
 * The six picks, in the order the pick screen shows them. Each pick's
 * `first` is its one stop: what the card says, what "Do it" opens and
 * when it counts as done.
 * Icons are names in components/Icon.jsx.
 */
export const PICKS = Object.freeze([
  {
    id: 'fitness', label: 'Fitness', icon: 'dumbbell',
    line: 'Daily trackers, food, weight and sleep.',
    first: {
      title: 'Log one thing today',
      body: 'A tracker is anything you do daily: the gym, water, 10k steps. You have a few ready to tick, or add your own with the button.',
      cta: 'Open my trackers', section: 'trackers', modal: null, target: 'add-tracker',
      check: 'Tick a tracker',
      doneTitle: 'First tracker ticked',
      doneBody: 'That’s your first Fitness day. Tick it again tomorrow and the streak starts.',
      done: S => anyLog(S),
    },
  },
  {
    id: 'money', label: 'Money', icon: 'piggy-bank',
    line: 'Savings goals, bills and subscriptions.',
    first: {
      title: 'Start a savings goal',
      body: 'Name something you’re saving for and a target. Vantage works out what to put away each month.',
      cta: 'Add a savings goal', section: 'achievements', modal: 'addSavingsGoalModal', target: 'add-savings',
      check: 'Add a savings goal',
      doneTitle: 'Savings goal added',
      doneBody: 'Log a contribution whenever you put money in; it counts toward your Finance rating.',
      done: S => len(S && S.savings) > 0,
    },
  },
  {
    id: 'habits', label: 'Habits', icon: 'rotate-ccw',
    line: 'Quit something, or cut it down. A timer runs from your last slip.',
    first: {
      title: 'Start a habit',
      body: 'Pick something to quit or cut down. A timer starts now, and milestones pay coins as you pass them.',
      cta: 'Start a habit', section: 'habits', modal: 'addHabitModal', target: 'add-habit',
      check: 'Start a habit',
      doneTitle: 'Habit started',
      doneBody: 'The clock is running. If you slip, log it from the habit card and the timer starts again.',
      done: S => len(S && S.habits) > 0,
    },
  },
  {
    id: 'goals', label: 'Goals', icon: 'target',
    line: 'Goals that build on each other, with coins for each one done.',
    first: {
      title: 'Set your first goal',
      body: 'Something you want to get done. Link goals later so one leads to the next.',
      cta: 'Add a goal', section: 'achievements', modal: 'addAchievementModal', target: 'add-goal',
      check: 'Add a goal of your own',
      doneTitle: 'Goal added',
      doneBody: 'Complete it for coins. Each one you finish moves your rating.',
      done: S => (Array.isArray(S && S.achievements) ? S.achievements : [])
        .some(a => a && (!SEEDED_GOALS.has(a.id) || a.completed)),
    },
  },
  {
    id: 'friends', label: 'Friends', icon: 'users',
    line: 'A league with your friends, and messages.',
    first: {
      title: 'Bring a friend',
      body: 'Share your invite link: anyone who opens it can join and becomes your friend. Already know someone on Vantage? Find them by @handle.',
      cta: 'Share my invite link', section: 'friends', modal: null, target: 'add-friend', invite: true,
      check: 'Add a friend',
      doneTitle: 'Invite sent',
      doneBody: 'When they join you’ll be friends, and your league starts.',
      done: (S, ctx = {}) => (ctx.friends || 0) > 0 || !!(S && S.onboarding && S.onboarding.invited),
    },
  },
  {
    id: 'trips', label: 'Trips & treats', icon: 'plane',
    line: 'Holidays, and a wish list you earn coins for.',
    first: {
      title: 'Plan a trip',
      body: 'Add one you’ve booked or one you’re dreaming about. Countdowns, budgets and bookings live with it.',
      cta: 'Add a trip', section: 'holiday', modal: 'addHolidayModal', target: 'add-trip',
      check: 'Add a trip or a wish-list item',
      doneTitle: 'Trip added',
      doneBody: 'Its countdown is on your calendar, and the wish list is ready when you want a treat.',
      done: S => len(S && S.holidays) > 0 || len(S && S.shopItems) > 0,
    },
  },
]);

export const PICK_IDS = Object.freeze(PICKS.map(p => p.id));
export const pickById = id => PICKS.find(p => p.id === id) || null;

/** The user's picks, cleaned (known ids, picker order, no repeats). [] if none. */
export function picksOf(S) {
  const raw = S && S.onboarding && Array.isArray(S.onboarding.picks) ? S.onboarding.picks : [];
  return PICK_IDS.filter(id => raw.includes(id));
}

/** Is a pick's first thing done? */
export function isDone(S, id, ctx = {}) {
  const p = pickById(id);
  return !!(p && p.first.done(S, ctx));
}

/** The onboarding stops for the picks: one per pick, in order, with `done`. */
export function stops(S, picks, ctx = {}) {
  return PICK_IDS.filter(id => (picks || []).includes(id))
    .map(id => ({ ...pickById(id), done: isDone(S, id, ctx) }));
}

/**
 * The hub's Getting started card → { visible, items, doneCount, total }.
 * Shown only to someone who picked (an account that onboarded before this
 * existed has no picks, so no card), until every item is done or it is
 * hidden.
 */
export function gettingStarted(S, ctx = {}) {
  const picks = picksOf(S);
  const items = picks.map(id => {
    const p = pickById(id);
    return { id, label: p.first.check, pick: p.label, cta: p.first.cta, done: isDone(S, id, ctx) };
  });
  const doneCount = items.filter(i => i.done).length;
  const hidden = !!(S && S.onboarding && S.onboarding.hidden);
  return { visible: items.length > 0 && !hidden && doneCount < items.length, items, doneCount, total: items.length };
}

// ── Updaters (additive: only S.onboarding and S.tutorialCompleted) ──

const ob = prev => (prev && prev.onboarding && typeof prev.onboarding === 'object' ? prev.onboarding : {});

/** Save the picks (a replay keeps `invited`; picking again un-hides the card). */
export function setPicks(prev, picks, now = Date.now()) {
  const clean = PICK_IDS.filter(id => (picks || []).includes(id));
  return { ...prev, onboarding: { ...ob(prev), picks: clean, pickedAt: now, hidden: false } };
}

/** The overlay is done with (finished, skipped or "finish later"). */
export function finishOverlay(prev) {
  return prev && prev.tutorialCompleted === true ? prev : { ...prev, tutorialCompleted: true };
}

/** The invite link was shared or copied: Friends' first thing counts as done. */
export function markInvited(prev, now = Date.now()) {
  if (ob(prev).invited) return prev;
  return { ...prev, onboarding: { ...ob(prev), invited: now } };
}

/** "Hide" on the hub card. */
export function hideGettingStarted(prev) {
  if (ob(prev).hidden) return prev;
  return { ...prev, onboarding: { ...ob(prev), hidden: true } };
}

/** Settings → "Replay the welcome": the overlay again, picks kept to pre-tick. */
export function replay(prev) {
  return { ...prev, tutorialCompleted: false };
}
