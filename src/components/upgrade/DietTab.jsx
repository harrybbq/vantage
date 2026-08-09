/**
 * Diet tab — the macro plan and the physique it is aimed at.
 *
 * The numbers come from the old rotation page's macro panel, but that
 * panel was frozen HTML: it said "current: 72 kg" forever, so the day
 * the weight changed the plan quietly started lying. Here the current
 * weight comes from vitalsLog and protein is derived from it, so the
 * plan tracks the body it is planning for.
 *
 * The targets are editable and stored under S.dietPlan. Defaults match
 * the original page exactly, so nothing changes on first load — the
 * plan only moves when it is deliberately moved.
 */
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import { RecipesPanel, VideosPanel } from './MealLibrary';
import { DEFAULT_PLAN, blendedDailyKcal } from '../../lib/diet/plan';
import { SEQ, CARDIO_SESSIONS, TRAIN_POS, REST_POS, patternDay, ANCHOR } from '../../lib/rotation/pattern';

function latestWeight(S) {
  const log = (S && S.vitalsLog) || {};
  const days = Object.keys(log).sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const w = log[days[i]] && log[days[i]].weight;
    if (w != null) return { kg: w, date: days[i] };
  }
  return null;
}

const PANELS = [
  { id: 'plan', label: 'Plan', icon: 'target' },
  { id: 'recipes', label: 'Recipes', icon: 'utensils' },
  { id: 'videos', label: 'Videos', icon: 'newspaper' },
];

export default function DietTab({ S, update, userId }) {
  const [panel, setPanel] = useState('plan');
  const plan = useMemo(() => ({ ...DEFAULT_PLAN, ...(S.dietPlan || {}) }), [S.dietPlan]);
  const [editing, setEditing] = useState(false);
  const weight = latestWeight(S);
  const kg = weight ? weight.kg : null;

  // Protein is per-kg of CURRENT bodyweight, so it moves as the body
  // does. Falls back to the target weight when nothing is logged —
  // better a number based on the goal than no number at all.
  const proteinG = Math.round((kg || plan.targetKg) * plan.proteinPerKg);
  const toGo = kg != null ? +(plan.targetKg - kg).toFixed(1) : null;
  const monthsToGo = toGo != null && plan.rateKgPerMonth > 0
    ? Math.max(0, Math.round((Math.abs(toGo) / plan.rateKgPerMonth) * 10) / 10)
    : null;

  const set = (k, v) => update(prev => ({ ...prev, dietPlan: { ...(prev.dietPlan || {}), [k]: v } }));

  // What a recipe serving is measured against. Training-day figures,
  // because that is the day you are usually planning food for.
  const targets = { kcal: plan.trainKcal, protein: proteinG };

  if (panel !== 'plan') {
    return (
      <div className="upg-pane">
        <Nav panel={panel} setPanel={setPanel} />
        {panel === 'recipes' && <RecipesPanel S={S} update={update} userId={userId} targets={targets} />}
        {panel === 'videos' && <VideosPanel S={S} update={update} />}
      </div>
    );
  }

  return (
    <div className="upg-pane">
      <Nav panel={panel} setPanel={setPanel} />
      <div className="upg-card upg-build">
        <div className="upg-card-head">
          <h3>The build</h3>
          <button type="button" className="upg-textbtn" onClick={() => setEditing(e => !e)}>
            {editing ? 'Done' : 'Edit targets'}
          </button>
        </div>
        <p className="upg-build-line">{plan.build}</p>
        <div className="upg-figs">
          <Fig label="Now" value={kg != null ? `${kg} kg` : '–'}
               sub={weight ? `logged ${weight.date}` : 'log a weight in Track'} />
          <Fig label="Target" value={`${plan.targetKg} kg`} accent
               sub={editing ? null : `at ${plan.rateKgPerMonth} kg/month`} />
          <Fig label="To go" value={toGo == null ? '–' : `${toGo > 0 ? '+' : ''}${toGo} kg`}
               sub={monthsToGo == null ? null : `≈ ${monthsToGo} months`} />
          <Fig label="Protein" value={`${proteinG} g`}
               sub={`${plan.proteinPerKg} g/kg${kg ? '' : ' of target'}`} />
        </div>
        {editing && (
          <div className="upg-edit-grid">
            <Num label="Target weight (kg)" v={plan.targetKg} step="0.5" onChange={v => set('targetKg', v)} />
            <Num label="Gain rate (kg/month)" v={plan.rateKgPerMonth} step="0.05" onChange={v => set('rateKgPerMonth', v)} />
            <Num label="Protein (g/kg)" v={plan.proteinPerKg} step="0.1" onChange={v => set('proteinPerKg', v)} />
            <Num label="Height (cm)" v={plan.heightCm} step="1" onChange={v => set('heightCm', v)} />
          </div>
        )}
      </div>

      <div className="upg-macro-grid">
        <MacroCard
          title="Training + cardio days" accent
          kcal={plan.trainKcal} protein={proteinG} carbs={plan.trainCarbs} fat={plan.trainFat}
          editing={editing}
          onKcal={v => set('trainKcal', v)} onCarbs={v => set('trainCarbs', v)} onFat={v => set('trainFat', v)}
        />
        <MacroCard
          title="Lift-only / rest days"
          kcal={plan.restKcal} protein={proteinG} carbs={plan.restCarbs} fat={plan.restFat}
          editing={editing}
          onKcal={v => set('restKcal', v)} onCarbs={v => set('restCarbs', v)} onFat={v => set('restFat', v)}
        />
      </div>

      <div className="upg-fine">
        Protein stays fixed per kilo regardless of day type. On nights, spread it across your
        actual waking hours — clock-time meals don&apos;t matter, totals do. The lean-athletic look
        comes from holding a small surplus and letting shoulder and back volume do the shaping,
        not from chasing bigger calorie numbers.
      </div>

      <SplitCard />

      <div className="upg-card">
        <div className="upg-card-head">
          <h3>How this reaches the rest of the app</h3>
          <span className="upg-card-sub">Blended daily: {blendedDailyKcal(S)} kcal</span>
        </div>
        <p className="upg-fine" style={{ margin: 0 }}>
          The Body Goal projection needs one daily calorie figure, and this plan has two. It uses
          the blend above — {plan.trainKcal} on the {TRAIN_POS.length} training days and {plan.restKcal} on
          the other {16 - TRAIN_POS.length}, weighted by how the rotation actually falls.
          {' '}That blend is a <b>fallback</b>: a calorie goal set in Track → Daily Macros wins, because
          that is what your food log measures against. And once you have logged enough days, what you
          actually ate beats both.
        </p>
      </div>
    </div>
  );
}

function Nav({ panel, setPanel }) {
  return (
    <div className="upg-subnav">
      {PANELS.map(p => (
        <button key={p.id} type="button"
                className={'upg-subtab' + (panel === p.id ? ' is-on' : '')}
                onClick={() => setPanel(p.id)}>
          <Icon name={p.icon} size={13} /> {p.label}
        </button>
      ))}
    </div>
  );
}

function Fig({ label, value, sub, accent }) {
  return (
    <div className="upg-fig">
      <div className="upg-fig-lbl">{label}</div>
      <div className={'upg-fig-val' + (accent ? ' is-accent' : '')}>{value}</div>
      {sub && <div className="upg-fig-sub">{sub}</div>}
    </div>
  );
}

function Num({ label, v, step, onChange }) {
  return (
    <label className="upg-num">
      <span>{label}</span>
      <input type="number" step={step} value={v}
             onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }} />
    </label>
  );
}

function MacroCard({ title, kcal, protein, carbs, fat, accent, editing, onKcal, onCarbs, onFat }) {
  const rows = [
    { k: 'Calories', v: kcal, unit: 'kcal', kcalStyle: true, set: onKcal, step: 50 },
    { k: 'Protein', v: protein, unit: 'g', locked: true },
    { k: 'Carbs', v: carbs, unit: 'g', set: onCarbs, step: 5 },
    { k: 'Fat', v: fat, unit: 'g', set: onFat, step: 5 },
  ];
  return (
    <div className={'upg-card upg-macro' + (accent ? ' is-accent' : '')}>
      <div className="upg-macro-title">{title}</div>
      {rows.map(r => (
        <div key={r.k} className="upg-mrow">
          <span className="upg-mk">{r.k}</span>
          {editing && r.set ? (
            <input className="upg-minput" type="number" step={r.step} value={r.v}
                   onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) r.set(n); }} />
          ) : (
            <span className={'upg-mv' + (r.kcalStyle ? ' is-kcal' : '')}>
              {r.v.toLocaleString()} {r.unit}
              {r.locked && <span className="upg-mlock"> derived</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The split, read out of the same pattern the Rotation tab draws — so
 * it cannot drift from what the calendar actually says. Shows one full
 * cycle, which is the shortest span that contains every session.
 */
function SplitCard() {
  const cycle = useMemo(() => {
    return Array.from({ length: 16 }, (_, i) => {
      const dt = new Date((ANCHOR + i) * 86400000);
      const day = patternDay(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
      return { i, ...day };
    });
  }, []);

  return (
    <div className="upg-card">
      <div className="upg-card-head">
        <h3>Gym split</h3>
        <span className="upg-card-sub">
          {TRAIN_POS.length} sessions / 16 days ≈ {(TRAIN_POS.length * 7 / 16).toFixed(1)} a week
        </span>
      </div>
      <div className="upg-split-row">
        {cycle.map(c => (
          <div key={c.i} className={`upg-split-cell is-${c.shift}${c.cardio ? ' has-cardio' : ''}${c.session === 'Rest' ? ' is-rest' : ''}`}>
            <span className="upg-split-shift">{c.shift === 'night' ? `N${c.shiftNum}` : c.shift === 'day' ? `D${c.shiftNum}` : '·'}</span>
            <span className="upg-split-sess">{c.session.slice(0, 4).toUpperCase()}</span>
          </div>
        ))}
      </div>
      <div className="upg-fine" style={{ marginTop: 10 }}>
        {SEQ.join(' → ')} is slotted from the first shift to the first day off, so one block runs
        across the four shifts and finishes on the day you come off them — then {REST_POS.size / 2}{' '}
        rest days before the next block. Block length and sequence length are both five, so every
        block is a complete PPLUL: Push always lands on the first shift, Lower always on the first
        day off. Cardio rides on {[...CARDIO_SESSIONS].join(' / ')} days to keep legs fresh.
      </div>
    </div>
  );
}
