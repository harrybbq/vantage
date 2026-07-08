/**
 * SavingsProjections — a lightweight cash-flow + savings-growth
 * planner that lives under the Savings tab.
 *
 * The user adds income and expense line items (each monthly or
 * yearly); we show net income per month/year and project the running
 * balance forward as a line chart. The starting balance defaults to
 * the total already saved across their goals.
 *
 * Interest (the "future" idea): an optional APY compounds monthly on
 * the running balance in the projection loop — kept minimal (one
 * field), off by default, so it doesn't complicate the core tool.
 *
 * State: S.projection = {
 *   items: [{ id, kind:'income'|'expense', label, amount, freq:'month'|'year' }],
 *   apy: string, horizon: number(months)
 * }
 */
import { useMemo, useRef, useState } from 'react';

const HORIZONS = [
  { m: 12, label: '1y' },
  { m: 24, label: '2y' },
  { m: 60, label: '5y' },
];

function toMonthly(amount, freq) {
  const v = parseFloat(amount) || 0;
  return freq === 'year' ? v / 12 : v;
}
function money(n) {
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toLocaleString('en-GB');
  return (neg ? '−£' : '£') + s;
}

export default function SavingsProjections({ S, update }) {
  const proj = S.projection || {};
  const items = proj.items || [];
  const goals = S.savings || [];
  const apy = proj.apy || '';
  const horizon = proj.horizon || 12;
  const [view, setView] = useState('month'); // month | year (summary only)
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  // Starting balance = everything already saved across goals.
  const startBalance = useMemo(
    () => (S.savings || []).reduce((sum, g) => sum + (g.current || 0), 0),
    [S.savings]
  );

  function setProj(patch) {
    update(prev => ({ ...prev, projection: { items, apy, horizon, ...prev.projection, ...patch } }));
  }
  function addItem(kind) {
    setProj({ items: [...items, { id: 'p' + Math.round(startBalance) + items.length + kind, kind, label: '', amount: '', freq: 'month' }] });
  }
  function updateItem(id, key, val) {
    setProj({ items: items.map(it => it.id === id ? { ...it, [key]: val } : it) });
  }
  function removeItem(id) {
    setProj({ items: items.filter(it => it.id !== id) });
  }

  const incomeM = items.filter(i => i.kind === 'income').reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
  const expenseM = items.filter(i => i.kind === 'expense').reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
  const netM = incomeM - expenseM;
  const mult = view === 'year' ? 12 : 1;
  const apyRate = (parseFloat(apy) || 0) / 100;
  const monthlyRate = apyRate / 12;

  // Project the running balance forward, compounding any APY monthly.
  const series = useMemo(() => {
    const out = [{ m: 0, bal: startBalance }];
    let bal = startBalance;
    for (let i = 1; i <= horizon; i++) {
      bal = bal * (1 + monthlyRate) + netM;
      out.push({ m: i, bal });
    }
    return out;
  }, [startBalance, horizon, monthlyRate, netM]);

  const endBal = series[series.length - 1].bal;
  const interestEarned = apyRate > 0 ? endBal - startBalance - netM * horizon : 0;

  // ── Chart geometry ──
  const W = 640, H = 200, PAD_L = 52, PAD_R = 14, PAD_T = 14, PAD_B = 24;
  const vals = series.map(p => p.bal);
  let vMin = Math.min(0, ...vals), vMax = Math.max(...vals, 1);
  const padV = (vMax - vMin) * 0.08 || 1;
  vMax += padV;
  const sx = m => PAD_L + (m / horizon) * (W - PAD_L - PAD_R);
  const sy = v => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD_T - PAD_B);
  const linePath = series.map((p, i) => `${i ? 'L' : 'M'}${sx(p.m).toFixed(1)},${sy(p.bal).toFixed(1)}`).join('');
  const areaPath = linePath + `L${sx(horizon).toFixed(1)},${sy(vMin).toFixed(1)}L${sx(0).toFixed(1)},${sy(vMin).toFixed(1)}Z`;
  const zeroY = vMin < 0 ? sy(0) : null;
  const yticks = [vMin, (vMin + vMax) / 2, vMax].map(v => Math.round(v));

  function onMove(e) {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const m = Math.max(0, Math.min(horizon, Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * horizon)));
    setHover(series[m] || null);
  }

  return (
    <div className="card proj-card">
      <div className="proj-head">
        <div>
          <h3 style={{ margin: '0 0 2px' }}>Projections</h3>
          <p className="proj-sub">Plan your monthly cash flow and see how your balance grows.</p>
        </div>
        <div className="proj-viewtoggle">
          {['month', 'year'].map(v => (
            <button key={v} type="button" className={`proj-vt${view === v ? ' on' : ''}`} onClick={() => setView(v)}>{v === 'month' ? 'Monthly' : 'Yearly'}</button>
          ))}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="proj-summary">
        <div className="proj-tile">
          <span className="proj-tile-label">Income</span>
          <span className="proj-tile-val proj-pos">{money(incomeM * mult)}</span>
        </div>
        <div className="proj-tile">
          <span className="proj-tile-label">Expenses</span>
          <span className="proj-tile-val proj-neg">{money(expenseM * mult)}</span>
        </div>
        <div className="proj-tile proj-tile-net">
          <span className="proj-tile-label">Net / {view}</span>
          <span className={`proj-tile-val ${netM >= 0 ? 'proj-pos' : 'proj-neg'}`}>{netM >= 0 ? '+' : ''}{money(netM * mult)}</span>
        </div>
      </div>

      {/* Line items editor */}
      <div className="proj-items">
        {items.map(it => (
          <div key={it.id} className={`proj-item proj-item-${it.kind}`}>
            <div className={`proj-row proj-row-${it.kind}`}>
              <button type="button" className="proj-kind" onClick={() => updateItem(it.id, 'kind', it.kind === 'income' ? 'expense' : 'income')} title="Toggle income / expense">
                {it.kind === 'income' ? '+' : '−'}
              </button>
              <input className="proj-label" placeholder={it.kind === 'income' ? 'e.g. Salary' : 'e.g. Rent'} value={it.label} onChange={e => updateItem(it.id, 'label', e.target.value)} />
              <div className="proj-amt-wrap">
                <span className="proj-amt-cur">£</span>
                <input className="proj-amt" type="number" inputMode="decimal" placeholder="0" value={it.amount} onChange={e => updateItem(it.id, 'amount', e.target.value)} />
              </div>
              <select className="proj-freq" value={it.freq} onChange={e => updateItem(it.id, 'freq', e.target.value)}>
                <option value="month">/mo</option>
                <option value="year">/yr</option>
              </select>
              <button type="button" className="proj-del" onClick={() => removeItem(it.id)} aria-label="Remove">✕</button>
            </div>
            {/* Expense → savings pot link. Money routed into a pot still
                reduces net cash flow, and drives the goal's months-to-go
                estimate on the goals list. */}
            {it.kind === 'expense' && goals.length > 0 && (
              <div className="proj-link-row">
                <span className="proj-link-arrow">↳ into pot</span>
                <select
                  className="proj-link-select"
                  value={it.goalId || ''}
                  onChange={e => {
                    const gid = e.target.value || null;
                    const g = goals.find(x => x.id === gid);
                    setProj({ items: items.map(x => x.id === it.id
                      ? { ...x, goalId: gid, label: (!x.label && g) ? g.name : x.label }
                      : x) });
                  }}>
                  <option value="">— none —</option>
                  {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}
          </div>
        ))}
        <div className="proj-add-row">
          <button type="button" className="proj-add proj-add-income" onClick={() => addItem('income')}>+ Income</button>
          <button type="button" className="proj-add proj-add-expense" onClick={() => addItem('expense')}>+ Expense</button>
        </div>
      </div>

      {/* Projection graph */}
      <div className="proj-chart-block">
        <div className="proj-chart-head">
          <div className="proj-chart-title">Projected balance</div>
          <div className="proj-horizon">
            {HORIZONS.map(h => (
              <button key={h.m} type="button" className={`proj-vt${horizon === h.m ? ' on' : ''}`} onClick={() => setProj({ horizon: h.m })}>{h.label}</button>
            ))}
          </div>
        </div>
        <div className="proj-chart-wrap">
          <svg ref={svgRef} className="proj-chart" viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Projected balance over time">
            {yticks.map(t => (
              <g key={t}>
                <line x1={PAD_L} x2={W - PAD_R} y1={sy(t)} y2={sy(t)} className="proj-grid" />
                <text x={PAD_L - 7} y={sy(t) + 3} className="proj-tick" textAnchor="end">{money(t)}</text>
              </g>
            ))}
            {zeroY != null && <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} className="proj-zero" />}
            <path d={areaPath} className={`proj-area ${netM >= 0 ? 'up' : 'down'}`} />
            <path d={linePath} className={`proj-line ${netM >= 0 ? 'up' : 'down'}`} />
            <text x={PAD_L} y={H - 8} className="proj-tick" textAnchor="start">now</text>
            <text x={W - PAD_R} y={H - 8} className="proj-tick" textAnchor="end">{Math.round(horizon / 12 * 10) / 10}y</text>
            {hover && (
              <g>
                <line x1={sx(hover.m)} x2={sx(hover.m)} y1={PAD_T} y2={H - PAD_B} className="proj-cross" />
                <circle cx={sx(hover.m)} cy={sy(hover.bal)} r="4" className={`proj-dot ${netM >= 0 ? 'up' : 'down'}`} />
              </g>
            )}
            <circle cx={sx(horizon)} cy={sy(endBal)} r="4" className={`proj-dot ${netM >= 0 ? 'up' : 'down'}`} />
          </svg>
          {hover && (
            <div className="proj-tooltip" style={{ left: `${(sx(hover.m) / W) * 100}%` }}>
              <div className="proj-tt-m">{hover.m === 0 ? 'Now' : `Month ${hover.m}`}</div>
              <div className="proj-tt-v">{money(hover.bal)}</div>
            </div>
          )}
        </div>
        <div className="proj-chart-foot">
          <span>Start {money(startBalance)}</span>
          <span className="proj-end">In {Math.round(horizon / 12 * 10) / 10}y: <strong>{money(endBal)}</strong></span>
        </div>
      </div>

      {/* Interest (optional) */}
      <div className="proj-apy">
        <label>Savings interest (APY %)</label>
        <input type="number" inputMode="decimal" placeholder="0" value={apy} onChange={e => setProj({ apy: e.target.value })} />
        {apyRate > 0 && <span className="proj-apy-note">≈ {money(interestEarned)} interest over {Math.round(horizon / 12 * 10) / 10}y</span>}
      </div>
    </div>
  );
}
