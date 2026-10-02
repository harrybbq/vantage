/**
 * Supabase API traffic as stacked columns, one per time bucket, one
 * segment per service. Hand-rolled SVG, drawn to scale: zero baseline,
 * a clean axis top (niceMax), columns ≤ 24 px with a 2 px surface gap
 * between segments and a 4 px rounded data-end. Series colours are the
 * validated categorical slots 1–4 (blue, orange, aqua, yellow — checked
 * on both Upgrade surfaces), set as CSS tokens so they step for dark-os.
 * Light-mode contrast for three of them is under 3:1, so the legend
 * carries values and a table view is one tap away (dataviz relief rule).
 */
import { useEffect, useMemo, useState } from 'react';
import { stack, ticks, tickCount, bucketLabel, labelEvery, barWidth } from '../../../lib/security/chart';
import { fmtCompact, fmtInt, stamp } from '../../../lib/security/format';
import { Sparkline } from './parts';

export const SERIES = [
  { key: 'rest', name: 'REST' },
  { key: 'auth', name: 'Auth' },
  { key: 'storage', name: 'Storage' },
  { key: 'realtime', name: 'Realtime' },
];
const KEYS = SERIES.map(s => s.key);

/** Width of an element given by callback ref — re-measures whenever it (re)mounts. */
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

/** A rect with only its top corners rounded (the data-end). */
function topRounded(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export default function TrafficChart({ series, windowHours }) {
  const [box, setBox] = useState(null);
  const width = useWidth(box);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState('chart');
  const s = useMemo(() => stack(series, KEYS), [series]);
  const n = s.rows.length;

  const H = 170, L = 40, R = 6, T = 8, B = 22;
  const W = Math.max(240, width);
  const pw = W - L - R, ph = H - T - B;
  const band = n ? pw / n : pw;
  const bw = barWidth(band);
  const y = v => T + ph - (v / s.max) * ph;
  const axis = ticks(s.max, tickCount(s.max));
  const labels = new Set(labelEvery(n, W < 420 ? 4 : 7));

  const legend = (
    <div className="sec-legend">
      {SERIES.map((x, i) => (
        <span key={x.key} className="sec-legend-item">
          <i className={`sec-sw s${i + 1}`} aria-hidden="true" />
          <span className="sec-legend-name">{x.name}</span>
          <b>{fmtCompact(s.totals[x.key])}</b>
          <span className={`sec-legend-spark s${i + 1}`}>
            <Sparkline values={s.rows.map(r => r.segs[i].v)} w={56} h={16} label={`${x.name} over time`} />
          </span>
        </span>
      ))}
      <span className="sec-legend-total">Total <b>{fmtCompact(s.grand)}</b></span>
    </div>
  );

  if (!n) return <div className="sec-fine">No traffic recorded in this window.</div>;

  const h = hover != null ? s.rows[hover] : null;
  const hx = hover != null ? L + band * hover + band / 2 : 0;

  return (
    <div className="sec-traffic">
      <div className="sec-traffic-top">
        {legend}
        <div className="sec-seg" role="group" aria-label="View">
          <button type="button" className={view === 'chart' ? 'is-on' : ''} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
          <button type="button" className={view === 'table' ? 'is-on' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
        </div>
      </div>
      {view === 'chart' ? (
        <div className="sec-chart" ref={setBox} onMouseLeave={() => setHover(null)}>
          {width > 0 && (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
                 aria-label={`API requests per ${windowHours > 48 ? 'day' : 'hour'}, stacked by service. ${fmtInt(s.grand)} in total.`}>
              {axis.map(v => (
                <g key={v}>
                  <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="sec-grid" />
                  <text x={L - 6} y={y(v)} className="sec-axis" textAnchor="end" dominantBaseline="middle">{fmtCompact(v)}</text>
                </g>
              ))}
              {s.rows.map((r, i) => {
                const x = L + band * i + (band - bw) / 2;
                const segs = r.segs.filter(g => g.v > 0);
                return (
                  <g key={i} className={hover != null && hover !== i ? 'is-dim' : ''}>
                    {segs.map((g, j) => {
                      const top = y(g.y1), bot = y(g.y0) - (j > 0 ? 2 : 0);
                      const hh = Math.max(0, bot - top);
                      if (hh <= 0) return null;
                      const cls = `sec-col s${KEYS.indexOf(g.key) + 1}`;
                      return j === segs.length - 1
                        ? <path key={g.key} d={topRounded(x, top, bw, hh, 4)} className={cls} />
                        : <rect key={g.key} x={x} y={top} width={bw} height={hh} className={cls} />;
                    })}
                    {labels.has(i) && (
                      // The last label ends at its bar rather than centring on it, so it never runs off the edge.
                      <text x={i === n - 1 ? Math.min(W - R, L + band * (i + 1)) : L + band * i + band / 2} y={H - 6}
                            className="sec-axis" textAnchor={i === n - 1 ? 'end' : 'middle'}>
                        {bucketLabel(r.t, windowHours)}
                      </text>
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
            <div className="sec-tip" style={{ left: Math.min(Math.max(hx, 70), W - 70) }} role="status">
              <div className="sec-tip-t">{stamp(h.t)}</div>
              {SERIES.map((x, i) => (
                <div key={x.key} className="sec-tip-row"><i className={`sec-sw s${i + 1}`} />{x.name}<b>{fmtInt(h.segs[i].v)}</b></div>
              ))}
              <div className="sec-tip-row is-total">Total<b>{fmtInt(h.total)}</b></div>
            </div>
          )}
        </div>
      ) : (
        <div className="sec-scroll">
          <table className="sec-table">
            <thead><tr><th>Time</th>{SERIES.map(x => <th key={x.key} className="is-num">{x.name}</th>)}<th className="is-num">Total</th></tr></thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i}>
                  <td>{stamp(r.t)}</td>
                  {r.segs.map(g => <td key={g.key} className="is-num">{fmtInt(g.v)}</td>)}
                  <td className="is-num"><b>{fmtInt(r.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
