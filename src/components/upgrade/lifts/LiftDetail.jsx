/**
 * One lift: headline figures, the estimated-1RM chart (range 3M / 6M /
 * 1Y / All), the rep-max table (1/3/5/8/10/12RM — heaviest weight for at
 * least that many reps) and the full log, grouped by month, newest first.
 * PBs are real sets only; every e1RM reads as an estimate. A row opens
 * the set for editing; its bin deletes with a five-second Undo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import E1rmChart from './E1rmChart';
import { agoText, changeText } from './LiftCard';
import {
  REP_MAX_NS, dayNo, fmtE1rm, setText, entryE1rm, bannedRule, BANNED_NOTE, LOAD_LABEL, isLowConfidence, estText,
} from '../../../lib/lifts/lifts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANGES = [['3m', '3M', 13], ['6m', '6M', 26], ['1y', '1Y', 52], ['all', 'All', null]];
const shortDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${SHORT[m - 1]} ${String(y).slice(2)}`; };
const PAGE = 6;   // months of log shown before "Show older"

export default function LiftDetail({ s, today, bwOf, onBack, onLog, onEdit, onDelete, backLabel = 'All lifts' }) {
  const { lift, pb, trend, sets, pbIds, pbDays, ratio, last } = s;
  const [range, setRange] = useState('6m');
  const [months, setMonths] = useState(PAGE);
  const head = useRef(null);
  useEffect(() => { if (head.current) head.current.focus({ preventScroll: true }); }, [lift.id]);

  const weeks = RANGES.find(r => r[0] === range)[2];
  const to = dayNo(today);
  const from = weeks ? to - weeks * 7 : null;
  const series = useMemo(() => (from == null ? trend.series : trend.series.filter(p => dayNo(p.date) > from)), [trend.series, from]);

  const groups = useMemo(() => {
    const out = [];
    const byMonth = new Map();
    for (let i = sets.length - 1; i >= 0; i--) {
      const e = sets[i];
      const k = e.date.slice(0, 7);
      if (!byMonth.has(k)) { const g = { k, rows: [] }; byMonth.set(k, g); out.push(g); }
      byMonth.get(k).rows.push(e);
    }
    return out;
  }, [sets]);

  const banned = bannedRule(lift);
  const best = pb.bestE1rm;
  const c4 = changeText(trend.change4w), c12 = changeText(trend.change12w);

  return (
    <div className="lf-detail">
      <div className="lf-dhead">
        <button type="button" className="sec-btn is-quiet lf-back" onClick={onBack}><Icon name="chevron-left" size={15} /> {backLabel}</button>
        <div className="lf-dtitles">
          <h3 ref={head} tabIndex={-1} className="lf-dname">{lift.name}</h3>
          <span className="lf-dmeta">{LOAD_LABEL[lift.load]}{lift.archived ? ' · archived' : ''} · {sets.length} {sets.length === 1 ? 'set' : 'sets'}{last ? ` · last logged ${agoText(last.date, today)}` : ''}</span>
          {banned && <span className="lf-banned"><Icon name="octagon-alert" size={13} /> {BANNED_NOTE}</span>}
        </div>
        {!lift.archived && <button type="button" className="sec-btn is-primary lf-btn-lg" onClick={onLog}><Icon name="plus" size={14} /> Log a set</button>}
      </div>

      <div className="lf-tiles">
        <div className="lf-tile">
          <span className="lf-fig-lbl">Heaviest · PB</span>
          <b className="lf-tile-val">{pb.heaviest ? setText(pb.heaviest.entry, lift) : '—'}</b>
          <span className="lf-tile-sub">{pb.heaviest ? `${shortDate(pb.heaviest.entry.date)}${pb.basis === 'total' ? ' · on total load' : ''}` : '—'}</span>
        </div>
        <div className="lf-tile">
          <span className="lf-fig-lbl">Est. 1RM · trend</span>
          <b className="lf-tile-val">{best ? `${best.low ? '≈' : '~'}${fmtE1rm(best.value)} kg` : '—'}</b>
          <span className="lf-tile-sub">{best ? `estimate from ${setText(best.entry, lift)}` : lift.load === 'bodyweight_plus' ? 'needs a bodyweight reading' : 'no sets yet'}</span>
        </div>
        <div className="lf-tile">
          <span className="lf-fig-lbl">Est. 1RM · 4 / 12 wk</span>
          <b className="lf-tile-val">{c4 || '—'}</b>
          <span className="lf-tile-sub">{c12 ? `${c12} over 12 wk` : 'not enough recent sets'}</span>
        </div>
        {ratio != null && (
          <div className="lf-tile">
            <span className="lf-fig-lbl">× bodyweight</span>
            <b className="lf-tile-val">{ratio.toFixed(2).replace(/0$/, '')}×</b>
            <span className="lf-tile-sub">heaviest set ÷ bodyweight then</span>
          </div>
        )}
      </div>

      <section className="sec-card lf-sec">
        <div className="lf-sec-head">
          <span className="sec-eyebrow">// Estimated 1RM over time</span>
          <div className="sec-seg lf-seg" role="group" aria-label="Chart range">
            {RANGES.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={range === id} className={range === id ? 'is-on' : ''} onClick={() => setRange(id)}>{label}</button>
            ))}
          </div>
        </div>
        <E1rmChart series={series} lift={lift} pbDays={pbDays} from={from} to={to} />
      </section>

      <div className="lf-two">
        <section className="sec-card lf-sec">
          <span className="sec-eyebrow">// Rep maxes</span>
          <p className="lf-muted lf-sec-p">Heaviest weight for at least that many reps.</p>
          <table className="lf-rm">
            <thead><tr><th scope="col">Reps</th><th scope="col">Best set</th><th scope="col" className="is-num">Est. 1RM</th><th scope="col" className="is-num">When</th></tr></thead>
            <tbody>
              {REP_MAX_NS.map(n => {
                const e = pb.repMaxes[n];
                const bw = e ? bwOf(e.date) : null;
                const v = e ? entryE1rm(e, lift, bw && bw.kg) : null;
                return (
                  <tr key={n}>
                    <th scope="row">{n}RM</th>
                    <td>{e ? setText(e, lift) : <span className="lf-muted">—</span>}</td>
                    <td className="is-num">{v != null ? `${isLowConfidence(e.reps) ? '≈' : '~'}${fmtE1rm(v)}` : '—'}</td>
                    <td className="is-num">{e ? (e.date.slice(0, 4) === today.slice(0, 4) ? shortDate(e.date).slice(0, -3) : shortDate(e.date)) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="sec-card lf-sec lf-logsec">
          <span className="sec-eyebrow">// Log · {sets.length}</span>
          {!groups.length && <p className="lf-muted lf-sec-p">Nothing logged yet.</p>}
          {groups.slice(0, months).map(g => {
            const [y, m] = g.k.split('-').map(Number);
            return (
              <div key={g.k} className="lf-month">
                <div className="lf-month-head"><span>{MONTHS[m - 1]} {y}</span><span>{g.rows.length} {g.rows.length === 1 ? 'set' : 'sets'}</span></div>
                <ul className="lf-rows">
                  {g.rows.map(e => {
                    const bw = bwOf(e.date);
                    const v = entryE1rm(e, lift, bw && bw.kg);
                    const ev = pbIds.get(e.id);
                    const dt = new Date(`${e.date}T12:00:00`);
                    return (
                      <li key={e.id} className="lf-row-wrap">
                        <button type="button" className={`lf-row${e.shift === 'night' ? ' is-night' : ''}`} onClick={() => onEdit(e)}
                                aria-label={`Edit ${setText(e, lift)} on ${shortDate(e.date)}`}>
                          <span className="lf-row-date"><b>{dt.getDate()}</b><em>{DOW[dt.getDay()]}</em></span>
                          <span className="lf-row-main">
                            <span className="lf-row-set">{setText(e, lift)}
                              {ev && ev.heaviest && <span className="lf-tag is-pb">PB</span>}
                              {ev && !ev.heaviest && ev.repMaxes.length > 0 && <span className="lf-tag is-pb">{ev.repMaxes[ev.repMaxes.length - 1]}RM PB</span>}
                            </span>
                            <span className="lf-row-sub">
                              {v != null && <span>{estText(v, isLowConfidence(e.reps))}</span>}
                              {e.sessionId && <span>workout</span>}
                              {e.rpe != null && <span>RPE {e.rpe}</span>}
                              {e.shift === 'night' && <span className="lf-night"><Icon name="moon" size={12} /> night shift · 80% load</span>}
                            </span>
                            {e.notes && <span className="lf-row-note">{e.notes}</span>}
                          </span>
                        </button>
                        <button type="button" className="lf-icon-btn lf-row-del" onClick={() => onDelete(e)} aria-label={`Delete ${setText(e, lift)} on ${shortDate(e.date)}`}>
                          <Icon name="trash-2" size={15} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {groups.length > months && (
            <button type="button" className="sec-btn lf-more" onClick={() => setMonths(n => n + PAGE)}>
              Show older · {groups.length - months} more {groups.length - months === 1 ? 'month' : 'months'}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
