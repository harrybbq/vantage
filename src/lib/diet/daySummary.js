/**
 * Today's macros and totals, for anything on the hub that shows them.
 *
 * The Macros widget, the Calories Burned widget and now every Nutrition
 * prime card want the same two rows: the user's macro goals and today's
 * summary. Each used to fetch them for itself on mount, so a hub with a
 * Nutrition card beside a Macros widget asked the database twice for the
 * same thing. Supabase here is on Micro compute; reads are not free.
 *
 * One request per user per day is shared by every caller, and the answer
 * is reused for a minute. A mount after that refetches, which is what
 * picks up a meal logged on the Track page when you come back to the hub.
 *
 * Deliberately NOT useNutrition: that seeds defaults and loads log
 * entries and month data a hub card never shows.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { getTodayStr } from '../../utils/helpers';

const TTL = 60_000;
const cache = new Map();   // key → { at, data, promise }

function load(userId, day) {
  const key = `${userId}|${day}`;
  const hit = cache.get(key);
  if (hit && (hit.promise || Date.now() - hit.at < TTL)) return hit.promise || Promise.resolve(hit.data);
  const promise = (async () => {
    try {
      const [{ data: macros }, { data: summary }] = await Promise.all([
        supabase.from('nutrition_macros').select('*').eq('user_id', userId).order('display_order', { ascending: true }),
        supabase.from('nutrition_daily_summary').select('*').eq('user_id', userId).eq('log_date', day).maybeSingle(),
      ]);
      return { macros: macros || [], summary: summary || null, loaded: true };
    } catch {
      return { macros: [], summary: null, loaded: true };
    }
  })();
  cache.set(key, { at: 0, data: null, promise });
  // Only if this is still the request on file — a refresh that landed
  // mid-flight must not be overwritten by the answer it replaced.
  promise.then(data => { if (cache.get(key)?.promise === promise) cache.set(key, { at: Date.now(), data, promise: null }); });
  return promise;
}

/* Everything mounted that shows today's figures, so a quick log from one
   card can refresh all of them (and the old Macros widget) at once. */
const listeners = new Set();

/**
 * Drop the cached day and have every mounted caller refetch. Called after
 * a log from the hub, so the rings move the moment the food is added.
 */
export function refreshDaySummary(userId) {
  for (const key of [...cache.keys()]) if (key.startsWith(`${userId}|`)) cache.delete(key);
  listeners.forEach(fn => fn(userId));
}

/** Synchronous peek, so a card mounted after the first fetch paints full. */
function peek(userId, day) {
  const hit = userId && cache.get(`${userId}|${day}`);
  return hit && hit.data ? hit.data : null;
}

/**
 * @returns { macros, summary, loaded }. `loaded` is true once the fetch
 * has answered (or immediately when there is no user to fetch for).
 */
export function useDaySummary(userId) {
  const day = getTodayStr();
  const [data, setData] = useState(() => peek(userId, day) || { macros: [], summary: null, loaded: !userId });
  useEffect(() => {
    if (!userId) { setData(d => (d.loaded ? d : { ...d, loaded: true })); return undefined; }
    let live = true;
    load(userId, day).then(d => { if (live) setData(d); });
    const onRefresh = uid => {
      if (uid !== userId) return;
      load(userId, day).then(d => { if (live) setData(d); });
    };
    listeners.add(onRefresh);
    return () => { live = false; listeners.delete(onRefresh); };
  }, [userId, day]);
  return data;
}
