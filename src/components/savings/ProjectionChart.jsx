/**
 * Cash and savings, out to a horizon.
 *
 * Cash is what is left over each month, accumulated. Savings is every
 * account compounding at its own rate plus whatever is routed into it.
 * The dashed marks are the months pots are due to land, which is the
 * whole reason the two lines sit on one chart: the question is not
 * "will I have money" but "will I have it when the pot is due".
 *
 * The viewBox is measured rather than fixed. A fixed viewBox with
 * width:100% scales its height with the container, so the chart grew a
 * little taller on every wider display until it was a banner — the same
 * trap the Track calendar fell into. Here one SVG unit is one CSS pixel
 * and the height is whatever the CSS says.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { moneyK, money, monthLabel } from '../../lib/savings/derive';

const PAD_L = 54;
const PAD_R = 14;
const PAD_T = 18;
const PAD_B = 26;
const MIN_W = 260;

export default function ProjectionChart({
  cash, sav, horizon, marks, horizons, onHorizon,
  startBalance, startPlaceholder, onStartBalance,
}) {
  const wrapRef = useRef(null);
  const [W, setW] = useState(720);
  const [H, setH] = useState(250);
  const [show, setShow] = useState({ cash: true, savings: true });
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width) setW(Math.max(MIN_W, Math.round(r.width)));
      if (r.height) setH(Math.round(r.height));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A horizon change while hovering would leave a readout pointing at a
  // month that is no longer on the chart.
  useEffect(() => { setHover(null); }, [horizon]);

  const series = [];
  if (show.cash) series.push(...cash);
  if (show.savings) series.push(...sav);
  const vals = series.length ? [0, ...series] : [0, 1];
  const vMin = Math.min(...vals);
  const vMaxRaw = Math.max(...vals, 1);
  const vMax = vMaxRaw + (vMaxRaw - vMin) * 0.1 || 1;

  const sx = m => PAD_L + (m / Math.max(1, horizon)) * (W - PAD_L - PAD_R);
  const sy = v => PAD_T + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - PAD_T - PAD_B);
  const path = ser => ser.map((v, m) => (m ? 'L' : 'M') + sx(m).toFixed(1) + ',' + sy(v).toFixed(1)).join('');
  const area = ser => path(ser)
    + `L${sx(horizon).toFixed(1)},${sy(vMin).toFixed(1)}L${sx(0).toFixed(1)},${sy(vMin).toFixed(1)}Z`;

  const yStep = (vMax - vMin) / 3;
  const yTicks = [0, 1, 2, 3].map(i => {
    const v = vMin + yStep * i;
    return { v, y: sy(v), label: moneyK(v) };
  });

  const xStep = [1, 3, 6, 12, 24].find(s => horizon / s <= 6) || 24;
  const xTicks = [];
  for (let m = 0; m <= horizon; m += xStep) xTicks.push({ m, x: sx(m) });

  function onMove(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const m = Math.max(0, Math.min(horizon, Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * horizon)));
    setHover(m);
  }

  const hm = hover;
  const tipLeftPct = hm != null ? (sx(hm) / W) * 100 : 0;

  return (
    <div className="sb-panel sb-proj">
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-panel-title">Projection</h3>
          <p className="sb-panel-sub">Cash from what is left over; savings compounding at each account&apos;s rate.</p>
        </div>
        <div className="sb-proj-controls">
          <label className="sb-start">
            <span>Cash now</span>
            <span className="sb-start-field">
              <i>£</i>
              <input
                type="number" inputMode="decimal" placeholder={startPlaceholder || '0'}
                value={startBalance ?? ''}
                onChange={e => onStartBalance(e.target.value)}
              />
            </span>
          </label>
          <div className="sb-seg">
            {horizons.map(h => (
              <button
                key={h.m} type="button"
                className={`sb-seg-btn${horizon === h.m ? ' is-active' : ''}`}
                onClick={() => onHorizon(h.m)}
              >{h.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="sb-series">
        {[['cash', 'Cash'], ['savings', 'Savings']].map(([k, label]) => (
          <button
            key={k} type="button"
            className={`sb-series-btn is-${k}${show[k] ? ' is-on' : ''}`}
            onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}
            aria-pressed={show[k]}
          ><i />{label}</button>
        ))}
        {marks.length > 0 && <span className="sb-series-note"><i className="is-mark" />pot lands</span>}
      </div>

      <div className="sb-chart" ref={wrapRef}>
        <svg
          width={W} height={H} viewBox={`0 0 ${W} ${H}`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          role="img" aria-label={`Projected cash and savings over ${horizon} months`}
        >
          {yTicks.map(t => (
            <g key={t.y}>
              <line x1={PAD_L} x2={W - PAD_R} y1={t.y} y2={t.y} className="sb-chart-grid" />
              <text x={PAD_L - 6} y={t.y + 3.5} textAnchor="end" className="sb-chart-tick">{t.label}</text>
            </g>
          ))}

          {show.savings && (
            <g>
              <path d={area(sav)} className="sb-chart-sav-area" />
              <path d={path(sav)} className="sb-chart-sav" />
            </g>
          )}
          {show.cash && (
            <g>
              <path d={area(cash)} className="sb-chart-cash-area" />
              <path d={path(cash)} className="sb-chart-cash" />
            </g>
          )}

          {marks.map((mk, i) => (
            <g key={i}>
              <line x1={sx(mk.m)} x2={sx(mk.m)} y1={PAD_T} y2={H - PAD_B} className="sb-chart-mark" />
              <text x={sx(mk.m) + 4} y={PAD_T + 2} className="sb-chart-mark-label">{mk.label}</text>
            </g>
          ))}

          {hm != null && (
            <g>
              <line x1={sx(hm)} x2={sx(hm)} y1={PAD_T} y2={H - PAD_B} className="sb-chart-cross" />
              {show.cash && <circle cx={sx(hm)} cy={sy(cash[hm])} r="4" className="sb-chart-dot is-cash" />}
              {show.savings && <circle cx={sx(hm)} cy={sy(sav[hm])} r="4" className="sb-chart-dot is-sav" />}
            </g>
          )}

          {xTicks.map(t => (
            <text key={t.m} x={t.x} y={H - 6} textAnchor="middle" className="sb-chart-tick">
              {monthLabel(t.m)}
            </text>
          ))}
        </svg>

        {hm != null && (
          <div className="sb-tip" style={{ left: `${tipLeftPct}%` }}>
            <div className="sb-tip-month">{hm === 0 ? 'now' : monthLabel(hm)}</div>
            {show.cash && <div className="sb-tip-cash">Cash {money(cash[hm])}</div>}
            {show.savings && <div className="sb-tip-sav">Savings {money(sav[hm])}</div>}
            <div className="sb-tip-total">
              Total {money((show.cash ? cash[hm] : 0) + (show.savings ? sav[hm] : 0))}
            </div>
          </div>
        )}
      </div>

      {marks.length > 0 && (
        <div className="sb-marks-key">
          {marks.map((mk, i) => (
            <span key={i}>{mk.label} {mk.name} · {monthLabel(mk.m)}</span>
          ))}
        </div>
      )}
    </div>
  );
}
