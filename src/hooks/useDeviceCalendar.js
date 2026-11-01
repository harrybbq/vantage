import { useEffect, useState } from 'react';
import { deviceCalendarAvailable, readDeviceEvents, subscribeDeviceCalendar } from '../lib/calendar/deviceSource';

const REFRESH_MS = 15 * 60 * 1000;

/**
 * The phone's calendar events for the calendar surfaces, as
 * { iso: [event] }, or null (off, not Pro, not the iOS app, or not
 * allowed). Read on mount, whenever the app comes back to the
 * foreground, every 15 minutes, and when Settings changes the choice.
 * Held in memory only — see lib/calendar/device.js.
 */
export function useDeviceCalendar(hasPro) {
  const [byDate, setByDate] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => subscribeDeviceCalendar(() => setVersion(v => v + 1)), []);

  useEffect(() => {
    if (!hasPro || !deviceCalendarAvailable()) { setByDate(null); return undefined; }
    let live = true;
    const load = () => { readDeviceEvents().then(r => { if (live) setByDate(r); }); };
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(load, REFRESH_MS);
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [hasPro, version]);

  return byDate;
}
