/**
 * Diet — the day's energy, what went into it, and how to add to it fast.
 *
 * ── The shape ────────────────────────────────────────────────────────
 * Left, the two things that answer "how am I doing": one ring for
 * calories with burn inside it, three for the macros, and the day as a
 * timeline. Right, the three ways of adding to it without typing —
 * what you eat often, a whole day at once, and last week for context.
 *
 * ── Why a timeline and not a list ────────────────────────────────────
 * The old day view was four meal buckets, which is a category most
 * people's eating does not have — a night shift has no "lunch" and a
 * training day has three of them. Times are what people actually
 * remember, and a gap between two entries carries information a bucket
 * cannot: five hours between meals is a fact about the day.
 *
 * Logging itself is unchanged — the same search, barcode and photo
 * routes, in the same sheets. This is a new way of reading the day, not
 * a new way of writing it.
 */
import { useMemo, useState } from 'react';
import { planDayFor, planGoalFor, planBadge } from '../../lib/plan/planDay';
import { ymd } from '../../lib/vitals/readiness';

const MACROS = [
  { key: 'protein_g', goalName: 'Protein', label: 'Protein', color: '#2563eb' },
  { key: 'carbs_g',   goalName: 'Carbs',   label: 'Carbs',   color: '#0891b2' },
  { key: 'fat_g',     goalName: 'Fat',     label: 'Fat',     color: '#be185d' },
];

const RING_R = 74, RING_C = 2 * Math.PI * RING_R;
const MRING_R = 30, MRING_C = 2 * Math.PI * MRING_R;

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const kcal = v => Math.round(num(v)).toLocaleString();

/** `HH:MM` from a log row — nutrition_log has no time column, so the
 *  row's created_at is the time it was eaten as far as anyone knows. */
function timeOf(entry) {
  const t = entry.created_at ? new Date(entry.created_at) : null;
  if (!t || Number.isNaN(t.getTime())) return '—';
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}
const minsOf = e => {
  const [h, m] = timeOf(e).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + m : -1;
};

export default function DietPanel({
  S, date, summary, logEntries, macros, burnKcal, recents = [],
  onLogFood, onDeleteEntry, onQuickAdd, onOpenGoals,
}) {
  const [busy, setBusy] = useState(null);
  const day = date || ymd();
  const plan = planDayFor(day, S);

  const goalOf = name => {
    const m = (macros || []).find(x => x.name === name);
    const planned = planGoalFor(plan, name);
    return planned != null ? planned : num(m?.daily_goal);
  };

  const eaten = {
    kcal: num(summary?.calories),
    protein_g: num(summary?.protein_g),
    carbs_g: num(summary?.carbs_g),
    fat_g: num(summary?.fat_g),
    fibre_g: num(summary?.fibre_g),
    sugar_g: num(summary?.sugar_g),
    sodium_mg: num(summary?.sodium_mg),
  };
  const calGoal = goalOf('Calories');
  const left = calGoal - eaten.kcal;
  const calPct = calGoal > 0 ? Math.min(1.35, eaten.kcal / calGoal) : 0;
  const burn = num(burnKcal);
  const burnPct = calGoal > 0 ? Math.min(1, burn / calGoal) : 0;

  // Ordered by time, because that is the axis the card is drawn on.
  const timeline = useMemo(
    () => (logEntries || []).slice().sort((a, b) => minsOf(a) - minsOf(b)),
    [logEntries],
  );

  /** Last seven days of calories, from the % history the nutrition
   *  section already writes. Percentages, not grams, so a goal change
   *  does not rewrite the past. */
  const week = useMemo(() => {
    const hist = S?.macroHistory || {};
    const out = [];
    const base = new Date(`${day}T12:00:00`);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base.getTime() - i * 86400000);
      const key = ymd(d);
      const pct = hist[key]?.cal;
      out.push({
        key,
        label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
        pct: pct == null ? null : Number(pct),
        isToday: key === day,
      });
    }
    return out;
  }, [S?.macroHistory, day]);
  const weekAvg = (() => {
    const has = week.filter(w => w.pct != null);
    return has.length ? Math.round(has.reduce((s, w) => s + w.pct, 0) / has.length) : null;
  })();

  async function quick(r) {
    if (!onQuickAdd || busy) return;
    setBusy(r.food_name);
    try { await onQuickAdd(r); } catch { /* surfaced by the caller */ }
    setBusy(null);
  }

  const span = timeline.length
    ? `${timeOf(timeline[0])}–${timeOf(timeline[timeline.length - 1])}`
    : '—';

  return (
    <div className="tv-wrap tv-diet">
      <div className="tv-main">
        {/* ── Energy and macros ── */}
        <div className="tv-card">
          <div className="tv-rule">
            <span>Energy &amp; macros</span><i />
            <button type="button" className="tv-chip-btn" onClick={onOpenGoals}>
              {plan.active ? planBadge(plan) : 'Goals'}
            </button>
          </div>

          <div className="tv-energy">
            <div className="tv-cal-ring">
              <svg viewBox="0 0 168 168" aria-hidden="true">
                <circle cx="84" cy="84" r={RING_R} className="tv-ring-track" strokeWidth="13" />
                <circle cx="84" cy="84" r={RING_R} strokeWidth="13" fill="none" strokeLinecap="round"
                  stroke={left < 0 ? '#c0563f' : 'var(--em)'}
                  strokeDasharray={`${calPct * RING_C} ${RING_C}`} transform="rotate(-90 84 84)" />
                {/* Burn, inside — the same day measured the other way. */}
                <circle cx="84" cy="84" r="56" className="tv-ring-track" strokeWidth="5" />
                <circle cx="84" cy="84" r="56" strokeWidth="5" fill="none" strokeLinecap="round"
                  stroke="#d99114"
                  strokeDasharray={`${burnPct * 2 * Math.PI * 56} ${2 * Math.PI * 56}`}
                  transform="rotate(-90 84 84)" />
              </svg>
              <div className="tv-cal-mid">
                <div className="tv-cal-num">{kcal(eaten.kcal)}</div>
                <div className="tv-cal-goal">/ {kcal(calGoal)} kcal</div>
                <div className={`tv-cal-left${left < 0 ? ' is-over' : ''}`}>
                  {calGoal <= 0 ? 'no goal set' : left >= 0 ? `${kcal(left)} left` : `${kcal(-left)} over`}
                </div>
              </div>
            </div>

            <div className="tv-energy-side">
              <div className="tv-macros">
                {MACROS.map(m => {
                  const g = goalOf(m.goalName);
                  const v = eaten[m.key];
                  const pct = g > 0 ? Math.min(1.2, v / g) : 0;
                  const shortBy = Math.round(g - v);
                  return (
                    <div key={m.key} className="tv-macro">
                      <div className="tv-macro-ring">
                        <svg viewBox="0 0 72 72" aria-hidden="true">
                          <circle cx="36" cy="36" r={MRING_R} className="tv-ring-track" strokeWidth="7" />
                          <circle cx="36" cy="36" r={MRING_R} strokeWidth="7" fill="none" strokeLinecap="round"
                            stroke={m.color} strokeDasharray={`${pct * MRING_C} ${MRING_C}`}
                            transform="rotate(-90 36 36)" />
                        </svg>
                        <span className="tv-macro-pct">{g > 0 ? `${Math.round((v / g) * 100)}%` : '—'}</span>
                      </div>
                      <div className="tv-macro-lbl">{m.label}</div>
                      <div className="tv-macro-val">{Math.round(v)}<em>/{Math.round(g)}g</em></div>
                      <div className="tv-macro-note">
                        {g <= 0 ? '' : shortBy > 0 ? `${shortBy}g short` : 'hit'}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="tv-strip">
                <div className="tv-strip-cell">
                  <span className="tv-strip-lbl">Burned</span>
                  <span className="tv-strip-val is-burn">{burn ? kcal(burn) : '—'}</span>
                </div>
                <span className="tv-strip-arrow" aria-hidden="true">→</span>
                <div className="tv-strip-cell">
                  <span className="tv-strip-lbl">Net</span>
                  <span className="tv-strip-val">{kcal(eaten.kcal - burn)}</span>
                </div>
                <span className="tv-strip-sep" aria-hidden="true" />
                <div className="tv-strip-cell">
                  <span className="tv-strip-lbl">Fibre</span>
                  <span className="tv-strip-val">{Math.round(eaten.fibre_g)}g</span>
                </div>
                <div className="tv-strip-cell">
                  <span className="tv-strip-lbl">Sugar</span>
                  <span className="tv-strip-val">{Math.round(eaten.sugar_g)}g</span>
                </div>
                <div className="tv-strip-cell">
                  <span className="tv-strip-lbl">Sodium</span>
                  <span className="tv-strip-val">{Math.round(eaten.sodium_mg)}mg</span>
                </div>
              </div>

              <button type="button" className="tv-log-btn" onClick={onLogFood}>+ Log food</button>
            </div>
          </div>
        </div>

        {/* ── The day ── */}
        <div className="tv-card">
          <div className="tv-rule">
            <span>The day</span><i />
            <em>{timeline.length} {timeline.length === 1 ? 'entry' : 'entries'} · {span}</em>
          </div>

          {timeline.length === 0 ? (
            <div className="tv-empty">Nothing logged yet — start with a search, a barcode or a photo.</div>
          ) : (
            <div className="tv-timeline">
              {timeline.map(e => (
                <div key={e.id} className="tv-tl-row">
                  <span className="tv-tl-time">{timeOf(e)}</span>
                  <span className="tv-tl-dot" aria-hidden="true" />
                  <div className="tv-tl-card">
                    <div className="tv-tl-body">
                      <div className="tv-tl-name">
                        <span>{e.food_name}</span>
                        {e.source && <em>{e.source}</em>}
                      </div>
                      <div className="tv-tl-macros">
                        <span>{Math.round(num(e.serving_g))}g</span>
                        <span>P {Math.round(num(e.protein_g))}</span>
                        <span>C {Math.round(num(e.carbs_g))}</span>
                        <span>F {Math.round(num(e.fat_g))}</span>
                      </div>
                    </div>
                    <div className="tv-tl-kcal">
                      <b>{kcal(e.calories)}</b><em>kcal</em>
                    </div>
                    {onDeleteEntry && (
                      <button type="button" className="tv-tl-x" title={`Remove ${e.food_name}`}
                        onClick={() => onDeleteEntry(e)}>✕</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── The rail ── */}
      <div className="tv-rail">
        <div className="tv-card">
          <div className="tv-rule"><span>One tap again</span><i /><em>by frequency</em></div>
          {recents.length === 0 ? (
            <div className="tv-empty tv-empty-sm">
              Foods you log more than once show up here, ready to add in one tap.
            </div>
          ) : (
            <div className="tv-recents">
              {recents.map(r => (
                <button key={r.id || r.food_name} type="button" className="tv-recent"
                  disabled={busy === r.food_name} onClick={() => quick(r)}>
                  <span className="tv-recent-tag">{r.count || 1}×</span>
                  <span className="tv-recent-body">
                    <span className="tv-recent-name">{r.food_name}</span>
                    <span className="tv-recent-meta">
                      {[r.brand, `${Math.round(num(r.serving_g))}g`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="tv-recent-kcal">{kcal(r.calories)}</span>
                  <span className="tv-recent-add" aria-hidden="true">{busy === r.food_name ? '…' : '+'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="tv-card">
          <div className="tv-rule">
            <span>Last 7 days</span><i />
            {weekAvg != null && <em>avg {weekAvg}% of goal</em>}
          </div>
          <div className="tv-week">
            {week.map(w => {
              const on = w.pct != null && w.pct >= 85 && w.pct <= 115;
              return (
                <div key={w.key} className={`tv-week-col${w.isToday ? ' is-today' : ''}`}>
                  <span className="tv-week-num">{w.pct == null ? '' : `${w.pct}%`}</span>
                  <span className={`tv-week-bar${on ? ' is-on' : ''}${w.pct == null ? ' is-none' : ''}`}
                        style={{ height: `${w.pct == null ? 3 : Math.max(4, Math.min(100, w.pct * 0.8))}%` }} />
                  <span className="tv-week-day">{w.label}</span>
                </div>
              );
            })}
          </div>
          <div className="tv-week-key">
            <span className="is-on"><i />On target</span>
            <span><i />Off target</span>
          </div>
          <p className="tv-note">
            Percentages of that day&apos;s calorie goal, kept as history — changing the goal
            later does not rewrite what happened.
          </p>
        </div>
      </div>
    </div>
  );
}
