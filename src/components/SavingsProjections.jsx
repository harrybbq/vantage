/**
 * SavingsProjections — cash-flow + savings planner under the Savings
 * tab. Desktop lays out as three modules (mirrors the Track screen):
 *
 *   ┌ Projections ┐ ┌ Cash flow ────┐ ┌ Savings accounts ┐
 *   │  graph +    │ │ income /       │ │ dummy accounts   │
 *   │  balance    │ │ expenses +     │ │ (balance + APY)  │
 *   │             │ │ folders        │ │                  │
 *   └─────────────┘ └────────────────┘ └──────────────────┘
 *
 * On mobile the three stack into one column (layout unchanged).
 *
 * The graph plots two series: projected CASH (starting balance +
 * cumulative net cash flow) and SAVINGS (sum of savings-account
 * balances, each compounding at its own APY).
 *
 * State:
 *   S.projection = {
 *     items:[{id,kind:'income'|'expense',label,amount,freq:'week'|'month'|'year',goalId,groupId}],
 *     groups:[{id,name}], horizon:number(months), startBalance:string
 *   }
 *   S.savingsAccounts = [{id,name,balance,apy}]
 */
import { useMemo, useRef, useState } from 'react';

const HORIZONS = [{ m: 12, label: '1y' }, { m: 24, label: '2y' }, { m: 60, label: '5y' }];
const SAVINGS_COLOR = '#d4a017';

function toMonthly(amount, freq) {
  const v = parseFloat(amount) || 0;
  if (freq === 'year') return v / 12;
  if (freq === 'week') return v * 52 / 12;
  return v;
}
function money(n) {
  const neg = n < 0;
  return (neg ? '−£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB');
}

export default function SavingsProjections({ S, update }) {
  const proj = S.projection || {};
  const items = proj.items || [];
  const groups = proj.groups || [];
  const goals = S.savings || [];
  const accounts = S.savingsAccounts || [];
  const horizon = proj.horizon || 12;

  const [view, setView] = useState('month');
  const [hover, setHover] = useState(null);
  const [openPots, setOpenPots] = useState(() => new Set());
  const [collapsed, setCollapsed] = useState(() => new Set());
  const svgRef = useRef(null);

  const savedTotal = useMemo(() => (S.savings || []).reduce((s, g) => s + (g.current || 0), 0), [S.savings]);
  const hasCustomStart = proj.startBalance != null && proj.startBalance !== '';
  const startBalance = hasCustomStart ? (parseFloat(proj.startBalance) || 0) : savedTotal;

  function setProj(patch) {
    update(prev => ({ ...prev, projection: { items, groups, horizon, ...prev.projection, ...patch } }));
  }
  function setAccounts(fn) {
    update(prev => ({ ...prev, savingsAccounts: fn(prev.savingsAccounts || []) }));
  }
  const uid = p => p + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);

  function addItem(kind, groupId = null) { setProj({ items: [...items, { id: uid('p'), kind, label: '', amount: '', freq: 'month', groupId }] }); }
  function updateItem(id, key, val) { setProj({ items: items.map(it => it.id === id ? { ...it, [key]: val } : it) }); }
  function removeItem(id) { setProj({ items: items.filter(it => it.id !== id) }); }

  function addGroup() { setProj({ groups: [...groups, { id: uid('g'), name: 'New folder' }] }); }
  function renameGroup(id, name) { setProj({ groups: groups.map(g => g.id === id ? { ...g, name } : g) }); }
  function removeGroup(id) { setProj({ groups: groups.filter(g => g.id !== id), items: items.map(it => it.groupId === id ? { ...it, groupId: null } : it) }); }
  function toggleCollapse(id) { setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  function addAccount() { setAccounts(a => [...a, { id: uid('a'), name: '', balance: '', apy: '' }]); }
  function updateAccount(id, key, val) { setAccounts(a => a.map(x => x.id === id ? { ...x, [key]: val } : x)); }
  function removeAccount(id) { setAccounts(a => a.filter(x => x.id !== id)); }

  // ── Maths ──
  const incomeM = items.filter(i => i.kind === 'income').reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
  const expenseM = items.filter(i => i.kind === 'expense').reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
  const netM = incomeM - expenseM;
  const mult = view === 'year' ? 12 : 1;

  const cashSeries = useMemo(() => {
    const out = []; let bal = startBalance;
    for (let m = 0; m <= horizon; m++) { out.push({ m, bal }); bal += netM; }
    return out;
  }, [startBalance, horizon, netM]);

  const savingsStart = accounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
  const hasAccounts = accounts.length > 0 && savingsStart > 0;
  const savingsSeries = useMemo(() => {
    const out = [];
    for (let m = 0; m <= horizon; m++) {
      out.push({ m, bal: accounts.reduce((s, a) => s + (parseFloat(a.balance) || 0) * Math.pow(1 + (parseFloat(a.apy) || 0) / 1200, m), 0) });
    }
    return out;
  }, [accounts, horizon]);

  const cashEnd = cashSeries[cashSeries.length - 1].bal;
  const savingsEnd = savingsSeries[savingsSeries.length - 1].bal;

  // ── Chart geometry (scales over both series) ──
  const W = 560, H = 190, PAD_L = 50, PAD_R = 12, PAD_T = 12, PAD_B = 22;
  const allVals = [0, ...cashSeries.map(p => p.bal), ...(hasAccounts ? savingsSeries.map(p => p.bal) : [])];
  let vMin = Math.min(...allVals), vMax = Math.max(...allVals, 1);
  vMax += (vMax - vMin) * 0.08 || 1;
  const sx = m => PAD_L + (m / horizon) * (W - PAD_L - PAD_R);
  const sy = v => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD_T - PAD_B);
  const pathOf = ser => ser.map((p, i) => `${i ? 'L' : 'M'}${sx(p.m).toFixed(1)},${sy(p.bal).toFixed(1)}`).join('');
  const cashPath = pathOf(cashSeries);
  const cashArea = cashPath + `L${sx(horizon).toFixed(1)},${sy(vMin).toFixed(1)}L${sx(0).toFixed(1)},${sy(vMin).toFixed(1)}Z`;
  const zeroY = vMin < 0 ? sy(0) : null;
  const yticks = [vMin, (vMin + vMax) / 2, vMax].map(v => Math.round(v));
  const yLabel = t => Math.abs(t) >= 1000 ? '£' + Math.round(t / 1000) + 'k' : money(t);

  function onMove(e) {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const m = Math.max(0, Math.min(horizon, Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * horizon)));
    setHover({ m, cash: cashSeries[m]?.bal, savings: savingsSeries[m]?.bal });
  }

  const potMonthlyFor = () => 0; // (unused here; goal ETA computed in SavingsList)

  // Loose items vs foldered
  const incomeItems = items.filter(i => i.kind === 'income');
  const looseExpenses = items.filter(i => i.kind === 'expense' && !i.groupId);

  function renderRow(it) {
    return (
      <div key={it.id} className={`proj-item proj-item-${it.kind}`}>
        <div className={`proj-row proj-row-${it.kind}`}>
          <button type="button" className="proj-kind" onClick={() => updateItem(it.id, 'kind', it.kind === 'income' ? 'expense' : 'income')} title="Toggle income / expense">{it.kind === 'income' ? '+' : '−'}</button>
          <input className="proj-label" placeholder={it.kind === 'income' ? 'e.g. Salary' : 'e.g. Rent'} value={it.label} onChange={e => updateItem(it.id, 'label', e.target.value)} />
          <div className="proj-amt-wrap"><span className="proj-amt-cur">£</span><input className="proj-amt" type="number" inputMode="decimal" placeholder="0" value={it.amount} onChange={e => updateItem(it.id, 'amount', e.target.value)} /></div>
          <select className="proj-freq" value={it.freq} onChange={e => updateItem(it.id, 'freq', e.target.value)}><option value="week">/wk</option><option value="month">/mo</option><option value="year">/yr</option></select>
          <button type="button" className="proj-del" onClick={() => removeItem(it.id)} aria-label="Remove">✕</button>
        </div>
        {it.kind === 'expense' && goals.length > 0 && (
          (it.goalId || openPots.has(it.id)) ? (
            <div className="proj-link-row">
              <span className="proj-link-arrow">↳ into pot</span>
              <select className="proj-link-select" value={it.goalId || ''} onChange={e => { const gid = e.target.value || null; const g = goals.find(x => x.id === gid); setProj({ items: items.map(x => x.id === it.id ? { ...x, goalId: gid, label: (!x.label && g) ? g.name : x.label } : x) }); }}>
                <option value="">— pick a pot —</option>
                {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button type="button" className="proj-link-del" onClick={() => { setProj({ items: items.map(x => x.id === it.id ? { ...x, goalId: null } : x) }); setOpenPots(prev => { const n = new Set(prev); n.delete(it.id); return n; }); }} aria-label="Remove pot link">✕</button>
            </div>
          ) : (
            <button type="button" className="proj-add-pot" onClick={() => setOpenPots(prev => new Set(prev).add(it.id))}>+ pot</button>
          )
        )}
      </div>
    );
  }

  return (
    <div className="proj-dash">
      {/* ── LEFT: Projections graph ── */}
      <div className="card proj-col proj-col-graph">
        <div className="proj-head">
          <div><h3 style={{ margin: '0 0 2px' }}>Projections</h3><p className="proj-sub">How your money grows over time.</p></div>
          <div className="proj-horizon">{HORIZONS.map(h => <button key={h.m} type="button" className={`proj-vt${horizon === h.m ? ' on' : ''}`} onClick={() => setProj({ horizon: h.m })}>{h.label}</button>)}</div>
        </div>

        <div className="proj-legend">
          <span className="proj-leg"><i style={{ background: 'var(--em)' }} /> Cash</span>
          {hasAccounts && <span className="proj-leg"><i style={{ background: SAVINGS_COLOR }} /> Savings</span>}
        </div>

        <div className="proj-chart-wrap">
          <svg ref={svgRef} className="proj-chart" viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Projected balance over time">
            {yticks.map(t => (<g key={t}><line x1={PAD_L} x2={W - PAD_R} y1={sy(t)} y2={sy(t)} className="proj-grid" /><text x={PAD_L - 6} y={sy(t) + 3} className="proj-tick" textAnchor="end">{yLabel(t)}</text></g>))}
            {zeroY != null && <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} className="proj-zero" />}
            <path d={cashArea} className={`proj-area ${netM >= 0 ? 'up' : 'down'}`} />
            <path d={cashPath} className={`proj-line ${netM >= 0 ? 'up' : 'down'}`} />
            {hasAccounts && <path d={pathOf(savingsSeries)} className="proj-line proj-line-savings" />}
            <text x={PAD_L} y={H - 7} className="proj-tick" textAnchor="start">now</text>
            <text x={W - PAD_R} y={H - 7} className="proj-tick" textAnchor="end">{Math.round(horizon / 12 * 10) / 10}y</text>
            {hover && (<g><line x1={sx(hover.m)} x2={sx(hover.m)} y1={PAD_T} y2={H - PAD_B} className="proj-cross" /><circle cx={sx(hover.m)} cy={sy(hover.cash)} r="3.5" className={`proj-dot ${netM >= 0 ? 'up' : 'down'}`} />{hasAccounts && <circle cx={sx(hover.m)} cy={sy(hover.savings)} r="3.5" className="proj-dot-savings" />}</g>)}
          </svg>
          {hover && (
            <div className="proj-tooltip" style={{ left: `${(sx(hover.m) / W) * 100}%` }}>
              <div className="proj-tt-m">{hover.m === 0 ? 'Now' : `Month ${hover.m}`}</div>
              <div className="proj-tt-v" style={{ color: 'var(--em)' }}>Cash {money(hover.cash)}</div>
              {hasAccounts && <div className="proj-tt-v" style={{ color: SAVINGS_COLOR }}>Savings {money(hover.savings)}</div>}
            </div>
          )}
        </div>

        <div className="proj-chart-foot">
          <div className="proj-start"><label>Start £</label><input type="number" inputMode="decimal" value={proj.startBalance ?? ''} placeholder={String(Math.round(savedTotal))} onChange={e => setProj({ startBalance: e.target.value })} />{hasCustomStart ? <button type="button" className="proj-start-reset" onClick={() => setProj({ startBalance: '' })}>↺</button> : <span className="proj-start-hint">saved</span>}</div>
          <span className="proj-end">In {Math.round(horizon / 12 * 10) / 10}y: <strong>{money(cashEnd + (hasAccounts ? savingsEnd : 0))}</strong></span>
        </div>
      </div>

      {/* ── CENTRE: Cash flow (income / expenses / folders) ── */}
      <div className="card proj-col proj-col-items">
        <div className="proj-head">
          <div><h3 style={{ margin: 0 }}>Cash flow</h3></div>
          <div className="proj-viewtoggle">{['month', 'year'].map(v => <button key={v} type="button" className={`proj-vt${view === v ? ' on' : ''}`} onClick={() => setView(v)}>{v === 'month' ? 'Monthly' : 'Yearly'}</button>)}</div>
        </div>

        <div className="proj-summary">
          <div className="proj-tile"><span className="proj-tile-label">Income</span><span className="proj-tile-val proj-pos">{money(incomeM * mult)}</span></div>
          <div className="proj-tile"><span className="proj-tile-label">Expenses</span><span className="proj-tile-val proj-neg">{money(expenseM * mult)}</span></div>
          <div className="proj-tile proj-tile-net"><span className="proj-tile-label">Net / {view}</span><span className={`proj-tile-val ${netM >= 0 ? 'proj-pos' : 'proj-neg'}`}>{netM >= 0 ? '+' : ''}{money(netM * mult)}</span></div>
        </div>

        <div className="proj-items">
          {incomeItems.map(renderRow)}
          {looseExpenses.map(renderRow)}

          {/* Expense folders */}
          {groups.map(g => {
            const gItems = items.filter(it => it.groupId === g.id);
            const subtotal = gItems.reduce((s, it) => s + toMonthly(it.amount, it.freq), 0) * mult;
            const isOpen = !collapsed.has(g.id);
            return (
              <div key={g.id} className="proj-folder">
                <div className="proj-folder-head">
                  <button type="button" className="proj-folder-toggle" onClick={() => toggleCollapse(g.id)} aria-label="Collapse folder">{isOpen ? '▾' : '▸'}</button>
                  <input className="proj-folder-name" value={g.name} onChange={e => renameGroup(g.id, e.target.value)} />
                  <span className="proj-folder-sub proj-neg">{money(subtotal)}</span>
                  <button type="button" className="proj-del" onClick={() => removeGroup(g.id)} aria-label="Delete folder" title="Delete folder (items move out)">✕</button>
                </div>
                {isOpen && (
                  <div className="proj-folder-body">
                    {gItems.map(renderRow)}
                    <button type="button" className="proj-add proj-add-expense proj-add-infolder" onClick={() => addItem('expense', g.id)}>+ Expense</button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="proj-add-row">
            <button type="button" className="proj-add proj-add-income" onClick={() => addItem('income')}>+ Income</button>
            <button type="button" className="proj-add proj-add-expense" onClick={() => addItem('expense')}>+ Expense</button>
            <button type="button" className="proj-add proj-add-folder" onClick={addGroup}>+ Folder</button>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Savings accounts ── */}
      <div className="card proj-col proj-col-accounts">
        <div className="proj-head"><div><h3 style={{ margin: '0 0 2px' }}>Savings accounts</h3><p className="proj-sub">Balances + interest — plotted as the Savings line.</p></div></div>
        <div className="proj-accounts">
          {accounts.length === 0 && <div className="proj-acc-empty">No accounts yet. Add your savings pots (Marcus, Chase saver…) with their balance and rate.</div>}
          {accounts.map(a => (
            <div key={a.id} className="proj-acc-row">
              <input className="proj-acc-name" placeholder="Account name" value={a.name} onChange={e => updateAccount(a.id, 'name', e.target.value)} />
              <div className="proj-acc-fields">
                <div className="proj-amt-wrap"><span className="proj-amt-cur">£</span><input className="proj-amt" type="number" inputMode="decimal" placeholder="0" value={a.balance} onChange={e => updateAccount(a.id, 'balance', e.target.value)} /></div>
                <div className="proj-acc-apy"><input type="number" inputMode="decimal" placeholder="0" value={a.apy} onChange={e => updateAccount(a.id, 'apy', e.target.value)} /><span>% APY</span></div>
                <button type="button" className="proj-del" onClick={() => removeAccount(a.id)} aria-label="Remove account">✕</button>
              </div>
            </div>
          ))}
          <button type="button" className="proj-add proj-add-account" onClick={addAccount}>+ Account</button>
          {hasAccounts && (
            <div className="proj-acc-total">
              <span>Total now <strong>{money(savingsStart)}</strong></span>
              <span className="proj-acc-grow">In {Math.round(horizon / 12 * 10) / 10}y ≈ <strong style={{ color: SAVINGS_COLOR }}>{money(savingsEnd)}</strong></span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
