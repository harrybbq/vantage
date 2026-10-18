/**
 * Estimated 1RM over time — hand-rolled SVG, drawn at the container's
 * real pixel width so circles stay round and text stays text-sized. The
 * line is an ESTIMATE (a trend); gold points mark days with a real PB
 * set (heaviest or a rep max) — PBs are never the estimate.
 *
 * To scale on both axes: x is calendar time (a three-week gap looks like
 * three weeks), y is kg on a linear axis with round gridlines. One point
 * per training day (the day's best set). Days with a real PB set are
 * marked larger in gold; night-shift sets (80% load)
 * are HOLLOW and off the line (it joins day-shift sets only), so a
 * lighter night never reads as a regression.
 *
 * Per gym (`groups`, a machine lift's All view): one line per gym, each
 * its own colour AND its own point shape (circle, square, diamond), with
 * a legend naming them — never colour alone. A PB point is gold in its
 * gym's shape, judged against that gym only.
 *
 * Pointer or arrow keys pick a point; its set is read out under the
 * chart (and announced). A summary sits in the svg's aria-label.
 */
import { useMemo, useState } from 'react';
import { useWidth } from './parts';
import { dayNo, fmtE1rm, setText, pbHeadline, gymOf } from '../../../lib/lifts/lifts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const SHAPES = ['circle', 'square', 'diamond'];

function niceStep(range, target = 4) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

/** One point in its group's shape. r is the circle radius; squares and diamonds match its area-ish. */
export function Mark({ shape, x, y, r, className }) {
  if (shape === 'square') { const h = r * 0.9; return <rect className={className} x={x - h} y={y - h} width={h * 2} height={h * 2} />; }
  if (shape === 'diamond') { const h = r * 1.25; return <path className={className} d={`M${x} ${y - h}L${x + h} ${y}L${x} ${y + h}L${x - h} ${y}Z`} />; }
  return <circle className={className} cx={x} cy={y} r={r} />;
}

export default function E1rmChart({ series, groups, lift, pbDays, from, to }) {
  const [ref, width] = useWidth(640);
  const [pick, setPick] = useState(null);
  const H = width < 480 ? 200 : 240;
  const pad = { l: 44, r: 14, t: 24, b: 28 };
  const multi = Array.isArray(groups) && groups.length > 1;
  const sets = useMemo(() => (Array.isArray(groups) && groups.length
    ? groups.map((g, i) => ({ ...g, k: i, shape: SHAPES[i % SHAPES.length] }))
    : [{ id: null, label: '', series: series || [], k: 0, shape: 'circle' }]), [groups, series]);

  const g = useMemo(() => {
    const all = sets.flatMap(s => s.series);
    if (!all.length) return null;
    const firstN = Math.min(...all.map(p => dayNo(p.date))), lastN = Math.max(...all.map(p => dayNo(p.date)));
    const x0 = from != null ? from : firstN;
    const x1 = Math.max(to != null ? to : lastN, x0 + 1);
    const vals = all.map(p => p.value);
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
    const lines = sets.map(s => {
      const pts = s.series.map(p => {
        const evs = ((pbDays && pbDays.get(p.date)) || []).filter(ev => !multi || gymOf(ev.entry) === s.id);
        return { ...p, x: X(dayNo(p.date)), y: Y(p.value), pb: evs.length > 0, evs, k: s.k, shape: s.shape, gym: s.id, gymLabel: s.label };
      });
      // The line runs through day-shift sets only: a night set (80% load)
      // sits off the line as a hollow point instead of dragging it down.
      const day = pts.filter(p => !p.night);
      const line = (day.length >= 2 ? day : pts).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      return { ...s, pts, line };
    });
    const pts = lines.flatMap(l => l.pts).sort((a, b) => a.x - b.x || a.k - b.k);
    return { X, Y, ticks, mt, pts, lines, lo, hi, iw, ih };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, width, H, from, to, pbDays, multi]);

  if (!g) {
    return <div ref={ref} className="lf-chart is-empty"><p className="lf-muted">No e1RM to chart in this range{lift.load === 'bodyweight_plus' ? ' — dips need a bodyweight reading within 14 days of the set' : ''}.</p></div>;
  }
  const sel = pick != null ? g.pts[Math.min(pick, g.pts.length - 1)] : null;
  const summary = multi
    ? `Estimated 1RM per gym: ${g.lines.filter(l => l.pts.length).map(l => `${l.label} from about ${fmtE1rm(l.pts[0].value)} to about ${fmtE1rm(l.pts[l.pts.length - 1].value)} kg over ${l.pts.length} training days`).join('; ')}.`
    : (() => {
      const first = g.pts[0], last = g.pts[g.pts.length - 1];
      return `Estimated 1RM from about ${fmtE1rm(first.value)} kg on ${dateLabel(first.date)} to about ${fmtE1rm(last.value)} kg on ${dateLabel(last.date)}, ${g.pts.length} training days, ${g.pts.filter(p => p.pb).length} with a real PB set.`;
    })();

  const nearest = ev => {
    const box = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - box.left, y = ev.clientY - box.top;
    let best = 0, bd = Infinity;
    g.pts.forEach((p, i) => { const d = Math.abs(p.x - x) + (multi ? Math.abs(p.y - y) * 0.35 : 0); if (d < bd) { bd = d; best = i; } });
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
    <div ref={ref} className={`lf-chart${multi ? ' is-multi' : ''}`}>
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
        {g.lines.map(l => <path key={`l${l.k}`} className={`lf-line is-g${l.k}`} d={l.line} />)}
        {g.lines.map(l => l.pts.map(p => (
          <Mark key={`${l.k}-${p.date}`} shape={l.shape} x={p.x} y={p.y} r={p.pb ? 4.6 : multi ? 3.2 : 2.8}
                className={`lf-pt is-g${l.k}${p.night ? ' is-night' : ''}${p.pb ? ' is-pb' : ''}${sel && sel === p ? ' is-sel' : ''}`} />
        )))}
        {sel && <line className="lf-cross" x1={sel.x} x2={sel.x} y1={pad.t} y2={H - pad.b} />}
        <text className="lf-unit" x={pad.l - 8} y={11} textAnchor="end">kg</text>
      </svg>
      <div className="lf-chart-read" aria-live="polite">
        {sel ? (
          <>
            <b>{dateLabel(sel.date)}{multi ? ` · ${sel.gymLabel}` : ''}</b>
            <span>{setText(sel.entry, lift)} · est. 1RM ~{fmtE1rm(sel.value)} kg</span>
            {sel.pb && sel.evs.map(ev => (
              <span key={ev.entry.id} className="lf-tag is-pb">PB {setText(ev.entry, lift)} · {pbHeadline(ev)}</span>
            ))}
            {sel.night && <span className="lf-tag is-night">night shift · 80% load</span>}
          </>
        ) : (
          <span className="lf-legend">
            {multi ? g.lines.map(l => (
              <span key={`k${l.k}`} data-testid="lf-gym-key">
                <svg className="lf-key-svg" width="22" height="12" aria-hidden="true">
                  <line className={`lf-line is-g${l.k}`} x1="1" x2="21" y1="6" y2="6" />
                  <Mark shape={l.shape} x={11} y={6} r={3.4} className={`lf-pt is-g${l.k}`} />
                </svg>
                {l.label}
              </span>
            )) : <span><i className="lf-key is-line" />Estimated 1RM</span>}
            <span><i className="lf-key is-pb" />Real PB set that day</span>
            <span><i className="lf-key is-night" />Night shift · 80% load</span>
          </span>
        )}
      </div>
    </div>
  );
}
