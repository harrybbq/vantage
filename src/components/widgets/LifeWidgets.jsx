/**
 * Life widgets — Body and Subscriptions. Widget bodies are shared by
 * the mobile hub (MobileWidget) and the desktop canvas (HubSection React
 * islands), one implementation per widget, same pattern as
 * savings/SavingsWidgets.jsx. The fuller page-level cards live here too:
 *
 *   BodyBody / BodyCard             — weight trend + goal (Track page)
 *   SubscriptionsBody / SubscriptionsManager — recurring outgoings
 *                                     (Achievements → Savings tab)
 *
 * Stores (all in S — no schema migrations):
 *   S.vitalsLog[date].weight  — existing store; Body reuses it so WHOOP /
 *                               Apple Health / Vitals-widget entries all
 *                               feed the same trend
 *   S.bodyLog[date]           — { waist?, bodyFat? } extra measurements
 *   S.bodyGoalKg              — goal weight (number)
 *   S.subscriptions           — [{ id, name, amount, freq, nextDate, category }]
 *
 * S.moodLog is deliberately NOT read here any more — the Mood widget
 * was withdrawn in 2026-08 and its code removed, but the entries
 * people logged are left untouched in state.
 */
import { useMemo, useState } from 'react';
import { getTodayStr } from '../../utils/helpers';

const mono = { fontFamily: 'var(--mono)' };
const money = n => (n < 0 ? '−£' : '£') + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 });

// ═══════════════════════════════════════════════════════════════════════
// BODY — weight trend, 7-day rolling average, goal
// ═══════════════════════════════════════════════════════════════════════

/** Ordered [date, weight] pairs from the vitals store, oldest first. */
function weightSeries(S) {
  const log = S.vitalsLog || {};
  return Object.keys(log)
    .filter(d => log[d]?.weight != null && log[d].weight > 0)
    .sort()
    .map(d => [d, parseFloat(log[d].weight)]);
}

/** 7-day rolling average of the series (by entry date, calendar-aware). */
function rollingAvg(series, endDate) {
  const end = new Date(endDate + 'T12:00');
  const start = new Date(end); start.setDate(start.getDate() - 6);
  const inWin = series.filter(([d]) => { const t = new Date(d + 'T12:00'); return t >= start && t <= end; });
  if (!inWin.length) return null;
  return inWin.reduce((s, [, w]) => s + w, 0) / inWin.length;
}

export function bodyStats(S) {
  const series = weightSeries(S);
  if (!series.length) return null;
  const [lastDate, lastW] = series[series.length - 1];
  const avgNow = rollingAvg(series, lastDate);
  const weekAgo = new Date(lastDate + 'T12:00'); weekAgo.setDate(weekAgo.getDate() - 7);
  const avgPrev = rollingAvg(series, weekAgo.toISOString().slice(0, 10));
  const delta = avgNow != null && avgPrev != null ? avgNow - avgPrev : null;
  const goal = parseFloat(S.bodyGoalKg) || null;
  return { series, lastDate, lastW, avgNow, delta, goal };
}

function Sparkline({ series, goal, height = 44 }) {
  // Plot the raw entries of the last 30 days plus a dashed goal line.
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const pts = series.filter(([d]) => new Date(d + 'T12:00') >= cutoff);
  if (pts.length < 2) return <div style={{ ...mono, fontSize: 10, color: 'var(--text-muted)', padding: '8px 0' }}>Log a few days of weight to see your trend.</div>;
  const ws = pts.map(([, w]) => w);
  const lo = Math.min(...ws, goal || Infinity) - 0.5;
  const hi = Math.max(...ws, goal || -Infinity) + 0.5;
  const W = 100;
  const x = i => (i / (pts.length - 1)) * W;
  const y = w => height - ((w - lo) / (hi - lo)) * (height - 6) - 3;
  const path = pts.map(([, w], i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(w).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }} aria-hidden="true">
      {goal != null && goal > lo && goal < hi && (
        <line x1="0" x2={W} y1={y(goal)} y2={y(goal)} stroke="var(--gold, #d4a017)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
      )}
      <path d={path} fill="none" stroke="var(--em)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1][1])} r="2.2" fill="var(--em)" />
    </svg>
  );
}

function logTodayWeight(update, value) {
  const num = parseFloat(value);
  if (!num || num <= 0) return;
  const today = getTodayStr();
  update(prev => ({
    ...prev,
    vitalsLog: { ...(prev.vitalsLog || {}), [today]: { ...((prev.vitalsLog || {})[today] || {}), weight: num } },
  }));
}

// showLog: the weight quick-log input. OFF in the hub widget — the
// Vitals widget already prompts for weight and both write the same
// store, so the widget surface stays read-only (trend + goal). The
// Track page's BodyCard turns it on.
export function BodyBody({ S, update, navigate, showLog = false }) {
  const [draft, setDraft] = useState('');
  const stats = bodyStats(S);
  const today = getTodayStr();
  const loggedToday = (S.vitalsLog || {})[today]?.weight != null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {stats ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
              {stats.avgNow.toFixed(1)}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}> kg</span>
            </span>
            <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.5 }}>7-day avg</span>
            {stats.delta != null && (
              <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: stats.delta <= 0 ? 'var(--em)' : '#d99114' }}>
                {stats.delta > 0 ? '+' : ''}{stats.delta.toFixed(1)} kg/wk
              </span>
            )}
          </div>
          <Sparkline series={stats.series} goal={stats.goal} />
          {stats.goal != null && stats.avgNow != null && (
            <div style={{ ...mono, fontSize: 10.5, color: 'var(--text-mid)' }}>
              Goal {stats.goal} kg · {Math.abs(stats.avgNow - stats.goal) < 0.3
                ? <span style={{ color: 'var(--gold, #d4a017)', fontWeight: 700 }}>at goal ✦</span>
                : `${Math.abs(stats.avgNow - stats.goal).toFixed(1)} kg to go`}
            </div>
          )}
        </>
      ) : (
        <div style={{ ...mono, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          No weight logged yet — log it via the Vitals widget or the Body card on Track, and your trend, weekly rate and goal progress appear here.
        </div>
      )}
      {showLog && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="number" inputMode="decimal" step="0.1" min="0"
            placeholder={loggedToday ? `today: ${(S.vitalsLog || {})[today].weight} kg` : 'weight today (kg)'}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { logTodayWeight(update, draft); setDraft(''); } }}
            style={{ flex: 1, minWidth: 0, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-base, transparent)', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 12.5, outline: 'none' }}
          />
          <button
            type="button"
            onClick={() => { logTodayWeight(update, draft); setDraft(''); }}
            disabled={!parseFloat(draft)}
            style={{ padding: '7px 12px', border: 'none', borderRadius: 8, background: parseFloat(draft) ? 'var(--em)' : 'var(--border)', color: '#fff', fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600, cursor: parseFloat(draft) ? 'pointer' : 'default' }}
          >Log</button>
        </div>
      )}
      {navigate && (
        <button type="button" onClick={() => navigate('track')}
          style={{ ...mono, alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, fontSize: 10, letterSpacing: 0.8, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}>
          Full history → Track
        </button>
      )}
    </div>
  );
}

/** Track-page card: goal editing + waist / body-fat measurements. */
export function BodyCard({ S, update }) {
  const stats = bodyStats(S);
  const today = getTodayStr();
  const bodyLog = S.bodyLog || {};
  const todayExtra = bodyLog[today] || {};
  const [goalDraft, setGoalDraft] = useState('');

  function setExtra(key, value) {
    const num = parseFloat(value);
    update(prev => ({
      ...prev,
      bodyLog: {
        ...(prev.bodyLog || {}),
        [today]: { ...((prev.bodyLog || {})[today] || {}), [key]: num > 0 ? num : undefined },
      },
    }));
  }

  // Most recent 5 dates that have any body data (weight or measurements).
  const recent = useMemo(() => {
    const dates = new Set([
      ...Object.keys(S.vitalsLog || {}).filter(d => (S.vitalsLog || {})[d]?.weight != null),
      ...Object.keys(bodyLog),
    ]);
    return [...dates].sort().reverse().slice(0, 5);
  }, [S.vitalsLog, bodyLog]);

  const inputStyle = { width: '100%', padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 12.5, outline: 'none' };
  const lbl = { ...mono, fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: 4 };

  return (
    <div className="card" style={{ padding: '18px', marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--text-md)' }}>Body</h3>
        {stats?.goal != null && <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)' }}>goal {stats.goal} kg</span>}
      </div>
      <BodyBody S={S} update={update} showLog />
      {/* Goal + today's measurements */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <span style={lbl}>Goal (kg)</span>
          <input type="number" inputMode="decimal" step="0.5" style={inputStyle}
            placeholder={stats?.goal != null ? String(stats.goal) : '—'}
            value={goalDraft}
            onChange={e => setGoalDraft(e.target.value)}
            onBlur={() => { const n = parseFloat(goalDraft); if (n > 0) update(prev => ({ ...prev, bodyGoalKg: n })); setGoalDraft(''); }}
          />
        </div>
        <div>
          <span style={lbl}>Waist (cm)</span>
          <input type="number" inputMode="decimal" step="0.5" style={inputStyle}
            placeholder={todayExtra.waist != null ? String(todayExtra.waist) : '—'}
            onBlur={e => { setExtra('waist', e.target.value); e.target.value = ''; }}
          />
        </div>
        <div>
          <span style={lbl}>Body fat (%)</span>
          <input type="number" inputMode="decimal" step="0.1" style={inputStyle}
            placeholder={todayExtra.bodyFat != null ? String(todayExtra.bodyFat) : '—'}
            onBlur={e => { setExtra('bodyFat', e.target.value); e.target.value = ''; }}
          />
        </div>
      </div>
      {recent.length > 0 && (
        <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse', ...mono, fontSize: 10.5 }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
              <th style={{ padding: '4px 0', fontWeight: 500 }}>Date</th>
              <th style={{ padding: '4px 0', fontWeight: 500 }}>Weight</th>
              <th style={{ padding: '4px 0', fontWeight: 500 }}>Waist</th>
              <th style={{ padding: '4px 0', fontWeight: 500 }}>Fat %</th>
            </tr>
          </thead>
          <tbody>
            {recent.map(d => (
              <tr key={d} style={{ borderTop: '1px solid var(--border)', color: 'var(--text-mid)' }}>
                <td style={{ padding: '5px 0' }}>{d.slice(5)}</td>
                <td style={{ padding: '5px 0' }}>{(S.vitalsLog || {})[d]?.weight != null ? `${(S.vitalsLog || {})[d].weight} kg` : '—'}</td>
                <td style={{ padding: '5px 0' }}>{bodyLog[d]?.waist != null ? `${bodyLog[d].waist} cm` : '—'}</td>
                <td style={{ padding: '5px 0' }}>{bodyLog[d]?.bodyFat != null ? `${bodyLog[d].bodyFat}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS — recurring outgoings, monthly burn, renewals
// ═══════════════════════════════════════════════════════════════════════

export function toMonthly(amount, freq) {
  const v = parseFloat(amount) || 0;
  if (freq === 'year') return v / 12;
  if (freq === 'week') return v * 52 / 12;
  return v;
}

/** Days until the next renewal, rolling the stored date forward by the
 *  cadence so a past date keeps producing the next occurrence. */
export function nextRenewal(sub, from = new Date()) {
  if (!sub.nextDate) return null;
  const d = new Date(sub.nextDate + 'T12:00');
  if (isNaN(d)) return null;
  const roll = { week: dd => dd.setDate(dd.getDate() + 7), month: dd => dd.setMonth(dd.getMonth() + 1), year: dd => dd.setFullYear(dd.getFullYear() + 1) }[sub.freq || 'month'];
  let guard = 0;
  while (d < from && guard++ < 400) roll(d);
  return d;
}

export function subsStats(S) {
  const subs = S.subscriptions || [];
  const monthly = subs.reduce((s, x) => s + toMonthly(x.amount, x.freq), 0);
  const now = new Date();
  const withDue = subs.map(x => ({ ...x, due: nextRenewal(x, now) }));
  const upcoming = withDue.filter(x => x.due).sort((a, b) => a.due - b.due);
  // Full list for the manager: dated ones by due date, undated last —
  // a sub without a renewal date must still be listed (and removable).
  const all = [...upcoming, ...withDue.filter(x => !x.due)];
  return { subs, monthly, upcoming, all };
}

const daysUntil = due => Math.max(0, Math.ceil((due - new Date()) / 86400000));
const dueLabel = due => { const n = daysUntil(due); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `${n}d`; };

export function SubscriptionsBody({ S, navigate }) {
  const { subs, monthly, upcoming } = subsStats(S);
  if (!subs.length) {
    return (
      <div style={{ ...mono, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        No subscriptions tracked yet.
        {navigate && <> <button type="button" onClick={() => navigate('achievements')} style={{ ...mono, background: 'none', border: 'none', padding: 0, fontSize: 11, color: 'var(--em)', cursor: 'pointer', textDecoration: 'underline' }}>Add your recurring bills</button> to see your monthly burn and upcoming renewals.</>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{money(monthly)}</span>
        <span style={{ ...mono, fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.5 }}>/month · {subs.length} subscription{subs.length === 1 ? '' : 's'}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {upcoming.slice(0, 3).map(x => (
          <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: daysUntil(x.due) <= 3 ? '#d99114' : 'var(--em)' }} />
            <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>
            <span style={{ ...mono, fontSize: 10.5, color: 'var(--text-mid)' }}>{money(parseFloat(x.amount) || 0)}</span>
            <span style={{ ...mono, fontSize: 10, color: daysUntil(x.due) <= 3 ? '#d99114' : 'var(--text-muted)', minWidth: 52, textAlign: 'right' }}>{x.due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {dueLabel(x.due)}</span>
          </div>
        ))}
      </div>
      {navigate && (
        <button type="button" onClick={() => navigate('achievements')}
          style={{ ...mono, alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, fontSize: 10, letterSpacing: 0.8, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}>
          Manage → Savings
        </button>
      )}
    </div>
  );
}

const SUB_CATEGORIES = ['Streaming', 'Software', 'Fitness', 'Utilities', 'Insurance', 'Other'];

/** Full manager — lives on Achievements → Savings tab. */
export function SubscriptionsManager({ S, update }) {
  const { subs, monthly } = subsStats(S);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', freq: 'month', nextDate: '', category: 'Other' });

  function add() {
    if (!form.name.trim() || !(parseFloat(form.amount) > 0)) return;
    update(prev => ({
      ...prev,
      subscriptions: [...(prev.subscriptions || []), { id: 'sub' + Date.now(), ...form, name: form.name.trim(), amount: parseFloat(form.amount) }],
    }));
    setForm({ name: '', amount: '', freq: 'month', nextDate: '', category: 'Other' });
    setAdding(false);
  }
  function remove(id) {
    update(prev => ({ ...prev, subscriptions: (prev.subscriptions || []).filter(x => x.id !== id) }));
  }

  const inputStyle = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 12.5, outline: 'none' };

  return (
    <div className="card" style={{ padding: '20px', marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>Subscriptions &amp; Bills</h3>
        <button type="button" className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => setAdding(a => !a)}>
          {adding ? 'Cancel' : '+ Add'}
        </button>
      </div>
      <p style={{ ...mono, fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.6 }}>
        Recurring outgoings — see your total monthly burn and what renews next. Cancelling one is an instant saving.
      </p>

      {adding && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 14, padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
          <input style={inputStyle} placeholder="Name (e.g. Netflix)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input style={inputStyle} type="number" inputMode="decimal" min="0" step="0.01" placeholder="£ amount" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          <select style={inputStyle} value={form.freq} onChange={e => setForm(f => ({ ...f, freq: e.target.value }))}>
            <option value="week">Weekly</option><option value="month">Monthly</option><option value="year">Yearly</option>
          </select>
          <input style={inputStyle} type="date" value={form.nextDate} onChange={e => setForm(f => ({ ...f, nextDate: e.target.value }))} title="Next renewal date" />
          <select style={inputStyle} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            {SUB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} disabled={!form.name.trim() || !(parseFloat(form.amount) > 0)} onClick={add}>Add subscription</button>
        </div>
      )}

      {subs.length === 0 ? (
        <div style={{ ...mono, fontSize: 11, color: 'var(--text-muted)' }}>Nothing tracked yet — add your first recurring bill above.</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--sans)', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{money(monthly)}</span>
            <span style={{ ...mono, fontSize: 10.5, color: 'var(--text-muted)' }}>/month · {money(monthly * 12)}/year</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {subsStats(S).all.map(x => (
              <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 9 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</div>
                  <div style={{ ...mono, fontSize: 9.5, color: 'var(--text-muted)', marginTop: 1 }}>
                    {x.category || 'Other'} · {x.freq === 'week' ? 'weekly' : x.freq === 'year' ? 'yearly' : 'monthly'}
                    {x.due && <> · renews {x.due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ({dueLabel(x.due)})</>}
                  </div>
                </div>
                <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: 'var(--text-mid)' }}>{money(parseFloat(x.amount) || 0)}</span>
                <span style={{ ...mono, fontSize: 9.5, color: 'var(--text-muted)' }}>{money(toMonthly(x.amount, x.freq))}/mo</span>
                <button type="button" onClick={() => remove(x.id)} aria-label={`Remove ${x.name}`}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '2px 6px' }}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
