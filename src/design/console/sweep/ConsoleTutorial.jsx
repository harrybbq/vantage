/**
 * Console tour. Same props as classic TutorialOverlay
 * ({ visible, theme, onNavigate, onClose }); `theme` is accepted and
 * ignored, because the console has one voice. Optional `S`: when the
 * shell passes it, the last stop ticks what is already done.
 *
 * Six screens: a welcome, four stops that point at the real nav (a ring
 * round the target, the card beside it on desktop and clear of it on a
 * phone), and "Where to start". A target that isn't on screen degrades
 * to a centred card, so the tour never gets stuck. Like classic, it
 * persists nothing itself: finishing or skipping calls onClose(), which
 * App turns into S.tutorialCompleted.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../../components/Icon';
import { Button } from '../ui';
import { TOUR_STEPS, START_ITEMS } from './tourSteps';

const CARD_W = 340;
const GAP = 14;

function isShown(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/** First on-screen element for a step's target list. */
function findTarget(targets) {
  for (const t of targets || []) {
    let el = null;
    if (t.startsWith('tab:')) {
      const label = t.slice(4).toLowerCase();
      el = [...document.querySelectorAll('.m-tabs button, [role="tablist"] button')]
        .find(b => (b.textContent || '').trim().toLowerCase() === label) || null;
    } else {
      el = [...document.querySelectorAll(t)].find(isShown) || null;
    }
    if (isShown(el)) {
      const r = el.getBoundingClientRect();
      // A target that fills most of the screen isn't worth a ring.
      if (r.width * r.height < window.innerWidth * window.innerHeight * 0.6) return r;
    }
  }
  return null;
}

function cardPos(rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (vw < 700) {
    // Phone: full-width card, on the side of the screen away from the target.
    const low = rect.top + rect.height / 2 > vh / 2;
    return low ? { left: 16, right: 16, top: 'calc(env(safe-area-inset-top) + 72px)' } : { left: 16, right: 16, bottom: 'calc(env(safe-area-inset-bottom) + 88px)' };
  }
  const clampY = y => Math.max(16, Math.min(y, vh - 280));
  if (rect.right + GAP + CARD_W < vw - 16) return { left: rect.right + GAP, top: clampY(rect.top - 12), width: CARD_W };
  if (rect.left - GAP - CARD_W > 16) return { left: rect.left - GAP - CARD_W, top: clampY(rect.top - 12), width: CARD_W };
  return { left: Math.max(16, Math.min(rect.left, vw - CARD_W - 16)), top: clampY(rect.bottom + GAP), width: CARD_W };
}

export default function ConsoleTutorial({ visible, onNavigate, onClose, S = null }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const card = useRef(null);
  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;

  useEffect(() => { if (visible) setI(0); }, [visible]);

  useEffect(() => {
    if (visible && step?.navTo && typeof onNavigate === 'function') onNavigate(step.navTo);
  }, [visible, step, onNavigate]);

  // Measure for a few frames (navigation may still be settling), then on resize/scroll.
  useLayoutEffect(() => {
    if (!visible || !step) return undefined;
    let cancelled = false, frames = 0;
    const measure = () => { if (!cancelled) setRect(findTarget(step.targets)); };
    const tick = () => { measure(); if (++frames < 20 && !cancelled) requestAnimationFrame(tick); };
    tick();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { cancelled = true; window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [visible, step]);

  useEffect(() => {
    if (!visible) return undefined;
    const k = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [visible, onClose]);

  useEffect(() => { if (visible) card.current?.focus({ preventScroll: true }); }, [visible, i]);

  const go = useCallback(d => setI(n => Math.max(0, Math.min(TOUR_STEPS.length - 1, n + d))), []);

  if (!visible || !step) return null;
  const pointing = !!rect && step.targets.length > 0;
  const pos = pointing ? cardPos(rect) : null;
  const finishTo = id => { onClose?.(); if (id) onNavigate?.(id); };

  return (
    <div className="cx-sweep-tour" data-testid="cx-tour">
      {pointing
        ? <div className="cx-sweep-tour-ring" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} aria-hidden="true" />
        : <div className="cx-sweep-tour-scrim" aria-hidden="true" />}
      <section
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cx-tour-title"
        className={`cx-sweep-tour-card${pointing ? ' is-pointing' : ' is-centred'}`}
        style={pos || undefined}
      >
        <div className="cx-sweep-tour-top">
          <span className="cx-t12 cx-muted">Step <span className="cx-num">{i + 1}</span> of <span className="cx-num">{TOUR_STEPS.length}</span></span>
          {!last && <button type="button" className="cx-sweep-tour-skip" onClick={onClose}>Skip</button>}
        </div>
        <h2 id="cx-tour-title" className="cx-sweep-tour-title">{step.title}</h2>
        <p className="cx-t15 cx-mid">{step.body}</p>

        {step.checklist && (
          <ul className="cx-sweep-start">
            {START_ITEMS.map(item => {
              const done = S ? !!item.done(S) : item.id === 'account';
              return (
                <li key={item.id}>
                  {item.go && !done ? (
                    <button type="button" className="cx-sweep-start-row" onClick={() => finishTo(item.go)}>
                      <span className="cx-check" aria-hidden="true" />
                      <span className="cx-sweep-start-label">{item.label}</span>
                      <Icon name="chevron-right" size={16} strokeWidth={1.75} />
                    </button>
                  ) : (
                    <div className={`cx-sweep-start-row${done ? ' is-done' : ''}`}>
                      <span className="cx-check" aria-checked={done ? 'true' : 'false'} aria-hidden="true">
                        <Icon name="check" size={14} strokeWidth={2.5} />
                      </span>
                      <span className="cx-sweep-start-label">{item.label}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="cx-sweep-tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((s, j) => <i key={s.id} className={j === i ? 'is-on' : ''} />)}
        </div>
        <div className="cx-sweep-tour-foot">
          {i > 0 && <Button variant="ghost" onClick={() => go(-1)}>Back</Button>}
          <span className="cx-sweep-sp" />
          <Button variant="primary" onClick={last ? onClose : () => go(1)} data-testid="cx-tut-next">
            {last ? 'Done' : i === 0 ? 'Show me' : 'Next'}
          </Button>
        </div>
      </section>
    </div>
  );
}
