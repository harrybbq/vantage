/**
 * Hub widget bodies for the Savings tools — shared by the mobile hub
 * (MobileWidget) and the desktop canvas (HubSection React islands), so
 * there's one implementation per widget.
 *
 *   SavingsPotsBody       — 1 pot (big fill bar) or up to 4 (donut %s)
 *   SavingsProjectionBody — net/month + resize-aware chart with date
 *                           axis and Cash / Savings line toggles
 */
import { useEffect, useMemo, useRef, useState } from 'react';

function money(n) {
  const neg = n < 0;
  return (neg ? '−£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB');
}

// Savings goals don't carry a colour of their own, so each pot gets a
// stable palette colour by its position in the goals list.
const POT_PALETTE = ['#2fbf83', '#5b8cff', '#d0498f', '#12a5a5', '#d99114', '#7a4fd0', '#e05252', '#4dc485'];
const potColor = (g, i) => g.color || POT_PALETTE[i % POT_PALETTE.length];
function toMonthly(amount, freq) {
  const v = parseFloat(amount) || 0;
  if (freq === 'year') return v / 12;
  if (freq === 'week') return v * 52 / 12;
  return v;
}

// ── Savings pots ──────────────────────────────────────────────────────────
function Donut({ pct, color, label, sub }) {
  const R = 26, C = 2 * Math.PI * R, size = 68;
  const p = Math.max(0, Math.min(1, pct));
  const done = p >= 1;
  return (
    <div className="sw-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="rgba(128,128,128,.22)" strokeWidth="5" />
        {p > 0 && (
          <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke={done ? 'var(--gold, #d4a017)' : color} strokeWidth="5"
            strokeDasharray={`${(p * C).toFixed(1)} ${C.toFixed(1)}`} strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )}
      </svg>
      <span className="sw-donut-pct">{Math.round(p * 100)}%</span>
      <span className="sw-donut-label" title={label}>{label}</span>
      {sub && <span className="sw-donut-sub">{sub}</span>}
    </div>
  );
}

export function SavingsPotsBody({ S, count = 1, onSetCount, navigate }) {
  const goals = (S.savings || []).filter(g => (g.target || 0) > 0);
  const max = Math.max(1, goals.length);
  const n = Math.min(Math.max(1, count || 1), max);
  const shown = goals.slice(0, n);

  // Stepper — any count from 1 up to how many goals exist.
  const stepper = onSetCount && max > 1 ? (
    <div className="sw-count" onClick={e => e.stopPropagation()}>
      <button type="button" className="sw-count-step" disabled={n <= 1} onClick={() => onSetCount(n - 1)} aria-label="Fewer pots">−</button>
      <span className="sw-count-n">{n}</span>
      <button type="button" className="sw-count-step" disabled={n >= max} onClick={() => onSetCount(n + 1)} aria-label="More pots">+</button>
    </div>
  ) : null;

  const go = () => navigate && navigate('achievements');

  if (!shown.length) {
    return <div className="sw-pots">{stepper}<div className="sw-empty">No savings goals yet — add one in Savings.</div></div>;
  }

  // Single pot → a full-widget bar that fills bottom-to-top.
  if (n === 1) {
    const g = shown[0];
    const pct = Math.max(0, Math.min(1, (g.current || 0) / (g.target || 1)));
    return (
      <div className="sw-pot-fill" onClick={go} role={navigate ? 'link' : undefined} tabIndex={navigate ? 0 : undefined}>
        <div className="sw-pot-fill-bar" style={{ height: `${Math.max(2, pct * 100)}%`, background: pct >= 1 ? 'var(--gold, #d4a017)' : potColor(g, goals.indexOf(g)) }} />
        {stepper}
        <div className="sw-pot-fill-overlay">
          <span className="sw-pot-fill-name">{g.icon || '💰'} {g.name}</span>
          <span className="sw-pot-fill-pct">{Math.round(pct * 100)}%</span>
          <span className="sw-pot-fill-nums">{money(g.current || 0)} / {money(g.target || 0)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="sw-pots sw-pots-multi" onClick={go} role={navigate ? 'link' : undefined} tabIndex={navigate ? 0 : undefined}>
      {stepper}
      <div className="sw-donuts">
        {shown.map((g, i) => (
          <Donut key={g.id} pct={(g.current || 0) / (g.target || 1)} color={potColor(g, i)} label={g.name} />
        ))}
      </div>
    </div>
  );
}

// ── Savings projection ──────────────────────────────────────────────────────
// Resize-aware: the chart area is measured with a ResizeObserver, and
//   width  → horizon (~20px per month, so stretching the widget wider
//            extends the projected date range), with month labels on
//            the bottom axis;
//   height → the money axis simply gains pixels (taller widget = more
//            vertical resolution + £ gridline labels appear).
// Maths mirror SavingsProjections.jsx: time-framed items (from/until),
// routed income skips the cash line, savings accounts compound at
// their APY plus linked monthly contributions.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SAVINGS_COLOR = '#d4a017';

function monthOffset(ym) {
  if (!ym) return null;
  const [y, mo] = ym.split('-').map(Number);
  const now = new Date();
  return (y - now.getFullYear()) * 12 + (mo - 1 - now.getMonth());
}
function activeAt(it, m) {
  const s = monthOffset(it.from), e = monthOffset(it.until);
  if (s != null && m < s) return false;
  if (e != null && m > e) return false;
  return true;
}
// Cash-flow contribution per month — routed income (salary paid
// straight into a pot/account) never touches the cash line.
function signedM(it, m) {
  if (!activeAt(it, m)) return 0;
  if (it.kind === 'income' && (it.goalId || it.accountId)) return 0;
  return (it.kind === 'income' ? 1 : -1) * toMonthly(it.amount, it.freq);
}
function monthLabel(m, withYear) {
  const now = new Date();
  const total = now.getMonth() + m;
  const y = now.getFullYear() + Math.floor(total / 12);
  const mo = ((total % 12) + 12) % 12;
  return MONTH_NAMES[mo] + (withYear || mo === 0 ? ` ’${String(y).slice(2)}` : '');
}
function yLabel(t) {
  if (Math.abs(t) >= 10000) return (t < 0 ? '−' : '') + '£' + Math.round(Math.abs(t) / 1000) + 'k';
  if (Math.abs(t) >= 1000) return (t < 0 ? '−' : '') + '£' + Math.round(Math.abs(t) / 100) / 10 + 'k';
  return money(t);
}

export function SavingsProjectionBody({ S, navigate }) {
  const proj = S.projection || {};
  const items = proj.items || [];
  const accounts = S.savingsAccounts || [];
  const hasAccounts = accounts.length > 0;
  const savedTotal = (S.savings || []).reduce((s, g) => s + (g.current || 0), 0);
  const start = (proj.startBalance != null && proj.startBalance !== '') ? (parseFloat(proj.startBalance) || 0) : savedTotal;

  // Which lines are plotted — never lets the last one be switched off.
  const [lines, setLines] = useState({ cash: true, savings: true });
  const [hover, setHover] = useState(null); // month index | null
  const showCash = lines.cash;
  const showSavings = hasAccounts && lines.savings;
  function toggleLine(key) {
    setLines(prev => {
      const next = { ...prev, [key]: !prev[key] };
      const anyOn = next.cash || (hasAccounts && next.savings);
      return anyOn ? next : prev;
    });
  }

  // Measure the chart area — the wrapper is the flex-filling element,
  // the SVG sits absolutely inside it so measuring can't feed back.
  const chartRef = useRef(null);
  const [size, setSize] = useState({ w: 240, h: 56 });
  useEffect(() => {
    const el = chartRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 40) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ~20px of width per projected month, clamped to 6mo–10y.
  const horizon = Math.max(6, Math.min(120, Math.round(size.w / 20)));

  const netM = items.reduce((s, it) => s + (activeAt(it, 0) ? (it.kind === 'income' ? 1 : -1) * toMonthly(it.amount, it.freq) : 0), 0);

  const cashSeries = useMemo(() => {
    const out = [start];
    let bal = start;
    for (let m = 1; m <= horizon; m++) { bal += items.reduce((s, it) => s + signedM(it, m), 0); out.push(bal); }
    return out;
  }, [start, horizon, items]);

  const savingsSeries = useMemo(() => {
    if (!hasAccounts) return null;
    const cur = accounts.map(a => parseFloat(a.balance) || 0);
    const rate = accounts.map(a => (parseFloat(a.apy) || 0) / 1200);
    const addAt = (accId, m) => items.reduce((s, it) => s + ((it.accountId === accId && activeAt(it, m)) ? toMonthly(it.amount, it.freq) : 0), 0);
    const out = [cur.reduce((s, b) => s + b, 0)];
    for (let m = 1; m <= horizon; m++) {
      for (let i = 0; i < cur.length; i++) cur[i] = cur[i] * (1 + rate[i]) + addAt(accounts[i].id, m);
      out.push(cur.reduce((s, b) => s + b, 0));
    }
    return out;
  }, [hasAccounts, accounts, items, horizon]);

  if (!items.length) {
    return <div className="sw-empty" onClick={() => navigate && navigate('achievements')}>Set up a projection in Savings to see it here.</div>;
  }

  // Clamp a stale hover if the horizon shrank between renders.
  const hv = hover != null ? Math.min(hover, horizon) : null;
  const cashEnd = cashSeries[cashSeries.length - 1];
  const savingsEnd = savingsSeries ? savingsSeries[savingsSeries.length - 1] : 0;
  const end = (showCash ? cashEnd : 0) + (showSavings ? savingsEnd : 0);
  const up = netM >= 0;

  // ── Chart geometry (real pixels, so text never distorts) ──
  const W = size.w, Hh = Math.max(48, size.h);
  const showYTicks = Hh >= 88;
  const PAD_L = showYTicks ? 34 : 4, PAD_R = 6, PAD_T = 4, PAD_B = 14;
  const vals = [...(showCash ? cashSeries : []), ...(showSavings ? savingsSeries : [])];
  let vMin = Math.min(...vals, 0), vMax = Math.max(...vals, 1);
  vMax += (vMax - vMin) * 0.06 || 1;
  const sx = m => PAD_L + (m / horizon) * (W - PAD_L - PAD_R);
  const sy = v => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (Hh - PAD_T - PAD_B);
  const pathOf = ser => ser.map((v, m) => `${m ? 'L' : 'M'}${sx(m).toFixed(1)},${sy(v).toFixed(1)}`).join('');

  // X ticks — a "nice" month step that keeps labels ~56px apart.
  const maxTicks = Math.max(2, Math.floor((W - PAD_L - PAD_R) / 56));
  const step = [1, 2, 3, 4, 6, 12, 24, 36, 60].find(s => horizon / s <= maxTicks) || 60;
  const xticks = [];
  for (let m = step; m <= horizon; m += step) xticks.push(m);
  const yticks = showYTicks ? [vMin, (vMin + vMax) / 2, vMax - (vMax - vMin) * 0.06].map(v => Math.round(v)) : [];

  return (
    <div className="sw-proj" onClick={() => navigate && navigate('achievements')} role={navigate ? 'link' : undefined} tabIndex={navigate ? 0 : undefined}>
      <div className="sw-proj-top">
        <div>
          <div className="sw-proj-net-label">NET / MONTH</div>
          <div className={`sw-proj-net ${up ? 'up' : 'down'}`}>{up ? '+' : ''}{money(netM)}</div>
        </div>
        <div className="sw-proj-end">
          <div className="sw-proj-net-label">IN {Math.round(horizon / 12 * 10) / 10}Y</div>
          <div className="sw-proj-endval">{money(end)}</div>
        </div>
      </div>
      <div className="sw-proj-toggles" onClick={e => e.stopPropagation()}>
        <button type="button" className={`sw-proj-tg${showCash ? ' on' : ''}`} onClick={() => toggleLine('cash')} aria-pressed={showCash}>
          <i style={{ background: 'var(--em)' }} /> Cash
        </button>
        {hasAccounts && (
          <button type="button" className={`sw-proj-tg${showSavings ? ' on' : ''}`} onClick={() => toggleLine('savings')} aria-pressed={showSavings}>
            <i style={{ background: SAVINGS_COLOR }} /> Savings
          </button>
        )}
      </div>
      <div className="sw-proj-chartwrap" ref={chartRef}>
        <svg
          className="sw-proj-chart"
          viewBox={`0 0 ${W} ${Hh}`}
          aria-hidden="true"
          onPointerMove={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            setHover(Math.max(0, Math.min(horizon, Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * horizon))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {yticks.map(t => (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={sy(t)} y2={sy(t)} className="sw-proj-grid" />
              <text x={PAD_L - 5} y={sy(t) + 3} className="sw-proj-tick" textAnchor="end">{yLabel(t)}</text>
            </g>
          ))}
          {showCash && <path d={`${pathOf(cashSeries)}L${sx(horizon).toFixed(1)},${sy(vMin).toFixed(1)}L${sx(0).toFixed(1)},${sy(vMin).toFixed(1)}Z`} className={`sw-proj-area ${up ? 'up' : 'down'}`} />}
          {showCash && <path d={pathOf(cashSeries)} className={`sw-proj-line ${up ? 'up' : 'down'}`} />}
          {showSavings && <path d={pathOf(savingsSeries)} className="sw-proj-line sw-proj-line-savings" />}
          {/* Date axis — "now" pinned left, then nice month steps */}
          <text x={sx(0)} y={Hh - 3} className="sw-proj-tick" textAnchor="start">now</text>
          {xticks.map(m => (
            <text key={m} x={sx(m)} y={Hh - 3} className="sw-proj-tick"
              textAnchor={m === horizon ? 'end' : 'middle'}>
              {monthLabel(m, step >= 12)}
            </text>
          ))}
          {/* Hover crosshair + point markers */}
          {hv != null && (
            <g>
              <line x1={sx(hv)} x2={sx(hv)} y1={PAD_T} y2={Hh - PAD_B} className="sw-proj-cross" />
              {showCash && <circle cx={sx(hv)} cy={sy(cashSeries[hv])} r="3.5" fill={up ? 'var(--em)' : '#d0596a'} />}
              {showSavings && <circle cx={sx(hv)} cy={sy(savingsSeries[hv])} r="3.5" fill={SAVINGS_COLOR} />}
            </g>
          )}
        </svg>
        {/* Balance pop-up at the hovered point */}
        {hv != null && (
          <div className="sw-proj-tt" style={{ left: `${(sx(hv) / W) * 100}%` }}>
            <div className="sw-proj-tt-m">{hv === 0 ? 'Now' : monthLabel(hv, true)}</div>
            {showCash && <div className="sw-proj-tt-v" style={{ color: up ? 'var(--em)' : '#d0596a' }}>Cash {money(cashSeries[hv])}</div>}
            {showSavings && <div className="sw-proj-tt-v" style={{ color: SAVINGS_COLOR }}>Savings {money(savingsSeries[hv])}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
