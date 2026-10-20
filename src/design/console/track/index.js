/**
 * TRACK area entry — owned by the TRACK agent (src/design/console/README.md).
 *
 * App.jsx mounts these through <DesignSlot>. While null, the classic
 * screen renders, in console mode too. Replace with lazy components:
 *
 *   import { lazy } from 'react';
 *   export const ConsoleTrack = lazy(() => import('./ConsoleTrack'));
 *
 *   ConsoleTrack    the 'track' route: Calendar / Diet / Vitals, trips merged in
 *   ConsoleHoliday  the 'holiday' route in console mode. Holiday is merged
 *                   into Track there, so this can simply render the Track
 *                   calendar on its trips view (deep links and the classic
 *                   nav still reach 'holiday'). HolidaySection stays for classic.
 *
 * Both receive the SectionProps bag (README.md, "Section props").
 */
export const ConsoleTrack = null;
export const ConsoleHoliday = null;
