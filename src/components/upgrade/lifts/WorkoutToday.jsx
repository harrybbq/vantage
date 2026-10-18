/**
 * The top of Lifts: today's workout.
 *
 *   · a workout in progress → "Workout in progress · 23 min" with Resume
 *     and Discard (two-step) — what the owner meets after a refresh, a
 *     sleeping phone or closing the app mid-session
 *   · otherwise the suggested workout for today, built from the owner's
 *     own rota and programme (workout.js suggestWorkout): name, N
 *     exercises, ~minutes, one line of why, night shift · 80% load when
 *     it is one, and Start workout. A rest day says so and leaves
 *     "Build my own workout" as the way in.
 *   · this week as a strip: Mon–Sun, the rota session, a dot on days
 *     something was lifted, today ringed.
 */
import { useMemo, useState } from 'react';
import Icon from '../../Icon';
import { ConfirmButton } from '../security/parts';
import { suggestWorkout, weekStrip, minutesText, elapsedSec } from '../../../lib/lifts/workout';

const SHORT = { Push: 'Push', Pull: 'Pull', Legs: 'Legs', Upper: 'Upr', Lower: 'Lwr' };

export default function WorkoutToday({ S, today, now, active, onStart, onBuild, onResume, onDiscard }) {
  const sug = useMemo(() => suggestWorkout(S, today), [S, today]);
  const week = useMemo(() => weekStrip(S, today), [S, today]);
  const [showAll, setShowAll] = useState(false);

  const done = active ? active.exercises.reduce((k, ex) => k + ex.sets.filter(s => s.done).length, 0) : 0;
  const total = active ? active.exercises.reduce((k, ex) => k + ex.sets.length, 0) : 0;
  const list = showAll ? sug.exercises : sug.exercises.slice(0, 4);

  return (
    <div className="wk-today">
      {active ? (
        <section className="wk-card wk-resume" aria-label="Workout in progress" data-testid="wk-resume">
          <span className="wk-live-dot" aria-hidden="true" />
          <div className="wk-resume-main">
            <span className="sec-eyebrow">// Workout in progress</span>
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
            {!sug.restDay && sug.exercises.length > 0 && (
              <span className="wk-sug-meta">{sug.exercises.length} exercises · ~{sug.minutes} min</span>
            )}
          </div>
          <p className="wk-sug-why">{sug.reason}</p>
          {sug.night && <span className="lf-tag is-night wk-night"><Icon name="moon" size={12} /> night shift · 80% load</span>}
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
                <Icon name="play" size={14} /> Start workout
              </button>
            </>
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
              <li key={d.iso} className={`wk-day${d.today ? ' is-today' : ''}${d.trained ? ' is-trained' : ''}${d.session ? '' : ' is-rest'}`}
                  aria-label={`${d.iso}${d.session ? ` · ${d.session}` : ' · rest'}${d.shift === 'night' ? ' · night shift' : ''}${d.trained ? ' · trained' : ''}${d.today ? ' · today' : ''}`}>
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
