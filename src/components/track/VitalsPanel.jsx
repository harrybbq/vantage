/**
 * Vitals — readiness, today's readings, one chart, and what moves with what.
 *
 * ── The shape ────────────────────────────────────────────────────────
 * A 340px rail on the left carrying the two things you check without
 * reading — how you are today, and what each metric currently says —
 * and the whole remaining width for the chart, which is the only thing
 * here that gets better with room.
 *
 * ── Honest gating ────────────────────────────────────────────────────
 * Tiles for metrics no connected device reports are shown, greyed, with
 * the device that would fill them named. Hiding them entirely means a
 * user never learns the metric exists; showing them live means tapping
 * one does nothing. Greyed and labelled is the only version that
 * answers "why is HRV not here".
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VITAL_METRICS, metricAvailability, fmtMetric, sourceLabel } from '../../lib/vitals/metrics';
import {
  ymd, seriesOf, readinessFor, correlate, strengthOf, trendOf, sparkPath,
} from '../../lib/vitals/readiness';
import VitalsEntryModal from './VitalsEntryModal';

const RANGES = [
  { key: 7, label: '7D' },
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
];

/** The pairs worth putting on screen. Chosen because each is a question
 *  a person actually asks about their own week, not because the data
 *  happens to exist. */
const PAIRS = [
  { a: 'sleep', b: 'hrv',    title: 'Sleep → HRV',        read: 'Do longer nights show up in your HRV?' },
  { a: 'sleep', b: 'rhr',    title: 'Sleep → Rest HR',    read: 'Does sleeping more settle your resting heart rate?' },
  { a: 'strain', b: 'sleep', title: 'Strain → Sleep',     read: 'Do harder days make you sleep longer?' },
];

const RING = 2 * Math.PI * 48;

export default function VitalsPanel({ S, update }) {
  const [metricKey, setMetricKey] = useState('weight');
  const [days, setDays] = useState(30);
  const [entryOpen, setEntryOpen] = useState(false);

  const today = ymd();
  // Memoised: `S?.vitalsLog || {}` is a fresh object every render when
  // the key is missing, which would make every memo below it useless.
  const vitalsLog = useMemo(() => S?.vitalsLog || {}, [S?.vitalsLog]);
  /* Availability comes from the shared rule, which already knows that
     Oura reports HRV but not strain, and that history survives a
     disconnect. Locked metrics are shown greyed with the reason, not
     hidden — a missing row cannot tell you the feature exists. */
  const availability = useMemo(() => metricAvailability(S), [S]);
  const availableKeys = useMemo(
    () => new Set(availability.filter(m => m.available).map(m => m.key)),
    [availability],
  );
  const reasonOf = key => availability.find(m => m.key === key)?.reason || null;

  const ready = useMemo(() => readinessFor(vitalsLog, today), [vitalsLog, today]);

  // One pass for every tile, so the sparkline, the trend and the value
  // all come from the same series.
  const tiles = useMemo(() => VITAL_METRICS.map(m => {
    const pts = seriesOf(vitalsLog, m.key, 30);
    const last = pts.length ? pts[pts.length - 1] : null;
    const todayVal = vitalsLog[today]?.[m.key];
    return {
      m,
      locked: !availableKeys.has(m.key),
      lock: reasonOf(m.key),
      value: todayVal != null ? todayVal : last?.v,
      isToday: todayVal != null,
      spark: sparkPath(pts.slice(-14)),
      trend: trendOf(pts.slice(-14), m.dp),
      source: sourceLabel(m, S),
    };
  }), [vitalsLog, availableKeys, S, today]);

  const chartMetric = VITAL_METRICS.find(m => m.key === metricKey) || VITAL_METRICS[0];
  const chart = useMemo(() => seriesOf(vitalsLog, metricKey, days), [vitalsLog, metricKey, days]);
  const chartTrend = trendOf(chart, chartMetric.dp);

  const correlations = useMemo(() => PAIRS.map(p => {
    const c = correlate(vitalsLog, p.a, p.b, 30);
    return { ...p, ...c, strength: strengthOf(c.r) };
  }), [vitalsLog]);

  const missingToday = tiles.filter(t => !t.locked && !t.isToday).length;

  return (
    <>
      <div className="tv-wrap tv-vitals">
        <div className="tv-rail">
          {/* ── Readiness ── */}
          <div className="tv-card tv-ready">
            <div className="tv-rule"><span>Readiness</span><i /></div>
            <div className="tv-ready-top">
              <div className="tv-ring" style={{ '--ring-color': readyColour(ready.score) }}>
                <svg viewBox="0 0 112 112" aria-hidden="true">
                  <circle cx="56" cy="56" r="48" className="tv-ring-track" />
                  <circle cx="56" cy="56" r="48" className="tv-ring-arc"
                    strokeDasharray={`${((ready.score || 0) / 100) * RING} ${RING}`}
                    transform="rotate(-90 56 56)" />
                </svg>
                <div className="tv-ring-mid">
                  <div className="tv-ring-num">{ready.score ?? '—'}</div>
                  <div className="tv-ring-state">{ready.state}</div>
                </div>
              </div>
              <div className="tv-ready-parts">
                {ready.parts.map(p => (
                  <div key={p.key} className={`tv-part${p.has ? '' : ' is-off'}`}>
                    <div className="tv-part-top">
                      <span className="tv-part-lbl">{p.label}</span>
                      <span className="tv-part-val">{p.has ? p.value : '—'}</span>
                      <span className="tv-part-w">{Math.round(p.weight * 100)}%</span>
                    </div>
                    <div className="tv-part-bar"><i style={{ width: `${p.has ? p.pct : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <p className="tv-note">{ready.note}</p>
          </div>

          {/* ── Today's readings ── */}
          <div className="tv-card">
            <div className="tv-rule">
              <span>Today</span><i />
              <button type="button" className="tv-chip-btn" onClick={() => setEntryOpen(true)}>+ Enter</button>
            </div>
            <div className="tv-tiles">
              {tiles.map(t => (
                <button
                  key={t.m.key}
                  type="button"
                  className={`tv-tile${t.locked ? ' is-locked' : ''}${metricKey === t.m.key ? ' is-on' : ''}`}
                  style={{ '--tile-color': t.m.color }}
                  disabled={t.locked}
                  title={t.locked ? t.lock : `Plot ${t.m.label}`}
                  onClick={() => setMetricKey(t.m.key)}
                >
                  <span className="tv-tile-head">
                    <i className="tv-tile-dot" />
                    <span className="tv-tile-lbl">{t.m.label}</span>
                    <span className="tv-tile-src">{t.locked ? 'locked' : t.source}</span>
                  </span>
                  <span className="tv-tile-val">
                    <b>{fmtMetric(t.value, t.m)}</b>
                    <em>{t.m.unit}</em>
                    {!t.locked && t.value != null && !t.isToday && <span className="tv-tile-stale">last</span>}
                  </span>
                  <span className="tv-tile-foot">
                    <svg viewBox="0 0 60 18" preserveAspectRatio="none" aria-hidden="true">
                      <path d={t.spark} fill="none" stroke={t.m.color} strokeWidth="1.6"
                            strokeLinejoin="round" strokeLinecap="round" opacity=".85" />
                    </svg>
                    <span className="tv-tile-trend">
                      {t.trend ? `${t.trend.up ? '+' : ''}${t.trend.delta}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="tv-note">
              {missingToday === 0
                ? 'Everything available is logged for today.'
                : `${missingToday} still to log today. Tap a tile to plot it below.`}
            </p>
          </div>
        </div>

        <div className="tv-main">
          {/* ── The chart ── */}
          <div className="tv-card tv-chart-card">
            <div className="tv-chart-head">
              <div>
                <div className="tv-rule tv-rule-bare"><span>{chartMetric.label}</span></div>
                <div className="tv-chart-now">
                  <span className="tv-chart-num" style={{ color: chartMetric.color }}>
                    {fmtMetric(chart.length ? chart[chart.length - 1].v : null, chartMetric)}
                  </span>
                  <span className="tv-chart-unit">{chartMetric.unit}</span>
                  {chartTrend && !chartTrend.flat && (
                    <span className={`tv-delta${goodDelta(chartMetric, chartTrend.up) ? ' is-good' : ' is-bad'}`}>
                      {chartTrend.up ? '+' : ''}{chartTrend.delta} in {days}d
                    </span>
                  )}
                </div>
              </div>
              <div className="tv-ranges">
                {RANGES.map(r => (
                  <button key={r.key} type="button"
                    className={`tv-range${days === r.key ? ' is-on' : ''}`}
                    onClick={() => setDays(r.key)}>{r.label}</button>
                ))}
              </div>
            </div>

            <Chart points={chart} colour={chartMetric.color} dp={chartMetric.dp} />

            <div className="tv-metric-chips">
              {VITAL_METRICS.map(m => {
                const locked = !availableKeys.has(m.key);
                return (
                  <button key={m.key} type="button" disabled={locked}
                    className={`tv-mchip${metricKey === m.key ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
                    style={{ '--chip-color': m.color }}
                    title={locked ? reasonOf(m.key) : undefined}
                    onClick={() => setMetricKey(m.key)}>
                    <i />{m.label}{locked && <em>· locked</em>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── What moves with what ── */}
          <div className="tv-corrs">
            {correlations.map(c => (
              <div key={c.title} className="tv-card tv-corr">
                <div className="tv-rule tv-rule-bare"><span>{c.title}</span></div>
                <div className="tv-corr-r">
                  <span className="tv-corr-num" style={{ color: rColour(c.r) }}>
                    {c.r == null ? '—' : (c.r > 0 ? '+' : '') + c.r.toFixed(2)}
                  </span>
                  <span className="tv-corr-strength">{c.strength}</span>
                </div>
                <ScatterOrGap pairs={c.pairs} r={c.r} n={c.n} />
                <p className="tv-corr-read">{c.r == null ? `${c.n} of the 8 days needed so far.` : c.read}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {entryOpen && (
        <VitalsEntryModal S={S} update={update} onClose={() => setEntryOpen(false)} />
      )}
    </>
  );
}

/* ── The chart ───────────────────────────────────────────────────────
   Measured rather than scaled, for the same reason the old vitals chart
   had to be: a fixed viewBox stretched by width:100% turns a 3:1 aspect
   ratio into a 620px-tall chart on a wide display and takes the axis
   labels up with it. Here the viewBox width follows the element. */
const H = 240, PAD_T = 16, PAD_B = 26, PAD_L = 42, PAD_R = 14;

function Chart({ points, colour, dp }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const next = Math.round(el.clientWidth);
      if (next > 120) setW(prev => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setHover(null); }, [points]);

  if (points.length < 2) {
    return (
      <div className="tv-chart-empty" ref={wrapRef}>
        {points.length ? 'One reading so far — a second draws the line.' : 'Nothing logged for this metric yet.'}
      </div>
    );
  }

  const vals = points.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.12;
  lo -= pad; hi += pad;
  const x = i => PAD_L + (i / (points.length - 1)) * (w - PAD_L - PAD_R);
  const y = v => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H - PAD_B} L${x(0).toFixed(1)} ${H - PAD_B} Z`;
  const ticks = niceTicks(lo + pad, hi - pad);
  const shortDate = d => {
    const [, m, day] = d.split('-');
    return `${Number(day)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1]}`;
  };

  function onMove(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    let best = 0, bestD = Infinity;
    points.forEach((p, i) => { const d = Math.abs(x(i) - px); if (d < bestD) { bestD = d; best = i; } });
    setHover(best);
  }

  const h = hover != null ? points[hover] : null;

  return (
    <div className="tv-chart-wrap" ref={wrapRef}>
      <svg className="tv-chart" viewBox={`0 0 ${w} ${H}`} onPointerMove={onMove}
           onPointerLeave={() => setHover(null)} role="img"
           aria-label={`${points.length} readings`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD_L} x2={w - PAD_R} y1={y(t)} y2={y(t)} className="tv-grid" />
            <text x={PAD_L - 7} y={y(t) + 3} className="tv-axis" textAnchor="end">{fmtTick(t, dp)}</text>
          </g>
        ))}
        <path d={area} fill={colour} opacity=".10" />
        <path d={line} fill="none" stroke={colour} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {h && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} className="tv-cross" />
            <circle cx={x(hover)} cy={y(h.v)} r="4" fill={colour} stroke="var(--surface)" strokeWidth="2" />
          </>
        )}
        <text x={PAD_L} y={H - 8} className="tv-axis">{shortDate(points[0].date)}</text>
        <text x={w - PAD_R} y={H - 8} className="tv-axis" textAnchor="end">{shortDate(points[points.length - 1].date)}</text>
      </svg>
      {h && (
        <div className="tv-tip" style={{ left: `${(x(hover) / w) * 100}%` }}>
          <b>{fmtTick(h.v, dp)}</b><span>{shortDate(h.date)}</span>
        </div>
      )}
    </div>
  );
}

/** A scatter of the two metrics against each other — the honest picture
 *  of a correlation, where two overlaid lines only ever look convincing. */
function ScatterOrGap({ pairs, r, n }) {
  if (r == null) {
    return (
      <div className="tv-corr-gap">
        <div className="tv-corr-gap-bar"><i style={{ width: `${Math.min(100, (n / 8) * 100)}%` }} /></div>
      </div>
    );
  }
  const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
  const xlo = Math.min(...xs), xhi = Math.max(...xs), ylo = Math.min(...ys), yhi = Math.max(...ys);
  const sx = v => 6 + ((v - xlo) / (xhi - xlo || 1)) * 188;
  const sy = v => 6 + (1 - (v - ylo) / (yhi - ylo || 1)) * 60;
  return (
    <svg className="tv-scatter" viewBox="0 0 200 72" role="img" aria-label={`${n} days plotted`}>
      {pairs.map(([a, b], i) => (
        <circle key={i} cx={sx(a)} cy={sy(b)} r="2.6" fill={rColour(r)} opacity=".75" />
      ))}
    </svg>
  );
}

// ── Small helpers ────────────────────────────────────────────────────
function niceTicks(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step = [1, 2, 2.5, 5, 10].map(s => s * Math.pow(10, Math.floor(Math.log10(span / 3))))
    .find(s => span / s <= 4) || span / 3;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(+t.toFixed(4));
  return out;
}
const fmtTick = (v, dp) => (dp ? v.toFixed(dp) : Math.round(v).toLocaleString());
const readyColour = s => (s == null ? 'var(--text-muted)' : s >= 75 ? 'var(--em)' : s >= 55 ? '#c8970a' : '#c0563f');
const rColour = r => (r == null ? 'var(--text-muted)' : Math.abs(r) < 0.2 ? 'var(--text-muted)' : r > 0 ? 'var(--em)' : '#c0563f');
/** Is this direction the good one? Null for metrics with no better way. */
const goodDelta = (m, up) => (m.goodHigh == null ? true : m.goodHigh === up);
