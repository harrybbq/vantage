/**
 * One lift in the list: name, heaviest real set, the estimated 1RM
 * (labelled as an estimate — it is a trend, never a PB), × bodyweight
 * where that means something, a 26-week e1RM sparkline, last logged.
 * The card body opens the lift; "Log" is a sibling button (never nested
 * inside the open button), so both are reachable by keyboard.
 * A machine (perGym) lift shows its heaviest per gym ("DXC 192.5 ·
 * Greenock 150"), and its sparkline / 4-week change are the gym it was
 * last trained at — a line zig-zagging between two different stacks
 * would be a chart of the gyms, not of the lifter.
 */
import Icon from '../../Icon';
import { Spark } from './parts';
import { dayNo, daysBetween, fmtE1rm, fmtKg, setText, bannedRule, BANNED_NOTE, LOAD_LABEL, gymOf } from '../../../lib/lifts/lifts';

export const agoText = (iso, today) => {
  const d = daysBetween(iso, today);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} d ago` : `${Math.round(d / 30.4)} mo ago`;
};
export const changeText = v => (v == null ? null : `${v >= 0 ? '+' : '−'}${fmtE1rm(Math.abs(v))} kg`);

const gymLabel = (gyms, id) => (id ? ((gyms || []).find(g => g.id === id) || { name: id }).name : 'Unassigned');

export default function LiftCard({ s, today, onOpen, onLog, gyms }) {
  const { lift, pb, last, ratio, perGym, byGym } = s;
  // A machine reads its trend from the gym it was last trained at.
  const here = perGym && byGym && last ? byGym.find(g => g.gym === gymOf(last)) : null;
  const trend = here ? here.trend : s.trend;
  const perGymBests = perGym && byGym ? byGym.filter(g => g.pb.heaviest && (g.gym || byGym.length === 1)) : null;
  const to = dayNo(today), from = to - 26 * 7;
  // Best day-shift e1RM per week over the last 26 weeks.
  const weeks = new Map();
  for (const p of trend.series) {
    const n = dayNo(p.date);
    if (n < from || p.night) continue;
    const k = Math.floor((n - from) / 7);
    const cur = weeks.get(k);
    if (!cur || p.value > cur.y) weeks.set(k, { x: n, y: p.value });
  }
  const pts = [...weeks.values()].sort((a, b) => a.x - b.x);
  const banned = bannedRule(lift);
  const best = here ? here.pb.bestE1rm : pb.bestE1rm;
  const label = [
    `Open ${lift.name}`,
    perGymBests && perGymBests.length ? `heaviest ${perGymBests.map(g => `${gymLabel(gyms, g.gym)} ${fmtKg(g.pb.heaviest.entry.weight)} kg`).join(', ')}`
      : pb.heaviest ? `heaviest ${setText(pb.heaviest.entry, lift)}` : null,
    best ? `estimated 1RM about ${fmtE1rm(best.value)} kg` : null,
    ratio ? `${ratio} times bodyweight` : null,
    last ? `last logged ${agoText(last.date, today)}` : 'no sets yet',
  ].filter(Boolean).join(', ');
  const ch = changeText(trend.change4w);
  return (
    <li className={`lf-card${lift.archived ? ' is-archived' : ''}`} data-testid="lift-card">
      <button type="button" className="lf-card-main" onClick={onOpen} aria-label={label}>
        <span className="lf-card-head">
          <span className="lf-card-name">{lift.name}</span>
          {lift.archived ? <span className="lf-tag">archived</span> : <span className="lf-card-load">{LOAD_LABEL[lift.load]}</span>}
        </span>
        {banned && <span className="lf-banned"><Icon name="octagon-alert" size={13} /> {BANNED_NOTE}</span>}
        {s.sets.length ? (
          <>
            <span className="lf-card-figs">
              {perGymBests && perGymBests.length > 0 ? (
                <span className="lf-fig lf-fig-gyms" data-testid="lf-gym-bests">
                  <span className="lf-fig-lbl">Heaviest</span>
                  <span className="lf-gymbests">
                    {perGymBests.map(g => (
                      <span key={g.gym || 'none'} className="lf-gymbest"><em>{gymLabel(gyms, g.gym)}</em> <b>{fmtKg(g.pb.heaviest.entry.weight)}</b></span>
                    ))}
                  </span>
                </span>
              ) : (
              <span className="lf-fig">
                <span className="lf-fig-lbl">Heaviest</span>
                <span className="lf-fig-val">{pb.heaviest ? <>{lift.load === 'bodyweight_plus' ? (Number(pb.heaviest.entry.weight) ? `+${fmtKg(pb.heaviest.entry.weight)}` : 'BW') : fmtKg(pb.heaviest.entry.weight)}<small> {lift.load === 'per_hand' ? 'kg/hand' : lift.load === 'bodyweight_plus' && !Number(pb.heaviest.entry.weight) ? '' : 'kg'} × {pb.heaviest.entry.reps}</small></> : '—'}</span>
              </span>
              )}
              <span className="lf-fig">
                <span className="lf-fig-lbl">Est. 1RM</span>
                <span className="lf-fig-val is-set">{best ? `${best.low ? '≈' : '~'}${fmtE1rm(best.value)} kg` : '—'}</span>
              </span>
              {ratio != null && (
                <span className="lf-fig">
                  <span className="lf-fig-lbl">× BW</span>
                  <span className="lf-fig-val is-set">{ratio.toFixed(2).replace(/0$/, '')}×</span>
                </span>
              )}
            </span>
            <Spark points={pts} from={from} to={to} />
            <span className="lf-card-foot">
              <span>Last logged {agoText(last.date, today)}{here && here.gym ? ` · ${gymLabel(gyms, here.gym)}` : ''}</span>
              {ch && <span className={`lf-chg${trend.change4w > 0 ? ' is-up' : ''}`}>{ch} · 4 wk</span>}
            </span>
          </>
        ) : (
          <span className="lf-card-empty">No sets yet — log one to start this lift&apos;s record.</span>
        )}
      </button>
      {!lift.archived && (
        <button type="button" className="lf-card-log" onClick={onLog} aria-label={`Log a set of ${lift.name}`}>
          <Icon name="plus" size={14} /> Log
        </button>
      )}
    </li>
  );
}
