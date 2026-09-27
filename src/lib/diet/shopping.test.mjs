/** Pack rounding and the seasonings split. Invented prices in tests. */
import assert from 'node:assert/strict';
import { bestPacks, isSeasoning, catalogueFor, shopPlan, picksLabel, packsAt, itemAt, swapAt, elsewhere, STORES, PRICED_AS } from './shopping.js';
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
t('catalogue matches specific items first, and prices each shop', () => {
  assert.deepEqual(packsAt(catalogueFor('pork mince'), 'g', 'tesco').map(p => [p.size, p.price]), [[500, 2.49], [750, 4.25]]);
  assert.deepEqual(packsAt(catalogueFor('pork mince'), 'g', 'aldi').map(p => p.size), [500], 'a size a shop does not sell is left out');
  assert.equal(catalogueFor('5% beef mince').aisle, 0);
  assert.equal(catalogueFor('dragonfruit'), null);
  assert.deepEqual(STORES.map(s => s.id), ['tesco', 'morrisons', 'aldi', 'lidl']);
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
const LIST = () => aggregate([{ lines: ['1.25kg beef mince', '10 eggs', '2 tsp paprika', 'salt to taste', '1 tbsp olive oil', '600g dragonfruit', '300ml beef stock', '600g turkey mince', '300g cottage cheese'], factor: 1 }]);
t('shopPlan at Tesco: cupboard split, packs by aisle, a running total', () => {
  const plan = shopPlan(LIST());
  assert.equal(plan.store, 'tesco');
  assert.deepEqual(plan.cupboard.map(i => i.item).sort(), ['beef stock', 'olive oil', 'paprika', 'salt to taste']);
  const meat = plan.aisles.find(a => a.name === 'Meat & fish').items;
  assert.equal(meat.find(i => i.ikey === 'beef mince').buy, '1× 750 g + 1× 500 g');
  assert.equal(meat.find(i => i.ikey === 'turkey mince').buy, '2× 500 g', 'no 1 kg turkey mince at Tesco');
  assert.equal(plan.aisles.find(a => a.name === 'Other').items[0].buy, '600 g', 'unknown items keep their amount');
  assert.equal(plan.cost, 9.25 + 2.85 + 8 + 1.65);
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.second, null);
});
t('each shop is priced from its own table', () => {
  const s = shopPlan(LIST(), { store: 'aldi' });
  const aldi = s.stores.find(x => x.id === 'aldi');
  assert.ok(aldi.cost < s.stores.find(x => x.id === 'tesco').cost, 'Aldi comes out cheaper');
  assert.equal(s.aisles[0].items.find(i => i.ikey === 'turkey mince').buy, '2× 500 g', 'no 1 kg turkey mince at Aldi');
});
t('one gap: a swap in the same shop, or the cheapest shop that has it', () => {
  const plan = shopPlan(LIST(), { store: 'aldi', out: { aldi: { 'turkey mince': true } } });
  assert.deepEqual(plan.missing, ['turkey mince']);
  assert.equal(plan.second, null, 'one gap does not send you to a second shop');
  const tm = plan.aisles[0].items.find(i => i.ikey === 'turkey mince');
  assert.equal(tm.at.status, 'out');
  assert.equal(tm.swap.item, 'chicken mince');
  assert.equal(tm.alt.store, 'lidl', 'Lidl’s 2× 500 g is the cheapest elsewhere');
  assert.equal(tm.alt.buy, '2× 500 g');
});
t('two or more gaps: the one second shop that covers them', () => {
  const out = { lidl: { 'turkey mince': true, 'cottage cheese': true, 'beef mince': true } };
  const plan = shopPlan(LIST(), { store: 'lidl', out });
  assert.deepEqual(plan.missing.sort(), ['beef mince', 'cottage cheese', 'turkey mince']);
  assert.equal(plan.second.store, 'aldi', 'Aldi covers all three and is cheapest');
  assert.equal(plan.second.keys.length, 3);
  const beef = plan.aisles[0].items.find(i => i.ikey === 'beef mince');
  assert.equal(beef.via, 'aldi');
  assert.ok(beef.packs, 'priced at the second shop');
});
t('your corrections win: your price at a shop, or "not stocked"', () => {
  const it = LIST().find(i => i.ikey === 'beef mince');
  assert.equal(itemAt(it, 'tesco', { storePacks: { tesco: { 'beef mince': { g: [{ size: 1500, price: 7 }] } } } }).best.picks[0].size, 1500);
  assert.equal(itemAt(it, 'tesco', { out: { tesco: { 'beef mince': true } } }).status, 'out');
  assert.equal(itemAt(it, 'aldi', { packs: { 'beef mince': { g: [{ size: 1500, price: 6 }] } } }).own, true, 'older all-shop packs still apply');
  assert.equal(itemAt({ ikey: 'dragonfruit', family: 'g', base: 600 }, 'tesco').status, 'unpriced');
  assert.equal(swapAt({ ikey: 'dragonfruit', family: 'g', base: 600 }, 'tesco'), null);
  assert.equal(elsewhere(it, 'tesco').store, 'morrisons', 'Morrisons, Aldi and Lidl all come to £9.75; first listed wins');
});

t('Lidl reads Aldi’s verified prices until it has its own', () => {
  assert.equal(PRICED_AS.lidl, 'aldi');
  assert.deepEqual(packsAt(catalogueFor('turkey mince'), 'g', 'lidl'), packsAt(catalogueFor('turkey mince'), 'g', 'aldi'));
  const it = { ikey: 'turkey mince', family: 'g', base: 600 };
  assert.equal(itemAt(it, 'lidl', { storePacks: { lidl: { 'turkey mince': { g: [{ size: 500, price: 2.5 }] } } } }).best.cost, 5, 'your Lidl price still wins');
});

t('5% beef mince is priced as 5%, not the 20% shelf pack', () => {
  const [it] = aggregate([{ lines: ['1kg 5% beef mince'], factor: 1, from: 'R' }]);
  assert.notEqual(catalogueFor(it.ikey), catalogueFor('beef mince'), 'lean has its own entry');
  assert.equal(catalogueFor('lean beef mince'), catalogueFor(it.ikey));
  assert.equal(catalogueFor('turkey mince').re.test('lean turkey mince'), true, 'lean turkey stays turkey');
  const m = itemAt(it, 'morrisons');
  assert.equal(m.status, 'ok');
  assert.equal(m.best.cost, 10.1, '2× 500 g at £5.05');
  const t2 = itemAt(it, 'tesco');
  assert.equal(t2.status, 'unpriced', 'Tesco sells it; price not checked, so not guessed');
  assert.equal(t2.why, 'unchecked');
  assert.equal(itemAt(it, 'lidl').status, 'unpriced', 'Lidl follows Aldi, unchecked too');
  assert.equal(itemAt(it, 'tesco', { storePacks: { tesco: { [it.ikey]: { g: [{ size: 500, price: 4.5 }] } } } }).best.cost, 9, 'your price fills the gap');
  const plan = shopPlan([it], { store: 'tesco' });
  assert.deepEqual(plan.missing, [], 'unchecked is not "not stocked"');
  assert.equal(plan.cost, 0);
});

console.log(`shopping: ${n} passed`);
