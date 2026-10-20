/**
 * Console paywall copy (paywallCopy.js), checked against a FREE_CAPS
 * fixture shaped like hooks/useTierLimits.js. Hermetic.
 * Run: npm run check:console
 */
import assert from 'node:assert/strict';
import { resolveCapKey, isPaywallId, compareRows, headline, numberWord } from './paywallCopy.js';

const CAPS = {
  links: { limit: 3, label: 'link widgets' },
  habits: { limit: 5, label: 'active habits' },
  achievements: { limit: 10, label: 'achievements' },
  holidays: { limit: 1, label: 'holiday' },
  shopItems: { limit: 50, label: 'shopping items' },
  trackers: { limit: 5, label: 'trackers' },
  aiScans: { limit: 3, label: 'AI food scans this week' },
  ourApps: { feature: true, label: 'Our Apps', sub: '…' },
  generic: { feature: true, label: 'Vantage Pro', sub: '…' },
};

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('feature entries have their own wording', () => {
  assert.equal(resolveCapKey('paywall:widgetSizes', CAPS), 'widgetSizes');
  assert.match(headline('widgetSizes', CAPS).title, /Bigger widgets/);
  assert.match(headline('widgets', CAPS).title, /part of Pro/);
  assert.match(headline('friends', CAPS).title, /friends/);
  assert.ok(compareRows(CAPS, 'widgetSizes').find(r => r.key === 'widgets').hit, 'the widget row is the one highlighted');
});

t('resolveCapKey: known caps pass through; bare and unknown ids fall back to generic', () => {
  assert.equal(resolveCapKey('paywall:trackers', CAPS), 'trackers');
  assert.equal(resolveCapKey('paywall:ourApps', CAPS), 'ourApps');
  assert.equal(resolveCapKey('paywall:', CAPS), 'generic');
  assert.equal(resolveCapKey('paywall:friends', CAPS), 'friends');
  assert.equal(resolveCapKey('paywall:nope', CAPS), 'generic');
  assert.equal(resolveCapKey('addHabitModal', CAPS), null);
  assert.equal(resolveCapKey(null, CAPS), null);
  assert.equal(isPaywallId('paywall:x'), true);
  assert.equal(isPaywallId('settings'), false);
});

t('compareRows: one row per numeric cap, none for feature gates, values from the caps', () => {
  const rows = compareRows(CAPS, 'trackers');
  const keys = rows.map(r => r.key);
  for (const k of ['trackers', 'habits', 'achievements', 'shopItems', 'links', 'holidays', 'aiScans']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes('ourApps') && !keys.includes('generic'));
  const tr = rows.find(r => r.key === 'trackers');
  assert.deepEqual([tr.label, tr.free, tr.pro, tr.hit], ['Trackers', '5', 'Unlimited', true]);
  assert.equal(rows.filter(r => r.hit).length, 1);
  assert.equal(rows[0].key, 'trackers', 'most-hit caps first');
  // A cap changed in FREE_CAPS changes the table — nothing is restated.
  assert.equal(compareRows({ ...CAPS, habits: { limit: 7, label: 'active habits' } }).find(r => r.key === 'habits').free, '7');
});

t('compareRows: AI scans are never sold as unlimited; themes are free on both sides', () => {
  const rows = compareRows(CAPS);
  assert.equal(rows.find(r => r.key === 'aiScans').pro, 'Fair daily limit');
  const th = rows.find(r => r.key === 'themes');
  assert.equal(th.free, th.pro);
  assert.equal(th.free, 'Both');
});

t('headline: names the cap that was hit, honestly, without a count it does not have', () => {
  const tr = headline('trackers', CAPS);
  assert.equal(tr.title, 'Track more than five things');
  assert.equal(tr.tag, "You've used all 5 free trackers");
  assert.match(tr.sub, /Both themes/);
  assert.equal(headline('habits', CAPS).title, 'Add more than five active habits');
  assert.equal(headline('holidays', CAPS).title, 'Plan more than one holiday');
  assert.equal(headline('holidays', CAPS).tag, "You've used your free holiday");
  assert.equal(headline('shopItems', CAPS).title, 'Add more than 50 shopping items');
  assert.match(headline('aiScans', CAPS).sub, /never limited/);
  assert.equal(headline('generic', CAPS).title, 'More room, more colour');
  assert.equal(headline('ourApps', CAPS).title, 'Our Apps are part of Pro');
  assert.equal(headline('trackers', CAPS, { hasPro: true }).title, "You're already on Pro");
});

t('headline: a count exactly at the cap reads "N of N"; over it, or unknown, stays "all N"', () => {
  assert.equal(headline('habits', CAPS, { count: 5 }).tag, "You've used 5 of 5 free active habits");
  assert.equal(headline('habits', CAPS, { count: 7 }).tag, "You've used all 5 free active habits");
  assert.equal(headline('habits', CAPS, { count: null }).tag, "You've used all 5 free active habits");
  assert.equal(headline('holidays', CAPS, { count: 1 }).tag, "You've used your free holiday");
});

t('copy carries no em-dash and no // label', () => {
  const all = [
    ...compareRows(CAPS).flatMap(r => [r.label, r.free, r.pro]),
    ...Object.keys(CAPS).flatMap(k => Object.values(headline(k, CAPS))),
  ].join('\n');
  assert.ok(!all.includes('—'), 'no em-dash');
  assert.ok(!all.includes('//'), 'no // labels');
});

t('numberWord', () => {
  assert.equal(numberWord(5), 'five');
  assert.equal(numberWord(10), 'ten');
  assert.equal(numberWord(50), '50');
});

console.log(`paywall copy: ${n} tests passed`);
