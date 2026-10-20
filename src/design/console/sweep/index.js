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
 *   ConsoleAuth          AuthScreen's props: { onOpenLegal, webInviteOnly }
 *
 * ConsoleAuth renders before there is any state, so it only shows once the
 * no-session design is console, i.e. after the launch flip. Verify it in a
 * harness (README "Gotchas"), not by signing out.
 */
export const ConsoleHabits = null;
export const ConsoleSettings = null;
export const ConsoleAchievements = null;
export const ConsoleShop = null;
export const ConsoleLeaderboard = null;
export const ConsoleFriends = null;
export const ConsolePaywall = null;
export const ConsoleTutorial = null;
export const ConsoleAuth = null;
