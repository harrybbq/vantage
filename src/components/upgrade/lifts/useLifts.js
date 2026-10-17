/**
 * Everything the Lifts screens read, worked out once per change of
 * `S.lifts` / `S.vitalsLog`: the store view, the bodyweight lookup, and
 * one summary per lift (sets, PBs, trend, the PB set ids for the chart).
 * Reads only — writes go through the store's writers in LiftsTab.
 */
import { useMemo } from 'react';
import { liftsOf } from '../../../lib/lifts/store';
import {
  makeBwOf, entriesFor, personalBests, pbTimeline, trend, relativeToBodyweight, chrono,
} from '../../../lib/lifts/lifts';

const pad = n => String(n).padStart(2, '0');
/** Local 'YYYY-MM-DD'. */
export function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function summarise(lift, log, bwOf, today) {
  const sets = entriesFor(log, lift);
  const pb = personalBests(sets, lift, { bwOf });
  const tl = pbTimeline(sets, lift, { bwOf });
  const pbIds = new Map(tl.map(ev => [ev.entry.id, ev]));
  const tr = trend(sets, lift, { today, bwOf });
  const last = sets.length ? sets[sets.length - 1] : null;
  const best = pb.bestE1rm;
  const ratio = best ? relativeToBodyweight(best.value, best.bodyweight ?? (bwOf(best.entry.date) || {}).kg, lift) : null;
  return { lift, sets, pb, pbIds, trend: tr, last, ratio };
}

export function useLiftsData(S, today) {
  const raw = S && S.lifts;
  const vit = S && S.vitalsLog;
  const lifts = useMemo(() => liftsOf({ lifts: raw }), [raw]);
  const bwOf = useMemo(() => makeBwOf(vit), [vit]);
  const summaries = useMemo(() => {
    const out = new Map();
    for (const l of lifts.list) out.set(l.id, summarise(l, lifts.log, bwOf, today));
    return out;
  }, [lifts, bwOf, today]);
  const totals = useMemo(() => {
    const ym = today.slice(0, 7);
    let pbsMonth = 0, sets = 0, last = null;
    for (const s of summaries.values()) {
      sets += s.sets.length;
      for (const ev of s.pbIds.values()) if ((ev.e1rm || ev.heaviest) && ev.entry.date.slice(0, 7) === ym) pbsMonth++;
      if (s.last && (!last || chrono(s.last, last) > 0)) last = s.last;
    }
    return { pbsMonth, sets, last };
  }, [summaries, today]);
  return { lifts, bwOf, summaries, totals, exists: !!(raw && typeof raw === 'object') };
}
