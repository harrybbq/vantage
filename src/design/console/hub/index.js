/**
 * HUB area entry — owned by the HUB agent (src/design/console/README.md).
 *
 * App.jsx mounts this through <DesignSlot>. It is a lazy component, so
 * classic users never download console code. It receives the SectionProps
 * bag (README.md, "Section props"), including `isMobile` — one component
 * serves desktop and the phone stack.
 */
import { lazy } from 'react';

export const ConsoleHub = lazy(() => import('./ConsoleHub'));
