/**
 * Console shell: what the navigation holds. Pure, no React, no DOM, so
 * nav.test.mjs can pin it.
 *
 * THREE SECTIONS (owner, 2026-11-23, from the "Four Sections" mockup):
 * the Hub plus Track, Health and Social. Settings sits behind the
 * avatar; a phone has no More drawer.
 *
 *   Track    Calendar · Goals · Money · Rewards
 *   Health   Train · Food · Vitals · Habits
 *   Social   League · Friends · Messages
 *
 * A section is a GROUP of tabs, and a tab is a PLACE: an existing route
 * (App's activeSection) plus, where that page has views of its own, the
 * view to show (`sub`). Nothing was moved or renamed underneath: Goals
 * and Money are the 'achievements' route's two views, Food and Vitals
 * are the 'track' route's, Messages is the 'friends' route's. So every
 * old route, deep link, shortcut and widget still lands, and lights the
 * tab it now belongs to (placeOf).
 *
 *   sidebar (desktop)   Hub · the groups · Upgrade (owner)
 *   tab bar (phone)     Hub · the groups (· Add, drawn by the shell)
 *   the strip           the open group's tabs: beside the title on a
 *                       desktop, a second row of the app bar on a phone
 *
 * Train is the gym tracker. It is the owner's until it opens to
 * everyone (the next step), so its tab is owner-only and Health starts
 * at Food for anyone else. The rest of the owner's Upgrade area keeps
 * its own sidebar entry; on a phone it is reached from Settings › Tools.
 *
 * Holiday has no tab: trips live on Track's calendar, and the 'holiday'
 * route (deep links, the 5 shortcut) reads as Track › Calendar.
 *
 * Keyboard hints: the number keys still jump to routes (1 Hub, 2 Goals,
 * 3 Calendar, 4 Rewards, 5 trips), which no longer line up one to one
 * with the sidebar, so only Hub shows its key.
 */

const HUB = { id: 'hub', icon: 'house', label: 'Hub', key: '1' };
const UPGRADE = { id: 'upgrade', icon: 'trending-up', label: 'Upgrade' };

/**
 * `area`: the id lib/onboarding/areas.js scopes by (a route id). A tab
 * with no area is always shown: the calendar, food and vitals all live
 * on the Track route, which every account has.
 */
export const GROUPS = Object.freeze([
  Object.freeze({ id: 'track', icon: 'calendar-days', label: 'Track', tabs: Object.freeze([
    Object.freeze({ id: 'calendar', label: 'Calendar', section: 'track', sub: 'calendar' }),
    Object.freeze({ id: 'goals', label: 'Goals', section: 'achievements', sub: 'goals', area: 'achievements' }),
    Object.freeze({ id: 'money', label: 'Money', section: 'achievements', sub: 'savings', area: 'achievements' }),
    Object.freeze({ id: 'rewards', label: 'Rewards', section: 'shop', area: 'shop' }),
  ]) }),
  Object.freeze({ id: 'health', icon: 'activity', label: 'Health', tabs: Object.freeze([
    Object.freeze({ id: 'train', label: 'Train', section: 'train', owner: true }),
    Object.freeze({ id: 'food', label: 'Food', section: 'track', sub: 'diet' }),
    Object.freeze({ id: 'vitals', label: 'Vitals', section: 'track', sub: 'vitals' }),
    Object.freeze({ id: 'habits', label: 'Habits', section: 'habits', area: 'habits' }),
  ]) }),
  Object.freeze({ id: 'social', icon: 'users', label: 'Social', tabs: Object.freeze([
    Object.freeze({ id: 'league', label: 'League', section: 'leaderboard', area: 'leaderboard' }),
    Object.freeze({ id: 'friends', label: 'Friends', section: 'friends', sub: 'friends', area: 'friends' }),
    Object.freeze({ id: 'messages', label: 'Messages', section: 'friends', sub: 'messages', area: 'friends' }),
  ]) }),
]);

/** The view a route opens on when none is asked for. */
export const DEFAULT_SUB = Object.freeze({ track: 'calendar', achievements: 'goals', friends: 'friends' });

/** Routes an id resolves to before highlighting ('schedule' is Upgrade's old id). */
export function canonicalSection(id) {
  if (id === 'schedule') return 'upgrade';
  return id || 'hub';
}

/** A route's view, normalised: classic's 'trackers' tab is the calendar here. */
function subOf(section, sub) {
  if (section === 'track' && sub === 'trackers') return 'calendar';
  return sub || DEFAULT_SUB[section] || null;
}

/**
 * Where a route (and its view) sits → { group, tab } or null for a
 * page outside the three sections (Hub, Settings, Upgrade).
 */
export function placeOf(section, sub = null) {
  let s = canonicalSection(section);
  if (s === 'holiday') { s = 'track'; sub = 'calendar'; }
  const want = subOf(s, sub);
  for (const group of GROUPS) {
    const tab = group.tabs.find(t => t.section === s && (t.sub || null) === (t.sub ? want : null));
    if (tab) return { group, tab };
  }
  return null;
}

/**
 * A group's tabs for this account. `scope`: the routes a scoped account
 * shows (a Set from lib/onboarding/areas.js navScope), or null for
 * everything, which is every account that is not scoped.
 */
export function groupTabs(group, { isOwner = false, scope = null } = {}) {
  return group.tabs.filter(t => (!t.owner || isOwner) && (!t.area || !scope || scope.has(t.area)));
}

/** The groups this account sees, each with its visible tabs. A group with none is left out. */
export function navGroups(opts = {}) {
  return GROUPS.map(g => ({ ...g, tabs: groupTabs(g, opts) })).filter(g => g.tabs.length > 0);
}

/** Desktop sidebar: Hub, the groups, and Upgrade for the owner. Settings is behind the avatar. */
export function sidebarItems({ isOwner = false, scope = null } = {}) {
  return [HUB, ...navGroups({ isOwner, scope }), ...(isOwner ? [UPGRADE] : [])];
}

/** The phone's tab bar: Hub and the groups. Never more than four. */
export function tabItems({ isOwner = false, scope = null } = {}) {
  return [HUB, ...navGroups({ isOwner, scope })];
}

/**
 * The tab a group opens on: the one last open in it (`last`, a tab id)
 * while it is still shown, otherwise its first.
 */
export function groupTarget(group, last = null) {
  return group.tabs.find(t => t.id === last) || group.tabs[0] || null;
}

/**
 * The nav entry a page belongs to: 'hub', a group's id, or the route
 * itself for a page outside the groups ('settings', 'upgrade').
 */
export function navSection(section, sub = null) {
  const place = placeOf(section, sub);
  return place ? place.group.id : canonicalSection(section);
}

/** Which phone tab lights up: one of the tabs' ids, or null (Settings, Upgrade). */
export function activeTab(section, sub = null, { tabs = tabItems() } = {}) {
  const id = navSection(section, sub);
  return tabs.some(t => t.id === id) ? id : null;
}

const TITLES = { hub: 'Hub', settings: 'Settings', upgrade: 'Upgrade' };

/** Page title for the top bar and the phone app bar: the section's name. Never empty. */
export function sectionTitle(section, sub = null) {
  const place = placeOf(section, sub);
  return place ? place.group.label : TITLES[canonicalSection(section)] || 'Vantage';
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
