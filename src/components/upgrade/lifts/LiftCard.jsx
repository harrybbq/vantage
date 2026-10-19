/**
 * One lift in the list (brief §3.8).
 *
 * Phone row, 64 px, inside one panel with hairlines:
 *   row 1  name (15/600, 2-line clamp) · best REAL set (16 mono) · ◆ · [+] 44
 *   row 2  load · per-gym bests (machines, active gym first — never one
 *          combined number) or "best at DXC" (free weights) · a 64 × 16
 *          sparkline of real top sets (PB gold dot, night hollow, last
 *          marked) · last logged ("3d")
 * Desktop card, 296 × 132: name, best set at 22 mono, the per-gym line, a
 * sparkline across the card, last logged, + Log.
 *
 * The open button and Log are siblings (never nested), both keyboard
 * reachable. A machine's best and sparkline are the ACTIVE gym's (a DXC
 * stack isn't a Greenock stack); a free weight's are every gym's.
 */
import { useMemo } from 'react';
import Icon from '../../Icon';
import { PbMark } from './ui';
import { useWidth } from './parts';
import { perGymBests, sparkPoints, agoShort } from '../../../lib/lifts/home';
import { realSetText } from '../../../lib/lifts/ui';
import { LOAD_LABEL, fmtKg, daysBetween, gymOf } from '../../../lib/lifts/lifts';

/** "yesterday" / "12 d ago" — kept for older callers. */
export const agoText = (iso, today) => {
  const d = daysBetween(iso, today);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} d ago` : `${Math.round(d / 30.4)} mo ago`;
};
export const changeText = v => (v == null ? null : `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v))} kg`);

/** A gym's short tag: "DXC", "GRE" — ≤ 5 characters stay whole. */
export const gymShort = name => { const n = String(name || '').trim(); return (n.length <= 5 ? n : n.slice(0, 3)).toUpperCase(); };
const NEW_PB_DAYS = 14;
/** Row 2 is 12 px mono in ~250 px: the load in a word or two. */
const SHORT_LOAD = { weight: 'Weight', per_hand: 'Per DB', bodyweight_plus: 'BW + added' };

/** The numbers a row / card shows, worked out once. */
export function cardModel(s, { today, activeGym = null, gymOrder = [], gymName = id => id, bwOf } = {}) {
  const { lift, pb, sets, last, perGym, pbIds } = s;
  const bests = perGym ? perGymBests(sets, lift, { activeGym, gymOrder, bwOf }) : [];
  const head = perGym ? (bests.find(b => b.gym === activeGym) || bests[0] || null) : null;
  const best = perGym ? (head ? head.best : null) : pb.heaviest;
  const bestGym = perGym ? (head ? head.gym : null) : (pb.heaviest ? gymOf(pb.heaviest.entry) : null);
  const ev = best && pbIds ? pbIds.get(best.entry.id) : null;
  const fresh = !!(best && daysBetween(best.entry.date, today) <= NEW_PB_DAYS && ev);
  const sparkGym = perGym ? (head ? head.gym : activeGym) : null;
  const spark = sparkPoints(sets, lift, { gym: sparkGym, pbIds, n: 16 });
  const gymsLine = perGym
    ? bests.map(b => ({ gym: b.gym, label: b.gym ? gymShort(gymName(b.gym)) : '—', value: fmtKg(b.best.entry.weight), active: b.gym === activeGym }))
    : [];
  return {
    lift, best, bestGym, fresh, spark, gymsLine, count: sets.length, last,
    ago: last ? agoShort(last.date, today) : '',
    load: SHORT_LOAD[lift.load] || LOAD_LABEL[lift.load] || 'Weight',
  };
}

/** A tiny sparkline at a fixed pixel size: real top sets, PB gold dot, night hollow, the last value marked. Decorative. */
export function MiniSpark({ points, width = 64, height = 16, className = '' }) {
  const P = 3;
  if (!points || points.length < 2) {
    return <svg className={`lh-spark is-empty ${className}`} width={width} height={height} aria-hidden="true"><line x1={P} x2={width - P} y1={height / 2} y2={height / 2} /></svg>;
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < 1) { y0 -= 1; y1 += 1; }
  const X = x => P + ((x - x0) / Math.max(1, x1 - x0)) * (width - 2 * P);
  const Y = y => height - P - ((y - y0) / (y1 - y0)) * (height - 2 * P);
  const day = points.filter(p => !p.night);
  const d = (day.length >= 2 ? day : points).map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
  return (
    <svg className={`lh-spark ${className}`} width={width} height={height} aria-hidden="true">
      <path className="lh-spark-line" d={d} />
      {points.filter(p => p.night).map(p => <circle key={`n${p.x}`} className="lh-spark-night" cx={X(p.x)} cy={Y(p.y)} r="2" />)}
      {points.filter(p => p.pb && !p.last).map(p => <circle key={`p${p.x}`} className="lh-spark-pb" cx={X(p.x)} cy={Y(p.y)} r="2" />)}
      {points.filter(p => p.last).map(p => <circle key="last" className={`lh-spark-last${p.pb ? ' is-pb' : ''}`} cx={X(p.x)} cy={Y(p.y)} r="2.5" />)}
    </svg>
  );
}

function ariaFor(m, gymName, today) {
  return [
    `Open ${m.lift.name}`,
    m.best ? `best ${realSetText(m.best.entry.weight, m.best.entry.reps, m.lift)}${m.bestGym && m.gymsLine.length ? ` at ${gymName(m.bestGym)}` : ''}` : null,
    m.fresh ? 'a new PB' : null,
    m.gymsLine.length > 1 ? `per gym ${m.gymsLine.map(g => `${g.gym ? gymName(g.gym) : 'no gym'} ${g.value}`).join(', ')}` : null,
    m.last ? `last logged ${agoText(m.last.date, today)}` : 'no sets yet',
  ].filter(Boolean).join(', ');
}

/** The row / card — `variant` 'row' (phone list) or 'card' (desktop grid). */
export default function LiftCard({ s, today, activeGym = null, gymOrder = [], gymName = id => id, bwOf, onOpen, onLog, variant = 'row' }) {
  const m = useMemo(() => cardModel(s, { today, activeGym, gymOrder, gymName, bwOf }), [s, today, activeGym, gymOrder, gymName, bwOf]);
  const label = ariaFor(m, gymName, today);
  const bestTxt = m.best ? realSetText(m.best.entry.weight, m.best.entry.reps, m.lift) : '—';
  const line2 = m.gymsLine.length
    ? m.gymsLine.map(g => <span key={g.gym || 'none'} className={`lh-gb${g.active ? ' is-active' : ''}`}>{g.label} <b>{g.value}</b></span>)
    : m.bestGym ? <span className="lh-gb">best at {gymShort(gymName(m.bestGym))}</span> : null;
  if (variant === 'card') return <GridCard m={m} label={label} bestTxt={bestTxt} line2={line2} onOpen={onOpen} onLog={onLog} />;
  return (
    <li className="lh-lrow" data-testid="lift-card">
      <button type="button" className="lh-lrow-main" onClick={onOpen} aria-label={label}>
        <span className="lh-lrow-r1">
          <span className="lh-lrow-name">{m.lift.name}</span>
          <span className="lh-lrow-best lf-num">{bestTxt}</span>
          <span className="lh-lrow-pb">{m.fresh && <PbMark />}</span>
        </span>
        <span className="lh-lrow-r2">
          <span className="lh-lrow-meta"><span className="lh-load">{m.load}</span>{line2 && <span className="lh-sep" aria-hidden="true">·</span>}{line2}</span>
          <MiniSpark points={m.spark} width={64} height={16} />
          <span className="lh-ago lf-num">{m.ago}</span>
        </span>
      </button>
      {onLog && (
        <button type="button" className="lh-logbtn" onClick={onLog} aria-label={`Log a set of ${m.lift.name}`} data-testid="lift-log">
          <Icon name="plus" size={18} />
        </button>
      )}
    </li>
  );
}

function GridCard({ m, label, bestTxt, line2, onOpen, onLog }) {
  const [ref, w] = useWidth(264);
  return (
    <li className="lh-gcard" data-testid="lift-card">
      <button type="button" className="lh-gcard-main" onClick={onOpen} aria-label={label}>
        <span className="lh-gcard-name">{m.lift.name}</span>
        <span className="lh-gcard-best">
          <span className="lf-num">{bestTxt}</span>
          {m.fresh && <span className="lh-gcard-pb"><PbMark /> PB</span>}
        </span>
        <span className="lh-gcard-line"><span className="lh-load">{m.load}</span>{line2 && <span className="lh-sep" aria-hidden="true">·</span>}{line2}</span>
        <span ref={ref} className="lh-gcard-spark"><MiniSpark points={m.spark} width={Math.max(120, w)} height={32} /></span>
        <span className="lh-gcard-foot lf-num">{m.last ? `last ${m.ago}` : 'not logged yet'} · {m.count} {m.count === 1 ? 'set' : 'sets'}</span>
      </button>
      {onLog && (
        <button type="button" className="lh-gcard-log" onClick={onLog} aria-label={`Log a set of ${m.lift.name}`} data-testid="lift-log">
          <Icon name="plus" size={14} /> Log
        </button>
      )}
    </li>
  );
}
