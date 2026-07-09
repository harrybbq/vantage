/**
 * Hub widget bodies for the Savings tools — shared by the mobile hub
 * (MobileWidget) and the desktop canvas (HubSection React islands), so
 * there's one implementation per widget.
 *
 *   SavingsPotsBody       — 1 pot (big fill bar) or up to 4 (donut %s)
 *   SavingsProjectionBody — net/month + mini balance sparkline + end
 */

function money(n) {
  const neg = n < 0;
  return (neg ? '−£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB');
}
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
  const shown = goals.slice(0, count === 1 ? 1 : 4);

  const toggle = onSetCount ? (
    <div className="sw-count" onClick={e => e.stopPropagation()}>
      {[1, 4].map(n => (
        <button key={n} type="button" className={`sw-count-btn${count === n ? ' on' : ''}`} onClick={() => onSetCount(n)}>{n}</button>
      ))}
    </div>
  ) : null;

  if (!shown.length) {
    return (
      <div className="sw-pots">
        {toggle}
        <div className="sw-empty">No savings goals yet — add one in Savings.</div>
      </div>
    );
  }

  const go = () => navigate && navigate('achievements');

  if (count === 1) {
    const g = shown[0];
    const pct = Math.max(0, Math.min(1, (g.current || 0) / (g.target || 1)));
    return (
      <div className="sw-pots sw-pots-single" onClick={go} role={navigate ? 'link' : undefined} tabIndex={navigate ? 0 : undefined}>
        {toggle}
        <div className="sw-single-top">
          <span className="sw-single-name">{g.icon || '💰'} {g.name}</span>
          <span className="sw-single-pct">{Math.round(pct * 100)}%</span>
        </div>
        <div className="sw-single-bar"><div className="sw-single-fill" style={{ width: `${Math.max(2, pct * 100)}%`, background: pct >= 1 ? 'var(--gold, #d4a017)' : (g.color || 'var(--em)') }} /></div>
        <div className="sw-single-nums"><span>{money(g.current || 0)}</span><span>{money(g.target || 0)}</span></div>
      </div>
    );
  }

  return (
    <div className="sw-pots" onClick={go} role={navigate ? 'link' : undefined} tabIndex={navigate ? 0 : undefined}>
      {toggle}
      <div className="sw-donuts">
        {shown.map(g => (
          <Donut key={g.id} pct={(g.current || 0) / (g.target || 1)} color={g.color || 'var(--em)'} label={g.name} />
        ))}
      </div>
    </div>
  );
}

// ── Savings projection ──────────────────────────────────────────────────────
export function SavingsProjectionBody({ S, navigate }) {
  const proj = S.projection || {};
  const items = proj.items || [];
  const horizon = proj.horizon || 12;
  const savedTotal = (S.savings || []).reduce((s, g) => s + (g.current || 0), 0);
  const start = (proj.startBalance != null && proj.startBalance !== '') ? (parseFloat(proj.startBalance) || 0) : savedTotal;

  const incomeM = items.filter(i => i.kind === 'income').reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
  const expenseM = items.filter(i => i.kind === 'expense').reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
  const netM = incomeM - expenseM;

  if (!items.length) {
    return <div className="sw-empty" onClick={() => navigate && navigate('achievements')}>Set up a projection in Savings to see it here.</div>;
  }

  // Mini balance sparkline (cash only).
  const pts = [];
  let bal = start;
  for (let m = 0; m <= horizon; m++) { pts.push(bal); bal += netM; }
  const end = pts[pts.length - 1];
  const min = Math.min(...pts, 0), max = Math.max(...pts, 1);
  const W = 200, Hh = 44;
  const path = pts.map((v, i) => {
    const x = (i / horizon) * W;
    const y = Hh - ((v - min) / (max - min || 1)) * Hh;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join('');
  const up = netM >= 0;

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
      <svg className="sw-proj-spark" viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`${path}L${W},${Hh}L0,${Hh}Z`} className={`sw-proj-area ${up ? 'up' : 'down'}`} />
        <path d={path} className={`sw-proj-line ${up ? 'up' : 'down'}`} />
      </svg>
    </div>
  );
}
