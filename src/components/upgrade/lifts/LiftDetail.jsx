/**
 * One lift (brief §3.9; A8, A12, A15).
 *
 *   ‹ Lifts   Machine leg press            [+ Log set]   one back control only
 *   WEIGHT · COMPARED WITHIN DXC · 24 sets                CompareScope (tap = explainer)
 *   [ DXC | Greenock ]                                    machine: no "All"; free weight: [All | DXC | …]
 *   [ HEAVIEST · PB ]  [ est. 1RM ┄┄ ]                    two even tiles: RealBest / Estimate
 *   // est. 1RM over time (kg) · estimate  [3M 6M 1Y ALL]  readout above, chart, shape key
 *   // Rep maxes · real sets                              REPS · BEST REAL SET · est. 1RM · WHEN
 *   // Log · Oct 2026 · 12 sets (sticky)                  date · gym · ☾ · 200 × 8 @8 · est · ⋯
 *
 * <LiftDetail liftId embedded onClose backLabel />
 *   standalone (LiftsTab's detail screen): the header row above; onClose = back
 *   embedded: the body only, for a caller's Sheet (the workout's "View
 *   history" — the Sheet carries the title and close); always one column
 * Data and actions come from the Lifts context (useLiftsCtx), so it works
 * anywhere under LiftsTab. Tap a log row → the Quick log sheet prefilled
 * (edit); swipe left (touch) or ⋯ → Delete, with a 5 s Undo.
 * The per-gym SETTING isn't here any more (A8): CompareScope explains it and
 * links to Manage lifts, the only place it changes.
 *
 * Desktop (≥ 1024, standalone): chart 760 × 320 + the log in cols 1–8;
 * tiles + rep maxes in cols 9–12.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import E1rmChart from './E1rmChart';
import { gymShort } from './LiftCard';
import { summarise, useLiftsCtx } from './useLifts';
import { Button, IconButton, Sheet, Segmented, GymSwitch, ALL_GYMS, RealBest, Estimate, CompareScope, PbMark, useInputMode } from './ui';
import { sessionE1rms, sessionKey, trendDelta, repMaxRows } from '../../../lib/lifts/home';
import { realSetText, roundEstimate } from '../../../lib/lifts/ui';
import {
  dayNo, fmtKg, entryE1rm, bannedRule, BANNED_NOTE, LOAD_LABEL, gymOf, perGymOf, gymsUsed, isWarmup, setTypeOf, SET_TYPE_LABEL, LOW_CONFIDENCE_REPS,
} from '../../../lib/lifts/lifts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RANGES = [{ value: '3m', label: '3M', weeks: 13 }, { value: '6m', label: '6M', weeks: 26 }, { value: '1y', label: '1Y', weeks: 52 }, { value: 'all', label: 'ALL', weeks: null }];
const PAGE = 6;   // months of log before "Show older"
const dayLabel = iso => { const [y, m, d] = iso.split('-').map(Number); return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`; };
const whenLabel = (iso, today) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]}${today && today.slice(0, 4) !== String(y) ? ` ${String(y).slice(2)}` : ''}`; };
const estTxt = v => (v == null ? '' : `~${fmtKg(roundEstimate(v, 'tile'))}`);

export default function LiftDetail({ liftId, embedded = false, onClose, backLabel = 'Lifts' }) {
  const ctx = useLiftsCtx();
  const { summaries, bwOf, gyms, today, gymName, activeGym } = ctx;
  const { layout } = useInputMode();
  const all = summaries.get(liftId) || null;
  useEffect(() => { if (!all && onClose) onClose(); }, [all, onClose]);
  if (!all) return <p className="lf-meta">That lift is no longer here.</p>;
  return <Detail all={all} ctx={ctx} embedded={embedded} onClose={onClose} backLabel={backLabel} desktop={!embedded && layout === 'desktop'}
                 bwOf={bwOf} gyms={gyms} today={today} gymName={gymName} activeGym={activeGym} />;
}

/**
 * The detail in its own Sheet — "View history" over the live workout:
 * <LiftHistorySheet liftId onClose />. Same contract as <LiftDetail embedded>,
 * with the Sheet (title = the lift's name, Esc / × / scrim close) included.
 */
export function LiftHistorySheet({ liftId, onClose }) {
  const { summaries } = useLiftsCtx();
  const s = summaries.get(liftId);
  return (
    <Sheet title={s ? s.lift.name : 'Lift'} eyebrow="// History" onClose={onClose} width={560} testId="lh-history">
      <LiftDetail liftId={liftId} embedded onClose={onClose} />
    </Sheet>
  );
}

function Detail({ all, ctx, embedded, onClose, backLabel, desktop, bwOf, gyms, today, gymName, activeGym }) {
  const { lift } = all;
  const perGym = perGymOf(lift);
  const used = useMemo(() => gymsUsed(all.sets, lift, gyms.map(g => g.id)), [all.sets, lift, gyms]);
  // The gyms to offer: the active ones, plus any archived gym this lift was logged at.
  const gymOpts = useMemo(() => gyms.filter(g => !g.archived || used.includes(g.id)), [gyms, used]);
  const defGym = perGym ? (used.includes(activeGym) || !used.length ? activeGym : used.find(Boolean) || activeGym) : ALL_GYMS;
  const [gymSel, setGymSel] = useState(defGym);
  useEffect(() => { setGymSel(defGym); }, [lift.id, perGym]); // eslint-disable-line react-hooks/exhaustive-deps
  const one = gymSel !== ALL_GYMS;
  const scoped = useMemo(() => (one ? all.sets.filter(e => gymOf(e) === gymSel) : all.sets), [one, all.sets, gymSel]);
  const s = useMemo(() => (one ? summarise(lift, scoped, bwOf, today) : all), [one, lift, scoped, bwOf, today, all]);
  const pbIds = all.pbIds;   // judged on the whole lift (per gym for a machine) — a free weight's PB is a PB at any gym
  const [range, setRange] = useState('6m');
  const head = useRef(null);
  useEffect(() => { if (!embedded && head.current) head.current.focus({ preventScroll: true }); }, [lift.id, embedded]);

  const gymLabel = one && gymSel ? gymName(gymSel) : null;
  const scopeGym = perGym ? (gymSel && gymSel !== ALL_GYMS ? gymName(gymSel) : gymName(activeGym)) : null;
  const banned = bannedRule(lift);
  const empty = all.sets.length === 0;

  // ── Chart model ──
  const points = useMemo(() => sessionE1rms(scoped, lift, { bwOf }), [scoped, lift, bwOf]);
  const pbKeys = useMemo(() => { const k = new Set(); for (const e of scoped) if (pbIds.has(e.id) && !isWarmup(e)) k.add(sessionKey(e)); return k; }, [scoped, pbIds]);
  const weeks = RANGES.find(r => r.value === range).weeks;
  const to = dayNo(today);
  const from = weeks ? to - weeks * 7 : null;
  const inRange = useMemo(() => (from == null ? points : points.filter(p => p.n > from)), [points, from]);
  const groups = useMemo(() => {
    if (one || perGym) return [{ id: one ? gymSel : null, label: gymLabel ? gymShort(gymLabel) : '', points: inRange }];
    const by = new Map();
    for (const p of inRange) { const k = p.gym || null; if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
    const ids = [...by.keys()];
    if (ids.length <= 1) return [{ id: ids[0] || null, label: '', points: inRange }];
    return ids.map(id => ({ id, label: id ? gymShort(gymName(id)) : 'NO GYM', points: by.get(id) }));
  }, [one, perGym, gymSel, gymLabel, inRange, gymName]);
  const td = useMemo(() => trendDelta(points, { weeks: 12 }), [points]);
  const best = s.pb.bestE1rm;
  const deltaTxt = td.delta == null ? null : `${td.delta >= 0 ? '↗ +' : '↘ −'}${fmtKg(Math.abs(Math.round(td.delta)))} / ${td.weeks} wk`;
  const summary = best ? `est. 1RM ~${fmtKg(roundEstimate(best.value, 'readout'))} kg${td.delta != null ? `, ${td.delta >= 0 ? '+' : '−'}${fmtKg(Math.abs(Math.round(td.delta)))} kg in ${td.weeks} wks` : ''}` : '';

  // ── Rep maxes ──
  const rows = useMemo(() => repMaxRows(s.pb, lift, { bwOf }), [s.pb, lift, bwOf]);

  const tiles = (
    <div className="lh-tiles" data-testid="lh-tiles">
      <div className="lh-tile">
        <p className="lf-eyebrow">Heaviest · PB</p>
        {s.pb.heaviest
          ? <RealBest entry={s.pb.heaviest.entry} lift={lift} pb today={today} size="lg" gymLabel={perGym && gymLabel ? gymShort(gymLabel) : null} />
          : <span className="lf-hero lh-dash">—</span>}
        {s.pb.heaviest && s.pb.basis === 'total' && <span className="lf-meta">on total load (bodyweight + added)</span>}
      </div>
      <div className="lh-tile lf-st is-est">
        <p className="lf-eyebrow">est. 1RM</p>
        {best ? <Estimate value={best.value} low={best.low} label="" boxed={false} className="lh-tile-est" /> : <span className="lf-hero lh-dash">—</span>}
        {best && (td.lastNight
          ? <span className="lf-meta lh-tile-note">☾ last session was night — trend uses day sessions</span>
          : deltaTxt ? <span className="lf-meta lh-tile-note lf-num">{deltaTxt}</span> : <span className="lf-meta lh-tile-note">needs 3 day sessions for a trend</span>)}
        {!best && !empty && lift.load === 'bodyweight_plus' && <span className="lf-meta lh-tile-note">needs a bodyweight reading</span>}
      </div>
      {empty && <p className="lf-meta lh-tiles-empty">Log a set to start this record.</p>}
    </div>
  );

  const chart = (
    <section className="lh-dsec lh-dchart" aria-labelledby={`lh-ch-${lift.id}`}>
      <div className="lh-dsec-head">
        <p className="lf-eyebrow" id={`lh-ch-${lift.id}`}>// est. 1RM over time (kg) · estimate</p>
        {!empty && <Segmented label="Chart range" size="sm" options={RANGES} value={range} onChange={setRange} testId="lh-range" />}
      </div>
      {empty
        ? <p className="lf-meta lh-explain-line">Your chart draws itself from real sets of 1–12 reps as an estimate (est. 1RM). PBs only ever come from sets you actually lifted, and they show as gold ◆.</p>
        : <E1rmChart groups={groups} accentId={perGym ? gymSel : activeGym} pbKeys={pbKeys} lift={lift} from={from} to={to}
                     height={desktop ? 320 : 200} summary={summary} />}
    </section>
  );

  const repTable = !empty && (
    <section className="lh-dsec lh-drm" aria-labelledby={`lh-rm-${lift.id}`}>
      <p className="lf-eyebrow" id={`lh-rm-${lift.id}`}>// Rep maxes · real sets{gymLabel ? ` · ${gymShort(gymLabel)}` : ''}</p>
      <table className="lh-rm" data-testid="lh-rm">
        <thead><tr><th scope="col">Reps</th><th scope="col">Best real set</th><th scope="col" className="is-num">est. 1RM</th><th scope="col" className="is-num">When</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.n}>
              <th scope="row" className="lf-num">{r.n}</th>
              <td className="lf-num">{r.entry ? <>{realSetText(r.entry.weight, r.entry.reps, lift)}{pbIds.has(r.entry.id) && <PbMark className="lh-rm-pb" />}</> : <span className="lh-muted">—</span>}</td>
              <td className="is-num lf-num">
                {r.entry ? (r.est != null ? <span className="lh-muted">{r.low ? '≈' : '~'}{fmtKg(roundEstimate(r.est, 'tile'))}</span> : <span className="lh-muted">—</span>)
                  : r.pred != null ? <span className="lh-pred">~{fmtKg(roundEstimate(r.pred, 'tile'))} (pred.)</span> : <span className="lh-muted">—</span>}
              </td>
              <td className="is-num lf-num">{r.entry ? whenLabel(r.entry.date, today) : <span className="lh-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="lf-meta">Heaviest real set with at least that many reps. “(pred.)” is predicted from your best estimate — never a PB.</p>
    </section>
  );

  const log = <LogList sets={scoped} lift={lift} perGym={perGym} one={one} gymLabel={gymLabel} pbIds={pbIds} bwOf={bwOf} today={today}
                       gymName={gymName} onEdit={e => ctx.openLog({ entry: e })} onDelete={ctx.deleteEntry} desktop={desktop} />;

  return (
    <div className={`lh-detail${embedded ? ' is-embedded' : ' lh-detail-page'}`} data-testid="lift-detail">
      {!embedded && (
        <div className="lh-dbar">
          <Button variant="quiet" icon="chevron-left" className="lh-dback" onClick={onClose} data-testid="lh-dback">{backLabel}</Button>
          <h2 ref={head} tabIndex={-1} className="lh-dname">{lift.name}</h2>
          {!lift.archived && <Button variant="primary" icon="plus" className="lh-dlog" onClick={() => ctx.openLog({ liftId: lift.id })} data-testid="lh-dlog">Log set</Button>}
        </div>
      )}
      <div className="lh-dmeta">
        <span>{LOAD_LABEL[lift.load]}</span><span aria-hidden="true">·</span>
        <CompareScope lift={lift} gymLabel={scopeGym} onManage={() => ctx.openManage(lift.id)} />
        <span aria-hidden="true">·</span><span className="lf-num">{all.sets.length} {all.sets.length === 1 ? 'set' : 'sets'}</span>
        {lift.archived && <><span aria-hidden="true">·</span><span>archived</span></>}
      </div>
      {banned && <p className="lf-meta lh-banned"><Icon name="octagon-alert" size={13} /> {BANNED_NOTE}</p>}
      {embedded && !lift.archived && (
        <Button variant="secondary" icon="plus" block onClick={() => ctx.openLog({ liftId: lift.id })} data-testid="lh-dlog">Log a set of this lift</Button>
      )}
      {gymOpts.length > 1 && (
        <GymSwitch gyms={gymOpts} value={gymSel} onChange={setGymSel} allowAll lift={lift} label={`Show ${lift.name} at`} testId="lh-dgym" className="lh-dgym" />
      )}
      <div className="lh-dgrid">
        <div className="lh-garea-tiles">{tiles}</div>
        <div className="lh-garea-chart">{chart}</div>
        <div className="lh-garea-rm">{repTable}</div>
        <div className="lh-garea-log">{!empty && log}</div>
      </div>
    </div>
  );
}

/** The log, newest first, by month with sticky headers. */
function LogList({ sets, lift, perGym, one, gymLabel, pbIds, bwOf, today, gymName, onEdit, onDelete, desktop }) {
  const [months, setMonths] = useState(PAGE);
  const [menu, setMenu] = useState(null);
  const [swiped, setSwiped] = useState(null);
  const groups = useMemo(() => {
    const out = [];
    const by = new Map();
    for (let i = sets.length - 1; i >= 0; i--) {
      const e = sets[i];
      const k = e.date.slice(0, 7);
      if (!by.has(k)) { const g = { k, rows: [] }; by.set(k, g); out.push(g); }
      by.get(k).rows.push(e);
    }
    return out;
  }, [sets]);
  if (!sets.length) return <p className="lf-meta">{one ? `Nothing logged at ${gymLabel} yet.` : 'Nothing logged yet.'}</p>;
  return (
    <section className="lh-dsec lh-dlogsec" aria-label="Log">
      {desktop && (
        <div className="lh-logrow lh-loghead" aria-hidden="true">
          <span>Date</span><span>Gym</span><span>Set</span><span>RPE</span><span className="is-num">est.</span><span />
        </div>
      )}
      {groups.slice(0, months).map(g => {
        const [y, m] = g.k.split('-').map(Number);
        return (
          <div key={g.k} className="lh-month">
            <p className="lh-month-head lf-eyebrow">// Log · {MONTHS[m - 1].slice(0, 3)} {y} · {g.rows.length} {g.rows.length === 1 ? 'set' : 'sets'}</p>
            <ul className="lh-logrows">
              {g.rows.map(e => (
                <LogRow key={e.id} e={e} lift={lift} perGym={perGym} one={one} pb={pbIds.get(e.id)} bwOf={bwOf} gymName={gymName}
                        open={swiped === e.id} onSwipe={on => setSwiped(on ? e.id : null)}
                        onEdit={() => onEdit(e)} onMenu={() => setMenu(e)} onDelete={() => { setSwiped(null); onDelete(e); }} desktop={desktop} />
              ))}
            </ul>
          </div>
        );
      })}
      {groups.length > months && (
        <Button variant="secondary" block onClick={() => setMonths(n => n + PAGE)}>Show older · {groups.length - months} more {groups.length - months === 1 ? 'month' : 'months'}</Button>
      )}
      {menu && (
        <Sheet title={`${realSetText(menu.weight, menu.reps, lift)} · ${whenLabel(menu.date, today)}`} eyebrow={`// ${lift.name}`} onClose={() => setMenu(null)} testId="lh-rowmenu">
          <div className="lh-menu">
            <Button variant="secondary" size="lg" block icon="pencil" onClick={() => { const e = menu; setMenu(null); onEdit(e); }}>Edit set</Button>
            <div className="lh-menu-gap" />
            <Button variant="danger" size="lg" block icon="trash-2" onClick={() => { const e = menu; setMenu(null); onDelete(e); }} data-testid="lh-rowmenu-del">Delete set</Button>
            <p className="lf-meta">You can undo a delete for 5 seconds.</p>
          </div>
        </Sheet>
      )}
    </section>
  );
}

const SWIPE_W = 88;
function LogRow({ e, lift, perGym, one, pb, bwOf, gymName, open, onSwipe, onEdit, onMenu, onDelete, desktop }) {
  const bw = bwOf(e.date);
  const warm = isWarmup(e);
  const v = !warm && Number(e.reps) <= LOW_CONFIDENCE_REPS ? entryE1rm(e, lift, bw && bw.kg) : null;
  const type = setTypeOf(e);
  const night = e.shift === 'night';
  const g = useRef(null);
  const rowClick = useRef(0);
  const [dx, setDx] = useState(0);
  const down = ev => {
    if (ev.button > 0) return;
    g.current = { x: ev.clientX, y: ev.clientY, base: open ? -SWIPE_W : 0, horiz: null, id: ev.pointerId };
  };
  const move = ev => {
    const st = g.current;
    if (!st) return;
    const mx = ev.clientX - st.x, my = ev.clientY - st.y;
    if (st.horiz == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      st.horiz = Math.abs(mx) > Math.abs(my);
      if (st.horiz && ev.currentTarget.setPointerCapture) ev.currentTarget.setPointerCapture(ev.pointerId);
    }
    if (st.horiz) setDx(Math.max(-SWIPE_W - 16, Math.min(0, st.base + mx)));
  };
  const up = () => {
    const st = g.current;
    g.current = null;
    if (!st || !st.horiz) { setDx(0); return; }
    const end = dx;
    setDx(0);
    onSwipe(end < -SWIPE_W / 2);
    // Suppress the click that follows a swipe.
    rowClick.current = Date.now();
  };
  const offset = dx || (open ? -SWIPE_W : 0);
  const label = `${dayLabel(e.date)}${e.gym ? ` at ${gymName(e.gym)}` : ''}${night ? ', night shift' : ''}: ${realSetText(e.weight, e.reps, lift)}${e.rpe != null ? ` at RPE ${e.rpe}` : ''}${type ? `, ${SET_TYPE_LABEL[type]}` : ''}${pb ? ', a PB' : ''} — edit`;
  return (
    <li className={`lh-logli${open ? ' is-open' : ''}`}>
      <button type="button" className="lh-logdel" onClick={onDelete} tabIndex={open ? 0 : -1} aria-hidden={open ? undefined : 'true'}
              aria-label={`Delete ${realSetText(e.weight, e.reps, lift)} on ${dayLabel(e.date)}`}>
        <Icon name="trash-2" size={16} /> Delete
      </button>
      <div className={`lh-logrow lf-st${pb ? ' is-pb' : ''}`} style={offset ? { transform: `translateX(${offset}px)` } : undefined}
           onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button type="button" className="lh-logrow-main" aria-label={label}
                onClick={() => { if (Date.now() - rowClick.current < 350) return; if (open) onSwipe(false); else onEdit(); }}>
          <span className="lh-log-date lf-num">{dayLabel(e.date)}</span>
          <span className="lh-log-gym">{(!one || perGym) && e.gym ? <span className="lh-gymtag">{gymShort(gymName(e.gym))}</span> : desktop ? <span className="lh-muted">—</span> : null}</span>
          <span className="lh-log-set lf-num">
            {night && <span className="lh-log-night" aria-hidden="true">☾</span>}
            {pb && <PbMark className="lh-log-pb" />}
            {realSetText(e.weight, e.reps, lift)}
            {!desktop && e.rpe != null && <span className="lh-log-rpe"> @{fmtKg(e.rpe)}</span>}
            {type && <span className={`lh-settype is-${type}`}>{type}</span>}
          </span>
          {desktop && <span className="lh-log-rpecol lf-num">{e.rpe != null ? fmtKg(e.rpe) : '—'}</span>}
          <span className="lh-log-est lf-num">{v != null ? estTxt(v) : warm ? 'warm-up' : ''}</span>
        </button>
        <IconButton icon="ellipsis" label={`Options for ${realSetText(e.weight, e.reps, lift)} on ${dayLabel(e.date)}`} className="lh-log-more" onClick={onMenu} />
      </div>
      {e.notes && <p className="lh-log-note">{e.notes}</p>}
    </li>
  );
}
