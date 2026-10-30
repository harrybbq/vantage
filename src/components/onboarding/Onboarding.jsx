/**
 * Onboarding overlay — "pick what it's for, then do the first thing".
 * Replaces both earlier tours (classic TutorialOverlay, console
 * ConsoleTutorial) and renders the same in both designs; its colours come
 * from whichever design's tokens are live (see onboarding.css).
 *
 *   pick   "What do you want Vantage for?" — six cards, multi-select.
 *          "Show me everything" saves no picks and closes.
 *   stop   One per pick. Opens the real section, rings the real add
 *          button (`data-ob="<target>"`) if it is on screen, and offers
 *          the pick's first thing. Done is read from the STATE
 *          (onboarding.isDone), never from a button press.
 *
 * The dim behind a stop is paint only: the app underneath stays usable
 * (the ringed button works, the nav works), so nobody is trapped. While
 * one of the app's modals is open (`paused`), or any other aria-modal
 * dialog is up (the console's own sheets, the friend dialogs), the overlay
 * steps aside.
 *
 * Props
 *   S, update        state + additive updater (only onboarding.js updaters)
 *   visible          App: !S.tutorialCompleted
 *   paused           App: a modal is open
 *   ctx              { friends } for the Friends check, when known
 *   onGo(section)    App's navigate (Friends → the right place per device)
 *   onDo(id)         App's dispatcher: open the pick's real add flow.
 *                    May return a promise of shareInvite's result.
 *   onClose()        finished, skipped or "finish later"
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import { PICKS, picksOf, stops as stopsOf, setPicks, finishOverlay } from '../../lib/onboarding/onboarding';
import { prefetchInvite } from '../../lib/onboarding/shareInvite';
import './onboarding.css';

const CARD_W = 360;
const GAP = 14;
const PHONE = 700;

function isShown(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/** Another dialog is open: one of the app's sheets, not ours. */
function otherDialogOpen() {
  if (typeof document === 'undefined') return false;
  return [...document.querySelectorAll('[aria-modal="true"]')].some(el => !el.closest('.ob-root') && isShown(el));
}

/** The visible element for a target (a button can exist once per layout). */
function findTarget(target) {
  if (!target || typeof document === 'undefined') return null;
  return [...document.querySelectorAll(`[data-ob="${target}"]`)].find(isShown) || null;
}

function cardPos(rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (vw < PHONE) {
    // Phone: full width, on the half of the screen away from the target.
    const low = rect.top + rect.height / 2 > vh / 2;
    return low
      ? { left: 12, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }
      : { left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' };
  }
  const clampY = y => Math.max(16, Math.min(y, vh - 300));
  if (rect.right + GAP + CARD_W < vw - 16) return { left: rect.right + GAP, top: clampY(rect.top - 12), width: CARD_W };
  if (rect.left - GAP - CARD_W > 16) return { left: rect.left - GAP - CARD_W, top: clampY(rect.top - 12), width: CARD_W };
  const below = rect.bottom + GAP + 260 < vh;
  return {
    left: Math.max(16, Math.min(rect.left, vw - CARD_W - 16)),
    ...(below ? { top: rect.bottom + GAP } : { top: clampY(rect.top - GAP - 260) }),
    width: CARD_W,
  };
}

export default function Onboarding({ S, update, visible, paused: modalOpen = false, ctx = {}, onGo, onDo, onClose }) {
  const [phase, setPhase] = useState('pick');   // 'pick' | stop index
  const [chosen, setChosen] = useState([]);
  const [doing, setDoing] = useState(false);    // the first thing was started: step aside
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rect, setRect] = useState(null);
  const card = useRef(null);
  const [dialog, setDialog] = useState(false);
  const paused = modalOpen || dialog;

  // Watch for another dialog opening (only while a stop is up: the pick
  // screen is itself the dialog). One check per frame at most.
  const watching = visible && typeof phase === 'number';
  useEffect(() => {
    if (!watching || typeof MutationObserver === 'undefined') { setDialog(false); return undefined; }
    let raf = 0;
    const check = () => { raf = 0; setDialog(otherDialogOpen()); };
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(check); });
    mo.observe(document.body, { childList: true, subtree: true });
    check();
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [watching]);

  // Each time it opens: back to the pick screen, last picks pre-ticked (a replay).
  useEffect(() => {
    if (!visible) return;
    setPhase('pick');
    setChosen(picksOf(S));
    setDoing(false);
    setNote(null);
  // Only on opening; S changes underneath while it is up.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const list = useMemo(() => stopsOf(S, chosen, ctx), [S, chosen, ctx]);
  const i = typeof phase === 'number' ? phase : -1;
  const stop = i >= 0 ? list[i] : null;
  const last = i === list.length - 1;
  const target = stop && !stop.done ? stop.first.target : null;

  // Entering a stop: open its section; get the invite ready to share.
  useEffect(() => {
    if (!visible || !stop) return;
    setDoing(false);
    setNote(null);
    onGo?.(stop.first.section);
    if (stop.first.invite) prefetchInvite();
  // The stop's identity, not its live `done`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, i, stop?.id]);

  // Ring the real button. Measure for a few frames while navigation
  // settles (scrolling it into view once), then on resize/scroll.
  useLayoutEffect(() => {
    if (!visible || paused || !target || doing) { setRect(null); return undefined; }
    let cancelled = false, frames = 0, scrolled = false;
    const measure = () => {
      if (cancelled) return;
      const el = findTarget(target);
      if (!el) { setRect(null); return; }
      let r = el.getBoundingClientRect();
      if (!scrolled && (r.top < 0 || r.bottom > window.innerHeight)) {
        scrolled = true;
        el.scrollIntoView({ block: 'center' });
        r = el.getBoundingClientRect();
      }
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom });
    };
    const tick = () => { measure(); if (++frames < 24 && !cancelled) requestAnimationFrame(tick); };
    tick();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { cancelled = true; window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [visible, paused, target, doing]);

  const close = useCallback(() => {
    update(prev => finishOverlay(prev));
    onGo?.('hub');
    onClose?.();
  }, [update, onGo, onClose]);

  useEffect(() => {
    if (!visible) return undefined;
    const k = e => { if (e.key === 'Escape' && !paused) close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [visible, paused, close]);

  useEffect(() => {
    if (visible && !paused) card.current?.focus({ preventScroll: true });
  }, [visible, paused, phase, stop?.done]);

  if (!visible || paused) return null;

  // ── Pick ──
  if (phase === 'pick') {
    const toggle = id => setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));
    const n = chosen.length;
    const name = (S?.profile?.name || '').trim().split(/\s+/)[0];
    return (
      <div className="ob-root ob-pick-root" role="dialog" aria-modal="true" aria-labelledby="ob-pick-title" data-testid="onboarding">
        <div className="ob-scrim" aria-hidden="true" />
        <div className="ob-pick" ref={card} tabIndex={-1}>
          <div className="ob-pick-head">
            <p className="ob-kicker">{name ? `// Welcome, ${name}` : '// Welcome'}</p>
            <h1 id="ob-pick-title" className="ob-pick-title">What do you want Vantage for?</h1>
            <p className="ob-pick-sub">Pick one or more and we’ll set up the first thing for each. Everything else is still a tap away.</p>
          </div>
          <div className="ob-pick-grid">
            {PICKS.map(p => {
              const on = chosen.includes(p.id);
              return (
                <button key={p.id} type="button" className={`ob-pick-card${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(p.id)}>
                  <span className="ob-pick-card-top">
                    <Icon name={p.icon} size={22} strokeWidth={1.75} />
                    {on && <Icon name="check" size={20} strokeWidth={2.25} className="ob-pick-tick" />}
                  </span>
                  <span className="ob-pick-card-name">{p.label}</span>
                  <span className="ob-pick-card-line">{p.line}</span>
                </button>
              );
            })}
          </div>
          <div className="ob-pick-foot">
            <p className="ob-pick-note">Change your picks any time: Settings › Replay the welcome.</p>
            <button
              type="button" className="ob-btn ob-btn-ghost"
              onClick={() => { update(prev => finishOverlay(setPicks(prev, []))); onGo?.('hub'); onClose?.(); }}
            >Show me everything</button>
            <button
              type="button" className="ob-btn ob-btn-primary" disabled={n === 0}
              onClick={() => { update(prev => setPicks(prev, chosen)); setPhase(0); }}
            >{n === 0 ? 'Pick at least one' : `Continue · ${n} picked`}</button>
          </div>
        </div>
      </div>
    );
  }

  if (!stop) return null;
  const p = stop.first;
  const next = () => (last ? close() : setPhase(i + 1));
  const step = <span className="ob-step">Step <span className="ob-num">{i + 1}</span> of <span className="ob-num">{list.length}</span> · {stop.label}</span>;

  const run = async () => {
    setNote(null);
    setDoing(true);
    const r = onDo?.(stop.id);
    if (r && typeof r.then === 'function') {
      setBusy(true);
      try {
        const res = await r;
        if (res && res.ok) setNote(res.how === 'copied' ? 'Link copied. Paste it to a friend.' : null);
        else if (res && res.reason !== 'cancelled') { setNote(res.message || 'That didn’t work. Try again.'); setDoing(false); }
        else setDoing(false);
      } finally { setBusy(false); }
    }
  };

  // ── Doing: the first thing was started and isn't done yet — a slim bar
  // so the real screen is usable. Done replaces it with the full card.
  if (doing && !stop.done) {
    return (
      <div className="ob-root" data-testid="onboarding">
        <div className="ob-bar" ref={card} tabIndex={-1} role="status">
          <span className="ob-bar-icon" aria-hidden="true"><Icon name={stop.icon} size={18} strokeWidth={1.75} /></span>
          <span className="ob-bar-text">
            <span className="ob-bar-title">{p.check}</span>
            {note && <span className="ob-bar-note">{note}</span>}
          </span>
          {!p.modal && !p.invite ? null : (
            <button type="button" className="ob-btn ob-btn-ghost ob-btn-sm" onClick={run} disabled={busy}>Again</button>
          )}
          <button type="button" className="ob-btn ob-btn-ghost ob-btn-sm" onClick={next}>{last ? 'Finish' : 'Later'}</button>
        </div>
      </div>
    );
  }

  const pointing = !!rect;
  const pos = pointing ? cardPos(rect) : null;
  return (
    <div className="ob-root" data-testid="onboarding">
      {pointing
        ? <div className="ob-ring" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} aria-hidden="true" />
        : <div className="ob-scrim ob-scrim-paint" aria-hidden="true" />}
      <div
        ref={card} tabIndex={-1}
        className={`ob-card${pointing ? ' is-pointing' : ' is-centred'}${stop.done ? ' is-done' : ''}`}
        style={pos || undefined}
        role="dialog" aria-labelledby="ob-card-title" aria-live="polite"
      >
        <div className="ob-card-top">
          {step}
          {!last && <button type="button" className="ob-link" onClick={close}>Finish later</button>}
        </div>
        {stop.done ? (
          <>
            <h2 id="ob-card-title" className="ob-card-title">
              <span className="ob-done-mark" aria-hidden="true"><Icon name="check" size={16} strokeWidth={2.5} /></span>
              {p.doneTitle}
            </h2>
            <p className="ob-card-body">{p.doneBody}</p>
            <div className="ob-card-actions">
              <button type="button" className="ob-btn ob-btn-primary" onClick={next}>{last ? 'Done' : 'Next'}</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="ob-card-title" className="ob-card-title">{p.title}</h2>
            <p className="ob-card-body">{p.body}</p>
            {note && <p className="ob-card-note" role="alert">{note}</p>}
            <div className="ob-card-actions">
              <button type="button" className="ob-btn ob-btn-ghost" onClick={next}>{last ? 'Finish' : 'Later'}</button>
              <button type="button" className="ob-btn ob-btn-primary" onClick={run} disabled={busy}>{busy ? 'One moment…' : p.cta}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
