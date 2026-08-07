/**
 * Goals widgets — shared bodies for the mobile stack and the desktop
 * hub's React islands, same pattern as LifeWidgets / SavingsWidgets.
 *
 *   BodyGoalBody  — one body target: setup form, then progress + plan
 *   GoalsBody     — pinned goals list with an on-widget picker
 *
 * Stores (all new keys in S — no migration):
 *   S.bodyGoal            { type, targetKg, targetBodyFat?, startKg,
 *                           startedAt, weeklyWeights, weeklyCardio,
 *                           gymTrackerId?, cardioTrackerId? }
 *   hubWidget.picks       string[] of pinned ids, per widget instance
 *
 * The projection maths lives in lib/body/goal.js so it can be reasoned
 * about (and asserted on) without a browser.
 */
import { useMemo, useState } from 'react';
import { bodyGoalPlan, refusalCopy, sessionsPerWeek, trainingCadence, trainingTrackers } from '../../lib/body/goal';
import { bmrKcal } from '../../lib/burn';
import './GoalsWidget.css';

const mono = { fontFamily: 'var(--mono)' };
const money = n => '£' + Math.round(n).toLocaleString('en-GB');

// ═══════════════════════════════════════════════════════════════════════
// Shared bits
// ═══════════════════════════════════════════════════════════════════════

export function GoalBar({ pct, accent = 'var(--em)', h = 4 }) {
  return (
    <div className="gw-bar" style={{ height: h }}>
      <div className="gw-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: accent }} />
    </div>
  );
}


/**
 * Progress gauge — a 270° arc, not a full ring.
 *
 * The open bottom is where the caption sits, so the label costs no
 * extra height. One component at every size: a ring's centred number
 * stops being readable below about 60px, an arc's doesn't, so the same
 * SVG serves the 118px hero and the 84px compact form.
 */
export function Gauge({ pct, size = 118, stroke = 9, label, sub, accent = 'var(--em)' }) {
  const r = (size - stroke) / 2, cx = size / 2, SWEEP = 270, START = 135;
  const pt = deg => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cx + r * Math.sin(a)];
  };
  const arc = (from, to) => {
    const [x1, y1] = pt(from), [x2, y2] = pt(to);
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  };
  const safe = Math.max(0, Math.min(100, pct || 0));
  const end = START + (SWEEP * safe) / 100;
  return (
    <div className="gw-gauge" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <path d={arc(START, START + SWEEP)} fill="none" stroke="var(--border)" strokeWidth={stroke} strokeLinecap="round" />
        {safe > 0 && (
          <path className="gw-gauge-fill" d={arc(START, end)} fill="none" stroke={accent}
                strokeWidth={stroke} strokeLinecap="round" />
        )}
      </svg>
      <div className="gw-gauge-mid">
        <span className="gw-gauge-num" style={{ fontSize: size * 0.26 }}>{label}</span>
        {sub && <span className="gw-gauge-sub" style={{ fontSize: Math.max(7, size * 0.085) }}>{sub}</span>}
      </div>
    </div>
  );
}

/**
 * The picker chip. Sits where the savings stepper sits and reuses its
 * .sw-count shell, so it inherits the placement and styling already in
 * index.css rather than inventing a second control.
 */
export function PickChip({ n, open, onToggle, label = 'Choose which to show' }) {
  return (
    <div className="sw-count" onClick={e => e.stopPropagation()}>
      <button type="button" className="sw-count-step gw-chip" onClick={onToggle}
              aria-expanded={open} aria-label={label}>
        <span className="sw-count-n">{n}</span>
        <span className="gw-chip-caret" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
    </div>
  );
}

/**
 * The pick list. Shared by the goals widget and the savings pots widget
 * — both had the same problem (the widget chose for you) and the same
 * answer, so they get the same component rather than two that drift.
 */
export function PickList({ items, picked, onToggle, onDone, note }) {
  return (
    <div className="gw-picklist">
      <div className="gw-picklist-head">// show which</div>
      <div className="gw-picklist-scroll">
        {items.map(it => {
          const on = picked.includes(it.id);
          return (
            <button key={it.id} type="button" className={'gw-pickrow' + (on ? ' is-on' : '')}
                    onClick={() => onToggle(it.id)} aria-pressed={on}>
              <span className={'gw-pickbox' + (on ? ' is-on' : '')}>{on ? '✓' : ''}</span>
              <span className="gw-pickrow-text">
                <span className="gw-pickrow-name">{it.name}</span>
                <span className="gw-pickrow-tag">{it.tag}</span>
              </span>
            </button>
          );
        })}
        {!items.length && <div className="gw-empty">Nothing to pin yet.</div>}
      </div>
      {note && <div className="gw-picklist-note">{note}</div>}
      <button type="button" className="link-open-btn gw-done" onClick={onDone}>Done</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// BODY GOAL — setup, then progress + plan
// ═══════════════════════════════════════════════════════════════════════

const GOAL_TYPES = [
  { id: 'cut', label: 'FAT LOSS' },
  { id: 'recomp', label: 'RECOMP' },
  { id: 'gain', label: 'GAIN' },
];

/** Boolean trackers, so the setup can offer the user's own gym tracker. */
function boolTrackers(S) {
  return (S.trackers || []).filter(t => t.type === 'boolean');
}

function Setup({ S, update, onCancel }) {
  const trackers = boolTrackers(S);
  const guessGym = trackers.find(t => /gym|lift|weight|train/i.test(t.name)) || trackers[0];
  const guessCardio = trackers.find(t => /cardio|run|walk|bike|cycle|swim/i.test(t.name));
  const [form, setForm] = useState({
    type: 'cut',
    targetKg: '',
    targetBodyFat: '',
    gymTrackerId: guessGym ? guessGym.id : '',
    cardioTrackerId: guessCardio ? guessCardio.id : '',
    dailyKcal: '',
    weeklyWeights: guessGym ? String(Math.round(sessionsPerWeek(S, guessGym.id) || guessGym.weeklyTarget || 3)) : '3',
    weeklyCardio: guessCardio ? String(Math.round(sessionsPerWeek(S, guessCardio.id) || guessCardio.weeklyTarget || 2)) : '2',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Start weight is captured NOW and frozen. Progress is measured from
  // here, so editing the target later doesn't make the bar jump.
  const startKg = useMemo(() => {
    const log = S.vitalsLog || {};
    const days = Object.keys(log).filter(d => log[d] && log[d].weight > 0).sort();
    return days.length ? parseFloat(log[days[days.length - 1]].weight) : null;
  }, [S.vitalsLog]);

  const bmr = useMemo(() => bmrKcal(S), [S]);
  const target = parseFloat(form.targetKg);
  const canSave = target > 0 && target < 400;

  function save() {
    update(prev => ({
      ...prev,
      bodyGoal: {
        type: form.type,
        targetKg: target,
        ...(parseFloat(form.targetBodyFat) > 0 ? { targetBodyFat: parseFloat(form.targetBodyFat) } : {}),
        startKg: startKg || target,
        startedAt: new Date().toISOString().slice(0, 10),
        ...(parseInt(form.dailyKcal, 10) > 0 ? { dailyKcal: parseInt(form.dailyKcal, 10) } : {}),
        weeklyWeights: Math.max(0, parseInt(form.weeklyWeights, 10) || 0),
        weeklyCardio: Math.max(0, parseInt(form.weeklyCardio, 10) || 0),
        ...(form.gymTrackerId ? { gymTrackerId: form.gymTrackerId } : {}),
        ...(form.cardioTrackerId ? { cardioTrackerId: form.cardioTrackerId } : {}),
      },
    }));
  }

  return (
    <div className="gw-setup">
      <div className="gw-field">
        <span className="gw-label">Goal type</span>
        <div className="gw-seg">
          {GOAL_TYPES.map(o => (
            <button key={o.id} type="button" className={'gw-seg-btn' + (form.type === o.id ? ' is-on' : '')}
                    onClick={() => set('type', o.id)}>{o.label}</button>
          ))}
        </div>
      </div>

      <div className="gw-row">
        <label className="gw-field">
          <span className="gw-label">Target weight (kg)</span>
          <input className="gw-input" type="number" inputMode="decimal" step="0.1"
                 value={form.targetKg} onChange={e => set('targetKg', e.target.value)} placeholder="78" />
        </label>
        <label className="gw-field">
          <span className="gw-label">Target body fat %</span>
          <input className="gw-input" type="number" inputMode="decimal" step="0.1"
                 value={form.targetBodyFat} onChange={e => set('targetBodyFat', e.target.value)} placeholder="optional" />
        </label>
      </div>

      {/* Recomp is the case where weight is the wrong yardstick. Better
          to say it here than let someone watch a flat number for three
          months and conclude the widget is broken. */}
      {form.type === 'recomp' && (
        <div className="gw-note is-warn">
          <span className="gw-note-icon">▲</span>
          <span>On a recomp your weight can hold still for months while your body changes.
            Body fat or waist is the honest yardstick — weight alone will read as no progress.</span>
        </div>
      )}

      <div className="gw-row">
        <label className="gw-field">
          <span className="gw-label">Weights / week</span>
          <input className="gw-input" type="number" inputMode="numeric" min="0" max="14"
                 value={form.weeklyWeights} onChange={e => set('weeklyWeights', e.target.value)} />
        </label>
        <label className="gw-field">
          <span className="gw-label">Cardio / week</span>
          <input className="gw-input" type="number" inputMode="numeric" min="0" max="14"
                 value={form.weeklyCardio} onChange={e => set('weeklyCardio', e.target.value)} />
        </label>
      </div>
      {guessGym && (
        <div className="gw-hint">Pre-filled from your “{guessGym.name}” tracker.</div>
      )}

      {/* The one number the model can't infer. With it we can estimate a
          timeline on day one instead of making the user log weight for
          a fortnight first; without it the widget still works, it just
          waits for a measured trend. */}
      <label className="gw-field">
        <span className="gw-label">Daily calorie target</span>
        <input className="gw-input" type="number" inputMode="numeric" min="800" max="6000"
               value={form.dailyKcal} onChange={e => set('dailyKcal', e.target.value)}
               placeholder="e.g. 2300 — optional" />
      </label>
      <div className="gw-hint">
        {bmr
          ? `We estimate you burn about ${Math.round(bmr * 1.55).toLocaleString()} kcal a day at ${form.weeklyWeights || 0}+${form.weeklyCardio || 0} sessions a week. Eating under that is what moves the target.`
          : 'Set up the Calories widget (height, age, sex) and we can estimate your daily burn too.'}
      </div>

      <div className="gw-actions">
        <button type="button" className="link-open-btn" disabled={!canSave} onClick={save}>Save goal</button>
        {onCancel && <button type="button" className="gw-textbtn" onClick={onCancel}>Cancel</button>}
      </div>
      <div className="gw-disclaimer">
        An estimate from your own logged data. Not medical or dietary advice.
      </div>
    </div>
  );
}

export function BodyGoalBody({ S, update, navigate, hasPro = false, compact = false, onUpgrade }) {
  const [editing, setEditing] = useState(false);
  const goal = S.bodyGoal;

  // Pro gate. Deliberately renders a teaser rather than nothing, and
  // NEVER touches S.bodyGoal — a lapsed subscription must not delete the
  // target the user set while they were paying. Resubscribe and it's all
  // still there.
  if (!hasPro) {
    return (
      <div className="gw-locked">
        <div className="gw-locked-badge">PRO</div>
        <div className="gw-locked-title">
          {goal ? `Your ${goal.targetKg} kg target is saved` : 'Set a body target'}
        </div>
        <div className="gw-locked-text">
          {goal
            ? 'Progress, timeline and session counts come back with Pro. Nothing has been lost.'
            : 'Track a weight target and see how far along you are, how long is left, and what that is in training sessions.'}
        </div>
        {onUpgrade && (
          <button type="button" className="link-open-btn" onClick={onUpgrade}>Upgrade ↗</button>
        )}
      </div>
    );
  }

  // Live session rates beat the numbers typed at setup — if the user
  // said 3 and has been doing 4, the plan should reflect 4.
  const plan = useMemo(() => {
    if (!goal) return { ok: false, reason: 'no-goal' };
    // What the user actually does, across every tracker that reads like
    // training — including ones created after the goal was set.
    const { weights, cardio } = trainingCadence(S, goal);
    return bodyGoalPlan(S, {
      ...(weights > 0 ? { weightsPerWeek: weights } : {}),
      ...(cardio > 0 ? { cardioPerWeek: cardio } : {}),
    });
  }, [S, goal]);

  if (!goal || editing) {
    return <Setup S={S} update={update} onCancel={goal ? () => setEditing(false) : null} />;
  }

  if (!plan.ok) {
    return (
      <div className="gw-goal">
        <div className="gw-goal-head">
          <span className="gw-goal-target">{goal.targetKg} kg</span>
          <span className="gw-goal-type">{goal.type}</span>
          <button type="button" className="gw-textbtn gw-edit" onClick={() => setEditing(true)}>Edit</button>
        </div>
        <div className="gw-hero is-compact">
          <Gauge pct={plan.pct || 0} size={84} stroke={7}
                 label={plan.pct != null ? `${plan.pct}%` : '—'} sub="to goal" />
          <div className="gw-refusal">{refusalCopy(plan.reason, plan)}</div>
        </div>
      </div>
    );
  }

  if (plan.atGoal) {
    return (
      <div className="gw-goal">
        <div className="gw-goal-head">
          <span className="gw-goal-pct is-gold">At goal ✦</span>
          <button type="button" className="gw-textbtn gw-edit" onClick={() => setEditing(true)}>Edit</button>
        </div>
        <div className="gw-hero is-compact">
          <Gauge pct={100} size={84} stroke={7} label="100%" sub="reached" accent="var(--gold,#d4af37)" />
          <div className="gw-hint">{plan.current.toFixed(1)} kg · target {plan.target} kg</div>
        </div>
      </div>
    );
  }

  const rateLabel = `${plan.rate > 0 ? '+' : '−'}${Math.abs(plan.rate).toFixed(2)} kg/wk`;
  // Named in the How block so auto-detection isn't magic — the user can
  // see exactly which trackers are feeding their progress.
  const ids = trainingTrackers(S, goal);
  const trackerNames = [...ids.weights, ...ids.cardio]
    .map(id => (S.trackers || []).find(t => t.id === id))
    .filter(Boolean).map(t => t.name);
  const sessionBits = [
    plan.weightSessions > 0 ? `${plan.weightSessions} gym` : null,
    plan.cardioSessions > 0 ? `${plan.cardioSessions} cardio` : null,
  ].filter(Boolean);

  return (
    <div className="gw-goal">
      {/* Compact stacks the gauge beside the numbers; full size puts it
          on top. Same component, same reading either way. */}
      <div className={'gw-hero' + (compact ? ' is-compact' : '')}>
        <Gauge pct={plan.pct} size={compact ? 84 : 118} stroke={compact ? 7 : 9}
               label={`${plan.pct}%`} sub="sessions done" />
        <div className="gw-hero-side">
          <div className="gw-sessions">
            <b>{plan.sessionsDone}</b> of <b>{plan.sessionsTotal}</b> sessions
          </div>
          <div className="gw-eta">
            <strong>{plan.sessionsRemaining}</strong> to go
            {sessionBits.length > 0 && <> · {sessionBits.join(' + ')}</>}
          </div>
          <div className="gw-nums">
            <span><b>{plan.current.toFixed(1)}</b> now</span>
            <span><b className="is-rate">{rateLabel.replace(' kg/wk', '')}</b> kg/wk</span>
            <span><b>{plan.target.toFixed(1)}</b> goal</span>
          </div>
          <div className="gw-eta-sub">
            ≈ {plan.weeks} week{plan.weeks === 1 ? '' : 's'} at {(plan.weightsPerWeek + plan.cardioPerWeek).toFixed(1)}/wk
          </div>
        </div>
      </div>

      {/* The workings. Without these the counts above are a number the
          app pulled from nowhere, and the first time reality diverges
          the whole widget stops being believed. */}
      <div className="gw-how">
        <div className="gw-how-head">How</div>
        <div className="gw-how-row"><span>Now → target</span><b>{plan.current.toFixed(1)} → {plan.target} kg</b></div>
        <div className="gw-how-row">
          <span>{plan.source === 'measured' ? 'Measured rate' : 'Projected rate'}</span><b>{rateLabel}</b>
        </div>
        {plan.source === 'measured' ? (
          <div className="gw-how-row"><span>Fitted over</span><b>{plan.ratePoints} weigh-ins · last {plan.rateWindowDays}d</b></div>
        ) : (
          <>
            <div className="gw-how-row"><span>Est. daily burn</span><b>{plan.tdee?.toLocaleString()} kcal</b></div>
            <div className="gw-how-row"><span>Your intake</span><b>{plan.intake?.toLocaleString()} kcal</b></div>
            <div className="gw-how-row"><span>Daily deficit</span><b>{plan.dailyDeficit?.toLocaleString()} kcal</b></div>
          </>
        )}
        <div className="gw-how-row"><span>Weight progress</span><b>{plan.weightPct}%</b></div>
        {trackerNames.length > 0 && (
          <div className="gw-how-row"><span>Counting</span><b>{trackerNames.join(', ')}</b></div>
        )}
        {plan.adherence && (
          <div className="gw-how-row"><span>Plan vs actual</span>
            <b>{plan.adherence.planned} → {plan.adherence.recent} /wk</b></div>
        )}
        {(plan.weightsPerWeek > 0 || plan.cardioPerWeek > 0) && (
          <div className="gw-how-row"><span>Your cadence</span>
            <b>{plan.weightsPerWeek.toFixed(1)} + {plan.cardioPerWeek.toFixed(1)} /wk</b></div>
        )}
      </div>

      {plan.adherence && plan.adherence.slacking && (
        <div className="gw-note is-warn">
          <span className="gw-note-icon">▲</span>
          <span>Training has slipped to {plan.adherence.recent}/wk against the {plan.adherence.planned} you
            planned{plan.adherence.shortBy > 0 ? ` — about ${plan.adherence.shortBy} sessions behind` : ''}.
            The timeline above already reflects that.</span>
        </div>
      )}

      {plan.tooFast && (
        <div className="gw-note is-warn">
          <span className="gw-note-icon">▲</span>
          <span>That is faster than about 1% of bodyweight a week. Quick, but harder to hold on to
            — and worth a word with a GP if it keeps up.</span>
        </div>
      )}

      <div className="gw-foot">
        <button type="button" className="gw-textbtn" onClick={() => setEditing(true)}>Edit goal</button>
        {navigate && <button type="button" className="gw-textbtn" onClick={() => navigate('track')}>Log weight</button>}
      </div>
      <div className="gw-disclaimer">
        {plan.source === 'projected'
          ? 'Projected from your calorie target and estimated daily burn (7,700 kcal ≈ 1 kg of fat). Real loss usually slows as you get lighter — this switches to your measured rate once you have a couple of weeks of weigh-ins. '
          : 'Measured from your own weigh-ins. '}
        An estimate from your logged data — not medical advice.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GOALS — pinned list with on-widget picker
// ═══════════════════════════════════════════════════════════════════════

/**
 * Everything pinnable, in one shape. Measurable entries carry a real
 * percentage; the rest carry their unlock step, because achievements in
 * this app are binary and inventing a percentage for them would be a
 * number with no meaning behind it.
 */
export function pinnableGoals(S, hasPro = false) {
  const out = [];

  if (S.bodyGoal && S.bodyGoal.targetKg) {
    const plan = bodyGoalPlan(S);
    out.push({
      id: '__body__',
      name: `Reach ${S.bodyGoal.targetKg} kg`,
      tag: 'Body · measurable',
      pct: plan.ok ? (plan.atGoal ? 100 : plan.pct) : (plan.pct || 0),
      accent: 'var(--em)',
      // The distance to target is ordinary information the user can
      // read on the Track page, so it stays free. The TIMELINE is the
      // Pro projection — without this the free Goals widget handed out
      // the exact number the Body Goal widget is gated on.
      meta: plan.ok
        ? (plan.atGoal ? 'At goal ✦'
          : `${Math.abs(plan.current - plan.target).toFixed(1)} kg to go${hasPro ? ` · ≈ ${plan.weeks} wks` : ''}`)
        : (hasPro ? refusalCopy(plan.reason, plan) : `${S.bodyGoal.targetKg} kg target`),
    });
  }

  for (const g of (S.savings || [])) {
    if (!(g.target > 0)) continue;
    const pct = Math.max(0, Math.min(100, Math.round(((g.current || 0) / g.target) * 100)));
    out.push({
      id: 'sav:' + g.id,
      name: `${g.icon || '💰'} ${g.name}`,
      tag: 'Savings · measurable',
      pct,
      accent: 'var(--gold,#d4af37)',
      meta: `${money(g.current || 0)} of ${money(g.target)}`,
    });
  }

  const all = S.achievements || [];
  const parents = new Map();
  for (const [from, to] of (S.connections || [])) {
    if (!parents.has(to)) parents.set(to, []);
    parents.get(to).push(from);
  }
  for (const a of all) {
    const ps = parents.get(a.id) || [];
    const done = ps.filter(pid => (all.find(x => x.id === pid) || {}).completed).length;
    out.push({
      id: 'ach:' + a.id,
      name: `${a.icon || '◆'} ${a.name}`,
      tag: `${a.category || 'goal'} · milestone`,
      // Binary by nature — the only honest fractions are "done" and
      // "how many prerequisites are cleared".
      pct: a.completed ? 100 : (ps.length ? Math.round((done / ps.length) * 100) : 0),
      accent: a.completed ? 'var(--gold,#d4af37)' : ps.length ? 'var(--text-muted)' : 'var(--em)',
      meta: a.completed ? 'Completed'
        : ps.length ? `${done}/${ps.length} required${a.locked ? ' · locked' : ''}`
        : 'In progress',
    });
  }
  return out;
}

export function GoalsBody({ S, picks, onSetPicks, navigate, hasPro = false, compact = false }) {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => pinnableGoals(S, hasPro), [S, hasPro]);
  // No stored picks → the first few, so a freshly added widget shows
  // something rather than an empty box asking to be configured.
  const picked = picks && picks.length ? picks : items.slice(0, compact ? 2 : 3).map(i => i.id);
  const shown = items.filter(i => picked.includes(i.id));

  const toggle = id => {
    const next = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id];
    onSetPicks?.(next);
  };

  return (
    <div className="gw-goals">
      {onSetPicks && <PickChip n={picked.length} open={open} onToggle={() => setOpen(o => !o)} label="Choose which goals to show" />}
      {open ? (
        <PickList items={items} picked={picked} onToggle={toggle} onDone={() => setOpen(false)}
                  note="Measurable goals show real progress; milestones show their unlock step." />
      ) : (
        <div className={'gw-list' + (onSetPicks ? ' has-chip' : '')}>
          {shown.map(a => (
            <div key={a.id} className="gw-item">
              <div className="gw-item-head">
                <span className="gw-item-name">{a.name}</span>
                <span className="gw-item-pct" style={{ color: a.accent }}>{a.pct}%</span>
              </div>
              <GoalBar pct={a.pct} accent={a.accent} />
              <span className="gw-item-meta">{a.meta}</span>
            </div>
          ))}
          {!shown.length && (
            <div className="gw-empty">
              {items.length ? 'Nothing pinned — tap the chip above to choose.' : 'No goals yet. Add achievements or a body target.'}
            </div>
          )}
          {navigate && !!shown.length && (
            <button type="button" className="gw-textbtn gw-foot-btn" onClick={() => navigate('achievements')}>All goals ↗</button>
          )}
        </div>
      )}
    </div>
  );
}
