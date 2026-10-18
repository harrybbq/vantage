/**
 * One lift: headline figures, the estimated-1RM chart (range 3M / 6M /
 * 1Y / All), the rep-max table (1/3/5/8/10/12RM — heaviest weight for at
 * least that many reps) and the full log, grouped by month, newest first.
 * PBs are real sets only; every e1RM reads as an estimate. A row opens
 * the set for editing; its bin deletes with a five-second Undo.
 *
 * A machine (perGym) lift gets a gym control — All / DXC / Greenock.
 * One gym: every figure, the chart and the rep maxes are that gym's.
 * All: the chart draws one line per gym (colour + point shape + legend),
 * the rep maxes sit side by side per gym, and sets with no gym
 * ("unassigned") appear here only. The lift's ⋯ toggles per-gym on/off.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import E1rmChart from './E1rmChart';
import { agoText, changeText } from './LiftCard';
import { summarise } from './useLifts';
import {
  REP_MAX_NS, dayNo, fmtE1rm, fmtKg, setText, entryE1rm, bannedRule, BANNED_NOTE, LOAD_LABEL, isLowConfidence, estText, gymOf,
} from '../../../lib/lifts/lifts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANGES = [['3m', '3M', 13], ['6m', '6M', 26], ['1y', '1Y', 52], ['all', 'All', null]];
const shortDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${SHORT[m - 1]} ${String(y).slice(2)}`; };
const PAGE = 6;   // months of log shown before "Show older"

export default function LiftDetail({ s: all, today, bwOf, gyms = [], onBack, onLog, onEdit, onDelete, onPerGym, backLabel = 'All lifts' }) {
  const { lift } = all;
  const perGym = !!all.perGym;
  const nameOf = id => (id ? (gyms.find(g => g.id === id) || { name: id }).name : 'Unassigned');
  // The gyms to offer: those in use, plus any archived one this lift was logged at.
  const gymOpts = useMemo(() => {
    const used = new Set((all.byGym || []).map(g => g.gym));
    return gyms.filter(g => !g.archived || used.has(g.id));
  }, [gyms, all.byGym]);
  const [gymSel, setGymSel] = useState('all');
  useEffect(() => { if (!perGym) setGymSel('all'); }, [perGym]);
  const one = perGym && gymSel !== 'all';
  // One gym → the same summary, worked on that gym's sets only.
  const s = useMemo(() => (one ? summarise(lift, all.sets.filter(e => gymOf(e) === gymSel), bwOf, today) : all), [one, lift, all, gymSel, bwOf, today]);
  const { pb, trend, sets, pbIds, pbDays, ratio, last } = s;
  const [range, setRange] = useState('6m');
  const [months, setMonths] = useState(PAGE);
  const head = useRef(null);
  useEffect(() => { if (head.current) head.current.focus({ preventScroll: true }); }, [lift.id]);

  const weeks = RANGES.find(r => r[0] === range)[2];
  const to = dayNo(today);
  const from = weeks ? to - weeks * 7 : null;
  const inRange = ser => (from == null ? ser : ser.filter(p => dayNo(p.date) > from));
  const series = useMemo(() => inRange(trend.series), [trend.series, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => (perGym && !one && all.byGym && all.byGym.length > 1
    ? all.byGym.map(g => ({ id: g.gym, label: nameOf(g.gym), series: inRange(g.trend.series) }))
    : null), [perGym, one, all.byGym, from, gyms]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupsByMonth = useMemo(() => {
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
  const perGymAll = perGym && !one && all.byGym && all.byGym.length > 0;
  const rmCols = perGymAll ? all.byGym : null;

  return (
    <div className="lf-detail">
      <div className="lf-dhead">
        <button type="button" className="sec-btn is-quiet lf-back" onClick={onBack}><Icon name="chevron-left" size={15} /> {backLabel}</button>
        <div className="lf-dtitles">
          <h3 ref={head} tabIndex={-1} className="lf-dname">{lift.name}</h3>
          <span className="lf-dmeta">{LOAD_LABEL[lift.load]}{lift.archived ? ' · archived' : ''} · {perGym ? 'compared per gym' : 'compared across gyms'} · {sets.length} {sets.length === 1 ? 'set' : 'sets'}{last ? ` · last logged ${agoText(last.date, today)}` : ''}</span>
          {banned && <span className="lf-banned"><Icon name="octagon-alert" size={13} /> {BANNED_NOTE}</span>}
        </div>
        <div className="lf-dacts">
          {onPerGym && (
            <button type="button" className="sec-btn is-quiet lf-btn-lg" aria-pressed={perGym} onClick={() => onPerGym(lift.id, !perGym)} data-testid="lf-pergym-toggle"
                    title={perGym ? 'Each gym’s machine is compared with itself' : 'One record across every gym'}>
              <Icon name={perGym ? 'locate-fixed' : 'link'} size={14} /> {perGym ? 'Per gym' : 'All gyms'}
            </button>
          )}
          {!lift.archived && <button type="button" className="sec-btn is-primary lf-btn-lg" onClick={onLog}><Icon name="plus" size={14} /> Log a set</button>}
        </div>
      </div>

      {perGym && (
        <div className="sec-seg lf-seg lf-gymseg lf-dgym" role="group" aria-label="Show which gym" data-testid="lf-detail-gyms">
          {[{ id: 'all', name: 'All' }, ...gymOpts].map(g => (
            <button key={g.id} type="button" aria-pressed={gymSel === g.id} className={gymSel === g.id ? 'is-on' : ''} onClick={() => setGymSel(g.id)}>{g.name}</button>
          ))}
        </div>
      )}

      <div className="lf-tiles">
        {perGymAll ? (
          <div className="lf-tile lf-tile-gyms">
            <span className="lf-fig-lbl">Heaviest · PB per gym</span>
            {all.byGym.map(g => (
              <span key={g.gym || 'none'} className="lf-tile-gymrow">
                <em>{nameOf(g.gym)}</em>
                <b>{g.pb.heaviest ? setText(g.pb.heaviest.entry, lift) : '—'}</b>
              </span>
            ))}
          </div>
        ) : (
          <div className="lf-tile">
            <span className="lf-fig-lbl">Heaviest · PB{one ? ` · ${nameOf(gymSel)}` : ''}</span>
            <b className="lf-tile-val">{pb.heaviest ? setText(pb.heaviest.entry, lift) : '—'}</b>
            <span className="lf-tile-sub">{pb.heaviest ? `${shortDate(pb.heaviest.entry.date)}${pb.basis === 'total' ? ' · on total load' : ''}` : one ? 'nothing logged at this gym yet' : '—'}</span>
          </div>
        )}
        <div className="lf-tile">
          <span className="lf-fig-lbl">Est. 1RM · trend</span>
          <b className="lf-tile-val">{best ? `${best.low ? '≈' : '~'}${fmtE1rm(best.value)} kg` : '—'}</b>
          <span className="lf-tile-sub">{best ? `estimate from ${setText(best.entry, lift)}${perGymAll && gymOf(best.entry) ? ` · ${nameOf(gymOf(best.entry))}` : ''}` : lift.load === 'bodyweight_plus' ? 'needs a bodyweight reading' : 'no sets yet'}</span>
        </div>
        {!perGymAll && (
          <div className="lf-tile">
            <span className="lf-fig-lbl">Est. 1RM · 4 / 12 wk</span>
            <b className="lf-tile-val">{c4 || '—'}</b>
            <span className="lf-tile-sub">{c12 ? `${c12} over 12 wk` : 'not enough recent sets'}</span>
          </div>
        )}
        {ratio != null && !perGymAll && (
          <div className="lf-tile">
            <span className="lf-fig-lbl">× bodyweight</span>
            <b className="lf-tile-val">{ratio.toFixed(2).replace(/0$/, '')}×</b>
            <span className="lf-tile-sub">heaviest set ÷ bodyweight then</span>
          </div>
        )}
      </div>

      <section className="sec-card lf-sec">
        <div className="lf-sec-head">
          <span className="sec-eyebrow">// Estimated 1RM over time{one ? ` · ${nameOf(gymSel)}` : groups ? ' · per gym' : ''}</span>
          <div className="sec-seg lf-seg" role="group" aria-label="Chart range">
            {RANGES.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={range === id} className={range === id ? 'is-on' : ''} onClick={() => setRange(id)}>{label}</button>
            ))}
          </div>
        </div>
        <E1rmChart series={series} groups={groups} lift={lift} pbDays={pbDays} from={from} to={to} />
      </section>

      <div className="lf-two">
        <section className="sec-card lf-sec">
          <span className="sec-eyebrow">// Rep maxes{one ? ` · ${nameOf(gymSel)}` : rmCols ? ' · per gym' : ''}</span>
          <p className="lf-muted lf-sec-p">Heaviest weight for at least that many reps{rmCols ? ', at each gym' : ''}.</p>
          {rmCols ? (
            <table className="lf-rm lf-rm-gyms" data-testid="lf-rm-gyms">
              <thead><tr><th scope="col">Reps</th>{rmCols.map(g => <th key={g.gym || 'none'} scope="col">{nameOf(g.gym)}</th>)}</tr></thead>
              <tbody>
                {REP_MAX_NS.map(n => (
                  <tr key={n}>
                    <th scope="row">{n}RM</th>
                    {rmCols.map(g => {
                      const e = g.pb.repMaxes[n];
                      return <td key={g.gym || 'none'}>{e ? <>{fmtKg(e.weight)}<small> × {e.reps}</small></> : <span className="lf-muted">—</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
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
          )}
        </section>

        <section className="sec-card lf-sec lf-logsec">
          <span className="sec-eyebrow">// Log · {sets.length}</span>
          {!groupsByMonth.length && <p className="lf-muted lf-sec-p">{one ? `Nothing logged at ${nameOf(gymSel)} yet.` : 'Nothing logged yet.'}</p>}
          {groupsByMonth.slice(0, months).map(g => {
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
                                aria-label={`Edit ${setText(e, lift)} on ${shortDate(e.date)}${gymOf(e) ? ` at ${nameOf(gymOf(e))}` : ''}`}>
                          <span className="lf-row-date"><b>{dt.getDate()}</b><em>{DOW[dt.getDay()]}</em></span>
                          <span className="lf-row-main">
                            <span className="lf-row-set">{setText(e, lift)}
                              {ev && ev.heaviest && <span className="lf-tag is-pb">PB</span>}
                              {ev && !ev.heaviest && ev.repMaxes.length > 0 && <span className="lf-tag is-pb">{ev.repMaxes[ev.repMaxes.length - 1]}RM PB</span>}
                            </span>
                            <span className="lf-row-sub">
                              {!one && (gymOf(e) || perGym) && <span className={`lf-gymtag${gymOf(e) ? '' : ' is-none'}`}>{nameOf(gymOf(e))}</span>}
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
          {groupsByMonth.length > months && (
            <button type="button" className="sec-btn lf-more" onClick={() => setMonths(n => n + PAGE)}>
              Show older · {groupsByMonth.length - months} more {groupsByMonth.length - months === 1 ? 'month' : 'months'}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
