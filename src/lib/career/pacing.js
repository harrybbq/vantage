/**
 * Study pacing: a cert's remaining hours laid over the real rotation.
 *
 * Off days (and booked leave) get `perOff` hours; day shifts optionally
 * get `afterDay` hours; night shifts get nothing — the same rule the
 * Upgrade section already runs training on. Holiday blocks are skipped:
 * nobody studies for an exam on a beach. The first day the running total
 * covers what is left is the exam-ready date, and it is compared with the
 * exam date so "on pace" is a date, not a feeling.
 *
 * The rotation is read through lib/rotation/pattern (overrides included),
 * so a swapped shift or a day of leave moves the plan with it.
 *
 * Pure apart from the calendar maths. No React, no network.
 */
import { resolveDay } from '../rotation/pattern.js';

const DAY = 86400000;
const isoAt = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);

/** `n` days from `fromIso`: [{ iso, shift, holiday, dow (0 = Mon) }]. Days outside the pattern are 'unknown'. */
export function studyDays(fromIso, n, { overrides = {}, holidayDays = new Set() } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const iso = isoAt(fromIso, i);
    const [y, m, d] = iso.split('-').map(Number);
    const r = resolveDay(y, m - 1, d, overrides);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    out.push({ iso, dow, shift: r.inPattern ? r.shift : 'unknown', holiday: holidayDays.has(iso) });
  }
  return out;
}

/** Hours a day can take. */
export function hoursFor(day, { perOff = 2.5, afterDay = 0 } = {}) {
  if (day.holiday) return 0;
  if (day.shift === 'off' || day.shift === 'leave') return perOff;
  if (day.shift === 'day') return afterDay;
  return 0;                                  // night, unknown
}

/**
 * Place `remaining` hours on the days, stopping once covered and never on
 * or after the exam day.
 * → { cal: [{ ...day, hours, exam }], readyIso, sessions, spare, status }
 *   status 'done' nothing left · 'ok' ready ≥ 3 days before the exam ·
 *   'tight' ready 0–2 days before · 'late' not ready by the exam ·
 *   'no-exam' no exam date to compare with (readyIso may still be set)
 */
export function planStudy(days, { remaining, perOff = 2.5, afterDay = 0, examIso = null } = {}) {
  let left = Math.max(0, Number(remaining) || 0);
  let readyIso = left === 0 ? (days[0] && days[0].iso) || null : null;
  let sessions = 0;
  const cal = days.map(d => {
    const exam = !!examIso && d.iso === examIso;
    let hours = 0;
    if (left > 0 && (!examIso || d.iso < examIso)) {
      hours = Math.min(left, hoursFor(d, { perOff, afterDay }));
      if (hours > 0) {
        left = Math.round((left - hours) * 100) / 100;
        sessions++;
        if (left <= 0) readyIso = d.iso;
      }
    }
    return { ...d, hours, exam };
  });
  let status;
  if (Number(remaining) <= 0) status = 'done';
  else if (!examIso) status = 'no-exam';
  else if (!readyIso) status = 'late';
  else status = daysBetween(readyIso, examIso) >= 3 ? 'ok' : 'tight';
  return { cal, readyIso, sessions, spare: readyIso && examIso ? daysBetween(readyIso, examIso) : null, status };
}

/**
 * The exam day for a cert: its booked `examDate`, else the last day of
 * its target window (so an unbooked "Apr–May 27" plans to 31 May).
 */
export function examIsoOf(cert) {
  if (cert && /^\d{4}-\d{2}-\d{2}$/.test(cert.examDate || '')) return cert.examDate;
  const m = cert && (/^\d{4}-\d{2}$/.test(cert.targetEnd || '') ? cert.targetEnd : cert.target);
  if (!/^\d{4}-\d{2}$/.test(m || '')) return null;
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m}-${String(last).padStart(2, '0')}`;
}

/** The cert to pace: studying or booked, with study hours, soonest exam first. */
export function pacedCert(certs) {
  return (certs || [])
    .filter(c => !c.completed && ['studying', 'booked'].includes(c.status) && Number(c.studyHours) > 0 && examIsoOf(c))
    .sort((a, b) => examIsoOf(a).localeCompare(examIsoOf(b)))[0] || null;
}
