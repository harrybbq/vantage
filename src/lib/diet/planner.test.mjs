/** Ingredients and the meal planner. Invented data only. */
import assert from 'node:assert/strict';
import { parseLine, aggregate, formatAmount, itemKey, toLine } from './ingredients.js';
import { planDays, nextShiftBlock, targetsFor, totalsOf, dayStatus, suggest, batchesOf, shoppingList, planSummary, foodLines, portionOptions, planFood, rememberFood } from './planner.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('parseLine reads amounts, units and items', () => {
  const p = parseLine('600g chicken thigh, diced');
  assert.deepEqual([p.qty, p.family, p.base, p.key], [600, 'g', 600, 'chicken thigh']);
  assert.equal(parseLine('1.5 kg beef mince').base, 1500);
  assert.equal(parseLine('½ tsp salt').qty, 0.5);
  assert.equal(parseLine('1 1/2 cups rice').qty, 1.5);
  assert.deepEqual([parseLine('2 large eggs').family, parseLine('2 large eggs').key], ['x', 'large egg']);
  assert.equal(parseLine('3 cloves garlic').family, 'clove');
  assert.equal(parseLine('- 400ml coconut milk').base, 400);
  assert.equal(parseLine('Salt and pepper').qty, null);
  assert.equal(parseLine('   '), null);
  assert.equal(parseLine('2-3 tbsp gochujang').qty, 2);
});
t('itemKey folds plurals and notes', () => {
  assert.equal(itemKey('Potatoes (Maris Piper), peeled'), 'potato');
  assert.equal(itemKey('Tortillas'), 'tortilla');
  assert.equal(itemKey('Hummus'), 'hummus');
});
t('formatAmount rounds to what you would buy', () => {
  assert.equal(formatAmount(1250, 'g'), '1.3 kg');
  assert.equal(formatAmount(452, 'g'), '450 g');
  assert.equal(formatAmount(4.2, 'x'), '5×');
  assert.equal(formatAmount(1, 'tin'), '1 tin');
  assert.equal(formatAmount(1.5, 'tbsp'), '1.5 tbsp');
  assert.equal(formatAmount(3.8, 'tbsp'), '4 tbsp');
});
t('aggregate sums scaled lines by item and unit family', () => {
  const a = aggregate([
    { lines: ['500g beef mince', '4 potatoes', 'salt'], factor: 1.5, from: 'Mince' },
    { lines: ['250g beef mince', '6 eggs', 'Salt'], factor: 1, from: 'Burrito' },
  ]);
  const mince = a.find(x => x.key.endsWith('beef mince'));
  assert.equal(mince.base, 1000);
  assert.equal(mince.amount, '1 kg');
  assert.deepEqual(mince.from, ['Mince', 'Burrito']);
  assert.equal(a.find(x => x.item === 'potatoes').amount, '6×');
  const salt = a.filter(x => x.base == null);
  assert.equal(salt.length, 1, 'amount-less lines are listed once');
  assert.equal(a[a.length - 1].base, null, 'and sort last');
});
t('toLine writes structured ingredients back as lines', () => {
  assert.equal(toLine({ qty: 600, unit: 'g', item: 'chicken thigh' }), '600g chicken thigh');
  assert.equal(toLine({ qty: 2, unit: 'tbsp', item: 'soy sauce' }), '2 tbsp soy sauce');
  assert.equal(toLine({ qty: null, unit: null, item: 'Salt' }), 'Salt');
  assert.equal(parseLine(toLine({ qty: 1.5, unit: 'kg', item: 'mince' })).base, 1500);
});

// Rotation: 15 Jul 2026 is position 0 (first night). 5 Oct 2026 → position 2.
t('planDays reads the rotation and marks training days', () => {
  const d = planDays('2026-10-05', 4);
  assert.deepEqual(d.map(x => x.shift), ['night', 'night', 'off', 'off']);
  assert.deepEqual(d.map(x => x.train), [true, true, true, false]);
});
t('nextShiftBlock: the block you are in, or the next one', () => {
  assert.deepEqual(nextShiftBlock('2026-10-05'), { start: '2026-10-05', days: 2 });
  assert.deepEqual(nextShiftBlock('2026-10-07'), { start: '2026-10-11', days: 4 });
});

const plan = { trainKcal: 2500, trainCarbs: 280, trainFat: 75, restKcal: 2300, restCarbs: 240, restFat: 70 };
const R = [
  { id: 'bur', title: 'Breakfast burrito', servings: 4, kcal: 600, protein: 45, carbs: 55, fat: 20, ingredients: ['8 eggs', '4 tortillas', '400g turkey mince'] },
  { id: 'min', title: 'Mince and potato', servings: 4, kcal: 700, protein: 50, carbs: 60, fat: 25, ingredients: ['500g beef mince', '1kg potatoes'] },
  { id: 'yog', title: 'Greek yoghurt bowl', servings: 1, kcal: 300, protein: 35, carbs: 25, fat: 5, ingredients: [] },
  { id: 'cake', title: 'Cake', servings: 8, kcal: 450, protein: 5, carbs: 60, fat: 20 },
];
t('targetsFor picks train or rest calories; protein is fixed', () => {
  assert.deepEqual(targetsFor({ train: true }, plan, 190), { kcal: 2500, protein: 190, carbs: 280, fat: 75 });
  assert.equal(targetsFor({ train: false }, plan, 190).kcal, 2300);
});
t('totals, status and suggestions for a short day', () => {
  const entries = [{ day: 0, recipeId: 'bur', servings: 1 }, { day: 0, recipeId: 'min', servings: 1.5 }];
  assert.deepEqual(totalsOf(entries, R), { kcal: 1650, protein: 120, carbs: 145, fat: 58 });
  const st = dayStatus(entries, R, targetsFor({ train: true }, plan, 190));
  assert.equal(st.status, 'short');
  assert.equal(st.protein, -70);
  const s = suggest(st, R);
  assert.equal(s[0].recipe.id, 'yog', 'best protein per kcal first');
  assert.ok(!s.some(x => x.recipe.id === 'cake') || s.findIndex(x => x.recipe.id === 'cake') > 0);
  assert.equal(dayStatus([], R, targetsFor({ train: true }, plan, 190)).status, 'empty');
  assert.deepEqual(suggest(dayStatus(entries, R, { kcal: 1700, protein: 120 }), R), [], 'no gap, no suggestions');
});
t('batches and the shopping list scale by servings planned', () => {
  const entries = [0, 1, 2, 3].flatMap(day => [{ day, recipeId: 'bur', servings: 1 }, { day, recipeId: 'min', servings: 1.5 }, ...(day === 0 ? [{ day, recipeId: 'yog', servings: 1 }] : [])]);
  const b = batchesOf(entries, R);
  assert.deepEqual(b.map(x => [x.recipe.id, x.servings, x.batches]), [['min', 6, 1.5], ['bur', 4, 1], ['yog', 1, 1]]);
  const { items, missing } = shoppingList(entries, R);
  assert.equal(items.find(x => x.ikey === 'beef mince').amount, '750 g');
  assert.equal(items.find(x => x.ikey === 'potato').amount, '1.5 kg');
  assert.equal(items.find(x => x.ikey === 'egg').amount, '8×');
  assert.deepEqual(missing.map(r => r.id), ['yog']);
});
t('planSummary averages over days with food', () => {
  const days = planDays('2026-10-11', 4);
  const entries = [{ day: 0, recipeId: 'bur', servings: 2 }, { day: 1, recipeId: 'bur', servings: 4 }];
  const s = planSummary(days, entries, R, plan, 190);
  assert.equal(s.filled, 2);
  assert.equal(s.avgProtein, 135);
  assert.equal(s.short, 2, 'a day 10 g under protein counts as short');
});

t('single foods count towards the day and the shopping list, not the cooking', () => {
  const banana = { name: 'Banana', amount: 118, unit: 'g', portion: 'serving', kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 };
  const yog = { name: 'Greek yoghurt', amount: 150, unit: 'g', portion: 'amount', kcal: 140, protein: 15, carbs: 6, fat: 5 };
  const entries = [
    { day: 0, food: banana, servings: 2 }, { day: 1, food: banana, servings: 1 },
    { day: 0, food: yog, servings: 1 }, { day: 1, food: yog, servings: 2 },
    { day: 0, recipeId: 'bur', servings: 1 },
  ];
  assert.deepEqual(totalsOf(entries.filter(e => e.day === 0), R), { kcal: 950, protein: 63, carbs: 115, fat: 26 });
  assert.deepEqual(batchesOf(entries, R).map(x => x.recipe.id), ['bur'], 'foods are not cooked');
  assert.deepEqual(foodLines(entries).map(r => r.lines[0]), ['3 Banana', '450g Greek yoghurt']);
  const { items } = shoppingList(entries, R);
  assert.equal(items.find(x => x.ikey === 'banana').amount, '3×');
  assert.equal(items.find(x => x.ikey === 'greek yoghurt').amount, '450 g');
});

t('a search result becomes a plan food for the chosen portion', () => {
  const bar = { food_name: 'Protein bar', brand: 'Brand', serving_g: 60, serving_unit: 'g', calories: 220, protein_g: 20, carbs_g: 18, fat_g: 7 };
  assert.deepEqual(portionOptions(bar).map(o => o.label), ['1 serving (60 g)', '100 g']);
  assert.deepEqual(portionOptions({ serving_g: 100, serving_unit: 'ml' }).map(o => o.label), ['100 ml']);
  const one = planFood(bar, { portion: 'serving', amount: 60 });
  assert.deepEqual([one.kcal, one.protein, one.portion, one.amount], [220, 20, 'serving', 60]);
  const g150 = planFood(bar, { portion: 'amount', amount: 150 });
  assert.deepEqual([g150.kcal, g150.protein], [550, 50]);
  const list = rememberFood(rememberFood([], one), g150);
  assert.equal(list.length, 2);
  assert.equal(rememberFood(list, one)[0], one, 'a repeat moves to the front');
  assert.equal(rememberFood(list, one).length, 2);
});

console.log(`meal planner: ${n} passed`);
