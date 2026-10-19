/**
 * New workout (brief §3.4) — CHOOSE, then start. Nothing runs and nothing
 * is written until "Start · <gym>": the clock starts there (fixes A9).
 *
 *   [Blank | Recent | Library]   44 px segmented
 *   gym switch                   the workout's gym (machines read its history)
 *   Blank    one row "Start empty and add exercises" (chosen by default)
 *   Recent   the last 10 finished workouts — name · date · gym · N ex · M sets
 *            · the first three exercises (+N); empty: "Finish a workout and
 *            it appears here to repeat."
 *   Library  the five programme sessions, then saved templates — name ·
 *            N ex · M sets · first three (+N); a saved one can be deleted
 *            (asks first)
 *   footer   "Start · DXC" — disabled until a row is chosen (Blank is
 *            pre-chosen)
 *
 * Loading a template / Recent never creates lift records — programme
 * exercises start PENDING and become lifts on their first ticked set
 * (workout.js). Rows start EMPTY (`prefill: false`): the live table shows
 * Previous as each cell's placeholder and ✓ commits it.
 *
 * ── Contract (Today's "Build my own", Blank / Recent / Library) ──
 *   <NewWorkoutSheet S today gyms gym gymName list initialTab
 *                    onStart(startArgs) onClose onQuickLog? onDeleteTemplate? />
 *   S            the state (read only)
 *   today        the TRAINING day ISO (LiftsTab's `today`)
 *   gyms         active gyms [{ id, name }]; gym the default (S.lifts.lastGym)
 *   gymName(id)  → display name
 *   list         S.lifts.list (names for the rows)
 *   initialTab   'blank' | 'recent' | 'library' (default 'blank')
 *   onStart(startArgs)  startArgs is ready for workout.js startWorkout once
 *                the caller adds { now, today }:
 *                  update(prev => startWorkout(prev, { ...startArgs, now: Date.now(), today }))
 *                It carries { source, name, shift, gym, exercises, prefill: false,
 *                rotaSession?, templateId? } and `openPicker: true` for Blank
 *                (the live screen opens Add exercises straight away).
 *   onDeleteTemplate(id)  delete a saved template (omit to hide the control)
 *   onQuickLog   optional "Or quick log one set" link under Blank
 */
import { useMemo, useState } from 'react';
import Icon from '../../../Icon';
import { Sheet, Segmented, GymSwitch, Button } from '../ui';
import { recentWorkouts, templatesOf, templateStart, repeatStart } from '../../../../lib/lifts/workout';
import { shortLiftName } from '../../../../lib/lifts/lifts';
import { fmtShortDate } from '../../../../lib/lifts/ui';
import { shiftOn } from '../../../../lib/rotation/pattern';

const TABS = [{ value: 'blank', label: 'Blank' }, { value: 'recent', label: 'Recent' }, { value: 'library', label: 'Library' }];

function firstThree(names) {
  const shown = names.slice(0, 3).join(' · ');
  return names.length > 3 ? { shown, more: names.length - 3 } : { shown, more: 0 };
}

export default function NewWorkoutSheet({ S, today, gyms = [], gym: gym0 = null, gymName = id => id, list = [], initialTab = 'blank', onStart, onClose, onQuickLog = null, onDeleteTemplate = null }) {
  const [tab, setTab] = useState(TABS.some(t => t.value === initialTab) ? initialTab : 'blank');
  const [gym, setGym] = useState(gym0 || (gyms[0] && gyms[0].id) || null);
  const [pick, setPick] = useState(initialTab === 'blank' || !initialTab ? { kind: 'blank' } : null);
  const [confirmDel, setConfirmDel] = useState(null);
  const recent = useMemo(() => recentWorkouts(S), [S]);
  const tpls = useMemo(() => templatesOf(S), [S]);
  const nameOf = id => { const l = list.find(x => x.id === id); return l ? shortLiftName(l.name) : null; };
  const shift = useMemo(() => { const d = shiftOn(S, today); return d ? d.shift : null; }, [S, today]);

  const changeTab = v => {
    setTab(v);
    setConfirmDel(null);
    if (v === 'blank') setPick({ kind: 'blank' });
    else if (!pick || pick.kind !== v) setPick(null);
  };

  const start = () => {
    if (!pick) return;
    const g = gym ? { gym } : {};
    let args;
    if (pick.kind === 'blank') {
      args = { source: 'blank', name: 'Workout', ...(shift ? { shift } : {}), ...g, exercises: [], openPicker: true };
    } else if (pick.kind === 'recent') {
      const s = recent.find(x => x.id === pick.id);
      if (!s) return;
      args = repeatStart(S, s, today, { gym });
    } else {
      const t = tpls.find(x => x.id === pick.id);
      if (!t) return;
      args = templateStart(S, t, today, { gym });
    }
    onStart({ ...args, prefill: false });
  };

  const gymLabel = gym ? gymName(gym) : null;
  const sel = (kind, id) => pick && pick.kind === kind && pick.id === id;
  const footer = (
    <div className="lw-new-foot">
      <Button variant="primary" size="lg" block icon="play" disabled={!pick} onClick={start} data-testid="lw-new-start">
        {pick ? `Start${gymLabel ? ` · ${gymLabel}` : ''}` : 'Choose a workout to start'}
      </Button>
    </div>
  );

  return (
    <Sheet title="New workout" eyebrow="// New workout" onClose={onClose} footer={footer} testId="lw-new" className="lw-new" width={520}>
      <div className="lw-new-body">
        <Segmented options={TABS} value={tab} onChange={changeTab} label="Start from" full testId="lw-new-tabs" />
        {gyms.length > 0 && (
          <div className="lw-new-gym">
            <span className="lf-eyebrow" id="lw-new-gym-l">Training at</span>
            <GymSwitch gyms={gyms} value={gym} onChange={setGym} label="Gym for this workout" testId="lw-new-gym" />
          </div>
        )}

        {tab === 'blank' && (
          <div className="lw-new-list" role="radiogroup" aria-label="Blank workout">
            <button type="button" role="radio" aria-checked={!!(pick && pick.kind === 'blank')} className={`lw-new-row${pick && pick.kind === 'blank' ? ' is-on' : ''}`}
                    onClick={() => setPick({ kind: 'blank' })} data-testid="lw-new-blank">
              <span className="lw-new-main">
                <span className="lw-new-name">Start empty and add exercises</span>
                <span className="lw-new-meta">Pick from your lifts, or create one</span>
              </span>
              <span className="lw-new-radio" aria-hidden="true" />
            </button>
            {onQuickLog && (
              <Button variant="quiet" icon="zap" onClick={onQuickLog} className="lw-new-ql">Or quick log one set</Button>
            )}
          </div>
        )}

        {tab === 'recent' && (recent.length ? (
          <div className="lw-new-list" role="radiogroup" aria-label="Recent workouts">
            {recent.map(s => {
              const names = s.exercises.map(ex => nameOf(ex.liftId)).filter(Boolean);
              const f = firstThree(names);
              const sets = s.exercises.reduce((k, ex) => k + ex.sets.length, 0);
              const on = sel('recent', s.id);
              return (
                <button key={s.id} type="button" role="radio" aria-checked={on} className={`lw-new-row${on ? ' is-on' : ''}`}
                        onClick={() => setPick({ kind: 'recent', id: s.id })} data-testid="lw-new-recent">
                  <span className="lw-new-main">
                    <span className="lw-new-name">{s.name}{s.shift === 'night' ? <span className="lw-new-night" aria-label="night session"> ☾</span> : null}</span>
                    <span className="lw-new-meta lf-num">{fmtShortDate(s.date, today)}{s.gym ? ` · ${gymName(s.gym)}` : ''} · {s.exercises.length} ex · {sets} sets</span>
                    <span className="lw-new-ex">{f.shown}{f.more ? <b> +{f.more}</b> : null}</span>
                  </span>
                  <span className="lw-new-radio" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ) : <p className="lf-meta lw-new-empty">Finish a workout and it appears here to repeat.</p>)}

        {tab === 'library' && (
          <div className="lw-new-list" role="radiogroup" aria-label="Library">
            {tpls.map(t => {
              const names = t.exercises.map(x => (x.name ? shortLiftName(x.name) : nameOf(x.liftId))).filter(Boolean);
              const f = firstThree(names);
              const sets = t.exercises.reduce((k, x) => k + (Number(x.sets) || 0), 0);
              const on = sel('library', t.id);
              return (
                <div key={t.id} className="lw-new-item">
                  <button type="button" role="radio" aria-checked={on} className={`lw-new-row${on ? ' is-on' : ''}`}
                          onClick={() => setPick({ kind: 'library', id: t.id })} data-testid="lw-new-tpl">
                    <span className="lw-new-main">
                      <span className="lw-new-name">{t.name}{t.builtIn ? <span className="lw-new-tag">Programme</span> : null}</span>
                      <span className="lw-new-meta lf-num">{t.exercises.length} ex · {sets} sets</span>
                      <span className="lw-new-ex">{f.shown}{f.more ? <b> +{f.more}</b> : null}</span>
                    </span>
                    <span className="lw-new-radio" aria-hidden="true" />
                  </button>
                  {!t.builtIn && onDeleteTemplate && (confirmDel === t.id ? (
                    <div className="lw-new-del" role="alert">
                      <span>Delete “{t.name}”?</span>
                      <Button variant="danger" onClick={() => { onDeleteTemplate(t.id); setConfirmDel(null); if (on) setPick(null); }}>Delete</Button>
                      <Button variant="quiet" onClick={() => setConfirmDel(null)}>Keep</Button>
                    </div>
                  ) : (
                    <button type="button" className="lf-iconbtn lw-new-x" onClick={() => setConfirmDel(t.id)} aria-label={`Delete template ${t.name}`}>
                      <Icon name="trash-2" size={16} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
