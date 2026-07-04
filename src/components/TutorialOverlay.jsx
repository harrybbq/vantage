import { useEffect, useState, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { backdropClose } from '../utils/backdropClose';

/**
 * TutorialOverlay
 *
 * Spotlight-with-tooltip onboarding walkthrough. Two tone variants:
 *   - theme="cream" → friendly, serif-italic voice (default)
 *   - theme="dark"  → terser mono "system.init" voice (for Dark OS users)
 *
 * The overlay is controlled — the parent decides when it's visible and
 * what to do on close. This component does not persist anything; it
 * just calls onClose() when the user finishes or skips.
 *
 * Target IDs refer to elements that already exist in the real app
 * (nav buttons, the hub section, the coin wallet). If a target element
 * can't be found, the step degrades gracefully to a centred card so
 * the tour never gets stuck.
 */

// ── Step definitions ────────────────────────────────────────────────
//
// id       — internal key; also used to decide which section to navigate
//            to before spotlighting ('hub' step → activeSection='hub',
//            'achievements' step → 'achievements', etc.)
// label    — small uppercase chip at top of the tooltip
// title    — headline
// body     — description
// target   — element id to spotlight. null ⇒ centred card.
// placement / arrowDir — where the tooltip sits relative to the target.
// navTo    — which app section to switch to before showing this step.
//            Some steps target the nav tabs themselves (so no navigation
//            needed); others show the landing content and should switch.

const STEPS_CREAM = [
  {
    id: 'welcome', label: 'Welcome', icon: '✦',
    title: 'Welcome to Vantage',
    body: 'A 45-second tour of what Vantage does. Skip any time — it lives in Settings if you want to replay it later.',
    target: null, placement: 'center',
  },
  {
    id: 'hub', label: 'Hub',
    title: 'Your hub',
    body: 'Home base. The Hub is your personal dashboard — your profile card, your overall rating, friends, and any widgets you pin (links, notepad, GitHub, habits, holidays, even a mini leaderboard). Drag widgets around or right-click modules to make them transparent.',
    target: 'hub', placement: 'bottom', arrowDir: 'up',
    navTo: 'hub',
  },
  {
    id: 'achievements', label: 'Achievements',
    title: 'Goals + savings',
    body: 'Two tabs in one place. The Goals board is a drag-and-connect pin-board — draw lines between milestones, complete them for ⬡ coins. The Savings tab tracks money goals (photos, target dates, monthly contribution guidance) and feeds your Finance rating.',
    target: 'nav-tab-achievements', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'track', label: 'Track',
    title: 'Track & log',
    body: 'Custom daily trackers (booleans or numbers) — tick them off, build streaks, hit weekly goals for coin rewards. Nutrition logging lives here too (barcode scan, food search, macros). Every log feeds your category ratings.',
    target: 'nav-tab-track', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'shop', label: 'Shop',
    title: 'Reward yourself',
    body: 'Add things you actually want — paste a link to autofill the details. Drop items into categories. Spend the ⬡ coins you\'ve earned to unlock them. The reward layer that gives finishing what you start a point.',
    target: 'nav-tab-shop', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'holiday', label: 'Holiday',
    title: 'Plan your trips',
    body: 'Trips you\'ve booked or are still dreaming about. Countdowns, budgets, photos, booking status — all in one place. Add the Holidays widget to your hub for upcoming-trip glances.',
    target: 'nav-tab-holiday', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'habits', label: 'Habits',
    title: 'Break bad habits',
    body: 'Add a habit you want to quit. A live timer counts up from your last relapse; progress bars track milestones (1 week → 1 month → 1 year for coins). Set strikes-per-week if a single slip shouldn\'t reset everything.',
    target: 'nav-tab-habits', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'leaderboard', label: 'Leaderboard',
    title: 'Compete + climb',
    body: 'Your OVR rating (Brain / Finance / Fitness / Social, each 0–99) is everywhere. The Leaderboard ranks you against friends or globally — by all-time or weekly climb. Hit OVR 99 and you can Prestige up for a colour-band badge (GREEN I → CRIMSON X).',
    target: 'nav-tab-leaderboard', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'settings', label: 'Settings',
    title: 'Make it yours',
    body: 'Colour schemes (10 free + Pro custom-colour wheel), themes, macro goals, privacy toggles, the Visions catalogue (every milestone you can chase), and replay this tour.',
    target: 'nav-tab-settings', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'done', label: 'Done', icon: '★',
    title: "You're all set",
    body: "Start with one thing — a goal, a habit to break, a trip, a tracker. Build from there. This tour lives in Settings if you ever need it again.",
    target: null, placement: 'center',
  },
];

// Dark OS — same 9-step structure, terser voice
const STEPS_DARK = [
  {
    id: 'welcome', label: 'init', icon: '◆',
    title: 'system init',
    body: 'Orientation tour. 45 seconds. Skippable at any time. Replayable from settings.',
    target: null, placement: 'center',
  },
  {
    id: 'hub', label: 'hub',
    title: 'the hub',
    body: 'Home base. Profile, ratings ledger, friends rail, draggable widget canvas. Right-click any module to toggle transparency. Pro themes give you the operator console grid.',
    target: 'hub', placement: 'bottom', arrowDir: 'up',
    navTo: 'hub',
  },
  {
    id: 'achievements', label: 'goals',
    title: 'achievements + savings',
    body: 'Drag-and-connect pin-board for goals, separate tab for monetary savings goals. Both feed your category ratings. 15 max new achievements per 24h (40 on Pro) — anti-gaming on the ranking system.',
    target: 'nav-tab-achievements', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'track', label: 'track',
    title: 'track and log',
    body: 'Daily trackers + nutrition logging. Streaks, weekly goals, macros. Coin scams blocked: toggling a tracker after a weekly bonus reverses the award.',
    target: 'nav-tab-track', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'shop', label: 'shop',
    title: 'shop',
    body: 'Wishlist items. Paste a URL → autofill. Drop into categories. Spend ⬡ coins to unlock — personal incentive layer.',
    target: 'nav-tab-shop', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'holiday', label: 'holiday',
    title: 'holiday',
    body: 'Trips booked or planned. Countdowns, budgets, booking status, photos. Mountable as a hub widget.',
    target: 'nav-tab-holiday', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'habits', label: 'habits',
    title: 'habits',
    body: 'Bad-habit break tracker. Live timer + milestone progress bars. Strikes-per-week allowance so one slip doesn\'t nuke the streak. Coin rewards on hit milestones.',
    target: 'nav-tab-habits', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'leaderboard', label: 'leaderboard',
    title: 'leaderboard',
    body: 'Server-canonical ratings (profiles.ratings_ovr). Friends / Global × all-time / weekly-climb. At OVR 99 you can prestige: badge in colour bands (forest → crimson), the climb restarts from zero, nothing else wiped.',
    target: 'nav-tab-leaderboard', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'settings', label: 'settings',
    title: 'settings',
    body: 'Colour schemes (10 free + Pro custom-colour wheel), themes, macros, privacy, Visions catalogue, replay this tour.',
    target: 'nav-tab-settings', placement: 'right', arrowDir: 'left',
  },
  {
    id: 'done', label: 'ready', icon: '◈',
    title: 'system ready',
    body: 'Orientation complete. Add your first node, tracker, or widget to begin. Tour accessible from settings.',
    target: null, placement: 'center',
  },
];

// ── Positioning helpers ─────────────────────────────────────────────

const TOOLTIP_W = 280;
const GAP = 18;

function getTargetRect(targetId) {
  if (!targetId) return null;
  const el = document.getElementById(targetId);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Element is display:none or collapsed — treat as missing.
  if (r.width === 0 && r.height === 0) return null;
  return r;
}

function getTooltipPos(rect, placement) {
  if (!rect) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Keep tooltip on-screen with a 12px safety margin.
  const clampX = x => Math.max(12, Math.min(x, vw - TOOLTIP_W - 12));
  const clampY = y => Math.max(12, Math.min(y, vh - 260));

  if (placement === 'right') {
    return { left: clampX(rect.right + GAP), top: clampY(rect.top + rect.height / 2 - 100) };
  }
  if (placement === 'left') {
    return { left: clampX(rect.left - TOOLTIP_W - GAP), top: clampY(rect.top + rect.height / 2 - 100) };
  }
  if (placement === 'bottom') {
    return { left: clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2), top: clampY(rect.bottom + GAP) };
  }
  if (placement === 'top') {
    return { left: clampX(rect.left + rect.width / 2 - TOOLTIP_W / 2), top: clampY(rect.top - GAP - 200) };
  }
  return null;
}

function getSpotlightRect(rect) {
  if (!rect) return null;
  return {
    left: rect.left - 6,
    top: rect.top - 6,
    width: rect.width + 12,
    height: rect.height + 12,
  };
}

// ── Component ───────────────────────────────────────────────────────

export default function TutorialOverlay({
  visible,
  theme = 'cream',          // 'cream' | 'dark'
  onClose,
  onNavigate,               // (sectionId) => void  — lets us sync app section before spotlighting
}) {
  const steps = useMemo(() => (theme === 'dark' ? STEPS_DARK : STEPS_CREAM), [theme]);
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState(null);
  const [spot, setSpot] = useState(null);

  // Reset to step 0 whenever the overlay is (re-)opened. Gives the
  // Settings replay button a clean slate without us having to reach in.
  useEffect(() => {
    if (visible) setStep(0);
  }, [visible]);

  const current = steps[step];

  // If the step wants to land the user on a specific section first,
  // fire navigation once per step change. This ensures e.g. the hub
  // step actually highlights the visible hub content rather than the
  // previous section's layout.
  useEffect(() => {
    if (!visible) return;
    if (current?.navTo && typeof onNavigate === 'function') {
      onNavigate(current.navTo);
    }
  }, [visible, current, onNavigate]);

  // Measure target after paint. We re-measure on every frame for the
  // first ~400 ms to let any navigation animation finish, then settle
  // on resize / scroll.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let frames = 0;

    function measure() {
      if (cancelled) return;
      const rect = getTargetRect(current?.target);
      setPos(getTooltipPos(rect, current?.placement));
      setSpot(getSpotlightRect(rect));
    }

    function tick() {
      measure();
      frames += 1;
      if (frames < 24 && !cancelled) requestAnimationFrame(tick);
    }

    tick();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [visible, current]);

  const go = useCallback(delta => {
    setStep(s => Math.max(0, Math.min(steps.length - 1, s + delta)));
  }, [steps.length]);

  // Escape closes the tour.
  useEffect(() => {
    if (!visible) return;
    const handler = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, onClose]);

  if (!visible || !current) return null;

  // A step is "centred" if it has no target OR the target can't be
  // found in the DOM right now. This keeps the tour flowing even if
  // e.g. nav buttons get hidden on small viewports.
  const targetResolved = !!spot;
  const isCentered = !current.target || current.placement === 'center' || !targetResolved;
  const isDone = current.id === 'done';
  const isWelcome = step === 0;
  const isLastStep = step === steps.length - 1;

  const themeClass = theme === 'dark' ? 'tut-theme-dark' : 'tut-theme-cream';

  const nextLabel = isDone
    ? (theme === 'dark' ? 'enter_app →' : 'Get started →')
    : isLastStep
      ? (theme === 'dark' ? 'finish →' : 'Finish →')
      : (theme === 'dark' ? 'next →' : 'Next →');
  const backLabel = theme === 'dark' ? '← back' : '← Back';
  const skipLabel = theme === 'dark' ? 'skip' : 'Skip';

  // Backdrop: radial gradient around target for spotlight steps,
  // flat dim for centred cards.
  const backdropStyle = (!isCentered && spot)
    ? {
        background: `radial-gradient(ellipse at ${spot.left + spot.width / 2}px ${spot.top + spot.height / 2}px, transparent ${Math.max(spot.width, spot.height) * 0.4}px, rgba(0,0,0,0.46) ${Math.max(spot.width, spot.height) * 0.85}px)`,
      }
    : undefined;

  return (
    <div className={`tut-root ${themeClass}`}>
      <div className="tut-backdrop" style={backdropStyle} onClick={onClose} />

      {/* Spotlight ring */}
      {!isCentered && spot && (
        <motion.div
          className="tut-ring"
          initial={false}
          animate={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        />
      )}

      {/* Centred welcome / done card */}
      <AnimatePresence mode="wait">
        {isCentered && (
          <motion.div
            key={`center-${step}`}
            className="tut-center-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            {...backdropClose(() => onClose?.())}
          >
            <div className="tut-center-card">
              <div className="tut-center-hero">
                <span className="tut-center-hero-glyph">{current.icon || '✦'}</span>
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.08 }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                    <line key={`v${i}`} x1={`${i * 12.5}%`} y1="0" x2={`${i * 12.5}%`} y2="100%" stroke="currentColor" strokeWidth="0.5" />
                  ))}
                  {[1, 2, 3].map(i => (
                    <line key={`h${i}`} x1="0" y1={`${i * 25}%`} x2="100%" y2={`${i * 25}%`} stroke="currentColor" strokeWidth="0.5" />
                  ))}
                </svg>
              </div>
              <div className="tut-center-body">
                <div className="tut-center-title">{current.title}</div>
                <div className="tut-center-text">{current.body}</div>
              </div>
              <div className="tut-dots" style={{ paddingLeft: 28 }}>
                {steps.map((s, i) => (
                  <div key={s.id} className={`tut-dot${step === i ? ' active' : ''}`} />
                ))}
              </div>
              <div className="tut-center-footer">
                {!isWelcome && (
                  <button type="button" className="tut-btn tut-btn-back" onClick={() => go(-1)}>
                    {backLabel}
                  </button>
                )}
                <span className="tut-spacer" />
                {!isDone && (
                  <button type="button" className="tut-btn tut-btn-back" onClick={onClose}>
                    {skipLabel}
                  </button>
                )}
                <button
                  type="button"
                  className="tut-btn tut-btn-next"
                  onClick={isDone ? onClose : () => go(1)}
                >
                  {nextLabel}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating tooltip (non-centred steps) */}
      <AnimatePresence mode="wait">
        {!isCentered && pos && (
          <motion.div
            key={`tip-${step}`}
            className="tut-tooltip"
            style={{ left: pos.left, top: pos.top }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="tut-tooltip-card">
              {current.arrowDir && <div className={`tut-arrow arrow-${current.arrowDir}`} />}

              <div className="tut-top">
                <span className="tut-step-label">{current.label}</span>
                <button type="button" className="tut-skip" onClick={onClose}>{skipLabel}</button>
              </div>

              <div className="tut-body">
                <div className="tut-title">{current.title}</div>
                <div className="tut-body-text">{current.body}</div>
              </div>

              <div className="tut-dots">
                {steps.map((s, i) => (
                  <div key={s.id} className={`tut-dot${step === i ? ' active' : ''}`} />
                ))}
              </div>

              <div className="tut-footer">
                <span className="tut-step-counter">{step + 1} / {steps.length}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {step > 0 && (
                    <button type="button" className="tut-btn tut-btn-back" onClick={() => go(-1)}>
                      {backLabel}
                    </button>
                  )}
                  <button type="button" className="tut-btn tut-btn-next" onClick={() => go(1)}>
                    {nextLabel}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
