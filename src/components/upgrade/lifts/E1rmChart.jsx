/**
 * e1RM over time — hand-rolled SVG, drawn at the container's real pixel
 * width so circles stay round and text stays text-sized.
 *
 * To scale on both axes: x is calendar time (a three-week gap looks like
 * three weeks), y is kg on a linear axis with round gridlines. One point
 * per training day (the day's best set). PB sets — PBs when they were
 * lifted — are marked larger with a ring; night-shift sets (80% load)
 * are HOLLOW and off the line (it joins day-shift sets only), so a
 * lighter night never reads as a regression.
 *
 * Pointer or arrow keys pick a point; its set is read out under the
 * chart (and announced). A summary sits in the svg's aria-label.
 */
import { useMemo, useState } from 'react';
import { useWidth } from './parts';
import { dayNo, fmtE1rm, setText } from '../../../lib/lifts/lifts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

function niceStep(range, target = 4) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

export default function E1rmChart({ series, lift, pbIds, from, to }) {
  const [ref, width] = useWidth(640);
  const [pick, setPick] = useState(null);
  const H = width < 480 ? 200 : 240;
  const pad = { l: 44, r: 14, t: 24, b: 28 };

  const g = useMemo(() => {
    if (!series.length) return null;
    const x0 = from != null ? from : dayNo(series[0].date);
    const x1 = Math.max(to != null ? to : dayNo(series[series.length - 1].date), x0 + 1);
    const vals = series.map(p => p.value);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 4) { lo -= 2; hi += 2; }
    const step = niceStep(hi - lo);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const iw = width - pad.l - pad.r, ih = H - pad.t - pad.b;
    const X = n => pad.l + ((n - x0) / (x1 - x0)) * iw;
    const Y = v => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
    // Month ticks: every month, thinned to fit ~70px apart.
    const months = [];
    const d0 = new Date(x0 * 86400000), d1 = new Date(x1 * 86400000);
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1;
    if (m > 11) { m = 0; y++; }
    while (Date.UTC(y, m, 1) <= d1.getTime()) {
      months.push({ n: Math.floor(Date.UTC(y, m, 1) / 86400000), m, y });
      m++; if (m > 11) { m = 0; y++; }
    }
    const every = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(iw / 70))));
    const mt = months.filter((_, i) => i % every === 0);
    const pts = series.map(p => ({ ...p, x: X(dayNo(p.date)), y: Y(p.value), pb: !!(pbIds && pbIds.get(p.entry.id) && (pbIds.get(p.entry.id).e1rm)) }));
    // The line runs through day-shift sets only: a night set (80% load)
    // sits off the line as a hollow point instead of dragging it down.
    const day = pts.filter(p => !p.night);
    const line = (day.length >= 2 ? day : pts).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return { X, Y, ticks, mt, pts, line, lo, hi, iw, ih };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, width, H, from, to, pbIds]);

  if (!g) {
    return <div ref={ref} className="lf-chart is-empty"><p className="lf-muted">No e1RM to chart in this range{lift.load === 'bodyweight_plus' ? ' — dips need a bodyweight reading within 14 days of the set' : ''}.</p></div>;
  }
  const sel = pick != null ? g.pts[Math.min(pick, g.pts.length - 1)] : null;
  const first = g.pts[0], last = g.pts[g.pts.length - 1];
  const summary = `e1RM from ${fmtE1rm(first.value)} kg on ${dateLabel(first.date)} to ${fmtE1rm(last.value)} kg on ${dateLabel(last.date)}, ${g.pts.length} training days, ${g.pts.filter(p => p.pb).length} PBs.`;

  const nearest = ev => {
    const box = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - box.left;
    let best = 0, bd = Infinity;
    g.pts.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = i; } });
    setPick(best);
  };
  const onKey = e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setPick(p => {
        const cur = p == null ? g.pts.length - 1 : p;
        return Math.max(0, Math.min(g.pts.length - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1)));
      });
    } else if (e.key === 'Home') { e.preventDefault(); setPick(0); }
    else if (e.key === 'End') { e.preventDefault(); setPick(g.pts.length - 1); }
    else if (e.key === 'Escape') setPick(null);
  };

  return (
    <div ref={ref} className="lf-chart">
      <svg width={width} height={H} role="img" aria-label={summary} tabIndex={0} onKeyDown={onKey}
           onPointerMove={nearest} onPointerDown={nearest} onPointerLeave={e => { if (e.pointerType === 'mouse') setPick(null); }}>
        <g className="lf-grid">
          {g.ticks.map(v => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={g.Y(v)} y2={g.Y(v)} />
              <text x={pad.l - 8} y={g.Y(v)} dy="0.35em" textAnchor="end">{Math.round(v)}</text>
            </g>
          ))}
          {g.mt.map(t => (
            <text key={t.n} className="lf-xlbl" x={g.X(t.n)} y={H - 8} textAnchor="middle">
              {t.m === 0 ? String(t.y) : MONTHS[t.m]}
            </text>
          ))}
        </g>
        <path className="lf-line" d={g.line} />
        {g.pts.map((p, i) => (
          <circle key={p.date} cx={p.x} cy={p.y} r={p.pb ? 4.6 : 2.8}
                  className={`lf-pt${p.night ? ' is-night' : ''}${p.pb ? ' is-pb' : ''}${sel && i === pick ? ' is-sel' : ''}`} />
        ))}
        {sel && <line className="lf-cross" x1={sel.x} x2={sel.x} y1={pad.t} y2={H - pad.b} />}
        <text className="lf-unit" x={pad.l - 8} y={11} textAnchor="end">kg</text>
      </svg>
      <div className="lf-chart-read" aria-live="polite">
        {sel ? (
          <>
            <b>{dateLabel(sel.date)}</b>
            <span>{setText(sel.entry, lift)} · e1RM {fmtE1rm(sel.value)} kg</span>
            {sel.pb && <span className="lf-tag is-pb">PB</span>}
            {sel.night && <span className="lf-tag is-night">night shift · 80% load</span>}
          </>
        ) : (
          <span className="lf-legend">
            <span><i className="lf-key is-pb" />PB</span>
            <span><i className="lf-key" />Day&apos;s best set</span>
            <span><i className="lf-key is-night" />Night shift · 80% load</span>
          </span>
        )}
      </div>
    </div>
  );
}
