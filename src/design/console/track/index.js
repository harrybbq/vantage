/**
 * TRACK area entry — owned by the TRACK agent (src/design/console/README.md).
 *
 * App.jsx mounts these through <DesignSlot>; lazy so classic users never
 * download console code.
 *
 *   ConsoleTrack    the 'track' route: Calendar / Diet / Vitals, trips merged in
 *   ConsoleHoliday  the 'holiday' route in console mode. Holiday is merged
 *                   into Track, so it renders Track on Calendar › Year
 *                   (trips, next trip, Visited). HolidaySection stays for classic.
 *
 * Both receive the SectionProps bag (README.md, "Section props").
 */
import { lazy } from 'react';

export const ConsoleTrack = lazy(() => import('./ConsoleTrack'));
export const ConsoleHoliday = lazy(() => import('./ConsoleHoliday'));
