/**
 * One lift in the list: name, best e1RM, heaviest set, × bodyweight
 * where that means something, a 26-week e1RM sparkline, last logged.
 * The card body opens the lift; "Log" is a sibling button (never nested
 * inside the open button), so both are reachable by keyboard.
 */
import Icon from '../../Icon';
import { Spark } from './parts';
import { dayNo, daysBetween, fmtE1rm, setText, bannedRule, BANNED_NOTE, LOAD_LABEL } from '../../../lib/lifts/lifts';

export const agoText = (iso, today) => {
  const d = daysBetween(iso, today);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 60 ? `${d} d ago` : `${Math.round(d / 30.4)} mo ago`;
};
export const changeText = v => (v == null ? null : `${v >= 0 ? '+' : '−'}${fmtE1rm(Math.abs(v))} kg`);

export default function LiftCard({ s, today, onOpen, onLog }) {
  const { lift, pb, trend, last, ratio } = s;
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
  const best = pb.bestE1rm;
  const label = [
    `Open ${lift.name}`,
    best ? `best e1RM ${fmtE1rm(best.value)} kg` : 'no e1RM yet',
    pb.heaviest ? `heaviest ${setText(pb.heaviest.entry, lift)}` : null,
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
              <span className="lf-fig">
                <span className="lf-fig-lbl">Best e1RM</span>
                <span className="lf-fig-val">{best ? <>{best.low ? '≈' : ''}{fmtE1rm(best.value)}<small> kg</small></> : '—'}</span>
              </span>
              <span className="lf-fig">
                <span className="lf-fig-lbl">Heaviest</span>
                <span className="lf-fig-val is-set">{pb.heaviest ? setText(pb.heaviest.entry, lift) : '—'}</span>
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
              <span>Last logged {agoText(last.date, today)}</span>
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
