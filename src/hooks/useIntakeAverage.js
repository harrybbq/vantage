/**
 * Average logged calorie intake over the trailing N days, for the body
 * goal's projection.
 *
 * Why this exists: the projection otherwise assumes the user eats the
 * daily target they typed at setup. Someone who logs their food
 * faithfully and lands at 2,600 against a 2,000 target has a smaller
 * deficit and a longer timeline than the plan says — and that is not a
 * confidence problem, it is the model running on a wrong input. Feeding
 * the real number back in is what makes the effort show up in the
 * percentage.
 *
 * Cost discipline (Supabase is on Micro):
 *   - one query, two indexed columns, capped at the trailing window
 *   - module-scope cache keyed by user + window, with a TTL, so the
 *     desktop hub's detached widget roots and the mobile stack share a
 *     single fetch instead of one each
 *   - never runs without a userId
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map();   // key → { at, value }

const ymd = d => d.toISOString().slice(0, 10);

export async function fetchIntakeAverage(userId, days = 14) {
  if (!userId) return null;
  const key = `${userId}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const from = ymd(new Date(Date.now() - days * 86400000));
  const to = ymd(new Date());
  // The calorie GOAL comes from the user's macro settings — asking for
  // it again in the body-goal form would be a second place to keep the
  // same number in sync, and they would drift.
  const [{ data, error }, { data: goalRow }] = await Promise.all([
    supabase
      .from('nutrition_daily_summary')
      .select('log_date,calories')
      .eq('user_id', userId)
      .gte('log_date', from)
      .lte('log_date', to),
    supabase
      .from('nutrition_macros').select('daily_goal')
      .eq('user_id', userId).eq('name', 'Calories').maybeSingle(),
  ]);

  // Fail soft: a null result means "no opinion", and the caller falls
  // back to the typed target rather than showing an error in a widget
  // that is otherwise working.
  if (error) return null;

  // Raw days out; the classification of what counts as a COMPLETE day
  // lives in lib/body/goal.js (summariseIntake) so the policy is pure
  // and testable rather than buried in a fetch.
  const value = {
    days,
    targetKcal: Number(goalRow?.daily_goal) || null,
    entries: (data || [])
      .filter(r => r.calories > 0)
      .map(r => ({ date: r.log_date, calories: r.calories })),
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Clear the cache — used after a food log so the widget catches up. */
export function invalidateIntakeAverage() {
  cache.clear();
}

export function useIntakeAverage(userId, days = 14, enabled = true) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!enabled || !userId) { setState(null); return undefined; }
    let alive = true;
    fetchIntakeAverage(userId, days).then(v => { if (alive) setState(v); });
    return () => { alive = false; };
  }, [userId, days, enabled]);
  return state;
}
