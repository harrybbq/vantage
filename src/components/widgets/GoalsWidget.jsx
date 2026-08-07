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
import { bodyGoalPlan, refusalCopy, sessionsPerWeek } from '../../lib/body/goal';
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
    const w = goal.gymTrackerId ? sessionsPerWeek(S, goal.gymTrackerId) : null;
    const c = goal.cardioTrackerId ? sessionsPerWeek(S, goal.cardioTrackerId) : null;
    return bodyGoalPlan(S, {
      ...(w != null && w > 0 ? { weightsPerWeek: w } : {}),
      ...(c != null && c > 0 ? { cardioPerWeek: c } : {}),
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
        {plan.pct != null && <GoalBar pct={plan.pct} />}
        <div className="gw-refusal">{refusalCopy(plan.reason, plan)}</div>
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
        <GoalBar pct={100} accent="var(--gold,#d4af37)" />
        <div className="gw-hint">{plan.current.toFixed(1)} kg · target {plan.target} kg</div>
      </div>
    );
  }

  const rateLabel = `${plan.rate > 0 ? '+' : '−'}${Math.abs(plan.rate).toFixed(2)} kg/wk`;

  return (
    <div className="gw-goal">
      <div className="gw-goal-head">
        <span className="gw-goal-pct">{plan.pct}<span className="gw-goal-pct-sign">%</span></span>
        <span className="gw-goal-sub">to goal</span>
        <span className="gw-goal-weeks">≈ {plan.weeks} wk{plan.weeks === 1 ? '' : 's'}</span>
      </div>
      <GoalBar pct={plan.pct} />

      {!compact && (
        <div className="gw-stats">
          {plan.weightSessions > 0 && (
            <div className="gw-stat"><b>{plan.weightSessions}</b><i>WEIGHTS</i><em>sessions</em></div>
          )}
          {plan.cardioSessions > 0 && (
            <div className="gw-stat"><b>{plan.cardioSessions}</b><i>CARDIO</i><em>sessions</em></div>
          )}
          <div className="gw-stat"><b>{plan.weeks}</b><i>WEEKS</i><em>to goal</em></div>
        </div>
      )}

      {/* The workings. Without these the counts above are a number the
          app pulled from nowhere, and the first time reality diverges
          the whole widget stops being believed. */}
      <div className="gw-how">
        <div className="gw-how-head">How</div>
        <div className="gw-how-row"><span>Now → target</span><b>{plan.current.toFixed(1)} → {plan.target} kg</b></div>
        <div className="gw-how-row"><span>Measured rate</span><b>{rateLabel}</b></div>
        <div className="gw-how-row"><span>Fitted over</span><b>{plan.ratePoints} weigh-ins · last {plan.rateWindowDays}d</b></div>
        {(plan.weightsPerWeek > 0 || plan.cardioPerWeek > 0) && (
          <div className="gw-how-row"><span>Your cadence</span>
            <b>{plan.weightsPerWeek.toFixed(1)} + {plan.cardioPerWeek.toFixed(1)} /wk</b></div>
        )}
      </div>

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
        Sessions are your timeline in your own cadence, not a claim they caused the change.
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
