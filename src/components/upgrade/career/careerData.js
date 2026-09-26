/**
 * Derived figures more than one Career panel needs — the study pacing
 * (Certs and Brief) and where savings stand against the plan (Money and
 * Brief) — computed one way, so two panels can never disagree.
 */
import { useMemo } from 'react';
import { KEYS } from '../../../lib/career/schema';
import { studyDays, planStudy, examIsoOf, pacedCert, daysBetween } from '../../../lib/career/pacing';
import { weekOf } from '../../../lib/career/brief';
import { project } from '../../../lib/career/money';
import { actualSeries, versusPlan } from '../../../lib/savings/history';
import { holidayDaySet } from '../../../lib/rotation/pattern';

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Pacing settings for a cert, with defaults. */
export const paceOf = cert => ({
  perOff: Number.isFinite(cert && cert.pacing && cert.pacing.perOff) ? cert.pacing.perOff : 2.5,
  afterDay: cert && cert.pacing && cert.pacing.afterDay ? 0.75 : 0,
  hoursLogged: Math.max(0, Number(cert && cert.hoursLogged) || 0),
});

/**
 * The paced cert and its plan, from the Monday of this week so a calendar
 * lines up — days before today carry no hours.
 * → { cert, plan, examIso, days, monIso, settings } | null
 */
export function usePacing(S, certs, pickId) {
  const overrides = (S && S.rotation && S.rotation.overrides) || null;
  const blocks = (S && S.rotation && S.rotation.holidayBlocks) || null;
  return useMemo(() => {
    const eligible = (certs || []).filter(c => !c.completed && ['studying', 'booked'].includes(c.status) && Number(c.studyHours) > 0 && examIsoOf(c));
    const cert = (pickId && eligible.find(c => c.id === pickId)) || pacedCert(certs);
    if (!cert) return { cert: null, eligible };
    const today = todayIso();
    const { monIso } = weekOf(today);
    const examIso = examIsoOf(cert);
    const horizon = Math.min(400, Math.max(56, daysBetween(monIso, examIso) + 1));
    const all = studyDays(monIso, horizon, { overrides: overrides || {}, holidayDays: holidayDaySet(blocks || []) });
    const settings = paceOf(cert);
    const remaining = Math.max(0, Number(cert.studyHours) - settings.hoursLogged);
    const future = all.map(d => (d.iso < today ? { ...d, holiday: true, past: true } : d));   // no hours before today
    const plan = planStudy(future, { remaining, perOff: settings.perOff, afterDay: settings.afterDay, examIso });
    return { cert, eligible, plan, examIso, monIso, today, settings, remaining };
  }, [certs, pickId, overrides, blocks]);
}

/** The latest CLOSED month's actual vs the no-bonus plan, or null. */
export function useLatestVs(S, oc) {
  const money = oc.data[KEYS.money];
  return useMemo(() => {
    if (!money || !money.start) return null;
    const noB = project(money, { to: money.until || '2027-12', bonus: false });
    const actual = actualSeries(S, { from: money.start.month, accountIds: money.actualAccountIds || [] });
    const vs = versusPlan(actual, noB);
    return [...vs].reverse().find(v => !v.live) || null;
  }, [S, money]);
}
