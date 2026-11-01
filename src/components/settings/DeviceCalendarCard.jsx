import { useCallback, useEffect, useState } from 'react';
import SettingsGroup from './SettingsGroup';
import './DeviceCalendarCard.css';
import Icon from '../Icon';
import { useSubscriptionContext } from '../../context/SubscriptionContext';
import { requestPaywall } from '../../lib/paywallBus';
import {
  deviceCalendarAvailable, devicePrefs, setDevicePrefs, subscribeDeviceCalendar,
  calendarPermission, requestCalendarAccess, listDeviceCalendars,
} from '../../lib/calendar/deviceSource';

/**
 * Settings › iPhone calendar. iOS app only, Pro only (owner, 2026-11-01).
 * Turning it on asks iOS for calendar access, then shows the phone's
 * calendars to pick from. The choice lives on this phone (deviceSource),
 * and the events are read here and never saved — lib/calendar/device.js.
 */
export default function DeviceCalendarCard() {
  const { hasPro } = useSubscriptionContext();
  const [prefs, setPrefs] = useState(devicePrefs);
  const [perm, setPerm] = useState('prompt');
  const [calendars, setCalendars] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeDeviceCalendar(() => setPrefs(devicePrefs())), []);

  const refresh = useCallback(async () => {
    const p = await calendarPermission();
    setPerm(p);
    setCalendars(p === 'granted' ? await listDeviceCalendars() : []);
  }, []);
  useEffect(() => { if (hasPro) refresh(); }, [hasPro, refresh]);

  if (!deviceCalendarAvailable()) return null;

  const desc = 'Show the events in your iPhone’s calendars on Vantage’s calendar and hub. '
    + 'They are read on this phone only: never saved to your account or sent anywhere, and Vantage never changes your calendar.';

  if (!hasPro) {
    return (
      <SettingsGroup title="iPhone calendar" desc={desc}>
        <button type="button" className="tut-replay-btn" onClick={() => requestPaywall('generic')}>
          <span aria-hidden="true" style={{ display: 'inline-flex', marginRight: 6 }}><Icon name="sparkles" size={15} /></span>
          Show my calendar with Pro
        </button>
      </SettingsGroup>
    );
  }

  const turnOn = async () => {
    setBusy(true);
    const result = perm === 'granted' ? 'granted' : await requestCalendarAccess();
    if (result === 'granted') setDevicePrefs({ enabled: true });
    await refresh();
    setBusy(false);
  };
  const chosen = id => !prefs.calendarIds || prefs.calendarIds.includes(id);
  const toggle = id => {
    const all = calendars.map(c => c.id);
    const current = prefs.calendarIds || all;
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    // Every calendar ticked is stored as "all", so a calendar added on the
    // phone later shows up without a trip back here.
    setDevicePrefs({ calendarIds: all.every(x => next.includes(x)) ? null : next });
  };

  const on = prefs.enabled && perm === 'granted';
  return (
    <SettingsGroup title="iPhone calendar" desc={desc}>
      {perm === 'denied' ? (
        <p className="settings-group-note" role="status">
          Calendar access is off for Vantage. Turn it on in the iPhone’s Settings › Privacy &amp; Security › Calendars, then come back here.
        </p>
      ) : on ? (
        <>
          {calendars.length > 0 && (
            <ul className="devcal-list" aria-label="Calendars to show">
              {calendars.map(c => (
                <li key={c.id}>
                  <label className="devcal-row">
                    <input type="checkbox" checked={chosen(c.id)} onChange={() => toggle(c.id)} />
                    <span className="devcal-dot" style={{ background: c.colour || 'var(--text-muted)' }} aria-hidden="true" />
                    <span className="devcal-name">{c.title}</span>
                    {c.account && <span className="devcal-acct">{c.account}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="tut-replay-btn" onClick={() => setDevicePrefs({ enabled: false })}>
            Stop showing my calendar
          </button>
        </>
      ) : (
        <button type="button" className="tut-replay-btn" onClick={turnOn} disabled={busy}>
          <span aria-hidden="true" style={{ display: 'inline-flex', marginRight: 6 }}><Icon name="calendar-days" size={15} /></span>
          {busy ? 'Asking iOS…' : 'Show my iPhone calendar'}
        </button>
      )}
    </SettingsGroup>
  );
}
