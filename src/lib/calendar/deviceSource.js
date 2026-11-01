/**
 * The phone's calendar: the plugin side (see device.js for the shape and
 * why nothing is stored).
 *
 * iOS app only (owner, 2026-11-01). On the web and in the Android app
 * this reports `available: false` and never loads the plugin. Reading
 * needs Full Access on iOS 17+ (there is no read-only level); Vantage
 * only ever reads. The Info.plist strings the iOS project needs are in
 * STARTUP_REQUIREMENTS.md.
 *
 * Settings live on the PHONE, not in S: whether it is on and which
 * calendars to show. Calendar ids belong to this device's EventKit, so
 * syncing them to another device would mean nothing there.
 */
import { isNativeApp } from '../native/platform';
import { deviceEventsByDate, readWindow } from './device';

const PREFS_KEY = 'vantage.deviceCalendar';
let testPlugin = null;   // harness only: setDeviceCalendarPluginForTest

/** Harness hook: a fake plugin, and pretend to be the iOS app. */
export function setDeviceCalendarPluginForTest(plugin) { testPlugin = plugin; emit(); }

function platform() {
  try { return window.Capacitor?.getPlatform?.() || 'web'; } catch { return 'web'; }
}

/** Can this build read the phone's calendar at all? */
export function deviceCalendarAvailable() {
  if (testPlugin) return true;
  return isNativeApp() && platform() === 'ios';
}

let pluginPromise = null;
async function plugin() {
  if (testPlugin) return testPlugin;
  if (!deviceCalendarAvailable()) return null;
  if (!pluginPromise) {
    pluginPromise = import('@ebarooni/capacitor-calendar')
      .then(m => m.CapacitorCalendar)
      .catch(() => null);
  }
  return pluginPromise;
}

// ── Per-phone settings, with a tiny subscription so Settings and the
//    App-level reader stay in step ──
const subs = new Set();
function emit() { subs.forEach(f => { try { f(); } catch { /* listener's problem */ } }); }
export function subscribeDeviceCalendar(f) { subs.add(f); return () => subs.delete(f); }

/** { enabled, calendarIds: string[] | null (= all) } */
export function devicePrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (p && typeof p === 'object') {
      return { enabled: !!p.enabled, calendarIds: Array.isArray(p.calendarIds) ? p.calendarIds.map(String) : null };
    }
  } catch { /* private mode, bad JSON */ }
  return { enabled: false, calendarIds: null };
}
export function setDevicePrefs(patch) {
  const next = { ...devicePrefs(), ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* not persisted this time */ }
  emit();
  return next;
}

/** 'granted' | 'denied' | 'prompt' | 'unavailable' */
export async function calendarPermission() {
  const p = await plugin();
  if (!p) return 'unavailable';
  try {
    const { result } = await p.checkPermission({ scope: 'readCalendar' });
    return result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'prompt';
  } catch { return 'prompt'; }
}

/** Ask once. iOS 17+ only offers Full Access for reading. */
export async function requestCalendarAccess() {
  const p = await plugin();
  if (!p) return 'unavailable';
  try {
    const { result } = await p.requestFullCalendarAccess();
    return result === 'granted' ? 'granted' : 'denied';
  } catch { return 'denied'; }
}

/** [{ id, title, colour, account }] for the picker. */
export async function listDeviceCalendars() {
  const p = await plugin();
  if (!p) return [];
  try {
    const { result } = await p.listCalendars();
    return (result || []).filter(c => c && c.id).map(c => ({
      id: String(c.id),
      title: c.title || c.internalTitle || 'Calendar',
      colour: typeof c.color === 'string' ? c.color : null,
      account: (c.source && c.source.title) || c.accountName || '',
    }));
  } catch { return []; }
}

/**
 * The events to show, as { iso: [event] }, or null when off, not
 * allowed, or unavailable. Never throws.
 */
export async function readDeviceEvents(now = new Date()) {
  const prefs = devicePrefs();
  if (!prefs.enabled) return null;
  const p = await plugin();
  if (!p) return null;
  if ((await calendarPermission()) !== 'granted') return null;
  try {
    const { from, to } = readWindow(now);
    const { result } = await p.listEventsInRange({ from, to });
    return deviceEventsByDate(result, prefs.calendarIds);
  } catch { return null; }
}

/** Open Apple Calendar at a moment (a tap on one of its events). */
export async function openInDeviceCalendar(ms) {
  const p = await plugin();
  if (!p) return false;
  try { await p.openCalendar({ date: Number(ms) || Date.now() }); return true; } catch { return false; }
}
