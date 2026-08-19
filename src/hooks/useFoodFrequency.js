/**
 * What you eat often, ranked by how often.
 *
 * The food search already has a "Recent" tab, but recent and frequent
 * are different lists and the panel wants the second one: the thing you
 * have logged thirty-four times belongs at the top whether or not you
 * had it yesterday.
 *
 * Counted over a window rather than for ever, so a food you have
 * stopped eating drops off instead of sitting at the top on the
 * strength of a phase two years ago.
 *
 * One query, cached at module scope for the session — the list changes
 * when you log something, and the caller invalidates it then.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const WINDOW_DAYS = 90;
const ROW_LIMIT = 400;      // 90 days of heavy logging is ~450 rows
const TOP_N = 6;

let cache = { userId: null, at: 0, rows: null };
const TTL_MS = 60_000;

/** Group log rows by food name and rank by count. The row kept for each
 *  name is the most recent one, so re-logging uses the serving you last
 *  actually ate rather than the first you ever did. */
export function rankByFrequency(rows, topN = TOP_N) {
  const byName = new Map();
  for (const r of rows || []) {
    const key = String(r.food_name || '').toLowerCase().trim();
    if (!key) continue;
    const prev = byName.get(key);
    if (prev) { prev.count += 1; continue; }
    byName.set(key, { count: 1, row: r });
  }
  return [...byName.values()]
    .sort((a, b) => b.count - a.count || String(a.row.food_name).localeCompare(String(b.row.food_name)))
    .slice(0, topN)
    .map(({ count, row }) => ({ ...row, count }));
}

export function useFoodFrequency(userId) {
  const [items, setItems] = useState(() => (
    cache.userId === userId && cache.rows ? rankByFrequency(cache.rows) : []
  ));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) { setItems([]); return; }
    let live = true;

    const fresh = cache.userId === userId && cache.rows && (Date.now() - cache.at) < TTL_MS;
    if (fresh && tick === 0) { setItems(rankByFrequency(cache.rows)); return; }

    (async () => {
      const from = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
      try {
        const { data, error } = await supabase
          .from('nutrition_log')
          .select('id,food_name,brand,serving_g,calories,protein_g,carbs_g,fat_g,fibre_g,sugar_g,sodium_mg,additional_nutrients,meal_type,log_date')
          .eq('user_id', userId)
          .gte('log_date', from)
          .order('log_date', { ascending: false })
          .order('id', { ascending: false })
          .limit(ROW_LIMIT);
        // Fail soft: the rail simply shows its empty state. Nothing here
        // is worth an error box over.
        if (error || !live || !Array.isArray(data)) return;
        cache = { userId, at: Date.now(), rows: data };
        setItems(rankByFrequency(data));
      } catch { /* fail soft */ }
    })();

    return () => { live = false; };
  }, [userId, tick]);

  /** Call after logging something so the counts catch up. */
  const refresh = useCallback(() => { cache = { userId: null, at: 0, rows: null }; setTick(t => t + 1); }, []);

  return { items, refresh };
}
