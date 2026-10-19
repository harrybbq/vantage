/**
 * TODAY — the top of Lifts (brief §3.3; A7, A3, A17).
 *
 * The suggested card reads in one order: WHAT (the session) → WHY (one
 * reason line) → HOW HARD (☾ night · 80 %) → WHERE (the gym switch) →
 * the block as pips (▮▮▮▯▯ 3 of 5 · P P L U L) → the preview (4 + "+ N
 * more" on a phone, all on desktop; the gym tag on machine rows; night
 * targets ×0.8 with ☾) → "Stretch after" (folded) → ONE primary
 * "▶ Start Push · DXC" → two secondaries [+ Build my own] [⚡ Quick log].
 *
 *   in progress   a Resume banner ABOVE the card (Discard is in its ⋯, with
 *                 the two-step confirm); the card stays, dimmed, and Start
 *                 reads "In progress"
 *   rest day      "Rest day — next: Pull Tue" + Build my own + Quick log
 *   no programme  outside the rota pattern: "No programme yet" + Build my own
 *   night         after a night shift's midnight `nightOf` makes the eyebrow
 *                 "Counts for Tuesday's night shift" (lib/rotation/trainingDay.js)
 *
 * The session is the PLAN's (lib/lifts/plan.js — the rota, the owner's
 * Rotation edits, what was trained); nothing here writes to the rota. The
 * gym switch writes S.lifts.lastGym. Build my own calls `onBuild` (LiftsTab
 * opens the new-workout sheet; it never starts a clock by itself).
 *
 * Desktop (≥ 1024 px): cols 1–7 the card, cols 8–12 the week strip, the
 * stretches (expanded) and "Last session".
 */
import { useMemo, useState } from 'react';
import Icon from '../../Icon';
import { Button, IconButton, Sheet, NightChip, GymSwitch, useInputMode } from './ui';
import WeekStrip from './WeekStrip';
import { suggestWorkout, minutesText, elapsedSec } from '../../../lib/lifts/workout';
import { blockPips, nextTraining, lastSessionSummary, dowOf } from '../../../lib/lifts/home';
import { perGymOf, perGymByName, fmtKg } from '../../../lib/lifts/lifts';
import { STRETCH_GOAL, stretchesFor } from '../../../data/trainingProgramme';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dowLong = iso => { const [y, m, d] = iso.split('-').map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const dayTitle = iso => { const [, m, d] = iso.split('-').map(Number); return `${dowOf(iso)} ${d} ${MON[m - 1]}`; };

export default function WorkoutToday({
  S, today, nightOf = null, now, active, list = [], onStart, onBuild, onResume, onDiscard, onQuickLog,
  gyms = [], gym = null, onGym, gymName = id => id, canQuickLog = true,
}) {
  const { layout } = useInputMode();
  const desktop = layout === 'desktop';
  const sug = useMemo(() => suggestWorkout(S, today, { gym }), [S, today, gym]);
  const pips = useMemo(() => blockPips(S, today), [S, today]);
  const next = useMemo(() => (sug.restDay ? nextTraining(S, today) : null), [S, today, sug.restDay]);
  const last = useMemo(() => (desktop ? lastSessionSummary(S, { today }) : null), [S, today, desktop]);
  const stretches = stretchesFor(sug.restDay ? 'Rest' : sug.rotaSession);
  const [all, setAll] = useState(false);

  const noProgramme = !sug.label && !sug.plan;
  const training = sug.exercises.length > 0;
  const shiftWord = sug.label ? sug.label.split(' · ')[0] : '';
  const eyebrow = nightOf ? `// Counts for ${dowLong(nightOf)}'s night shift` : `// Today · ${dayTitle(today)}${shiftWord ? ` · ${shiftWord}` : ''}`;
  // The eyebrow already carries "Night 1": the reason line starts at the why.
  const reason = shiftWord && sug.reason.startsWith(`${shiftWord} · `) ? sug.reason.slice(shiftWord.length + 3) : sug.reason;
  const title = noProgramme ? 'No programme yet' : sug.restDay && !sug.plan?.done?.length ? 'Rest day' : sug.name;
  const restLine = sug.restDay && next ? `Rest day — next: ${next.session} ${next.word}` : null;
  const showGym = gyms.length > 1;
  const preview = desktop || all ? sug.exercises : sug.exercises.slice(0, 4);
  const more = sug.exercises.length - preview.length;
  const gymLbl = gym ? gymName(gym) : '';

  const liftOf = x => (x.liftId ? list.find(l => l.id === x.liftId) : null);
  const isMachine = x => { const l = liftOf(x); return l ? perGymOf(l) : perGymByName(x.name); };

  const card = (
    <section className={`lh-card lh-sug${active ? ' is-dimmed' : ''}`} aria-labelledby="lh-sug-name" data-testid="wk-suggested">
      <p className="lf-eyebrow" data-testid="wk-eyebrow">{eyebrow}</p>
      <div className="lh-sug-head">
        <h3 id="lh-sug-name" className="lh-sug-name">{title}</h3>
        {training && <span className="lh-sug-meta lf-num">{sug.exercises.length} ex · ~{sug.minutes} min</span>}
      </div>
      <p className="lh-sug-why" data-testid="wk-reason">
        {sug.plan && sug.plan.source === 'dynamic' && <span className="lh-moved" title="Moved by the plan"><Icon name="repeat" size={12} /> </span>}
        {noProgramme ? 'Today sits outside your rota pattern. Build your own workout, or log a set.' : restLine || reason}
      </p>
      {(sug.night || (showGym && training)) && (
        <div className="lh-chiprow">
          {sug.night && <NightChip className="lh-nightchip" />}
          {showGym && training && <GymSwitch gyms={gyms} value={gym} onChange={onGym} label="Gym for this workout" testId="wk-gym" />}
        </div>
      )}
      {pips && pips.pips.length > 0 && <BlockPips bp={pips} />}
      {training && (
        <>
          <ol className="lh-preview" data-testid="wk-preview">
            {preview.map(x => {
              const w = x.weight != null ? `${sug.night ? '☾ ' : ''}${fmtKg(x.weight)} kg` : null;
              return (
                <li key={x.liftKey}>
                  <span className="lh-preview-n">{x.name}{x.optional && <em> · optional</em>}</span>
                  {isMachine(x) && gymLbl && <span className="lh-gymtag">{gymLbl}</span>}
                  <span className="lh-preview-t lf-num">
                    {x.sets} × {x.reps}
                    {w && <span className={`lh-preview-w${sug.night ? ' is-night' : ''}`}>{w}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {more > 0 && (
            <button type="button" className="lh-rowbtn" onClick={() => setAll(true)} data-testid="wk-more">+ {more} more</button>
          )}
          {all && !desktop && sug.exercises.length > 4 && (
            <button type="button" className="lh-rowbtn" onClick={() => setAll(false)}>Show fewer</button>
          )}
        </>
      )}
      {!desktop && <Stretches stretches={stretches} rest={sug.restDay} folded />}
      <div className="lh-sug-acts">
        {training && (
          active
            ? <Button variant="secondary" size="lg" block className="lh-start" disabled data-testid="wk-start"><span className="lf-live-dot" aria-hidden="true" /> In progress</Button>
            : <Button variant="primary" size="lg" block icon="play" className="lh-start" onClick={() => onStart(sug)} data-testid="wk-start">
                Start {sug.name}{gymLbl && showGym ? ` · ${gymLbl}` : ''}
              </Button>
        )}
        <div className="lh-sec2">
          <Button variant="secondary" icon="plus" onClick={onBuild} disabled={!!active} data-testid="wk-build">Build my own</Button>
          <Button variant="secondary" icon="zap" onClick={onQuickLog} disabled={!canQuickLog} data-testid="wk-quicklog">Quick log<span className="lh-wide"> a set</span></Button>
        </div>
      </div>
    </section>
  );

  return (
    <div className="lh-today">
      <div className="lh-today-main">
        {active && <ResumeBanner active={active} now={now} gymName={gymName} onResume={onResume} onDiscard={onDiscard} />}
        {card}
      </div>
      <div className="lh-today-side">
        <WeekStrip S={S} today={today} gymName={gymName} className="lh-card" />
        {desktop && <Stretches stretches={stretches} rest={sug.restDay} />}
        {desktop && last && <LastSession last={last} gymName={gymName} />}
      </div>
    </div>
  );
}

/** BLOCK ▮▮▮▯▯ 3 of 5 · P P L U L — done accent, today outlined, missed muted with a carry arrow. */
function BlockPips({ bp }) {
  const words = { done: 'done', today: 'today', missed: 'missed, carried forward', todo: 'to do' };
  const aria = `Block: ${bp.done} of ${bp.total} done — ${bp.pips.map(p => `${p.code} ${words[p.state]}`).join(', ')}`;
  return (
    <div className="lh-pips" role="img" aria-label={aria} data-testid="wk-block">
      <span className="lh-pips-lbl" aria-hidden="true">Block</span>
      <span className="lh-pips-bar" aria-hidden="true">
        {bp.pips.map(p => <i key={p.code} className={`lh-pip is-${p.state}`} />)}
      </span>
      <span className="lh-pips-n lf-num" aria-hidden="true">{bp.done} of {bp.total}</span>
      <span className="lh-pips-codes" aria-hidden="true">
        {bp.pips.map(p => (
          <span key={p.code} className={`lh-pipc is-${p.state}`} title={p.code}>{p.carried && <Icon name="arrow-right" size={10} />}{p.letter}</span>
        ))}
      </span>
    </div>
  );
}

/** ● WORKOUT IN PROGRESS · DXC · 23 MIN / Push · 7 of 19 sets / [▶ Resume] [⋯] (Discard is in the ⋯). */
function ResumeBanner({ active, now, gymName, onResume, onDiscard }) {
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);
  const done = active.exercises.reduce((k, ex) => k + ex.sets.filter(s => s.done).length, 0);
  const total = active.exercises.reduce((k, ex) => k + ex.sets.length, 0);
  const mins = minutesText(elapsedSec(active, now));
  const close = () => { setMenu(false); setArmed(false); };
  return (
    <section className="lh-card lh-resume" aria-label="Workout in progress" data-testid="wk-resume">
      <p className="lf-eyebrow lh-resume-eb"><span className="lf-live-dot" aria-hidden="true" /> Workout in progress{active.gym ? ` · ${gymName(active.gym)}` : ''} · {mins}</p>
      <p className="lh-resume-title"><b>{active.name}</b> · <span className="lf-num">{done} of {total}</span> sets</p>
      <div className="lh-resume-acts">
        <Button variant="primary" size="lg" icon="play" className="lh-resume-go" onClick={onResume} data-testid="wk-resume-go">Resume</Button>
        <IconButton icon="ellipsis" label="Workout options" className="lh-resume-more" onClick={() => setMenu(true)} data-testid="wk-resume-more" />
      </div>
      {menu && (
        <Sheet title={active.name} eyebrow={`// In progress · ${mins}`} onClose={close} testId="wk-resume-menu">
          <div className="lh-menu">
            <Button variant="secondary" size="lg" block icon="play" onClick={() => { close(); onResume(); }}>Resume workout</Button>
            <div className="lh-menu-gap" />
            {!armed ? (
              <Button variant="danger" size="lg" block icon="trash-2" onClick={() => setArmed(true)} data-testid="wk-discard">Discard workout…</Button>
            ) : (
              <div className="lh-confirm" role="group" aria-label="Confirm discard">
                <p className="lf-body">Discard this workout? Nothing from it will be saved — {done} ticked {done === 1 ? 'set' : 'sets'} included.</p>
                <div className="lh-confirm-acts">
                  <Button variant="secondary" size="lg" onClick={() => setArmed(false)}>Keep it</Button>
                  <Button variant="danger" size="lg" className="lh-danger-solid" onClick={() => { close(); onDiscard(); }} data-testid="wk-discard-confirm">Discard workout</Button>
                </div>
              </div>
            )}
          </div>
        </Sheet>
      )}
    </section>
  );
}

/**
 * The cool-down (moved from Rotation's old today card on 18 Oct): the
 * session's stretches, or a rest day's mobility flow. Folded under the
 * preview on a phone; expanded in the right column on desktop.
 */
function Stretches({ stretches, rest, folded = false }) {
  const head = `${rest ? 'Mobility for a rest day' : 'Stretch after'} · ${stretches.length} moves`;
  const body = (
    <>
      <p className="lf-meta lh-stretch-goal">{STRETCH_GOAL}</p>
      <ul className="lh-stretch-list">
        {stretches.map(st => (
          <li key={st.name}>
            <div className="lh-stretch-top"><span>{st.name}</span><span className="lh-stretch-hold lf-num">{st.hold}</span></div>
            <p className="lf-meta">{st.why}</p>
          </li>
        ))}
      </ul>
    </>
  );
  if (folded) {
    return (
      <details className="lh-stretch" data-testid="wk-stretch">
        <summary><Icon name="chevron-right" size={16} className="lh-stretch-chev" /><span>{head}</span></summary>
        {body}
      </details>
    );
  }
  return (
    <section className="lh-card lh-stretch is-open" data-testid="wk-stretch">
      <p className="lf-eyebrow">// {head}</p>
      {body}
    </section>
  );
}

/** // LAST SESSION Push · Mon 12 — up to 4 lines: exercise · top set · Δ vs the last like-for-like session. */
function LastSession({ last, gymName }) {
  const s = last.session;
  return (
    <section className="lh-card lh-last" data-testid="lh-last">
      <p className="lf-eyebrow">// Last session · {s.name || 'Workout'} · {dayTitle(s.date)}{s.gym ? ` · ${gymName(s.gym)}` : ''}{s.shift === 'night' ? ' · ☾' : ''}</p>
      <ul className="lh-plist">
        {last.rows.map(r => (
          <li key={r.liftId}>
            <span className="lh-plist-n">{r.name}</span>
            <span className="lh-plist-t lf-num">{fmtKg(r.top.weight)} × {r.top.reps}</span>
            <span className={`lh-delta lf-num${r.delta > 0 ? ' is-up' : ''}`}>{r.delta == null ? '—' : r.delta === 0 ? '±0' : `${r.delta > 0 ? '+' : '−'}${fmtKg(Math.abs(r.delta))}`}</span>
          </li>
        ))}
      </ul>
      {last.more > 0 && <p className="lf-meta">+ {last.more} more</p>}
    </section>
  );
}
