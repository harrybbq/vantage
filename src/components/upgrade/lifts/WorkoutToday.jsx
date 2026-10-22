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
 * Adaptive (lib/lifts/adaptive.js, owner 2026-10-21): Upper / Lower are
 * built from what the week still owes, and each preview row carries its
 * tags — the part it serves ("side delts 4 / 9"), a gold "+1 Push" for a
 * missed anchor's catch-up, a red "≤ RPE 7" on a WHOOP-red anchor (old set
 * count struck through). Chips: WHOOP Recovery when synced (a dot in
 * WHOOP's own band colour, text in theme ink), the catch-up;
 * a below-standard note under a catch-up; a red box on a red day. The
 * stretch block is adaptStretches' ("tuned for this week", "· added").
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
import { adaptStretches } from '../../../lib/lifts/adaptive';
import { WHOOP_RECOVERY_COLOURS } from '../../../lib/vitals/recoverySource';
import { STRETCH_GOAL, STRETCHES } from '../../../data/trainingProgramme';

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
  const stretches = useMemo(() => adaptStretches(S, today, sug.restDay ? 'Rest' : sug.rotaSession, STRETCHES), [S, today, sug.restDay, sug.rotaSession]);
  const ad = sug.adaptive || null;
  const ready = ad && ad.readiness;
  const red = !!(ad && ad.red);
  const [all, setAll] = useState(false);

  const noProgramme = !sug.label && !sug.plan;
  const training = sug.exercises.length > 0;
  const shiftWord = sug.label ? sug.label.split(' · ')[0] : '';
  const eyebrow = nightOf ? `// Counts for ${dowLong(nightOf)}'s night shift` : `// Today · ${dayTitle(today)}${shiftWord ? ` · ${shiftWord}` : ''}`;
  // The eyebrow already carries "Night 1": the reason line starts at the why.
  const reason = shiftWord && sug.reason.startsWith(`${shiftWord} · `) ? sug.reason.slice(shiftWord.length + 3) : sug.reason;
  // Adaptive (lib/lifts/adaptive.js): the catch-up sentence, else the plan's move, else what the build is for.
  const catchNote = ad && ad.catchUp.length && !red ? ad.notes.find(x => / missed this week/.test(x)) : null;
  const builtNote = ad && ad.built && !red ? ad.notes.find(x => x.startsWith('Built for this week')) : null;
  const whyLine = catchNote || (sug.plan && sug.plan.source === 'dynamic' ? null : builtNote) || null;
  const notCarried = ad && ad.catchUp.length ? Math.max(0, ad.missedSets - ad.catchUpSets) : 0;
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
        {noProgramme ? 'Today sits outside your rota pattern. Build your own workout, or log a set.' : restLine || whyLine || reason}
      </p>
      {training && red && ready && (
        <p className="lh-redbox" data-testid="wk-redbox">
          <b>WHOOP Recovery {ready.score}% · red.</b>{' '}
          {ad.built ? 'Trimmed to what twice-a-week needs — two sets for each muscle still short of its second session.'
            : `Same exercises, one set fewer each, and keep every set to about RPE ${sug.exercises.find(x => x.rpeCap)?.rpeCap || 7}. ${sug.name} still counts as done for the week.`}
        </p>
      )}
      {(sug.night || (showGym && training) || (training && (ready || (ad && ad.catchUpSets > 0)))) && (
        <div className="lh-chiprow">
          {/* WHOOP's score in WHOOP's name and WHOOP's band colour (item 126):
              the band is the dot; the words stay in theme ink, because
              WHOOP's yellow cannot carry text on a light surface. */}
          {training && ready && !red && (
            <span className="lh-chip" data-testid="wk-ready">
              <i className="lh-chip-dot" style={{ background: WHOOP_RECOVERY_COLOURS[ready.band] }} aria-hidden="true" />
              WHOOP Recovery {ready.score}% · {ready.band}
            </span>
          )}
          {training && red && (
            <span className="lh-chip is-red" data-testid="wk-ready">
              <i className="lh-chip-dot" style={{ background: WHOOP_RECOVERY_COLOURS.red }} aria-hidden="true" />
              red · {ad.built ? 'twice-a-week only' : '−1 set per exercise'}
            </span>
          )}
          {training && ad && ad.catchUpSets > 0 && <span className="lh-chip is-plus" data-testid="wk-catchup">+{ad.catchUpSets} sets · {ad.catchUp.join(' + ')} catch-up</span>}
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
              const tags = x.tags || [];
              return (
                <li key={x.liftKey}>
                  <div className="lh-preview-row">
                    <span className="lh-preview-n">{x.name}{x.optional && <em> · optional</em>}</span>
                    {isMachine(x) && gymLbl && <span className="lh-gymtag">{gymLbl}</span>}
                    <span className="lh-preview-t lf-num">
                      <span>{x.setsWas != null && <><del className="lh-was" aria-label={`was ${x.setsWas}`}>{x.setsWas}</del> </>}{x.sets} × {x.reps}</span>
                      {w && <span className={`lh-preview-w${sug.night ? ' is-night' : ''}`}>{w}</span>}
                    </span>
                  </div>
                  {(tags.length > 0 || x.why) && (
                    <div className="lh-preview-tags" data-testid="wk-tags">
                      {tags.map(tg => <span key={tg.text} className={`lh-tag is-${tg.kind}`}>{tg.text}</span>)}
                      {x.why && <span className="lh-preview-why">{x.why}</span>}
                    </div>
                  )}
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
          {notCarried > 0 && (
            <p className="lh-warn" data-testid="wk-below">
              This week will finish below standard: {ad.catchUp.join(' and ')}’s other {notCarried} sets aren’t carried.
            </p>
          )}
        </>
      )}
      {!desktop && <Stretches stretches={stretches} rest={sug.restDay} red={red} folded />}
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
        {desktop && <Stretches stretches={stretches} rest={sug.restDay} red={red} />}
        {desktop && last && <LastSession last={last} gymName={gymName} />}
      </div>
    </div>
  );
}

/**
 * WEEK ▮▮▮▯▯ 3 of 5 · P P L U L — done accent, today outlined, missed hatched
 * (an anchor accepted as missed; a missed Upper / Lower adds a carry arrow).
 * The week is one rota block (lib/lifts/plan.js).
 */
function BlockPips({ bp }) {
  const words = p => (p.state === 'missed' ? (p.carried ? 'missed, carried forward' : 'missed') : { done: 'done', today: 'today', todo: 'to do' }[p.state]);
  const aria = `This week: ${bp.done} of ${bp.total} done — ${bp.pips.map(p => `${p.code} ${words(p)}`).join(', ')}`;
  return (
    <div className="lh-pips" role="img" aria-label={aria} data-testid="wk-block">
      <span className="lh-pips-lbl" aria-hidden="true">Week</span>
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
function Stretches({ stretches, rest, red = false, folded = false }) {
  const head = `${rest ? 'Mobility for a rest day' : 'Stretch after'} · ${stretches.length} moves`;
  // adaptStretches (lib/lifts/adaptive.js) marks what it added for this week.
  const tuned = stretches.some(st => st.added) ? (red && stretches.some(st => st.added === 'red day') ? 'longer flow on a red day' : 'tuned for this week') : null;
  const body = (
    <>
      <p className="lf-meta lh-stretch-goal">{STRETCH_GOAL}</p>
      <ul className="lh-stretch-list">
        {stretches.map(st => (
          <li key={st.name} className={st.added ? 'is-added' : undefined}>
            <div className="lh-stretch-top">
              <span>{st.name}{st.added && <span className="lh-stretch-add"> · added</span>}</span>
              <span className="lh-stretch-hold lf-num">{st.hold}</span>
            </div>
            <p className="lf-meta">{st.added && <span className="lh-stretch-addwhy">{st.added[0].toUpperCase() + st.added.slice(1)}. </span>}{st.why}</p>
          </li>
        ))}
      </ul>
    </>
  );
  if (folded) {
    return (
      <details className="lh-stretch" data-testid="wk-stretch">
        <summary><Icon name="chevron-right" size={16} className="lh-stretch-chev" /><span>{head}{tuned && <small className="lh-stretch-tuned"> · {tuned}</small>}</span></summary>
        {body}
      </details>
    );
  }
  return (
    <section className="lh-card lh-stretch is-open" data-testid="wk-stretch">
      <p className="lf-eyebrow">// {head}{tuned && <span className="lh-stretch-tuned"> · {tuned}</span>}</p>
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
