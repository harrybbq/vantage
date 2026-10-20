/**
 * Console shell: what the navigation holds. Pure, no React, no DOM, so
 * nav.test.mjs can pin it.
 *
 * One list per surface:
 *   SIDEBAR   desktop rail, top to bottom (Sign out is drawn separately)
 *   TABS      the 5-tab phone bar: Hub · Track · Habits · Shop · More
 *   MORE      the rows in the phone's More sheet
 *
 * Holiday. TRACK is merging trips into Track's calendar; until that lands,
 * Holiday keeps its own entry in the sidebar and in More, so the owner never
 * loses a way to reach trips mid-build. Flip CONSOLE_SHOW_HOLIDAY to false
 * once ConsoleTrack shows trips. The 'holiday' route itself stays either
 * way (deep links, saved tabs), rendered by TRACK's ConsoleHoliday.
 *
 * Keyboard hints show the shortcuts that work today (useKeyboardShortcuts:
 * 1 Hub, 2 Achievements, 3 Track, 4 Shop, 5 Holiday). The Direction A mock
 * drew letters; those are not bound, so they are not shown.
 */

export const CONSOLE_SHOW_HOLIDAY = true;

const ITEM = {
  hub:          { id: 'hub',          icon: 'house',          label: 'Hub',          key: '1' },
  achievements: { id: 'achievements', icon: 'star',           label: 'Achievements', key: '2', desc: 'Your goal map' },
  track:        { id: 'track',        icon: 'calendar-days',  label: 'Track',        key: '3' },
  shop:         { id: 'shop',         icon: 'shopping-bag',   label: 'Shopping',     key: '4', short: 'Shop' },
  holiday:      { id: 'holiday',      icon: 'plane',          label: 'Holiday',      key: '5', desc: 'Trips, until they move into Track' },
  habits:       { id: 'habits',       icon: 'flame',          label: 'Habits' },
  leaderboard:  { id: 'leaderboard',  icon: 'trophy',         label: 'Leaderboard',  desc: 'Where you rank overall' },
  friends:      { id: 'friends',      icon: 'users',          label: 'Friends',      desc: 'Your friends and messages' },
  settings:     { id: 'settings',     icon: 'settings',       label: 'Settings',     desc: 'Account, appearance, data' },
  upgrade:      { id: 'upgrade',      icon: 'trending-up',    label: 'Upgrade',      desc: 'Rotation, diet, career' },
};

/** Desktop sidebar items. Upgrade only for the owner, above Settings (as classic). */
export function sidebarItems({ isOwner = false, showHoliday = CONSOLE_SHOW_HOLIDAY } = {}) {
  return [
    ITEM.hub, ITEM.achievements, ITEM.track, ITEM.shop,
    ...(showHoliday ? [ITEM.holiday] : []),
    ITEM.habits, ITEM.leaderboard,
    ...(isOwner ? [ITEM.upgrade] : []),
    ITEM.settings,
  ];
}

/** The four routed phone tabs; More is drawn after them. Shop took Holiday's slot (owner decision). */
export const TABS = [
  { ...ITEM.hub },
  { ...ITEM.track },
  { ...ITEM.habits },
  { ...ITEM.shop, label: 'Shop' },
];

/** Rows in the phone's More sheet. */
export function moreItems({ isOwner = false, showHoliday = CONSOLE_SHOW_HOLIDAY } = {}) {
  return [
    ITEM.achievements, ITEM.friends, ITEM.leaderboard,
    ...(showHoliday ? [ITEM.holiday] : []),
    ITEM.settings,
    ...(isOwner ? [ITEM.upgrade] : []),
  ];
}

/** Routes an id resolves to before highlighting ('schedule' is Upgrade's old id). */
export function canonicalSection(id) {
  if (id === 'schedule') return 'upgrade';
  return id || 'hub';
}

/** Which phone tab lights up for a section: one of TABS' ids, 'more', or null. */
export function activeTab(section, { moreOpen = false } = {}) {
  if (moreOpen) return 'more';
  const s = canonicalSection(section);
  if (TABS.some(t => t.id === s)) return s;
  // Holiday is part of Track in the console design; while it still has its
  // own route it lights the Track tab, which is where it is going.
  if (s === 'holiday') return 'track';
  return 'more';
}

const TITLES = {
  hub: 'Hub', achievements: 'Achievements', track: 'Track', shop: 'Shopping', holiday: 'Holiday',
  habits: 'Habits', leaderboard: 'Leaderboard', settings: 'Settings', friends: 'Friends', upgrade: 'Upgrade',
};

/** Page title for the top bar and the phone app bar. Never empty. */
export function sectionTitle(section) {
  return TITLES[canonicalSection(section)] || 'Vantage';
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Tuesday 20 October" (desktop top bar). */
export function longDate(now) {
  return `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

/** "Tue 20 Oct" (phone app bar). */
export function shortDate(now) {
  return `${DAYS[now.getDay()].slice(0, 3)} ${now.getDate()} ${MONTHS[now.getMonth()].slice(0, 3)}`;
}

/** "Morning, Jordan" — plain, no emoji. First name only; no name, no comma. */
export function greeting(now, name) {
  const h = now.getHours();
  const part = h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 22 ? 'Evening' : 'Hello';
  const first = String(name || '').trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

/** Up to two initials for the avatar fallback. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. */
export function paletteHint(platform) {
  return /mac|iphone|ipad|ipod/i.test(String(platform || '')) ? '⌘K' : 'Ctrl K';
}
