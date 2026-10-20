/**
 * HUB area entry — owned by the HUB agent (src/design/console/README.md).
 *
 * App.jsx mounts this through <DesignSlot>. While it is null the classic
 * hub renders, in console mode too. Replace it with a lazy component:
 *
 *   import { lazy } from 'react';
 *   export const ConsoleHub = lazy(() => import('./ConsoleHub'));
 *
 * It receives the SectionProps bag (README.md, "Section props"), which
 * includes `isMobile` — one component serves desktop and the mobile stack.
 */
export const ConsoleHub = null;
