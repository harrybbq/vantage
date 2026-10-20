/**
 * <DesignSlot use={ConsoleThing} props={…}>{classic element}</DesignSlot>
 *
 * The mount point that lets a screen agent swap in a console screen
 * WITHOUT editing App.jsx or the classic component:
 *   - design 'console' AND `use` is a component → renders <use {...props}/>
 *     inside its own Suspense (console screens should be lazy()).
 *   - otherwise → renders the classic children, untouched.
 * So a slot whose console component is still null shows classic even in
 * console mode, and the redesign can land screen by screen.
 *
 * `use` comes from an area entry module (src/design/console/<area>/index.js),
 * owned by that area's agent. App.jsx only ever names the slot.
 *
 * Hooks-safe by construction: useDesign() is always called, and switching
 * design swaps the whole subtree (remount), never a component's hook list.
 */
import { Suspense } from 'react';
import { useDesign } from '../hooks/useDesign';

export default function DesignSlot({ use: Console = null, props = null, fallback = null, children = null }) {
  const { isConsole } = useDesign();
  if (isConsole && Console) {
    return (
      <Suspense fallback={fallback}>
        <Console {...(props || {})} />
      </Suspense>
    );
  }
  return children;
}
