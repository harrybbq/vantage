/**
 * The saved moment (owner, 2026-11-23, from the "Workout Moments"
 * mockup, option A): what the Finish sheet shows the instant a workout
 * is saved, in the session's colour.
 *
 *   body     the body map, the muscles trained filling in from the top;
 *   muscles  beside it, up to four "Shoulders 13" chips, the set counts
 *            ticking up (side by side so the week stays on a phone's
 *            first screen)
 *   numbers  Time · Volume · Sets · Lifts, counting up
 *   bests    the new bests in gold (real sets only — the summary's list)
 *   week     the week strip, today's box filling; "Week complete" when
 *            this workout was the block's last session
 *   more     one quiet button to the Summary page, where Save as
 *            template and the tracker link still live
 *
 * About two and a half seconds, once, over controls that already work:
 * Done is in the sheet's footer from the first frame. Confetti is rare
 * on purpose — a small gold burst when there is a best, the full thing
 * only for a finished week. Reduced motion: the final state, no
 * movement, no confetti (lifts-tokens.css zeroes the animations; the
 * counters and the confetti check the media query themselves).
 *
 * Nothing here writes to S.
 */
import { useEffect, useMemo, useState } from 'react';
import Icon from '../../../Icon';
import BodyMap from '../BodyMap';
import WeekStrip from '../WeekStrip';
import { PbMark } from '../ui';
import { bodyMap } from '../../../../lib/lifts/bodymap';
import { clock, volumeText } from '../../../../lib/lifts/workout';
import { realSetText } from '../../../../lib/lifts/ui';
import { perGymOf } from '../../../../lib/lifts/lifts';
import { SESSION_COLOURS } from '../../../../lib/lifts/sessionColour';
import { fireBurst } from '../../../../utils/confetti';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const setsText = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const GOLD = ['#E3B341', '#F5D56E', '#FFFFFF'];
// Above the sheet (2000), below the popovers (2600).
const OVER_SHEET = { zIndex: 2550, disableForReducedMotion: true };

/** 0 → 1 over `ms`, starting after `delay`; 1 at once under reduced motion. */
function useProgress(ms, delay) {
  const [k, setK] = useState(() => (reduced() ? 1 : 0));
  useEffect(() => {
    if (reduced()) { setK(1); return undefined; }
    let raf = 0, t0 = 0;
    const step = t => {
      if (!t0) t0 = t;
      const x = Math.min(1, (t - t0) / ms);
      setK(x === 1 ? 1 : 1 - Math.pow(1 - x, 3));
      if (x < 1) raf = requestAnimationFrame(step);
    };
    const timer = setTimeout(() => { raf = requestAnimationFrame(step); }, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [ms, delay]);
  return k;
}

/** A number that counts up to `to`; `fmt` draws it (the last frame is exactly fmt(to)). */
function Count({ to, ms = 700, delay = 0, fmt = String }) {
  const k = useProgress(ms, delay);
  return fmt(k === 1 ? to : Math.round(to * k));
}

export default function SavedMoment({ summary, lifts = [], S = null, today = null, gym, gymName = id => id, gymLabel = null, week = null, onMore = null }) {
  const s = summary.session;
  const planned = summary.setsPlanned || summary.setsDone + summary.setsOpen;
  const chips = useMemo(() => bodyMap(s, lifts).muscles.filter(m => m.done > 0).sort((a, b) => b.done - a.done).slice(0, 4), [s, lifts]);
  const pbs = summary.pbs || [];
  const weekDone = !!(week && week.completed);

  useEffect(() => {
    if (reduced()) return undefined;
    const timers = [];
    if (pbs.length > 0) {
      timers.push(setTimeout(() => fireBurst({ count: 36, spread: 60, startVelocity: 20, scalar: 0.8, origin: { y: 0.6 }, colors: GOLD, ...OVER_SHEET }), 1700));
    }
    if (weekDone) {
      const colors = [...Object.values(SESSION_COLOURS), '#FFFFFF'];
      timers.push(setTimeout(() => fireBurst({ count: 120, spread: 80, origin: { y: 0.5 }, colors, ...OVER_SHEET }), 2300));
      timers.push(setTimeout(() => fireBurst({ count: 50, spread: 50, origin: { x: 0.2, y: 0.6 }, colors, ...OVER_SHEET }), 2450));
      timers.push(setTimeout(() => fireBurst({ count: 50, spread: 50, origin: { x: 0.8, y: 0.6 }, colors, ...OVER_SHEET }), 2600));
    }
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`lw-saved${weekDone ? ' is-weekdone' : ''}`} data-testid="lw-saved">
      <div className="lw-saved-top">
        <BodyMap session={s} list={lifts} bare />
        {chips.length > 0 && (
          <ul className="lw-saved-mus" aria-label="Sets by muscle">
            {chips.map((m, i) => (
              <li key={m.muscle} style={{ '--i': i }}><span>{m.muscle}</span><b className="lf-num"><Count to={m.done} ms={500} delay={450 + i * 220} fmt={setsText} /></b></li>
            ))}
          </ul>
        )}
      </div>
      <dl className="lw-saved-tiles">
        <div><dt>Time</dt><dd><Count to={summary.durationSec} delay={1200} fmt={clock} /></dd></div>
        <div><dt>Volume</dt><dd><Count to={summary.volume} ms={800} delay={1200} fmt={v => volumeText(v).replace(/ kg$/, '')} /><small> kg</small></dd></div>
        <div><dt>Sets</dt><dd><Count to={summary.setsDone} delay={1200} /><small>/{planned}</small></dd></div>
        <div><dt>Lifts</dt><dd><Count to={summary.exercises} delay={1200} /></dd></div>
      </dl>
      {pbs.length > 0 && (
        <section className="lw-fin-pbs lw-saved-pbs" aria-label="New personal bests — real sets">
          <p className="lw-fin-pbh"><PbMark /> {pbs.length} new {pbs.length === 1 ? 'best' : 'bests'}</p>
          <ul>
            {pbs.map((p, i) => (
              <li key={i} data-testid="lw-saved-pb">
                <PbMark />
                <span className="lw-fin-pbtxt">
                  <b>{p.lift.name}</b> · <span className="lf-num">{realSetText(p.entry.weight, p.entry.reps, p.lift)}</span>
                  {p.was && <span className="lw-fin-was"> (was {realSetText(p.was.weight, p.was.reps, p.lift)})</span>}
                </span>
                {perGymOf(p.lift) && gymLabel && <span className="lf-gymchip">{gymLabel}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {weekDone && (
        <p className="lw-saved-weekdone" data-testid="lw-saved-weekdone"><Icon name="check" size={16} strokeWidth={3} /> Week complete · {week.done} of {week.total} sessions</p>
      )}
      {S && today && (
        <WeekStrip S={S} today={today} gym={gym} gymName={gymName} className="lw-saved-week"
                   note={week && week.total && !weekDone ? `${week.done} of ${week.total} sessions done` : null} />
      )}
      {onMore && (
        <button type="button" className="lw-saved-more" onClick={onMore} data-testid="lw-saved-more">
          Save as a template or tick a tracker <Icon name="chevron-right" size={15} />
        </button>
      )}
    </div>
  );
}
