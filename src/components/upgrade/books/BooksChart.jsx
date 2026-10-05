/**
 * Income vs costs per month: paired columns, hand-rolled SVG like the
 * Security console's TrafficChart. Drawn to scale — zero baseline, a
 * clean axis top (niceMax), columns ≤ 18 px with a 2 px gap in the pair
 * and a rounded data-end. Two series, so a legend with totals names
 * them; months outside the chosen period are drawn faint rather than
 * dropped, so the year's shape stays readable. A table view is one tap
 * away (series colours are the validated categorical slots 1 and 2).
 */
import { useEffect, useState } from 'react';
import { niceMax, ticks, tickCount, labelEvery } from '../../../lib/security/chart';
import { fmtGBP } from '../../../lib/books/money';
import { monthLabel } from '../../../lib/upgrade/booksView';

function useWidth(el) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return undefined;
    const read = () => setW(Math.floor(el.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}

function topRounded(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Axis money: '£0', '£250', '£1.5k', '£12k'. */
function axisGBP(pence) {
  const p = pence / 100;
  if (p >= 1000) return `£${(p / 1000).toFixed(p % 1000 === 0 || p >= 10000 ? 0 : 1)}k`;
  return `£${Math.round(p)}`;
}

export default function BooksChart({ rows }) {
  const [box, setBox] = useState(null);
  const width = useWidth(box);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState('chart');
  const n = rows.length;
  const inPeriod = rows.filter(r => r.inPeriod);
  const totIn = inPeriod.reduce((s, r) => s + r.income, 0);
  const totOut = inPeriod.reduce((s, r) => s + r.expense, 0);
  const peak = rows.reduce((m, r) => Math.max(m, r.income, r.expense), 0);
  const max = niceMax(peak / 100) * 100;

  const H = 190, L = 46, R = 6, T = 10, B = 22;
  const W = Math.max(260, width);
  const pw = W - L - R, ph = H - T - B;
  const band = n ? pw / n : pw;
  const bw = Math.max(2, Math.min(18, (band - 6) / 2));
  const y = v => T + ph - (v / max) * ph;
  const axis = ticks(max, tickCount(max / 100));
  const labels = new Set(labelEvery(n, W < 420 ? 4 : n));
  const h = hover != null ? rows[hover] : null;
  const hx = hover != null ? L + band * hover + band / 2 : 0;

  return (
    <div className="sec-traffic bk-chart">
      <div className="sec-traffic-top">
        <div className="sec-legend">
          <span className="sec-legend-item"><i className="sec-sw s1" aria-hidden="true" /><span className="sec-legend-name">Income</span><b>{fmtGBP(totIn)}</b></span>
          <span className="sec-legend-item"><i className="sec-sw s2" aria-hidden="true" /><span className="sec-legend-name">Costs</span><b>{fmtGBP(totOut)}</b></span>
          <span className="sec-legend-total">{totIn - totOut >= 0 ? 'Profit' : 'Loss'} <b>{fmtGBP(Math.abs(totIn - totOut))}</b></span>
        </div>
        <div className="sec-seg" role="group" aria-label="View">
          <button type="button" className={view === 'chart' ? 'is-on' : ''} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
          <button type="button" className={view === 'table' ? 'is-on' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
        </div>
      </div>
      {view === 'chart' ? (
        <div className="sec-chart" ref={setBox} onMouseLeave={() => setHover(null)}>
          {width > 0 && (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
                 aria-label={`Income and costs per month, ${monthLabel(rows[0].month, true)} to ${monthLabel(rows[n - 1].month, true)}.`}>
              {axis.map(v => (
                <g key={v}>
                  <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="sec-grid" />
                  <text x={L - 6} y={y(v)} className="sec-axis" textAnchor="end" dominantBaseline="middle">{axisGBP(v)}</text>
                </g>
              ))}
              {rows.map((r, i) => {
                const cx = L + band * i + band / 2;
                const x1 = cx - bw - 1, x2 = cx + 1;
                const hi = Math.max(0, y(0) - y(r.income));
                const ho = Math.max(0, y(0) - y(r.expense));
                const dim = (!r.inPeriod ? ' is-out' : '') + (hover != null && hover !== i ? ' is-dim' : '');
                return (
                  <g key={r.month} className={dim}>
                    {hi > 0 && <path d={topRounded(x1, y(r.income), bw, hi, 3)} className="sec-col s1" />}
                    {ho > 0 && <path d={topRounded(x2, y(r.expense), bw, ho, 3)} className="sec-col s2" />}
                    {labels.has(i) && (
                      <text x={cx} y={H - 6} className="sec-axis" textAnchor="middle">{monthLabel(r.month).split(' ')[0]}</text>
                    )}
                    <rect x={L + band * i} y={T} width={band} height={ph} className="sec-hit"
                          onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                  </g>
                );
              })}
              <line x1={L} x2={W - R} y1={T + ph} y2={T + ph} className="sec-baseline" />
            </svg>
          )}
          {h && (
            <div className="sec-tip" style={{ left: Math.min(Math.max(hx, 80), W - 80) }} role="status">
              <div className="sec-tip-t">{monthLabel(h.month, true)}</div>
              <div className="sec-tip-row"><i className="sec-sw s1" />Income<b>{fmtGBP(h.income)}</b></div>
              <div className="sec-tip-row"><i className="sec-sw s2" />Costs<b>{fmtGBP(h.expense)}</b></div>
              <div className="sec-tip-row is-total">{h.income - h.expense >= 0 ? 'Profit' : 'Loss'}<b>{fmtGBP(Math.abs(h.income - h.expense))}</b></div>
            </div>
          )}
        </div>
      ) : (
        <div className="sec-scroll">
          <table className="sec-table">
            <thead><tr><th>Month</th><th className="is-num">Income</th><th className="is-num">Costs</th><th className="is-num">Profit</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.month} className={r.inPeriod ? '' : 'bk-row-out'}>
                  <td>{monthLabel(r.month, true)}</td>
                  <td className="is-num">{fmtGBP(r.income)}</td>
                  <td className="is-num">{fmtGBP(r.expense)}</td>
                  <td className="is-num"><b>{fmtGBP(r.income - r.expense)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
