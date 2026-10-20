/**
 * The console hub's layout state: S.hubGrid, or the seed derived from the
 * classic lists while that key is absent (grid.js has the rules).
 *
 * `commit(fn)` is the ONLY write path: it re-reads the grid from the
 * latest `prev`, applies `fn`, and writes S.hubGrid alone. Nothing here
 * writes S.hubWidgets, S.mobileWidgets, S.widgetPositions or
 * S.widgetSizes. A no-op edit on an unseeded hub writes nothing, so
 * merely viewing the hub never creates the key.
 */
import { useCallback, useMemo, useRef } from 'react';
import { readHubGrid, withHubGrid } from './grid';
import { PRESET_IDS, allowType } from './catalogue';
import { nextRenewal } from '../../../lib/money/recurring';
import { eventsOn, todayIso } from '../../../lib/calendar/events';

/** Is there anything for Up next to show? Trips, events in the next 60 days, or bills. */
export function hasUpcoming(S, now = new Date()) {
  const today = todayIso(now);
  if ((S.holidays || []).some(h => h && h.status !== 'completed' && (!h.from || h.from >= today))) return true;
  if ((S.subscriptions || []).some(s => nextRenewal(s, now))) return true;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 60; i++) {
    if (eventsOn(S, todayIso(d)).length) return true;
    d.setDate(d.getDate() + 1);
  }
  return false;
}

export const makeId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function useHubGrid(S, update, { isOwner = false } = {}) {
  const opts = useMemo(() => ({
    presetIds: PRESET_IDS,
    allow: type => allowType(type, { isOwner }),
    hasUpcoming: hasUpcoming(S),
  // The seed only depends on these keys; recomputing on every S change
  // would re-derive on every tracker tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isOwner, S.holidays, S.subscriptions, S.calendarEvents]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const { grid, seeded } = useMemo(() => readHubGrid(S, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [S.hubGrid, S.hubWidgets, S.mobileWidgets, opts]);

  const commit = useCallback(fn => {
    update(prev => {
      const { grid: cur } = readHubGrid(prev, optsRef.current);
      const next = fn(cur);
      if (!next || next === cur) return prev;
      return withHubGrid(prev, next);
    });
  }, [update]);

  return { grid, seeded, commit, presetIds: PRESET_IDS };
}
