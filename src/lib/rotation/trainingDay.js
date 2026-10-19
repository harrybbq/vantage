/**
 * Which day a workout belongs to.
 *
 * A night shift runs across midnight, and so does the gym trip that goes
 * with it: on nights the owner trains at about 3:30am, which is on the
 * NEXT calendar date. Filed by the clock, Tuesday night's session lands
 * on Wednesday — Tuesday's Gym Session stays unticked, Wednesday gets a
 * tick it never earned, and the plan thinks Tuesday was missed.
 *
 * The rule: a workout that STARTS before NIGHT_ROLLOVER_HOUR counts for
 * the day before when that day is a night shift (the resolved rota day,
 * so a booked-off night or a manual edit is respected). Anything later
 * in the morning, or after a day shift or a day off, keeps its date.
 * 09:00 leaves room for a session straight after a shift that ends
 * around 07:00, and is long before anyone trains for the next shift.
 *
 * Only for accounts that have a rota. The pattern falls back to a
 * default schedule for any account, so without this gate everybody
 * would inherit the owner's nights. `rotation` and `lifts` are written
 * only from owner-only Upgrade screens, so either one means the rota is
 * real for this account.
 *
 * Pure — the clock is always passed in.
 */
import { shiftOn, isRealIso } from './pattern.js';

export const NIGHT_ROLLOVER_HOUR = 9;

export const usesRota = S => !!(S && (S.rotation || S.lifts));

const pad = n => String(n).padStart(2, '0');
const localIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The ISO date one day before `iso`. */
export function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The ISO date one day after `iso`. */
export function dayAfter(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The night shift a workout at `hour` on `iso` belongs to, or null. */
export function nightBefore(S, iso, hour) {
  if (!usesRota(S) || !isRealIso(iso) || !(hour >= 0 && hour < NIGHT_ROLLOVER_HOUR)) return null;
  const prev = dayBefore(iso);
  const day = shiftOn(S, prev);
  return day && day.shift === 'night' ? prev : null;
}

/** The day a workout starting at local wall-clock (`iso`, `hour`) counts for. */
export function trainingDayFor(S, iso, hour) {
  return nightBefore(S, iso, hour) || iso;
}

/** The day a workout started now (a local Date) counts for. */
export function trainingDayOf(S, now = new Date()) {
  return trainingDayFor(S, localIso(now), now.getHours());
}

/**
 * A wearable workout's local start, as the syncs store it on the burn
 * entry: 'YYYY-MM-DDTHH:MM', wall clock where it happened, no zone.
 * → { iso, hour } or null (older entries have no `start`).
 */
export function wallClock(start) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):\d{2}/.exec(String(start || ''));
  if (!m || !isRealIso(m[1])) return null;
  const hour = Number(m[2]);
  return hour >= 0 && hour < 24 ? { iso: m[1], hour } : null;
}
