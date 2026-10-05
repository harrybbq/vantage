/**
 * The free AI-scan allowance, as the scanner shows it: "2 of 3 free AI
 * scans left this week".
 *
 * The server owns the number (netlify/functions/ai-food-detect.js counts
 * from ai_usage and checks the tier itself) — this only asks and
 * displays, so editing it in the browser changes nothing but the label.
 * Each scan's response carries the new `freeScansLeft`, which `setLeft`
 * applies without another round trip.
 */
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../authFetch';

/** "2 of 3 free AI scans left this week" / "No free AI scans left — refills Monday". */
export function quotaLine(q) {
  if (!q || q.paid || q.left == null || q.limit == null) return '';
  if (q.left <= 0) return `No free AI scans left this week — refills ${weekday(q.resetsOn)}.`;
  return `${q.left} of ${q.limit} free AI scan${q.limit === 1 ? '' : 's'} left this week`;
}

function weekday(iso) {
  if (!iso) return 'next week';
  const d = new Date(iso + 'T12:00:00Z');
  return Number.isNaN(d.getTime()) ? 'next week' : d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

/**
 * → { paid, left, limit, resetsOn, setLeft, refresh }
 * `enabled` false skips the request (e.g. Pro is already known client-side).
 */
export function useAiScanQuota(enabled = true) {
  const [q, setQ] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const res = await authFetch('/.netlify/functions/ai-food-detect');
      if (!res.ok) return;
      setQ(await res.json());
    } catch { /* offline — no label, scanning still works */ }
  }, []);
  useEffect(() => { if (enabled) refresh(); }, [enabled, refresh]);
  const setLeft = useCallback(left => {
    if (typeof left !== 'number') return;
    setQ(prev => (prev && !prev.paid ? { ...prev, left } : prev));
  }, []);
  return { ...(q || {}), setLeft, refresh };
}
