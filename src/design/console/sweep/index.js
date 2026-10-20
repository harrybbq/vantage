/**
 * SWEEP area entry — owned by the SWEEP agent (src/design/console/README.md).
 *
 * App.jsx mounts these through <DesignSlot>. Each is lazy, so classic
 * users never download console code; a slot set back to null shows the
 * classic screen again, in console mode too.
 *
 * Section routes (receive the SectionProps bag, README.md "Section props"):
 *   ConsoleHabits        'habits' (desktop + mobile; `isMobile` is in the bag)
 *   ConsoleSettings      'settings' — renders the owner Design switch
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
import { lazy } from 'react';

export const ConsoleHabits = lazy(() => import('./ConsoleHabits'));
export const ConsoleSettings = lazy(() => import('./ConsoleSettings'));
export const ConsoleAchievements = lazy(() => import('./ConsoleAchievements'));
export const ConsoleShop = lazy(() => import('./ConsoleShop'));
export const ConsoleLeaderboard = lazy(() => import('./ConsoleLeaderboard'));
export const ConsoleFriends = lazy(() => import('./ConsoleFriends'));
export const ConsolePaywall = lazy(() => import('./ConsolePaywall'));
export const ConsoleTutorial = lazy(() => import('./ConsoleTutorial'));
export const ConsoleAuth = lazy(() => import('./ConsoleAuth'));
