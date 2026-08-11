/**
 * Hub drawer — the day's numbers, swiped in from the left edge.
 *
 * The mobile hub used to stack five sections above the first widget:
 * greeting, ratings, coins + streak, trackers, AI coach. That meant the
 * thing the hub is *for* started below the fold. Everything except the
 * greeting moves here, and the hub becomes greeting + widgets.
 *
 * This is a working surface, not a summary — trackers are tickable
 * without closing it. Burying a daily tap behind a gesture would only be
 * worth it if the tap still worked when you got there.
 *
 * Two ways in, deliberately: the edge swipe is fast once you know it,
 * and the avatar in the header means the gesture is never the only way.
 * The swipe is gated to the left EDGE because widget cards already claim
 * horizontal drags past 8px for their delete reveal — a full-width
 * swipe would fight every widget on the screen.
 */
import { useEffect, useRef } from 'react';
import RatingsPanel from '../RatingsPanel';

/** How far in from the left edge a drag may start and still open it. */
export const EDGE_PX = 20;
/** Horizontal travel before an edge drag counts as "opening". */
export const OPEN_THRESHOLD = 44;

export default function HubDrawer({
  open, onClose, S, update, trackers, onToggleTracker, onNavigate, briefLine, hasPro,
}) {
  const panelRef = useRef(null);

  // Escape closes, and the body stops scrolling underneath — a drawer
  // over a page that still scrolls reads as broken.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const name = (S.profile && S.profile.name) || 'You';
  const coins = S.coins || 0;
  const streak = S.currentStreak || 0;

  return (
    <>
      <div className={'m-hubdrawer-scrim' + (open ? ' is-open' : '')}
           onClick={onClose} aria-hidden={!open} />
      <aside
        ref={panelRef}
        className={'m-hubdrawer' + (open ? ' is-open' : '')}
        role="dialog"
        aria-modal={open ? 'true' : undefined}
        aria-label="Your day"
        aria-hidden={!open}
        // inert would be better but is not universal yet; hiding from the
        // tab order stops a closed drawer swallowing focus.
        {...(open ? {} : { tabIndex: -1 })}
      >
        <div className="m-hubdrawer-head">
          {/* Your own photo, so tapping it goes where a photo of you
              should go: Settings → Account, which is where Profile
              lives now. It was decorative before — the one thing on
              this header that looked tappable and wasn't. */}
          <button type="button" className="m-hubdrawer-av"
                  onClick={() => { onClose(); onNavigate?.('profile'); }}
                  aria-label="Your profile">
            {(S.profile && S.profile.photo)
              ? <img src={S.profile.photo} alt="" />
              : <span>{name.slice(0, 1).toUpperCase()}</span>}
          </button>
          <div className="m-hubdrawer-who">
            <div className="m-hubdrawer-name">{name}</div>
            <button type="button" className="m-hubdrawer-link"
                    onClick={() => { onClose(); onNavigate?.('settings'); }}>
              Profile &amp; settings
            </button>
          </div>
          <button type="button" className="m-hubdrawer-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="m-hubdrawer-body">
          <RatingsPanel S={S} update={update} />

          <div className="m-hubdrawer-stats">
            <div className="m-hubdrawer-stat">
              <div className="m-hubdrawer-stat-v" style={{ color: 'var(--coin, #d4a017)' }}>
                {coins.toLocaleString()}
              </div>
              <div className="m-hubdrawer-stat-l">Coins</div>
            </div>
            <div className="m-hubdrawer-stat">
              <div className="m-hubdrawer-stat-v" style={{ color: 'var(--em)' }}>{streak}</div>
              <div className="m-hubdrawer-stat-l">Day streak</div>
            </div>
          </div>

          <div className="m-hubdrawer-sec">
            <div className="m-hubdrawer-sec-h">// Today&apos;s trackers</div>
            {!trackers.length && (
              <button type="button" className="m-hubdrawer-empty"
                      onClick={() => { onClose(); onNavigate?.('track'); }}>
                No trackers yet — add one in Track.
              </button>
            )}
            {trackers.map(t => (
              <button key={t.id} type="button"
                      className={'m-hubdrawer-track' + (t.done ? ' is-done' : '')}
                      onClick={() => onToggleTracker(t)}>
                <span className={'m-hubdrawer-tick' + (t.done ? ' is-done' : '')} aria-hidden="true">
                  {t.done ? '✓' : ''}
                </span>
                <span className="m-hubdrawer-track-name">{t.name}</span>
                {t.target ? <span className="m-hubdrawer-track-t">{t.value ?? 0}/{t.target}</span> : null}
              </button>
            ))}
          </div>

          <div className="m-hubdrawer-sec">
            <div className="m-hubdrawer-sec-h">
              // AI Coach {hasPro && <span className="m-hubdrawer-pro">PRO</span>}
            </div>
            <button type="button" className="m-hubdrawer-coach"
                    onClick={() => { onClose(); onNavigate?.('track'); }}>
              {briefLine || (hasPro
                ? 'Today&rsquo;s brief hasn&rsquo;t loaded yet.'
                : 'Pro unlocks daily briefs — patterns, focus areas, micro-actions.')}
            </button>
          </div>
        </div>

        {/* An Achievements / Leaderboard footer sat here. Both are rows
            in the More sheet, so it was a second door to each pinned
            across the bottom of a drawer that is about today's numbers —
            and it cost the trackers above it the last of the height. */}
      </aside>
    </>
  );
}
