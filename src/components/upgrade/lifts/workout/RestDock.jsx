/**
 * The rest timer (brief §3.5.5, owner decisions in COMMON).
 *
 * Docked bar, 56 px, at the bottom of the screen (above the number pad
 * when it's open — WorkoutLive stacks both in one dock):
 *   ◔ 1:12   of 1:30 · NEXT SET 3 · 82.5 × 8          [−15] [+15] [Skip]
 * a 20 px ring, 26 px mono time, a 12 px mono line truncating from the
 * right, three 48 × 44 buttons, and a 4 px accent progress line on top.
 * Tap the bar → a NON-modal sheet (no scrim, the table stays live): 64 px
 * time, presets 60 / 90 / 120 / 180, −15 / +15 / Skip at 52 px, and
 * "Use for this exercise" (writes lift.restSec).
 *
 * States: running · the last 10 s (accent tint) · over — counts UP as
 * "+0:12" in --lf-mid, never red, never auto-dismissed, the line full,
 * "rest over · next set when ready" · skipped (slides away in 200 ms,
 * instantly under reduced motion).
 *
 * Time is computed from the stored end time (S.lifts.active.rest.endsAt)
 * on requestAnimationFrame and on visibilitychange — never a counter, so
 * a sleeping phone or a background tab can't drift it. It re-renders only
 * when the shown second changes. While resting: Screen Wake Lock; at the
 * end (seen live, not on a reload that's already past it) a vibration
 * where supported and, if switched on, a short tone. The phone can't be
 * alerted while locked — a one-time dismissible hint says so.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../../Icon';
import { Sheet, Segmented, Button } from '../ui';
import { restState, clock } from '../../../../lib/lifts/workout';
import { REST_PRESETS } from '../../../../lib/lifts/store';
import { useWakeLock, buzz, playTone } from './feedback';

/** The rest as drawn now — re-rendering only when the visible numbers change. */
export function useRestClock(active) {
  const endsAt = active && active.rest ? active.rest.endsAt : null;
  const total = active && active.rest ? active.rest.total : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt == null) return undefined;
    let raf = 0;
    let key = '';
    const sig = t => { const r = restState(active, t); return `${r.phase}|${r.left}|${r.over}`; };
    const tick = () => {
      const t = Date.now();
      const k = sig(t);
      if (k !== key) { key = k; setNow(t); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const vis = () => { if (document.visibilityState === 'visible') { const t = Date.now(); key = sig(t); setNow(t); } };
    document.addEventListener('visibilitychange', vis);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', vis); };
  // active is read through endsAt/total — the only fields the timer depends on
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, total]);
  return restState(active, now);
}

const Ring = ({ pct }) => {
  const r = 8, c = 2 * Math.PI * r;
  return (
    <svg className="lw-ring" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r={r} className="lw-ring-track" />
      <circle cx="10" cy="10" r={r} className="lw-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, pct)))} transform="rotate(-90 10 10)" />
    </svg>
  );
};

/**
 * <RestDock active nextText expanded onExpand(bool) onAdjust(sec) onSkip onPreset(sec)
 *           useForExercise={bool|null} onUseForExercise(bool) tone vibrate hint onHintSeen />
 * useForExercise null → the checkbox is disabled (a lift not created yet).
 */
export default function RestDock({
  active, nextText = '', expanded = false, onExpand, onAdjust, onSkip, onPreset, useForExercise = null, onUseForExercise,
  tone = false, vibrate = true, hint = false, onHintSeen,
}) {
  const r = useRestClock(active);
  const resting = r.phase !== 'idle';
  useWakeLock(resting);

  // The end, seen live: buzz (+ tone). A reload that is already past it stays quiet.
  const was = useRef(null);
  useEffect(() => {
    const prev = was.current;
    was.current = r.phase;
    if (r.phase === 'over' && (prev === 'running' || prev === 'ending')) {
      if (vibrate) buzz();
      if (tone) playTone();
    }
  }, [r.phase, tone, vibrate]);

  if (!resting) return null;
  const over = r.phase === 'over';
  const time = over ? `+${clock(r.over)}` : clock(r.left);
  const label = over ? 'rest over · next set when ready' : `of ${clock(r.total)}${nextText ? ` · ${nextText}` : ''}`;
  const aria = over ? `Rest over ${r.over} seconds ago` : `Rest, ${r.left} seconds left of ${r.total}`;

  if (expanded) {
    return (
      <Sheet title="Rest" eyebrow="// Rest timer" modal={false} onClose={() => onExpand(false)} testId="lw-rest-sheet" className="lw-rest-sheet">
        <div className={`lw-rest-x is-${r.phase}`}>
          <p className="lw-rest-xtime" role="timer" aria-label={aria} data-testid="lw-rest-xtime">{time}</p>
          <p className="lw-rest-xlbl">{label}</p>
          <Segmented label="Rest length" full options={REST_PRESETS.map(v => ({ value: v, label: v < 120 ? `${v} s` : `${v / 60} min` }))}
                     value={REST_PRESETS.includes(r.total) ? r.total : null} onChange={onPreset} testId="lw-rest-presets" />
          <div className="lw-rest-xbtns">
            <Button variant="secondary" size="lg" onClick={() => onAdjust(-15)} disabled={over} aria-label="15 seconds less">−15</Button>
            <Button variant="secondary" size="lg" onClick={() => onAdjust(15)} aria-label="15 seconds more">+15</Button>
            <Button variant="secondary" size="lg" onClick={onSkip}>{over ? 'Done' : 'Skip'}</Button>
          </div>
          <label className={`lw-check${useForExercise == null ? ' is-disabled' : ''}`}>
            <input type="checkbox" checked={!!useForExercise} disabled={useForExercise == null}
                   onChange={e => onUseForExercise(e.target.checked)} data-testid="lw-rest-use" />
            <span className="lw-check-box" aria-hidden="true"><Icon name="check" size={14} strokeWidth={3} /></span>
            <span className="lw-check-txt">Use {clock(r.total)} for this exercise
              {useForExercise == null && <small>Available once its first set is ticked.</small>}
            </span>
          </label>
        </div>
      </Sheet>
    );
  }

  return (
    <>
      {hint && (
        <div className="lw-rest-hint" role="note" data-testid="lw-rest-hint">
          <span>The timer can&apos;t alert you while the phone is locked.</span>
          <button type="button" className="lf-iconbtn" onClick={onHintSeen} aria-label="Got it — don't show again"><Icon name="x" size={16} /></button>
        </div>
      )}
      <div className={`lw-rest is-${r.phase}`} data-testid="lw-rest">
        <div className="lw-rest-line" aria-hidden="true"><span style={{ width: `${Math.round(r.pct * 1000) / 10}%` }} /></div>
        <button type="button" className="lw-rest-main" onClick={() => onExpand(true)} aria-label={`${aria}. Open the rest timer`} data-testid="lw-rest-open">
          <Ring pct={r.pct} />
          <span className="lw-rest-time" role="timer" data-testid="lw-rest-time">{time}</span>
          <span className="lw-rest-lbl">{label}</span>
        </button>
        <div className="lw-rest-btns">
          {!over && <button type="button" className="lw-rest-btn" onClick={() => onAdjust(-15)} aria-label="15 seconds less" data-testid="lw-rest-minus">−15</button>}
          <button type="button" className="lw-rest-btn" onClick={() => onAdjust(15)} aria-label="15 seconds more" data-testid="lw-rest-plus">+15</button>
          <button type="button" className="lw-rest-btn" onClick={onSkip} data-testid="lw-rest-skip">{over ? 'Done' : 'Skip'}</button>
        </div>
      </div>
    </>
  );
}
