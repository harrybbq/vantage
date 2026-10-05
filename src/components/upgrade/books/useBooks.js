/**
 * Load one books view, keep the last good answer while a refresh is in
 * flight (a refresh never blanks the screen) — the Security console's
 * usePanel, pointed at the books function. No polling: books change when
 * the owner changes them, and every write here reloads what it touched.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBooks } from './api';

export function useBooks(view, { params, skip = false } = {}) {
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [updatedAt, setUpdatedAt] = useState(null);
  const key = JSON.stringify(params || {});
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const out = await fetchBooks(view, JSON.parse(key));
    if (mine !== seq.current) return;              // a newer load superseded this one
    setRes(prev => (out.state === 'error' && prev && prev.state === 'ok') ? { ...prev, staleError: out.error } : out);
    setUpdatedAt(Date.now());
    setLoading(false);
  }, [view, key]);

  useEffect(() => { if (!skip) load(); }, [load, skip]);

  /** Patch the loaded data in place (optimistic updates after an action). */
  const patch = useCallback(fn => {
    setRes(prev => (prev && prev.state === 'ok' ? { ...prev, data: fn(prev.data) } : prev));
  }, []);

  return { res, loading, updatedAt, reload: load, patch };
}
