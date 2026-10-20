/**
 * SWEEP area entry — owned by the SWEEP agent (src/design/console/README.md).
 *
 * App.jsx mounts these through <DesignSlot>. While null, the classic
 * screen renders, in console mode too. Replace with lazy components:
 *
 *   import { lazy } from 'react';
 *   export const ConsoleHabits = lazy(() => import('./ConsoleHabits'));
 *
 * Section routes (receive the SectionProps bag, README.md "Section props"):
 *   ConsoleHabits        'habits' (desktop + mobile; `isMobile` is in the bag)
 *   ConsoleSettings      'settings' — MUST render the owner Design switch
 *                        (src/design/DesignSwitch.jsx) in Appearance, with the
 *                        same OWNER_SURFACES_IN_BUILD lazy gating SettingsSection uses
 *   ConsoleAchievements  'achievements'
 *   ConsoleShop          'shop'
 *   ConsoleLeaderboard   'leaderboard'
 *   ConsoleFriends       'friends' (the mobile friends screen)
 *
 * Overlays (receive the SAME props as the classic component they replace):
 *   ConsolePaywall       PaywallModal's props: { openId, onClose, onManage, onShowToast, onOpenLegal }
 *   ConsoleTutorial      TutorialOverlay's props: { visible, theme, onNavigate, onClose }
 *
 * The sign-in screen renders before there is any state, so it is always the
 * no-session design (classic until the launch flip) — see README "Gotchas".
 */
export const ConsoleHabits = null;
export const ConsoleSettings = null;
export const ConsoleAchievements = null;
export const ConsoleShop = null;
export const ConsoleLeaderboard = null;
export const ConsoleFriends = null;
export const ConsolePaywall = null;
export const ConsoleTutorial = null;
