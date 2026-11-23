/**
 * Console shell navigation contract. Hermetic. Run: npm run check:console
 */
import assert from 'node:assert/strict';
import {
  GROUPS, DEFAULT_SUB, sidebarItems, tabItems, navGroups, groupTabs, groupTarget, placeOf, activeTab, canonicalSection, navSection,
  sectionTitle, longDate, shortDate, greeting, initials, paletteHint,
} from './nav.js';
import { AREA_NAV, ALWAYS_NAV } from '../../../lib/onboarding/areas.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ids = list => list.map(i => i.id);

t('three sections, in the decided order, with the decided tabs', () => {
  assert.deepEqual(ids(GROUPS), ['track', 'health', 'social']);
  assert.deepEqual(GROUPS.map(g => g.tabs.map(x => x.label).join(' · ')), [
    'Calendar · Goals · Money · Rewards',
    'Train · Food · Vitals · Habits',
    'League · Friends · Messages',
  ]);
  const tabIds = GROUPS.flatMap(g => ids(g.tabs));
  assert.equal(new Set(tabIds).size, tabIds.length, 'a tab id is used twice');
  for (const g of GROUPS) for (const x of [g, ...g.tabs]) assert.match(x.label, /^[A-Z][a-z]+$/, `${x.label} is one sentence-case word`);
});

t('sidebar: Hub, the three sections, Upgrade only for the owner; Settings is behind the avatar', () => {
  assert.deepEqual(ids(sidebarItems()), ['hub', 'track', 'health', 'social']);
  assert.deepEqual(ids(sidebarItems({ isOwner: true })), ['hub', 'track', 'health', 'social', 'upgrade']);
  assert.ok(!ids(sidebarItems({ isOwner: true })).includes('settings'));
});

t('phone bar: Hub · Track · Health · Social, and no More', () => {
  assert.deepEqual(tabItems().map(x => x.label), ['Hub', 'Track', 'Health', 'Social']);
  assert.deepEqual(tabItems({ isOwner: true }).map(x => x.label), ['Hub', 'Track', 'Health', 'Social']);
  assert.ok(!ids(tabItems()).includes('more'));
});

t('Train is the owner\'s for now: Health starts at Food for anyone else', () => {
  const health = GROUPS.find(g => g.id === 'health');
  assert.deepEqual(ids(groupTabs(health)), ['food', 'vitals', 'habits']);
  assert.deepEqual(ids(groupTabs(health, { isOwner: true })), ['train', 'food', 'vitals', 'habits']);
  assert.equal(groupTarget({ tabs: groupTabs(health) }).id, 'food');
  assert.equal(groupTarget({ tabs: groupTabs(health, { isOwner: true }) }).id, 'train');
});

t('every old route lands in a section and lights the right tab', () => {
  const at = (s, sub) => { const p = placeOf(s, sub); return p ? `${p.group.id}/${p.tab.id}` : null; };
  assert.equal(at('track'), 'track/calendar');
  assert.equal(at('track', 'calendar'), 'track/calendar');
  assert.equal(at('track', 'trackers'), 'track/calendar', "classic's Trackers tab is the calendar");
  assert.equal(at('holiday'), 'track/calendar', 'trips live on the calendar');
  assert.equal(at('holiday', 'diet'), 'track/calendar');
  assert.equal(at('achievements'), 'track/goals');
  assert.equal(at('achievements', 'savings'), 'track/money');
  assert.equal(at('shop'), 'track/rewards');
  assert.equal(at('train'), 'health/train');
  assert.equal(at('track', 'diet'), 'health/food');
  assert.equal(at('track', 'vitals'), 'health/vitals');
  assert.equal(at('habits'), 'health/habits');
  assert.equal(at('leaderboard'), 'social/league');
  assert.equal(at('friends'), 'social/friends');
  assert.equal(at('friends', 'messages'), 'social/messages');
  for (const s of ['hub', 'settings', 'upgrade', 'schedule', 'nonsense', undefined]) assert.equal(at(s), null, String(s));
  assert.deepEqual(DEFAULT_SUB, { track: 'calendar', achievements: 'goals', friends: 'friends' });
});

t('every tab is a place that resolves back to itself', () => {
  for (const g of GROUPS) for (const tab of g.tabs) {
    const p = placeOf(tab.section, tab.sub);
    assert.equal(p && p.tab.id, tab.id, tab.id);
    assert.equal(p.group.id, g.id);
    assert.equal(navSection(tab.section, tab.sub), g.id);
    assert.equal(sectionTitle(tab.section, tab.sub), g.label);
  }
});

t('a group opens on its last tab while that tab is still shown, else its first', () => {
  const track = navGroups().find(g => g.id === 'track');
  assert.equal(groupTarget(track).id, 'calendar');
  assert.equal(groupTarget(track, 'money').id, 'money');
  assert.equal(groupTarget(track, 'habits').id, 'calendar', 'a tab from another group');
  const scoped = navGroups({ scope: new Set(['hub', 'track']) }).find(g => g.id === 'track');
  assert.equal(groupTarget(scoped, 'money').id, 'calendar', 'a tab the scope hides');
});

t('active tab and titles', () => {
  assert.equal(activeTab('hub'), 'hub');
  assert.equal(activeTab('shop'), 'track');
  assert.equal(activeTab('track', 'diet'), 'health');
  assert.equal(activeTab('holiday'), 'track');
  assert.equal(activeTab('friends', 'messages'), 'social');
  assert.equal(activeTab('settings'), null);
  assert.equal(activeTab('schedule'), null);
  assert.equal(activeTab('leaderboard', null, { tabs: tabItems({ scope: new Set(['hub', 'track']) }) }), null, 'Social is not shown');
  assert.equal(canonicalSection('schedule'), 'upgrade');
  assert.equal(navSection('schedule'), 'upgrade');
  assert.equal(sectionTitle('settings'), 'Settings');
  assert.equal(sectionTitle('shop'), 'Track');
  assert.equal(sectionTitle('train'), 'Health');
  for (const s of ['hub', 'track', 'shop', 'friends', 'upgrade', 'schedule', 'nonsense', undefined]) assert.ok(sectionTitle(s).length > 0, String(s));
});

t('dates and greeting (no clock, no emoji)', () => {
  const d = new Date(2026, 9, 20, 8, 42);
  assert.equal(longDate(d), 'Tuesday 20 October');
  assert.equal(shortDate(d), 'Tue 20 Oct');
  assert.equal(greeting(d, 'Jordan Hale'), 'Morning, Jordan');
  assert.equal(greeting(new Date(2026, 9, 20, 14), ''), 'Afternoon');
  assert.equal(greeting(new Date(2026, 9, 20, 19), 'Sam'), 'Evening, Sam');
  assert.equal(greeting(new Date(2026, 9, 20, 2), 'Sam'), 'Hello, Sam');
  assert.doesNotMatch(greeting(d, 'J'), /\p{Extended_Pictographic}/u);
});

t('initials and palette hint', () => {
  assert.equal(initials('Jordan Hale'), 'JH');
  assert.equal(initials('jordan'), 'J');
  assert.equal(initials('  '), '');
  assert.equal(initials('Mary Ann Smith'), 'MS');
  assert.equal(paletteHint('MacIntel'), '⌘K');
  assert.equal(paletteHint('Win32'), 'Ctrl K');
  assert.equal(paletteHint(undefined), 'Ctrl K');
});

// ── Scoped navigation (lib/onboarding/areas.js), Nov 2026 ──

t('no scope: everything, exactly as with no argument', () => {
  assert.deepEqual(navGroups({ scope: null }), navGroups());
  assert.deepEqual(ids(tabItems({ scope: null })), ids(tabItems()));
});

t('every area a tab is scoped by is one the onboarding can turn on', () => {
  const known = new Set([...ALWAYS_NAV, ...Object.values(AREA_NAV).flat()]);
  for (const g of GROUPS) for (const tab of g.tabs) if (tab.area) assert.ok(known.has(tab.area), `${tab.id} scopes by ${tab.area}`);
});

t('scoped: Fitness alone is Hub, Track (the calendar) and Health (Food, Vitals)', () => {
  const scope = new Set(['hub', 'track', 'settings', 'upgrade']);
  assert.deepEqual(ids(tabItems({ scope })), ['hub', 'track', 'health']);
  const g = Object.fromEntries(navGroups({ scope }).map(x => [x.id, ids(x.tabs)]));
  assert.deepEqual(g, { track: ['calendar'], health: ['food', 'vitals'] });
});

t('scoped: Fitness + Friends adds Social; Money adds Goals and Money', () => {
  const friends = new Set(['hub', 'track', 'settings', 'upgrade', 'leaderboard', 'friends']);
  assert.deepEqual(ids(tabItems({ scope: friends })), ['hub', 'track', 'health', 'social']);
  assert.deepEqual(ids(navGroups({ scope: friends }).find(x => x.id === 'social').tabs), ['league', 'friends', 'messages']);
  const money = new Set(['hub', 'track', 'settings', 'upgrade', 'achievements']);
  assert.deepEqual(ids(navGroups({ scope: money }).find(x => x.id === 'track').tabs), ['calendar', 'goals', 'money']);
  assert.ok(!ids(tabItems({ scope: money })).includes('social'));
});

t('scoped: whatever the scope, the bar is 3 or 4 tabs and every shown route has a tab', () => {
  const opt = ['achievements', 'shop', 'habits', 'leaderboard', 'friends'];
  for (let m = 0; m < 1 << opt.length; m++) {
    const scope = new Set(['hub', 'track', 'settings', 'upgrade', ...opt.filter((_, i) => m & (1 << i))]);
    const tabs = tabItems({ scope });
    assert.ok(tabs.length >= 3 && tabs.length <= 4);
    const shown = navGroups({ scope }).flatMap(g => g.tabs);
    for (const id of opt) assert.equal(shown.some(x => x.area === id), scope.has(id), `${id} in ${[...scope]}`);
    for (const x of shown) assert.equal(activeTab(x.section, x.sub, { tabs }), placeOf(x.section, x.sub).group.id);
  }
});

console.log(`shell nav: ${n} tests passed`);
