/**
 * The console tour: one voice for both themes, sentence case, five
 * short stops that point at real UI. Classic had eleven stops in two
 * voices ("Welcome to Vantage" / "system init"), each a paragraph of
 * mono prose in a centred modal. Pure data; tourSteps.test.mjs pins it.
 *
 *   targets  where to point, tried in order; the first element that is
 *            on screen wins. `[data-cx-nav=…]` is the console shell's
 *            nav hook (requested of SHELL in sweep/NOTES.md), the
 *            `#nav-tab-…` ids are classic Nav's, `tab:` matches a phone
 *            tab-bar button by its label. No match → a centred card.
 *   navTo    section to open before pointing.
 */
export const TOUR_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Vantage',
    body: 'Four quick stops, about thirty seconds. You can skip, and replay it any time from Settings.',
    targets: [],
  },
  {
    id: 'hub',
    title: 'Your hub',
    body: 'Your rating, your progress to the next prestige and the widgets you choose. A widget can be added once there is something for it to show.',
    targets: ['[data-cx-tour="hub"]', '[data-cx-nav="hub"]', '#nav-tab-hub', 'tab:Hub'],
    navTo: 'hub',
  },
  {
    id: 'track',
    title: 'Log your day',
    body: 'Trackers, food and vitals live in Track. A tracker can tick itself from a reading you already have.',
    targets: ['[data-cx-nav="track"]', '#nav-tab-track', 'tab:Track'],
  },
  {
    id: 'habits',
    title: 'Break a habit',
    body: 'A timer runs from your last slip, and milestones pay coins as you pass them.',
    targets: ['[data-cx-nav="habits"]', '#nav-tab-habits', 'tab:Habits'],
  },
  {
    id: 'league',
    title: 'Your league',
    body: 'Your rating against your friends, and a group league that settles every Monday.',
    targets: ['[data-cx-nav="leaderboard"]', '#nav-tab-leaderboard', '[data-cx-nav="more"]', 'tab:More'],
  },
  {
    id: 'start',
    title: 'Where to start',
    body: 'Pick one. Everything else can wait until it is useful.',
    targets: [],
    checklist: true,
  },
];

/** Where to start, shown on the last stop. `done(S)` reads state only; nothing is written. */
export const START_ITEMS = [
  { id: 'account', label: 'Create your account', done: () => true },
  {
    id: 'hub', label: 'Choose what your hub shows', go: 'hub',
    done: S => (S?.hubWidgets || []).length > 0 || (S?.mobileWidgets || []).length > 0 || Object.keys(S?.hubGrid || {}).length > 0,
  },
  {
    id: 'track', label: 'Log your first tracker', go: 'track',
    done: S => Object.values(S?.logs || {}).some(day => day && Object.values(day).some(v => v !== false && v !== 0 && v != null && v !== '')),
  },
  { id: 'habits', label: 'Start a habit, or cut one down', go: 'habits', done: S => (S?.habits || []).length > 0 },
];
