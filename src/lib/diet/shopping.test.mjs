/** Pack rounding and the seasonings split. Invented prices in tests. */
import assert from 'node:assert/strict';
import { bestPacks, isSeasoning, catalogueFor, shopPlan, picksLabel } from './shopping.js';
import { aggregate } from './ingredients.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('bestPacks: cheapest cover, larger pack when it is cheaper', () => {
  const mince = [{ size: 500, price: 3.5 }, { size: 750, price: 4.99 }, { size: 1000, price: 6.25 }];
  const b = bestPacks(1250, mince);
  assert.deepEqual(b.picks.map(p => [p.size, p.count]), [[750, 1], [500, 1]]);
  assert.equal(b.cost, 8.49);
  assert.equal(b.leftover, 0);
  // 1.1 kg: 1 kg + 500 g (£9.75) beats 750 + 500 (£8.49)? No — 8.49 covers 1.25 kg and is cheaper.
  assert.deepEqual(bestPacks(1100, mince).picks.map(p => [p.size, p.count]), [[750, 1], [500, 1]]);
  // A bigger pack that is cheaper than two small ones wins even with more left over.
  const cheapBig = [{ size: 500, price: 3.5 }, { size: 1000, price: 5 }];
  assert.deepEqual(bestPacks(900, cheapBig).picks.map(p => [p.size, p.count]), [[1000, 1]]);
  assert.deepEqual(bestPacks(400, cheapBig).picks.map(p => [p.size, p.count]), [[500, 1]]);
  // Same price: least left over, then fewest packs.
  assert.deepEqual(bestPacks(12, [{ size: 6, price: 1.5 }, { size: 12, price: 3 }]).picks.map(p => [p.size, p.count]), [[12, 1]]);
  assert.equal(bestPacks(0, cheapBig), null);
  assert.equal(bestPacks(100, []), null);
});
t('seasonings are spotted by name and by measure', () => {
  for (const [item, fam, raw] of [['salt', null, 'salt'], ['smoked paprika', 'tsp', ''], ['olive oil', 'tbsp', ''], ['soy sauce', 'tbsp', ''],
    ['black pepper', null, 'black pepper to taste'], ['beef stock', 'ml', ''], ['tomato puree', 'tbsp', ''], ['dried oregano', 'x', ''], ['chilli flakes', 'x', '']]) {
    assert.equal(isSeasoning(item, fam, raw), true, item);
  }
  for (const [item, fam] of [['chicken thigh', 'g'], ['eggs', 'x'], ['garlic', 'clove'], ['red pepper', 'x'], ['potatoes', 'g'], ['greek yoghurt', 'g']]) {
    assert.equal(isSeasoning(item, fam), false, item);
  }
});
t('catalogue matches specific items before general ones', () => {
  assert.ok(catalogueFor('turkey mince').packs.g.some(p => p.size === 1000 && p.price === 5.75));
  assert.equal(catalogueFor('5% beef mince').aisle, 0);
  assert.equal(catalogueFor('sweet potato').packs.g[0].price, 1.5);
  assert.equal(catalogueFor('dragonfruit'), null);
});
t('picksLabel reads like a shopping note', () => {
  assert.equal(picksLabel([{ size: 750, count: 1 }, { size: 500, count: 1 }], 'g'), '1× 750 g + 1× 500 g');
  assert.equal(picksLabel([{ size: 12, count: 1 }], 'x'), '1× 12-pack');
  assert.equal(picksLabel([{ size: 2272, count: 1, label: '4 pints' }], 'ml'), '1× 4 pints');
  assert.equal(picksLabel([{ size: 1000, count: 2 }], 'g'), '2× 1 kg');
  assert.equal(picksLabel([{ size: 1, count: 2 }], 'x'), '2 loose');
  assert.equal(picksLabel([{ size: 1, count: 2 }], 'tin'), '2 tins');
  assert.equal(picksLabel([{ size: 4, count: 1 }, { size: 1, count: 1 }], 'tin'), '1× 4-pack + 1 tin');
});
t('shopPlan splits the cupboard, packs the rest by aisle, and honours overrides', () => {
  const items = aggregate([{ lines: ['1.25kg beef mince', '10 eggs', '2 tsp paprika', 'salt to taste', '1 tbsp olive oil', '600g dragonfruit', '300ml beef stock'], factor: 1 }]);
  const plan = shopPlan(items);
  assert.deepEqual(plan.cupboard.map(i => i.item).sort(), ['beef stock', 'olive oil', 'paprika', 'salt to taste']);
  const meat = plan.aisles.find(a => a.name === 'Meat & fish');
  assert.equal(meat.items[0].buy, '1× 750 g + 1× 500 g');
  assert.equal(plan.aisles.find(a => a.name === 'Dairy & eggs').items[0].buy, '1× 12-pack');
  const other = plan.aisles.find(a => a.name === 'Other');
  assert.equal(other.items[0].buy, '600 g', 'unknown items keep their amount');
  assert.equal(plan.cost, 11.44);
  assert.equal(plan.priced, 2);
  const moved = shopPlan(items, { cats: { 'beef stock': 'shop', paprika: 'shop' } });
  assert.equal(moved.cupboard.length, 2);
  const own = shopPlan(items, { packs: { 'beef mince': { g: [{ size: 1500, price: 7 }] } } });
  assert.equal(own.aisles[0].items[0].buy, '1× 1.5 kg');
  assert.equal(own.aisles[0].items[0].ownPacks, true);
});

console.log(`shopping: ${n} passed`);
