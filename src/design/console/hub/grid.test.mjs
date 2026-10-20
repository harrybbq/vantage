// node src/design/console/hub/grid.test.mjs — run by `npm run check:console`.
// Hermetic: no env, no network, no clock.
import assert from 'node:assert/strict';
import {
  PRO_SIZES_GATED, WIDGET_SIZES, SIZES, sizesFor, isProSize, validateSize, effectiveSize,
  seedHubGrid, readHubGrid, withHubGrid, moveItem, nudgeItem, setItemSize, patchItem, removeItem, addItem,
  packGrid, dropIndex, spanOf,
} from './grid.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const types = g => g.items.map(i => i.type);

t('every size table has def ≤ free and only known sizes', () => {
  for (const [type, s] of Object.entries(WIDGET_SIZES)) {
    for (const z of s.sizes) assert.ok(SIZES.includes(z), `${type} ${z}`);
    assert.ok(s.sizes.includes(s.def), `${type} def allowed`);
    assert.ok(s.sizes.includes(s.free), `${type} free allowed`);
    assert.ok(SIZES.indexOf(s.def) <= SIZES.indexOf(s.free), `${type} def ≤ free`);
  }
});

t('spans: desktop 1×1 / 2×1 / 2×2, phone half / full / full', () => {
  assert.deepEqual(spanOf('small', 4), [1, 1]);
  assert.deepEqual(spanOf('medium', 4), [2, 1]);
  assert.deepEqual(spanOf('large', 4), [2, 2]);
  assert.deepEqual(spanOf('small', 2), [1, 1]);
  assert.deepEqual(spanOf('medium', 2), [2, 1]);
  assert.deepEqual(spanOf('large', 2), [2, 1]);
});

t('pro gate: sizes above a type\'s free size need Pro (one switch)', () => {
  assert.equal(PRO_SIZES_GATED, true);
  assert.equal(isProSize('vitals', 'small'), false);
  assert.equal(isProSize('vitals', 'medium'), true);
  assert.equal(isProSize('league', 'large'), true);
  assert.equal(isProSize('today', 'large'), false);
  assert.deepEqual(validateSize('vitals', 'medium', { hasPro: false }), { ok: false, reason: 'pro' });
  assert.deepEqual(validateSize('vitals', 'medium', { hasPro: true }), { ok: true, reason: null });
  assert.deepEqual(validateSize('body', 'large', { hasPro: true }), { ok: false, reason: 'not-allowed' });
  assert.deepEqual(validateSize('nope', 'small', { hasPro: true }), { ok: false, reason: 'unknown-type' });
  assert.ok(sizesFor('prime:savings'));
  assert.equal(sizesFor('floorplan'), null);
  assert.ok(sizesFor('floorplan', { presetIds: new Set(['floorplan']) }));
});

t('effective size: invalid → default, lapsed Pro → free size, stored value untouched', () => {
  const it = { id: 'a', type: 'vitals', size: 'large' };
  assert.equal(effectiveSize(it, { hasPro: true }), 'large');
  assert.equal(effectiveSize(it, { hasPro: false }), 'small');
  assert.equal(it.size, 'large');
  assert.equal(effectiveSize({ id: 'b', type: 'body', size: 'large' }, { hasPro: true }), 'small');
});

t('seed: both lists, de-duplicated, phone-only widget kept, console widgets lead', () => {
  const S = {
    hubWidgets: [{ id: 'hw1', type: 'prime:nutrition' }, { id: 'hw2', type: 'vitals', picks: ['weight'] }, { id: 'hw3', type: 'leaderboard' }],
    mobileWidgets: [{ id: 'mw1', type: 'vitals' }, { id: 'mw2', type: 'recent-wins' }, { id: 'mw3', type: 'prime:nutrition' }],
  };
  const g = seedHubGrid(S);
  assert.deepEqual(types(g), ['today', 'league', 'friends', 'upnext', 'prime:nutrition', 'vitals', 'recent-wins']);
  // desktop copy wins the de-dup, with its own settings carried over
  assert.deepEqual(g.items.find(i => i.type === 'vitals'), { id: 'hw2', type: 'vitals', size: 'small', picks: ['weight'] });
  // every seeded size is the type default
  for (const it of g.items) assert.equal(it.size, sizesFor(it.type).def);
  // ids unique
  assert.equal(new Set(g.items.map(i => i.id)).size, g.items.length);
});

t('seed: hub-only, mobile-only, empty', () => {
  assert.deepEqual(types(seedHubGrid({ hubWidgets: [{ id: 'a', type: 'body' }] })), ['today', 'league', 'friends', 'upnext', 'body']);
  assert.deepEqual(types(seedHubGrid({ mobileWidgets: [{ id: 'a', type: 'macros' }] })), ['today', 'league', 'friends', 'upnext', 'macros']);
  assert.deepEqual(types(seedHubGrid({})), ['today', 'league', 'friends', 'upnext']);
  assert.deepEqual(types(seedHubGrid({}, { hasUpcoming: false })), ['today', 'league', 'friends']);
});

t('seed: retired, stubs, unknown and malformed entries are skipped; nothing thrown', () => {
  const S = {
    hubWidgets: [{ id: 'a', type: 'mood' }, { id: 'b', type: 'rotation' }, null, 'x', { id: 'c' }, { id: 'd', type: 'zzz' }],
    mobileWidgets: { not: 'a list' },
  };
  assert.deepEqual(types(seedHubGrid(S)), ['today', 'league', 'friends', 'upnext']);
  assert.deepEqual(types(seedHubGrid({ mobileWidgets: [{ id: 'm', type: 'mail' }, { id: 'n', type: 'notepad' }] })), ['today', 'league', 'friends', 'upnext']);
});

t('seed: primes are instanceable; exact duplicates collapse; trackers prime replaces Today', () => {
  const S = {
    hubWidgets: [{ id: 'a', type: 'prime:savings', blocks: ['total'] }, { id: 'b', type: 'prime:savings', blocks: ['pots'] }],
    mobileWidgets: [{ id: 'c', type: 'prime:savings', blocks: ['total'] }, { id: 'd', type: 'prime:trackers' }],
  };
  const g = seedHubGrid(S);
  assert.deepEqual(types(g), ['league', 'friends', 'upnext', 'prime:savings', 'prime:savings', 'prime:trackers']);
  assert.deepEqual(g.items.filter(i => i.type === 'prime:savings').map(i => i.blocks), [['total'], ['pots']]);
});

t('seed: allow() filters (owner-only / build gates); presets need presetIds', () => {
  const S = { hubWidgets: [{ id: 'a', type: 'trading' }, { id: 'b', type: 'floorplan' }] };
  assert.deepEqual(types(seedHubGrid(S, { allow: ty => ty !== 'trading' })), ['today', 'league', 'friends', 'upnext']);
  assert.deepEqual(types(seedHubGrid(S, { presetIds: new Set(['floorplan']) })).slice(4), ['trading', 'floorplan']);
});

t('seed never mutates S, and colliding ids are made unique', () => {
  const S = { hubWidgets: [{ id: 'x', type: 'body' }], mobileWidgets: [{ id: 'x', type: 'vitals' }] };
  const before = JSON.stringify(S);
  const g = seedHubGrid(S);
  assert.equal(JSON.stringify(S), before);
  assert.deepEqual(g.items.slice(-2).map(i => i.id), ['x', 'x-2']);
});

t('read: stored v1 grid wins; anything else seeds; seeded flag says which', () => {
  const S = { hubGrid: { v: 1, items: [{ id: 'a', type: 'body', size: 'small' }, { bad: 1 }] }, hubWidgets: [{ id: 'z', type: 'vitals' }] };
  const r = readHubGrid(S);
  assert.equal(r.seeded, false);
  assert.deepEqual(types(r.grid), ['body']);
  assert.equal(readHubGrid({ hubGrid: { v: 2, items: [] } }).seeded, true);
  assert.equal(readHubGrid({ hubGrid: { v: 1, items: [] } }).grid.items.length, 0); // emptied by the user stays empty
});

t('withHubGrid writes ONLY hubGrid; classic layout keys pass through untouched', () => {
  const prev = { hubWidgets: [{ id: 'a' }], mobileWidgets: [{ id: 'b' }], widgetPositions: { a: { x: 1 } }, widgetSizes: { a: { w: 2 } }, other: 1 };
  const next = withHubGrid(prev, { v: 1, items: [{ id: 'a', type: 'body', size: 'small' }] });
  for (const k of ['hubWidgets', 'mobileWidgets', 'widgetPositions', 'widgetSizes', 'other']) assert.equal(next[k], prev[k], k);
  assert.deepEqual(Object.keys(next).filter(k => !(k in prev)), ['hubGrid']);
});

t('move / nudge / size / patch / remove / add', () => {
  const g = { v: 1, items: ['a', 'b', 'c', 'd'].map(id => ({ id, type: 'vitals', size: 'small' })) };
  assert.deepEqual(moveItem(g, 0, 2).items.map(i => i.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(g, 3, 0).items.map(i => i.id), ['d', 'a', 'b', 'c']);
  assert.equal(moveItem(g, 1, 1), g);
  assert.equal(moveItem(g, 9, 0), g);
  assert.deepEqual(nudgeItem(g, 'b', -1).items.map(i => i.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(nudgeItem(g, 'd', 1).items.map(i => i.id), ['a', 'b', 'c', 'd']);
  assert.equal(setItemSize(g, 'a', 'medium', { hasPro: false }), g); // Pro size, free account
  assert.equal(setItemSize(g, 'a', 'medium', { hasPro: true }).items[0].size, 'medium');
  const p = patchItem(g, 'a', w => ({ ...w, picks: ['sleep'], id: 'hijack', type: 'x' }));
  assert.deepEqual(p.items[0], { id: 'a', type: 'vitals', size: 'small', picks: ['sleep'] });
  assert.deepEqual(removeItem(g, 'c').items.map(i => i.id), ['a', 'b', 'd']);
  let k = 0;
  const added = addItem(g, { type: 'prime:habits', blocks: ['timers'] }, { makeId: () => (k++ ? 'n2' : 'a') });
  assert.deepEqual(added.items[4], { id: 'n2', type: 'prime:habits', size: 'medium', blocks: ['timers'] });
  assert.equal(addItem(g, 'zzz', { makeId: () => 'q' }), g);
});

t('pack: first fit, no overlaps, large is 2×2, small fills the hole', () => {
  const items = [
    { id: 'L', size: 'large' }, { id: 'M1', size: 'medium' }, { id: 'M2', size: 'medium' },
    { id: 'S1', size: 'small' }, { id: 'M3', size: 'medium' }, { id: 'S2', size: 'small' },
  ];
  const { cells, rows } = packGrid(items, 4);
  const at = id => cells.find(c => c.id === id);
  assert.deepEqual(at('L'), { id: 'L', col: 1, row: 1, w: 2, h: 2 });
  assert.deepEqual(at('M1'), { id: 'M1', col: 3, row: 1, w: 2, h: 1 });
  assert.deepEqual(at('M2'), { id: 'M2', col: 3, row: 2, w: 2, h: 1 });
  assert.deepEqual(at('S1'), { id: 'S1', col: 1, row: 3, w: 1, h: 1 });
  assert.deepEqual(at('M3'), { id: 'M3', col: 3, row: 3, w: 2, h: 1 });
  assert.deepEqual(at('S2'), { id: 'S2', col: 2, row: 3, w: 1, h: 1 }); // back-fills beside S1
  assert.equal(rows, 3);
  // no two cells overlap
  const seen = new Set();
  for (const c of cells) for (let y = c.row; y < c.row + c.h; y++) for (let x = c.col; x < c.col + c.w; x++) {
    const k = `${x},${y}`; assert.ok(!seen.has(k), `overlap at ${k}`); seen.add(k);
  }
});

t('pack: phone is two columns, smalls pair up, medium/large full width', () => {
  const items = [{ id: 'a', size: 'small' }, { id: 'b', size: 'large' }, { id: 'c', size: 'small' }, { id: 'd', size: 'small' }];
  const { cells } = packGrid(items, 2);
  assert.deepEqual(cells, [
    { id: 'a', col: 1, row: 1, w: 1, h: 1 },
    { id: 'b', col: 1, row: 2, w: 2, h: 1 },
    { id: 'c', col: 2, row: 1, w: 1, h: 1 },
    { id: 'd', col: 1, row: 3, w: 1, h: 1 },
  ]);
});

t('dropIndex: staying put is stable; dragging to a far cell picks that slot', () => {
  const items = ['a', 'b', 'c', 'd'].map(id => ({ id, size: 'medium' })); // 2 per row
  // a sits at col 1-2 row 1 (centre x=1, y=.5)
  assert.equal(dropIndex(items, 0, { x: 1, y: 0.5 }, 4), 0);
  // drag a to the bottom-right slot (centre x=3, y=1.5) → index 3
  assert.equal(dropIndex(items, 0, { x: 3, y: 1.5 }, 4), 3);
  // drag d to the top-left → index 0
  assert.equal(dropIndex(items, 3, { x: 1, y: 0.5 }, 4), 0);
  // phone: one column of mediums, y decides
  assert.equal(dropIndex(items, 0, { x: 1, y: 2.6 }, 2), 2);
});

console.log(`hub grid: ${n} tests passed`);
