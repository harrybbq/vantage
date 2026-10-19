/**
 * est. 1RM over time (brief §3.9) — hand-rolled SVG drawn at the
 * container's real pixel width (circles stay round, text stays text-sized).
 *
 *   axis     Y on the RIGHT, 3–4 round ticks, dynamic range, no frame,
 *            hairline grid; months along the bottom
 *   lines    one per gym (free weight, "All") or the selected gym only
 *            (machine / one gym) — the active gym accent 2 px, others mid
 *            1.5 px, each labelled at its right end ("DXC ~241"), no legend box
 *   trend    the 5-session rolling median of DAY sessions; night sessions
 *            never join it; a gap > 28 days breaks it (home.js trendSegments)
 *   points   raw per-session estimates as 4 px dots; a real PB session is a
 *            gold diamond 10 px with an s1 outline; night is an 8 px hollow
 *            indigo circle; a 6–12-rep estimate has a dotted outline; sets of
 *            > 12 reps and warm-ups make no point at all (sessionE1rms)
 *   < 3      sessions: points only, and "needs 3 sessions for a trend"
 *   scrub    the whole plot is the target; a vertical rule snaps to the
 *            nearest session and the readout ABOVE the plot updates (never
 *            under the finger); release restores the summary. ← / → keys.
 * The line is an ESTIMATE; gold marks sets that were actually lifted.
 *
 * Props: groups [{ id, label, points: sessionE1rms(..) }], accentId (the
 * gym drawn in accent), pbKeys (Set of session keys with a real PB),
 * lift, from / to (day numbers; null = fit), height, summary (the readout
 * text at rest), gymLabel(id).
 */
import { useMemo, useState } from 'react';
import { useWidth } from './parts';
import { trendSegments, niceTicks, TREND_WINDOW } from '../../../lib/lifts/home';
import { roundEstimate } from '../../../lib/lifts/ui';
import { realSetText } from '../../../lib/lifts/ui';
import { fmtKg } from '../../../lib/lifts/lifts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const est = v => `~${fmtKg(roundEstimate(v, 'readout'))}`;

export default function E1rmChart({ groups, accentId = null, pbKeys = null, lift, from = null, to = null, height = 200, summary = '', emptyText = null }) {
  const [ref, width] = useWidth(358);
  const [pick, setPick] = useState(null);
  const W = Math.max(200, width);
  const H = height;
  const pad = { l: 6, r: 44, t: 22, b: 24 };   // right: the Y tick labels; top: room for the end labels

  const g = useMemo(() => {
    const live = (groups || []).filter(gr => gr.points.length);
    const all = live.flatMap(gr => gr.points);
    if (!all.length) return null;
    const ns = all.map(p => p.n);
    const x0 = from != null ? Math.min(from, Math.min(...ns)) : Math.min(...ns);
    const x1 = Math.max(to != null ? to : Math.max(...ns), x0 + 1);
    const tk = niceTicks(Math.min(...all.map(p => p.value)), Math.max(...all.map(p => p.value)), 4);
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const X = n => pad.l + ((n - x0) / (x1 - x0)) * iw;
    const Y = v => pad.t + ih - ((v - tk.lo) / Math.max(1e-9, tk.hi - tk.lo)) * ih;
    // Month ticks, thinned to ≥ 56 px apart.
    const months = [];
    const d0 = new Date(x0 * 86400000);
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1;
    if (m > 11) { m = 0; y++; }
    while (Math.floor(Date.UTC(y, m, 1) / 86400000) <= x1) {
      months.push({ n: Math.floor(Date.UTC(y, m, 1) / 86400000), m, y });
      m++; if (m > 11) { m = 0; y++; }
    }
    const every = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(iw / 56))));
    const mt = months.filter((_, i) => i % every === 0);
    const daySessions = live.reduce((k, gr) => k + gr.points.filter(p => !p.night).length, 0);
    const lines = live.map((gr, k) => {
      const accent = live.length === 1 || gr.id === accentId;
      const segs = gr.points.filter(p => !p.night).length >= 3 ? trendSegments(gr.points) : [];
      const paths = segs.filter(s => s.length >= 2).map(s => s.map((p, i) => `${i ? 'L' : 'M'}${X(p.n).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(' '));
      const flat = segs.flat();
      const end = flat.length ? flat[flat.length - 1] : null;
      const pts = gr.points.map(p => ({ ...p, x: X(p.n), y: Y(p.value), pb: !!(pbKeys && pbKeys.has(p.key)), gid: gr.id, glabel: gr.label }));
      return { ...gr, k, accent, paths, end, pts };
    });
    // End labels sit just above each line's right end; nudged apart so two gyms never print on top of each other.
    const ends = lines.filter(l => l.end).map(l => ({ l, y: Y(l.end.value) - 10 })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    for (const e of ends) e.l.endY = Math.min(H - pad.b - 4, Math.max(8, e.y));
    const pts = lines.flatMap(l => l.pts).sort((a, b) => a.x - b.x);
    return { X, Y, tk, mt, lines, pts, iw, ih, daySessions };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, W, H, from, to, pbKeys, accentId]);

  if (!g) {
    return (
      <div ref={ref} className="lh-chart is-empty" data-testid="lh-chart">
        <p className="lf-meta">{emptyText || `No est. 1RM in this range. Sets of 1–12 reps make an estimate${lift && lift.load === 'bodyweight_plus' ? ' (a dip also needs a bodyweight reading within 14 days)' : ''}; warm-ups don’t.`}</p>
      </div>
    );
  }
  const sel = pick != null ? g.pts[Math.min(pick, g.pts.length - 1)] : null;
  const multi = g.lines.length > 1;
  const noTrend = g.lines.every(l => !l.paths.length);
  const aria = `Estimated 1RM chart, ${g.pts.length} sessions${multi ? ` across ${g.lines.length} gyms` : ''}. `
    + g.lines.filter(l => l.pts.length).map(l => `${multi ? `${l.label}: ` : ''}from ${est(l.pts[0].value)} kg on ${dateLabel(l.pts[0].date)} to ${est(l.pts[l.pts.length - 1].value)} kg on ${dateLabel(l.pts[l.pts.length - 1].date)}`).join('; ')
    + `. ${g.pts.filter(p => p.pb).length} sessions with a real PB set${noTrend ? '. Needs 3 day sessions for a trend.' : `. Trend: ${TREND_WINDOW}-session median of day sessions.`}`;

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
      setPick(p => { const cur = p == null ? g.pts.length - 1 : p; return Math.max(0, Math.min(g.pts.length - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1))); });
    } else if (e.key === 'Home') { e.preventDefault(); setPick(0); }
    else if (e.key === 'End') { e.preventDefault(); setPick(g.pts.length - 1); }
    else if (e.key === 'Escape' && pick != null) { e.stopPropagation(); setPick(null); }
  };
  const readout = sel
    ? <>
        <b className="lf-num">{dateLabel(sel.date)}</b>
        {multi && <span className="lh-gymtag">{sel.glabel}</span>}
        <span className="lf-num">{realSetText(sel.entry.weight, sel.entry.reps, lift)}</span>
        <span className="lh-ro-est lf-num">est. {est(sel.value)}{sel.loose ? ' (6–12 reps)' : ''}</span>
        {sel.pb && <span className="lh-ro-pb">◆ PB set</span>}
        {sel.night && <span className="lh-ro-night">☾ night</span>}
      </>
    : <span className="lh-ro-sum">{noTrend ? `${summary ? `${summary} · ` : ''}needs 3 sessions for a trend` : summary}</span>;

  return (
    <div ref={ref} className="lh-chart" data-testid="lh-chart">
      <div className="lh-readout" aria-live="polite" data-testid="lh-readout">{readout}</div>
      <svg width={W} height={H} role="img" aria-label={aria} tabIndex={0} onKeyDown={onKey} className="lh-chart-svg"
           onPointerMove={nearest} onPointerDown={nearest}
           onPointerUp={e => { if (e.pointerType !== 'mouse') setPick(null); }}
           onPointerLeave={() => setPick(null)} onPointerCancel={() => setPick(null)} onBlur={() => setPick(null)}>
        <g className="lh-cgrid">
          {g.tk.ticks.map(v => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r + 4} y1={g.Y(v)} y2={g.Y(v)} />
              <text className="lh-tick" x={W - pad.r + 8} y={g.Y(v)} dy="0.35em">{fmtKg(v)}</text>
            </g>
          ))}
          {g.mt.map(t => (
            <text key={t.n} className="lh-xlbl" x={g.X(t.n)} y={H - 6} textAnchor="middle">{t.m === 0 ? String(t.y) : MONTHS[t.m]}</text>
          ))}
        </g>
        {g.lines.map(l => l.paths.map((d, i) => <path key={`t${l.k}-${i}`} className={`lh-trend${l.accent ? ' is-accent' : ''}`} d={d} />))}
        {g.lines.map(l => l.pts.map(p => {
          if (p.night) return <circle key={`${l.k}-${p.key}`} className="lh-pt-night" cx={p.x} cy={p.y} r="4" />;
          if (p.pb) return <path key={`${l.k}-${p.key}`} className="lh-pt-pb" d={`M${p.x} ${p.y - 5}L${p.x + 5} ${p.y}L${p.x} ${p.y + 5}L${p.x - 5} ${p.y}Z`} />;
          return <circle key={`${l.k}-${p.key}`} className={`lh-pt${l.accent ? ' is-accent' : ''}${p.loose ? ' is-loose' : ''}`} cx={p.x} cy={p.y} r={p.loose ? 2.5 : 2} />;
        }))}
        {g.lines.filter(l => l.end).map(l => (
          <text key={`e${l.k}`} className={`lh-endlbl${l.accent ? ' is-accent' : ''}`} x={g.X(l.end.n)} y={l.endY} dy="0.35em" textAnchor="end">
            {multi ? `${l.label} ` : ''}{est(l.end.value)}
          </text>
        ))}
        {sel && <line className="lh-rule" x1={sel.x} x2={sel.x} y1={pad.t} y2={H - pad.b} />}
        {sel && <circle className="lh-sel" cx={sel.x} cy={sel.y} r="6" />}
      </svg>
      <p className="lh-key" aria-hidden="true">
        <span><i className="lh-key-pb">◆</i> PB set</span>
        <span><i className="lh-key-day">●</i> day session</span>
        <span><i className="lh-key-night">○</i> night 80 %</span>
        <span><i className="lh-key-trend" /> trend (day)</span>
      </p>
    </div>
  );
}
