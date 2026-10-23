/**
 * Swipeable pages, shared by the Finish sheet (Body · Muscles · Summary)
 * and the Lifts home on a phone (Today · Week · History).
 *
 *   <Pager pages={[{ id, label }]} page={i} go={setPage} label="…" testId="…" />
 *     ‹  ● TODAY  ○ WEEK  ○ HISTORY  ›   — the steps are buttons too
 *   <SwipePage pages page dir go testId>{content}</SwipePage>
 *     the current page; a horizontal swipe (touch or pen) moves one page.
 *     `dir` (+1 / -1 / 0) picks the slide-in direction.
 *
 * Only the current page is rendered. A swipe that starts inside something
 * that scrolls sideways (a strip of days, a wide table) is left to that
 * element, so the pages never steal its scroll. touch-action: pan-y keeps
 * vertical scrolling native (ui.css).
 */
import { useRef } from 'react';
import Icon from '../../../Icon';

export const SWIPE_PX = 48;

/** Does `el` (or an ancestor below `stop`) scroll sideways? */
function inSideScroller(el, stop) {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

/** ‹ Step · Step · Step › — a div, not <nav>: index.css styles every nav as the app's sidebar. */
export function Pager({ pages, page, go, label = 'Pages', testId = 'lw-pager', stepPrefix = 'lw-step', arrowPrefix = 'lw-page', className = '' }) {
  const last = pages.length - 1;
  return (
    <div className={`lw-pager${className ? ` ${className}` : ''}`} role="navigation" aria-label={label} data-testid={testId}>
      <button type="button" className="lw-pager-arrow" onClick={() => go(page - 1)} disabled={page === 0}
              aria-label={page > 0 ? `Back: ${pages[page - 1].label}` : 'Back'} data-testid={`${arrowPrefix}-prev`}>
        <Icon name="chevron-left" size={20} />
      </button>
      <ol className="lw-pager-steps">
        {pages.map((p, i) => (
          <li key={p.id}>
            <button type="button" className={i === page ? 'is-on' : ''} aria-current={i === page ? 'step' : undefined}
                    onClick={() => go(i)} data-testid={`${stepPrefix}-${p.id}`}>
              <i aria-hidden="true" />{p.label}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="lw-pager-arrow" onClick={() => go(page + 1)} disabled={page === last}
              aria-label={page < last ? `Next: ${pages[page + 1].label}` : 'Next'} data-testid={`${arrowPrefix}-next`}>
        <Icon name="chevron-right" size={20} />
      </button>
    </div>
  );
}

/** The current page, swipeable. */
export function SwipePage({ pages, page, dir = 0, go, testIdPrefix = 'lw-page', className = '', children }) {
  const touch = useRef(null);
  const root = useRef(null);
  const onPointerDown = e => {
    if (e.pointerType === 'mouse') return;
    touch.current = inSideScroller(e.target, root.current) ? null : { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = e => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) go(page + (dx < 0 ? 1 : -1));
  };
  return (
    <div ref={root} key={page} className={`lw-page${dir > 0 ? ' is-next' : dir < 0 ? ' is-prev' : ''}${className ? ` ${className}` : ''}`}
         data-testid={`${testIdPrefix}-${pages[page].id}`}
         onPointerDown={onPointerDown} onPointerCancel={() => { touch.current = null; }} onPointerUp={onPointerUp}>
      {children}
    </div>
  );
}
