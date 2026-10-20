/**
 * Console shell navigation contract. Hermetic. Run: npm run check:console
 */
import assert from 'node:assert/strict';
import {
  CONSOLE_SHOW_HOLIDAY, sidebarItems, TABS, moreItems, activeTab, canonicalSection,
  sectionTitle, longDate, shortDate, greeting, initials, paletteHint,
} from './nav.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ids = list => list.map(i => i.id);

t('Holiday is merged into Track: no entry of its own, but it can come back', () => {
  assert.equal(CONSOLE_SHOW_HOLIDAY, false, 'trips live in Track › Calendar');
  assert.ok(!ids(sidebarItems()).includes('holiday'));
  assert.ok(!ids(moreItems()).includes('holiday'));
  assert.ok(ids(sidebarItems({ showHoliday: true })).includes('holiday'));
  assert.ok(ids(moreItems({ showHoliday: true })).includes('holiday'));
  assert.ok(!ids(sidebarItems({ showHoliday: false })).includes('holiday'));
  assert.ok(!ids(moreItems({ showHoliday: false })).includes('holiday'));
});

t('sidebar order, sentence case, Upgrade only for the owner and above Settings', () => {
  assert.deepEqual(ids(sidebarItems({ showHoliday: false })),
    ['hub', 'achievements', 'track', 'shop', 'habits', 'leaderboard', 'settings']);
  const owner = ids(sidebarItems({ isOwner: true, showHoliday: false }));
  assert.deepEqual(owner.slice(-2), ['upgrade', 'settings']);
  for (const i of sidebarItems({ isOwner: true })) {
    assert.match(i.label, /^[A-Z][a-z ]+$/, `${i.label} is sentence case`);
  }
  assert.equal(sidebarItems().find(i => i.id === 'track').icon, 'calendar-days');
});

t('phone bar: Hub · Track · Habits · Shop, then More', () => {
  assert.deepEqual(TABS.map(x => x.label), ['Hub', 'Track', 'Habits', 'Shop']);
  assert.ok(!ids(TABS).includes('holiday'));
});

t('every section is reachable on the phone (a tab or a More row)', () => {
  const routed = ['hub', 'achievements', 'track', 'shop', 'holiday', 'habits', 'leaderboard', 'settings', 'friends'];
  const reach = new Set([...ids(TABS), ...ids(moreItems())]);
  // Holiday is reached through Track (Calendar › Year), which its route lights.
  for (const r of routed) assert.ok(reach.has(r) || (r === 'holiday' && activeTab(r) === 'track'), r);
  assert.ok(ids(moreItems({ isOwner: true })).includes('upgrade'));
  assert.ok(!ids(moreItems()).includes('upgrade'));
});

t('active tab', () => {
  assert.equal(activeTab('hub'), 'hub');
  assert.equal(activeTab('shop'), 'shop');
  assert.equal(activeTab('holiday'), 'track');
  assert.equal(activeTab('settings'), 'more');
  assert.equal(activeTab('schedule'), 'more');
  assert.equal(activeTab('hub', { moreOpen: true }), 'more');
  assert.equal(canonicalSection('schedule'), 'upgrade');
});

t('titles never empty', () => {
  for (const s of ['hub', 'track', 'shop', 'friends', 'upgrade', 'schedule', 'nonsense', undefined]) {
    assert.ok(sectionTitle(s).length > 0, String(s));
  }
  assert.equal(sectionTitle('shop'), 'Shopping');
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

console.log(`shell nav: ${n} tests passed`);
