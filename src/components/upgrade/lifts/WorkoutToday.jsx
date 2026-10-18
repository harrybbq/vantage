/**
 * The top of Lifts: today's workout.
 *
 *   · a workout in progress → "Workout in progress · 23 min" with Resume
 *     and Discard (two-step) — what the owner meets after a refresh, a
 *     sleeping phone or closing the app mid-session
 *   · otherwise the suggested workout for today. The session is the
 *     PLAN's (lib/lifts/plan.js): the rota, the owner's Rotation edits
 *     (which win) and what was actually trained — so after Push on a Legs
 *     day the card says "Legs — moved from yesterday, you did Push
 *     yesterday". Under it: where the block stands ("3 of 5 this block ·
 *     Legs, Lower to do"), the gym switch (DXC | Greenock — the weights
 *     follow it for machines), night shift · 80% load when it is one,
 *     and Start workout. A rest day says so and leaves "Build my own
 *     workout" as the way in.
 *   · the plan for the next five days: session, shift chip, and a
 *     "moved" mark where the plan has moved a session off the rota.
 *   · this week as a strip: Mon–Sun, the planned session, a dot on days
 *     something was lifted, today ringed.
 * Nothing here writes to the rota; the gym switch writes S.lifts.lastGym.
 */
import { useMemo, useState } from 'react';
import Icon from '../../Icon';
import { ConfirmButton } from '../security/parts';
import { GymSwitch } from './parts';
import { suggestWorkout, weekStrip, planStrip, minutesText, elapsedSec } from '../../../lib/lifts/workout';
import { SEQ } from '../../../lib/rotation/pattern';

const SHORT = { Push: 'Push', Pull: 'Pull', Legs: 'Legs', Upper: 'Upr', Lower: 'Lwr', Extra: 'Any' };

export default function WorkoutToday({ S, today, now, active, onStart, onBuild, onResume, onDiscard, gyms = [], gym = null, onGym, gymName = id => id }) {
  const sug = useMemo(() => suggestWorkout(S, today, { gym }), [S, today, gym]);
  const week = useMemo(() => weekStrip(S, today), [S, today]);
  const next = useMemo(() => planStrip(S, today, 5), [S, today]);
  const [showAll, setShowAll] = useState(false);

  const done = active ? active.exercises.reduce((k, ex) => k + ex.sets.filter(s => s.done).length, 0) : 0;
  const total = active ? active.exercises.reduce((k, ex) => k + ex.sets.length, 0) : 0;
  const list = showAll ? sug.exercises : sug.exercises.slice(0, 4);
  const bp = sug.block;

  return (
    <div className="wk-today">
      {active ? (
        <section className="wk-card wk-resume" aria-label="Workout in progress" data-testid="wk-resume">
          <span className="wk-live-dot" aria-hidden="true" />
          <div className="wk-resume-main">
            <span className="sec-eyebrow">// Workout in progress{active.gym ? ` · ${gymName(active.gym)}` : ''}</span>
            <b className="wk-resume-title">Workout in progress · {minutesText(elapsedSec(active, now))}</b>
            <span className="wk-resume-sub">{active.name} · {active.exercises.length} {active.exercises.length === 1 ? 'exercise' : 'exercises'} · {done} of {total} sets done</span>
          </div>
          <div className="wk-resume-acts">
            <button type="button" className="sec-btn is-primary wk-btn" onClick={onResume}><Icon name="play" size={14} /> Resume</button>
            <ConfirmButton label="Discard" confirmLabel="Discard workout" onConfirm={onDiscard} className="wk-btn" />
          </div>
        </section>
      ) : (
        <section className="wk-card wk-sug" aria-labelledby="wk-sug-name" data-testid="wk-suggested">
          <span className="sec-eyebrow">// Suggested workout for today</span>
          <div className="wk-sug-head">
            <h3 id="wk-sug-name" className="wk-sug-name">{sug.name}</h3>
            {sug.plan && sug.plan.source === 'dynamic' && <span className="lf-tag wk-moved-tag"><Icon name="repeat" size={11} /> moved</span>}
            {!sug.restDay && sug.exercises.length > 0 && (
              <span className="wk-sug-meta">{sug.exercises.length} exercises · ~{sug.minutes} min</span>
            )}
          </div>
          <p className="wk-sug-why" data-testid="wk-reason">{sug.reason}</p>
          {bp && (
            <div className="wk-block" data-testid="wk-block">
              <ol className="wk-block-row" aria-label={bp.label}>
                {SEQ.filter(c => bp.done.includes(c) || bp.owed.includes(c)).map(c => {
                  const isDone = bp.done.includes(c);
                  return (
                    <li key={c} className={`wk-block-s${isDone ? ' is-done' : ''}`} aria-hidden="true">
                      {isDone ? <Icon name="check" size={11} strokeWidth={3} /> : <i />}{c}
                    </li>
                  );
                })}
              </ol>
              <span className="wk-block-lbl">{bp.label}</span>
            </div>
          )}
          {sug.night && <span className="lf-tag is-night wk-night"><Icon name="moon" size={12} /> night shift · 80% load</span>}
          {gyms.length > 1 && (
            <div className="wk-gymrow">
              <span className="wk-gymrow-lbl" id="wk-gym-lbl">Training at</span>
              <GymSwitch gyms={gyms} value={gym} onChange={onGym} label="Gym for this workout" testId="wk-gym" />
            </div>
          )}
          {sug.exercises.length > 0 && (
            <>
              <ol className="wk-sug-list">
                {list.map(x => (
                  <li key={x.liftKey}>
                    <span className="wk-sug-ex">{x.name}{x.optional && <em> · optional</em>}</span>
                    <span className="wk-sug-sets">{x.sets} × {x.reps}{x.weight != null ? ` · ${x.weight} kg` : ''}</span>
                  </li>
                ))}
              </ol>
              {sug.exercises.length > 4 && (
                <button type="button" className="wk-linkbtn" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>
                  {showAll ? 'Show fewer' : `+ ${sug.exercises.length - 4} more`}
                </button>
              )}
              <button type="button" className="sec-btn is-primary wk-btn wk-start" onClick={() => onStart(sug)} data-testid="wk-start">
                <Icon name="play" size={14} /> Start workout{gym && gyms.length > 1 ? ` · ${gymName(gym)}` : ''}
              </button>
            </>
          )}
          {next.length > 0 && (
            <div className="wk-next" data-testid="wk-next">
              <span className="wk-next-h">Plan for the next {next.length} days</span>
              <ol className="wk-next-row">
                {next.map(d => (
                  <li key={d.iso} className={`wk-nd${d.trainingDay ? '' : ' is-rest'}${d.moved ? ' is-moved' : ''}${d.night ? ' is-night' : ''}`}
                      title={d.why}
                      aria-label={`${d.dow} ${d.date}: ${d.trainingDay ? d.session : 'rest'}${d.chip ? `, ${d.chip}` : ''}${d.moved ? ' — moved by the plan' : ''}`}>
                    <span className="wk-nd-dow" aria-hidden="true"><span>{d.dow}</span> <b>{d.date}</b></span>
                    <span className="wk-nd-ses" aria-hidden="true">{d.trainingDay ? d.session : 'Rest'}</span>
                    <span className="wk-nd-foot" aria-hidden="true">
                      {d.chip ? <span className={`wk-nd-chip is-${d.shift}`}>{d.chip}</span> : <span className="wk-nd-chip">Off</span>}
                      {d.moved && <Icon name="repeat" size={11} />}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}
      <div className="wk-side">
        {!active && (
          <button type="button" className="sec-btn wk-btn wk-build" onClick={onBuild} data-testid="wk-build">
            <Icon name="plus" size={14} /> Build my own workout
          </button>
        )}
        <section className="wk-card wk-week" aria-label="This week">
          <span className="sec-eyebrow">// This week</span>
          <ol className="wk-week-row">
            {week.map(d => (
              <li key={d.iso} className={`wk-day${d.today ? ' is-today' : ''}${d.trained ? ' is-trained' : ''}${d.session ? '' : ' is-rest'}${d.moved ? ' is-moved' : ''}`}
                  aria-label={`${d.iso}${d.session ? ` · ${d.session}` : ' · rest'}${d.moved ? ' (moved)' : ''}${d.shift === 'night' ? ' · night shift' : ''}${d.trained ? ' · trained' : ''}${d.today ? ' · today' : ''}`}>
                <span className="wk-day-dow" aria-hidden="true">{d.dow}</span>
                <span className="wk-day-num" aria-hidden="true">{d.date}</span>
                <span className="wk-day-ses" aria-hidden="true">{d.session ? SHORT[d.session] || d.session.slice(0, 4) : 'Rest'}</span>
                <span className="wk-day-dot" aria-hidden="true" />
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
