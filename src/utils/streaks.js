/**
 * Recalculate streaks for all boolean trackers.
 * Returns a new streaks map { [trackerId]: { current, best, lastDate } }
 *
 * Logic:
 * - Sort all logged dates ascending
 * - Walk day-by-day; consecutive true days = streak increments
 * - If yesterday was logged true AND today also true → increment
 * - If today logged true but yesterday not → reset to 1
 * - If today not yet logged → preserve last streak (not broken until tomorrow)
 */
export function recalcStreaks(logs, trackers, prevStreaks = {}, today = getTodayStr()) {
  const boolTrackers = trackers.filter(t => t.type === 'boolean');

  const newStreaks = { ...prevStreaks };

  boolTrackers.forEach(tracker => {
    // Collect all dates where this tracker was logged true, sorted
    const trueDates = Object.entries(logs)
      .filter(([, dayLog]) => dayLog[tracker.id] === true)
      .map(([date]) => date)
      .sort();

    if (!trueDates.length) {
      newStreaks[tracker.id] = { current: 0, best: (prevStreaks[tracker.id]?.best || 0), lastDate: null };
      return;
    }

    // Calculate longest streak and current streak
    let best = 1;
    let runLen = 1;
    for (let i = 1; i < trueDates.length; i++) {
      const prev = new Date(trueDates[i - 1]);
      const curr = new Date(trueDates[i]);
      const diffDays = Math.round((curr - prev) / 86400000);
      if (diffDays === 1) {
        runLen++;
        if (runLen > best) best = runLen;
      } else {
        runLen = 1;
      }
    }

    // Current streak: streak ending at the most recent logged date
    const lastLogged = trueDates[trueDates.length - 1];
    let current = 1;
    for (let i = trueDates.length - 2; i >= 0; i--) {
      const prev = new Date(trueDates[i]);
      const next = new Date(trueDates[i + 1]);
      const diffDays = Math.round((next - prev) / 86400000);
      if (diffDays === 1) current++;
      else break;
    }

    // If last logged date is neither today nor yesterday → streak is broken
    const diffFromToday = Math.round((new Date(today) - new Date(lastLogged)) / 86400000);
    if (diffFromToday > 1) current = 0;

    const prevBest = prevStreaks[tracker.id]?.best || 0;
    newStreaks[tracker.id] = {
      current,
      best: Math.max(best, prevBest, current),
      lastDate: lastLogged,
    };
  });

  return newStreaks;
}

function getTodayStr() {
  const today = new Date();
  return today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
}
