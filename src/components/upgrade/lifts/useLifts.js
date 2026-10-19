/**
 * Everything the Lifts screens read, worked out once per change of
 * `S.lifts` / `S.vitalsLog`: the store view, the bodyweight lookup, and
 * one summary per lift (sets, real-set PBs, the e1RM trend, the PB set
 * ids and PB days for the chart).
 * Reads only — writes go through the store's writers in LiftsTab.
 */
import { createContext, useContext, useMemo } from 'react';
import { liftsOf, gymList } from '../../../lib/lifts/store';
import {
  makeBwOf, entriesFor, personalBests, pbTimeline, trend, relativeToBodyweight, chrono, perGymOf, gymsUsed, gymOf,
} from '../../../lib/lifts/lifts';

const pad = n => String(n).padStart(2, '0');
/** Local 'YYYY-MM-DD'. */
export function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * One lift's summary. A perGym lift also gets `byGym`: [{ gym, sets, pb,
 * trend }] — one per gym it was logged at (unassigned last), because a
 * machine's numbers only mean something next to the same machine.
 * (pbTimeline already judges a perGym lift gym by gym.)
 */
export function summarise(lift, log, bwOf, today, gymOrder = []) {
  const sets = entriesFor(log, lift);
  const pb = personalBests(sets, lift, { bwOf });
  const tl = pbTimeline(sets, lift, { bwOf });
  const pbIds = new Map(tl.map(ev => [ev.entry.id, ev]));
  // Days with a real PB set, for the chart's gold points (the line is the
  // e1RM estimate; gold marks what was actually lifted).
  const pbDays = new Map();
  for (const ev of tl) { const d = pbDays.get(ev.entry.date) || []; d.push(ev); pbDays.set(ev.entry.date, d); }
  const tr = trend(sets, lift, { today, bwOf });
  const last = sets.length ? sets[sets.length - 1] : null;
  // × bodyweight on the heaviest REAL set (a dip's total load), never the estimate.
  const h = pb.heaviest;
  const bw = h ? (bwOf(h.entry.date) || {}).kg : null;
  const load = h ? (lift.load === 'bodyweight_plus' ? (bw ? bw + Number(h.entry.weight) : null) : Number(h.entry.weight)) : null;
  const ratio = load != null ? relativeToBodyweight(load, bw, lift) : null;
  const perGym = perGymOf(lift);
  const byGym = perGym ? gymsUsed(sets, lift, gymOrder).map(g => {
    const gs = sets.filter(e => gymOf(e) === g);
    return { gym: g, sets: gs, pb: personalBests(gs, lift, { bwOf }), trend: trend(gs, lift, { today, bwOf }) };
  }) : null;
  return { lift, sets, pb, pbIds, pbDays, trend: tr, last, ratio, perGym, byGym };
}

export function useLiftsData(S, today) {
  const raw = S && S.lifts;
  const vit = S && S.vitalsLog;
  const lifts = useMemo(() => liftsOf({ lifts: raw }), [raw]);
  const bwOf = useMemo(() => makeBwOf(vit), [vit]);
  const gyms = useMemo(() => gymList(lifts), [lifts]);
  const summaries = useMemo(() => {
    const out = new Map();
    const order = gyms.map(g => g.id);
    for (const l of lifts.list) out.set(l.id, summarise(l, lifts.log, bwOf, today, order));
    return out;
  }, [lifts, bwOf, today, gyms]);
  const totals = useMemo(() => {
    const ym = today.slice(0, 7);
    let pbsMonth = 0, sets = 0, last = null;
    for (const s of summaries.values()) {
      sets += s.sets.length;
      for (const ev of s.pbIds.values()) if (ev.entry.date.slice(0, 7) === ym) pbsMonth++;
      if (s.last && (!last || chrono(s.last, last) > 0)) last = s.last;
    }
    return { pbsMonth, sets, last };
  }, [summaries, today]);
  return { lifts, bwOf, summaries, totals, gyms, exists: !!(raw && typeof raw === 'object') };
}

/**
 * The Lifts context: what any Lifts screen needs to read the store and to
 * ask LiftsTab for a sheet — so <LiftDetail liftId embedded onClose /> works
 * wherever it is rendered under LiftsTab (a page, or inside the workout's
 * history Sheet: portals keep React context).
 *
 * LiftsTab provides { S, lifts, summaries, bwOf, gyms, activeGyms, curGym,
 * gymName, today, calendarToday, counts, shiftOf, openLog({ liftId?, entry? }),
 * deleteEntry(entry), openManage(), openLift(id) }.
 */
const LiftsCtx = createContext(null);
export const LiftsProvider = LiftsCtx.Provider;
export function useLiftsCtx() {
  const v = useContext(LiftsCtx);
  if (!v) throw new Error('useLiftsCtx: render inside LiftsTab');
  return v;
}
