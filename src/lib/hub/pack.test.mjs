/**
 * The packing rule.
 *
 * This is the whole promise of prime widgets: tick some blocks, drag the
 * card to any size, and get something deliberate rather than something
 * clipped. So the properties are asserted at many sizes rather than one
 * layout being pinned — a test that only checks 280×200 would pass while
 * 281×200 fell apart.
 *
 * The rule that matters most is the one about never hiding anything. A
 * user who ticks a block has said they want to see it; a packer that
 * silently drops it under pressure has broken the only contract the
 * feature makes.
 */
import assert from 'node:assert/strict';
import { makePacker, classify, bandOf, colsOf, S_H, PAD, HEAD, GAP } from './pack.js';
import { PRIMES } from './primeBlocks.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const pack = makePacker(PRIMES.savings.blocks);
const ALL = ['total', 'pots', 'projection', 'accounts', 'bills', 'month', 'plan'];

/** Every size a card can plausibly be dragged to. */
const SIZES = [];
for (let w = 280; w <= 900; w += 37) for (let h = 150; h <= 700; h += 43) SIZES.push([w, h]);

// ── Shape vocabulary ──
{
  eq(classify(700, 200), 'banner', 'wide and short is a banner');
  eq(classify(700, 400), 'wide', 'wide but not short enough for a banner is just wide');
  eq(classify(700, 500), 'square', 'and 1.4:1 is still square — the wide threshold is 1.55');
  eq(classify(280, 200), 'square', 'a small card is square-ish');
  eq(classify(200, 500), 'column', 'much taller than wide is a column');
  eq(classify(300, 400), 'tall', 'somewhat taller than wide is tall');
  eq(bandOf(160), 'xs', 'height bands');
  eq(bandOf(200), 'sm', 'height bands');
  eq(bandOf(300), 'md', 'height bands');
  eq(bandOf(500), 'lg', 'height bands');
  eq(colsOf(700, 500), '2 col', 'a wide card splits');
  eq(colsOf(280, 500), '1 col', 'a narrow one does not');
  eq(colsOf(700, 200), 'row', 'a banner is a row of columns');
}

// ── Nothing is ever hidden ──
{
  let worst = null;
  for (const [w, h] of SIZES) {
    for (const ids of [ALL, ALL.slice(0, 3), ALL.slice(0, 5), ['total'], ['pots', 'bills']]) {
      const { items } = pack(ids, w, h);
      if (items.length !== ids.length) { worst = { w, h, ids, got: items.length }; break; }
    }
    if (worst) break;
  }
  ok(!worst, 'every ticked block gets a slot at every size — ' + JSON.stringify(worst));
  n += SIZES.length;   // the sweep above IS the assertion, once per size
}

// ── Slots stay inside the card, and never overlap ──
{
  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  let bad = null;
  for (const [w, h] of SIZES) {
    const { items } = pack(ALL, w, h);
    for (const it of items) {
      if (it.x < PAD - 0.5 || it.x + it.w > w - PAD + 0.5) { bad = { w, h, why: 'x out of bounds', it }; break; }
      if (it.y < HEAD - 0.5) { bad = { w, h, why: 'above the header', it }; break; }
      if (it.h < 0) { bad = { w, h, why: 'negative height', it }; break; }
    }
    if (bad) break;
    for (let i = 0; i < items.length && !bad; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (overlaps(items[i], items[j])) { bad = { w, h, why: 'overlap', a: items[i].key, b: items[j].key }; break; }
      }
    }
    if (bad) break;
  }
  ok(!bad, 'no slot escapes the card or lands on another — ' + JSON.stringify(bad));
}

// ── Detail sheds evenly, bottom-up ──
{
  // Tall enough for everything: all full.
  const roomy = pack(['total', 'pots', 'projection'], 320, 600).items;
  ok(roomy.every(i => i.level === 0), 'given room, every block is at full detail');

  // Squeeze it: the LAST block gives up detail first.
  const tight = pack(['total', 'pots', 'projection'], 320, 250).items;
  const byId = Object.fromEntries(tight.map(i => [i.key, i]));
  ok(byId.projection.level >= byId.total.level,
    'the bottom block sheds detail before the top one');

  // Every block is compact before any is a fact.
  let violated = null;
  for (const [w, h] of SIZES) {
    const items = pack(ALL, w, h).items;
    if (items.some(i => i.level === 2) && items.some(i => i.level === 0)) {
      // A fact and a full block in the same COLUMN would be the bug;
      // across columns it is fine, so group by x before judging.
      const cols = new Map();
      items.forEach(i => { const k = Math.round(i.x); cols.set(k, [...(cols.get(k) || []), i]); });
      for (const list of cols.values()) {
        if (list.some(i => i.level === 2) && list.some(i => i.level === 0)) {
          // The fact-grid floor legitimately puts two per row; detect it
          // by there being more than one slot at the same y.
          const ys = new Set(list.map(i => Math.round(i.y)));
          if (ys.size === list.length) { violated = { w, h, list: list.map(i => i.key + ':' + i.level) }; }
        }
      }
    }
    if (violated) break;
  }
  ok(!violated, 'no column mixes a full block with a fact — ' + JSON.stringify(violated));
}

// ── The card is filled, not left half empty ──
{
  let gappy = null;
  for (const [w, h] of SIZES) {
    if (w - PAD * 2 >= 520) continue;              // multi-column: measured per column below
    if (classify(w, h) === 'banner') continue;
    const items = pack(['total', 'pots', 'projection'], w, h).items;
    const bottom = Math.max(...items.map(i => i.y + i.h));
    const slack = (h - PAD) - bottom;
    // One gap's worth of rounding is fine; a whole block's worth is not.
    if (slack > GAP + 2) { gappy = { w, h, slack: Math.round(slack) }; break; }
  }
  ok(!gappy, 'a single column reaches the bottom of the card — ' + JSON.stringify(gappy));
}

// ── Order is layout ──
{
  // A hero FIRST on a wide card spans as a header; the rest sit below.
  const heroFirst = pack(['total', 'pots', 'projection'], 700, 500).items;
  const header = heroFirst.find(i => i.key === 'total');
  eq(header.w, 700 - PAD * 2, 'a hero in first place becomes a full-width header');
  ok(heroFirst.filter(i => i.key !== 'total').every(i => i.y > header.y),
    'and everything else sits under it');

  // The same three blocks, chart first: no full-width header, two columns.
  const chartFirst = pack(['projection', 'pots', 'total'], 700, 500).items;
  const proj = chartFirst.find(i => i.key === 'projection');
  ok(proj.w < 700 - PAD * 2, 'a chart in first place takes the main column, not the full width');
  ok(chartFirst.some(i => i.x > proj.x + proj.w - 1), 'and the rest stack beside it');

  ok(heroFirst.find(i => i.key === 'pots').y !== chartFirst.find(i => i.key === 'pots').y
     || heroFirst.find(i => i.key === 'pots').x !== chartFirst.find(i => i.key === 'pots').x,
    'the two orders genuinely produce different layouts, with nothing else configured');
}

// ── Banner: one block per column, left to right ──
{
  const items = pack(['total', 'pots', 'projection'], 800, 190).items;
  eq(classify(800, 190), 'banner', 'that size is a banner');
  const xs = items.map(i => i.x).sort((a, b) => a - b);
  eq(new Set(xs).size, 3, 'each block gets its own column');
  ok(items.every(i => Math.abs(i.y - HEAD) < 2), 'and they all start at the top');
}

// ── Mobile: unbounded height, everything full ──
{
  const { items, height } = pack(ALL, 358, null);
  eq(items.length, ALL.length, 'every block renders');
  ok(items.every(i => i.level === 0), 'nothing is compacted — there is no ceiling to hit');
  ok(items.every(i => i.w === 358 - PAD * 2), 'one column, full width');
  const bottom = Math.max(...items.map(i => i.y + i.h));
  eq(height, bottom + PAD, 'the card reports exactly the height it needs');
  ok(height > 600, 'which for seven blocks is a tall card, as it should be');

  // A chart keeps its proportions rather than a fixed height.
  const chart = items.find(i => i.key === 'projection');
  eq(chart.h, Math.round((358 - PAD * 2) / 2.3), 'charts take an aspect-ratio height on mobile');
}

// ── Lists land on whole rows ──
{
  for (const [w, h] of SIZES) {
    const items = pack(['bills', 'projection'], w, h).items;
    const bills = items.find(i => i.key === 'bills');
    if (bills.level !== 0) continue;
    const m = PRIMES.savings.blocks.bills;
    const extra = bills.h - m.L;
    ok(extra >= -1 && Math.abs(extra % m.row) < 1.5,
      `a list is a whole number of rows tall (${w}×${h}: ${bills.h})`);
    break;
  }
}

// ── Growth respects ceilings, while the card still reaches its bottom ──
{
  // A capped block stops at its ceiling and hands the rest to a grower
  // that has none. `accounts` is a two-row list: growing it further would
  // draw empty rows.
  const items = pack(['accounts', 'projection'], 320, 700).items;
  const acc = items.find(i => i.key === 'accounts');
  const proj = items.find(i => i.key === 'projection');
  const m = PRIMES.savings.blocks.accounts;
  eq(acc.h, m.max, 'a capped block stops at its ceiling rather than drawing empty rows');
  ok(proj.h > 400, 'and the uncapped block takes everything that is left');
  ok(Math.abs((proj.y + proj.h) - (700 - PAD)) < 2, 'so the column still reaches the bottom');

  // With no uncapped GROWER, the slack goes to whatever can absorb it
  // invisibly — a hero centres its content, so stretching it costs
  // nothing. The list stays at its ceiling, because a two-row list drawn
  // 400px tall is 68px of rows and a wall of nothing.
  const alone = pack(['accounts', 'total'], 320, 700).items;
  const accAlone = alone.find(i => i.key === 'accounts');
  const heroAlone = alone.find(i => i.key === 'total');
  eq(accAlone.h, m.max, 'a row-stepped list keeps its ceiling rather than absorbing the slack');
  ok(heroAlone.h > 400, 'the hero takes it instead, and centres its content in it');
  ok(Math.abs((heroAlone.y + heroAlone.h) - (700 - PAD)) < 2, 'so the card is still filled to the bottom');

  // And when EVERY block is a list, the gap is left rather than faked.
  const allLists = pack(['accounts', 'bills'], 320, 700).items;
  const bottom = Math.max(...allLists.map(i => i.y + i.h));
  ok(bottom < 700 - PAD - 50,
    'a column of nothing but short lists stops where its content stops');
  ok(allLists.every(i => i.h <= PRIMES.savings.blocks[i.key].max + 1),
    'with every list at its own ceiling');
}

// ── A single block is not a special case ──
{
  for (const [w, h] of [[280, 200], [700, 500], [900, 160]]) {
    const items = pack(['pots'], w, h).items;
    eq(items.length, 1, `one block, one slot at ${w}×${h}`);
    eq(items[0].w, w - PAD * 2, 'taking the full width');
  }
}

// ── Every prime packs, not just Savings ──
{
  for (const [key, P] of Object.entries(PRIMES)) {
    const p = makePacker(P.blocks);
    const ids = Object.keys(P.blocks);
    for (const [w, h] of [[280, 200], [440, 340], [700, 500], [800, 190]]) {
      const items = p(ids, w, h).items;
      eq(items.length, ids.length, `${key} keeps every block at ${w}×${h}`);
    }
    const m = p(ids, 358, null);
    ok(m.height > 0, `${key} reports a mobile height`);
    // Every block must be able to become a fact, or the floor cannot hold.
    ok(ids.every(id => P.blocks[id].views.length === 2), `${key}: every block declares two views`);
    ok(P.def.every(id => P.blocks[id]), `${key}: its default blocks all exist`);
    ok(P.presets.every(([, list]) => list.every(id => P.blocks[id])),
      `${key}: every preset names blocks that exist`);
  }
}

// ── The floor: facts pair up rather than overflowing ──
{
  const items = pack(ALL, 320, 160).items;
  eq(items.length, ALL.length, 'all seven survive a card too small for any of them');
  ok(items.every(i => i.level === 2), 'as facts');
  const rows = new Set(items.map(i => Math.round(i.y)));
  ok(rows.size < ALL.length, 'paired two to a row rather than stacked seven deep');
  ok(items.every(i => i.h >= S_H - 1), 'and each still has a readable line of height');
}


// ── Nothing is left compact that would fit at full ──
// Shedding is coarse, so a promote-back pass returns detail wherever it
// still fits. Checked on single-column cards across every prime: for
// each compact block, promoting it alone would overflow the column (or
// the column holds a fact, where full detail is never mixed in).
{
  let wasted = null;
  for (const [key, P] of Object.entries(PRIMES)) {
    const pk = makePacker(P.blocks);
    for (const [w, h] of SIZES) {
      if (w - PAD * 2 >= 520 || classify(w, h) === 'banner') continue;
      const ids = P.def;
      const items = pk(ids, w, h).items;
      if (new Set(items.map(i => Math.round(i.x))).size > 1) continue;   // fact grid
      if (items.some(i => i.level === 2)) continue;
      const hOf = (id, l) => (l === 0 ? P.blocks[id].L : l === 1 ? P.blocks[id].M : S_H);
      const inner = h - HEAD - PAD;
      const base = items.reduce((s, i) => s + hOf(i.key, i.level), 0) + GAP * (items.length - 1);
      for (const i of items) {
        if (i.level !== 1) continue;
        if (base - P.blocks[i.key].M + P.blocks[i.key].L <= inner) { wasted = { key, w, h, id: i.key }; break; }
      }
      if (wasted) break;
    }
    if (wasted) break;
  }
  ok(!wasted, 'no block is left compact when full detail would fit — ' + JSON.stringify(wasted));
}

console.log(`prime packing: ${n} assertions passed`);
