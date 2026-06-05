export const DEFAULT_STATE = {
  profile: { name: '', tagline: '', photo: null },
  links: [],
  achievements: [
    { id: 'a1', name: 'Save £10,000', desc: 'Build emergency fund', icon: '💰', x: 40, y: 40, completed: false, coins: 100, category: 'finance' },
    { id: 'a2', name: 'Buy a House', desc: 'Get on the property ladder', icon: '🏠', x: 370, y: 40, completed: false, locked: true, coins: 500, category: 'finance' },
    { id: 'a3', name: 'Run 5K', desc: 'Complete a 5K run', icon: '🏃', x: 40, y: 210, completed: false, coins: 50, category: 'fitness' },
    { id: 'a4', name: 'Run 10K', desc: 'Level up to 10K', icon: '🏅', x: 370, y: 210, completed: false, locked: true, coins: 80, category: 'fitness' },
  ],
  connections: [['a1', 'a2'], ['a3', 'a4']],
  trackers: [
    { id: 't1', name: 'Gym Session', type: 'boolean', color: '#1a7a4a', weeklyTarget: 3, weeklyCoins: 15, category: 'fitness' },
    { id: 't2', name: 'Protein Goal', type: 'boolean', color: '#2a9e62', weeklyTarget: 5, weeklyCoins: 10, category: 'fitness' },
    { id: 't3', name: 'Amount Saved', type: 'number', unit: '£', goal: 500, color: '#c8970a', category: 'finance' },
  ],
  logs: {},
  shopItems: [],
  shopCategories: [],
  shopFilter: 'all',
  // colorScheme: scheme id ('green' default, or 'custom'). customColor
  // holds the hex when colorScheme === 'custom' (Pro colour wheel).
  customColor: null,
  widgetPositions: {},
  // Per-section background images (data URLs), keyed by section id.
  // Synced in state so they follow the account across devices (migrated
  // from the old device-local localStorage('vb4_bg')).
  backgrounds: {},
  // Per-widget custom sizes { [widgetId]: { w, h } } set by dragging a
  // widget's resize grip. Cleared by the "Sort" action alongside
  // widgetPositions.
  widgetSizes: {},
  holidays: [],
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  selectedLogDate: null,
  connectingFrom: null,
  multiSelectMode: false,
  multiSelectedDays: [],
  coins: 0,
  coinHistory: [],
  notepadText: '',
  notepadPos: null,
  notepadWidth: 380,
  ytWidgets: [],
  lastfm: { username: '', track: '', artist: '', album: '', artUrl: '', trackUrl: '', nowPlaying: false },
  ghCache: {},
  habits: [],
  streaks: {},
  // ── AI Coach state ────────────────────────────────────────────────
  // coachMemory: { [stableInsightId]: { lastShownYmd, lastDismissedYmd,
  //   lastActedYmd, showCount, dismissCount, actCount } }
  //   — drives heuristic cooldowns so the same insight doesn't loop.
  // coachBriefHistory: rolling array (max 7) of past LLM briefs sent
  //   back to the model on each fetch so it can avoid repeating
  //   yesterday's focus/watch/micro lines.
  coachMemory: {},
  coachBriefHistory: [],
  // ── Visions / Level system ────────────────────────────────────────
  // visions: { [visionId]: { unlockedAt: ISO } }
  //   System-tracked milestones (habit streaks, logging consistency,
  //   completed-achievement counts). Stamped once when their `check(S)`
  //   first passes. XP from these + a small drip from completed user
  //   achievements drives the displayed Level. See src/lib/visions.
  // visionsBackfilled: marks the first-load silent backfill as done so
  //   we don't fire a burst of toasts when the feature lands for users
  //   whose state already meets several visions.
  visions: {},
  visionsBackfilled: false,
  // ── Notifications ────────────────────────────────────────────────
  // Preferences for push + in-app notifications. The push delivery
  // pipeline (Sprint 3 of FEATURE 2) reads these to decide whether
  // to fire a notification for a given event kind. Categories map
  // 1:1 to the `data.kind` values handled in src/lib/push/handlers.js.
  //   - quietHours: ISO HH:mm strings; no notifications fire in this
  //     window. Empty start/end strings disable quiet hours.
  //   - dailyReminderAt: HH:mm string for the optional daily nudge,
  //     null to disable.
  // The panel in Settings → Tools writes here.
  notifications: {
    visionUnlock: true,
    friendRequest: true,
    streakWarning: true,
    coachNudge: true,
    quietHours: { start: '', end: '' },
    dailyReminderAt: null,
  },
  // ── Savings goals (FEATURE 4 Sprint 2) ────────────────────────────
  // Named monetary goals + their contribution log. Lives in the same
  // user_data JSON blob; NO Supabase migration. Privacy hard rule:
  // amounts NEVER get published to public_stats and are redacted in
  // the AI Coach snapshot (count + names only, never £).
  //
  // Shape per goal:
  //   { id, name, icon, target, current, contributions: [...],
  //     achievementId?, createdAt }
  // Contribution: { id, amount, ts, note? }
  // achievementId optional — when goal completes (current >= target),
  // the linked achievement is auto-marked complete + its coin reward
  // fires. Same pipeline as the Achievements board.
  savings: [],
  // ── Mobile widget stack (FEATURE 5 follow-up) ────────────────────
  // Vertical list rendered below the AI Coach on the mobile hub.
  // Each entry: { id, type, ...config }. Order = render order.
  //
  // Widget types implemented today (work without external APIs):
  //   - 'notepad'      — quick-jot text, mirrors S.notepadText
  //   - 'recent-wins'  — last 3 completed achievements
  //   - 'coin-history' — last 5 coin events
  //
  // Widget types stubbed (show "Requires X" CTA until wired):
  //   - 'vitals'    → needs F4 Sprint 1 (HealthKit / Health Connect)
  //   - 'calories'  → needs F4 Sprint 1
  //   - 'mail'      → needs Gmail/Outlook OAuth (deferred — separate vertical)
  //
  // Free for all users — Pro differentiation on mobile lives here
  // (more widgets unlocked) rather than via a separate layout.
  mobileWidgets: [],
  // ── Ranked categories (FEATURE 5 Sprint 3) ───────────────────────
  // Brain / Finance / Fitness / Social each 1-99, plus a 1-99 OVR
  // composite. Cached here after each derive; canonical truth for
  // friend display lives server-side (profiles.ratings, recomputed
  // by netlify/functions/recompute-ratings). See feature_playbook.md
  // F5 Sprint 3 for the full algorithm + anti-gaming rules.
  //
  // Last derived snapshot. Recomputed by src/lib/ratings/derive.js
  // on a debounce after relevant state changes.
  ratings: {
    brain:   1,
    finance: 1,
    fitness: 1,
    social:  1,
    ovr:     1,
    computedAt: null,
  },
  // Result of the most-recent IQ self-check (F5 Sprint 4). Optional;
  // null means the user hasn't taken it. testVersion lets us migrate
  // the test bank later without invalidating old scores silently.
  brainScore: null, // { result: 0-160, ts, testVersion: 1 }
  // ── Friend-card privacy (FEATURE 1 follow-up) ────────────────────
  // Per-field toggles for what friends see on the profile card.
  // Defaults preserve existing behavior (everything visible).
  // usePublishProfile reads these and zeros-out hidden fields when
  // it writes public_stats — so server-side data simply doesn't have
  // the value when a friend reads it. Toggling off a field clears
  // the value on the next debounced publish.
  privacy: {
    shareAvatar:   true,  // profile photo (vs @handle initial)
    shareStreak:   true,  // current_streak + streak_habit
    shareHeatmap:  true,  // 91-day heatmap_days
    shareWins:     true,  // recent_wins (last 3 completed achievements)
    sharePresence: true,  // last_active_at + online dot heartbeat
  },
  // ── Hub module appearance ────────────────────────────────────────
  // Per-module background-transparency toggles, set via the right-click
  // menu on each hub module (Widgets / Ratings / Profile / Trackers /
  // Friends). { [moduleId]: true } makes that module's surface
  // transparent so the page shows through, like the Ratings Ledger.
  moduleTransparency: {},
  // Achievement board background toggles (right-click the board). Affect
  // only that section's canvas background, not the global theme.
  achBoardTransparent: false,
  // "Use the opposite of the current theme's default board background"
  // — on a light theme that's a dark board, on a dark theme a light one.
  achBoardInvert: false,
};
