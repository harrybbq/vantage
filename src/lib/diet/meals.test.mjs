/** Links between recipes and saved videos. Invented data only. */
import assert from 'node:assert/strict';
import { linkedVideos, linkedRecipes, linkVideo, unlinkVideo, fillFromRead, applyRead, pendingRecipes, addOfferedRecipes } from './meals.js';
import { parseLine } from './ingredients.js';
import { RECIPE_LOG } from '../../data/recipeLog.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const base = () => ({
  coins: 5,
  mealVideos: [
    { id: 'v1', url: 'https://youtu.be/abc', title: 'Chicken' },
    { id: 'v2', url: 'https://www.tiktok.com/@x/video/123', title: 'Rice' },
  ],
  recipes: [
    { id: 'r1', title: 'Chicken rice', videoIds: ['v2'], sourceUrl: 'https://youtu.be/abc/' },
    { id: 'r2', title: 'Oats' },
  ],
});

t('a recipe shows linked ids first, then a video matching its old sourceUrl', () => {
  const s = base();
  assert.deepEqual(linkedVideos(s.recipes[0], s.mealVideos).map(v => v.id), ['v2', 'v1']);
  assert.deepEqual(linkedVideos(s.recipes[1], s.mealVideos), []);
  assert.deepEqual(linkedVideos({ videoIds: ['gone'] }, s.mealVideos), [], 'a deleted video is not shown');
});
t('a video lists the recipes that link to it either way', () => {
  const s = base();
  assert.deepEqual(linkedRecipes(s.mealVideos[0], s.recipes).map(r => r.id), ['r1']);
  assert.deepEqual(linkedRecipes(s.mealVideos[1], s.recipes).map(r => r.id), ['r1']);
});
t('linkVideo adds once; unknown ids and repeats change nothing', () => {
  const s = base();
  const a = linkVideo(s, 'r2', 'v1');
  assert.deepEqual(a.recipes[1].videoIds, ['v1']);
  assert.equal(a.coins, 5);
  assert.equal(a.recipes[0], s.recipes[0], 'other recipes untouched');
  assert.equal(linkVideo(a, 'r2', 'v1'), a);
  assert.equal(linkVideo(s, 'r2', 'nope'), s);
  assert.equal(linkVideo(s, 'nope', 'v1'), s);
});
t('unlinkVideo removes the id, or clears the sourceUrl doing the linking', () => {
  const s = base();
  const a = unlinkVideo(s, 'r1', 'v2');
  assert.deepEqual(a.recipes[0].videoIds, []);
  assert.equal(a.recipes[0].sourceUrl, s.recipes[0].sourceUrl, 'the source link stays');
  const b = unlinkVideo(s, 'r1', 'v1');
  assert.equal(b.recipes[0].sourceUrl, '');
  assert.deepEqual(b.recipes[0].videoIds, ['v2']);
  assert.equal(unlinkVideo(s, 'r2', 'v1'), s);
});

const READ = { title: 'Breakfast burrito', servings: 6, lines: ['10 eggs', '500g turkey mince'], macros: { kcal: 510, protein: 45, carbs: 33, fat: 22 }, source: 'description' };
t('fillFromRead fills only what the recipe is missing', () => {
  const blank = { id: 'r', title: '', servings: 1, kcal: 0, protein: 0, carbs: 0, fat: 0, ingredients: [''] };
  const f = fillFromRead(blank, READ);
  assert.deepEqual(f.ingredients, READ.lines);
  assert.equal(f.servings, 6);
  assert.equal(f.protein, 45);
  assert.equal(f.macrosEstimated, true);
  assert.equal(f.title, 'Breakfast burrito');
  const typed = { id: 'r', title: 'Mine', servings: 4, kcal: 600, protein: 50, carbs: 0, fat: 0, ingredients: ['2 eggs'] };
  assert.deepEqual(fillFromRead(typed, READ), typed, 'nothing typed is overwritten');
  assert.equal(fillFromRead(blank, { ...READ, lines: [] }), blank, 'an empty read changes nothing');
});
t('applyRead stores the read on the video and fills the recipe', () => {
  const s = { mealVideos: [{ id: 'v1', url: 'u' }], recipes: [{ id: 'r1', title: '', servings: 1, ingredients: [] }, { id: 'r2' }] };
  const a = applyRead(s, 'v1', 'r1', READ);
  assert.equal(a.mealVideos[0].read, READ);
  assert.equal(a.recipes[0].servings, 6);
  assert.equal(a.recipes[1], s.recipes[1]);
});

t('offered recipes: pending until added, then never again', () => {
  const s = base();
  const offer = [{ id: 'o1', title: 'Steak pasta', kcal: 1200 }, { id: 'o2', title: 'Wrap', kcal: 650 }];
  assert.deepEqual(pendingRecipes(s, offer).map(r => r.id), ['o1', 'o2']);
  const a = addOfferedRecipes(s, offer, 42);
  assert.equal(a.recipes.length, 4, 'appended, nothing replaced');
  assert.equal(a.recipes[0], s.recipes[0]);
  assert.equal(a.recipes[1], s.recipes[1]);
  assert.equal(a.recipes[2].createdAt, 42);
  assert.equal(a.recipes[2].servings, 1, 'missing fields come from EMPTY_RECIPE');
  assert.deepEqual(a.recipeLogAdded, ['o1', 'o2']);
  assert.equal(a.mealVideos, s.mealVideos, 'other keys untouched');
  assert.equal(addOfferedRecipes(a, offer, 99), a, 'adding again is a no-op');
  assert.equal(pendingRecipes(a, offer).length, 0);
  const deleted = { ...a, recipes: a.recipes.filter(r => r.id !== 'o1') };
  assert.equal(pendingRecipes(deleted, offer).length, 0, 'a deleted one is not offered again');
  const one = addOfferedRecipes(s, [offer[1]], 1);
  assert.deepEqual(pendingRecipes(one, offer).map(r => r.id), ['o1'], 'adding one leaves the other offered');
});

t('the shipped recipe log is well-formed and its ingredient lines parse', () => {
  assert.equal(RECIPE_LOG.length, 2);
  for (const r of RECIPE_LOG) {
    assert.ok(r.id.startsWith('rlog-') && r.title && r.servings === 1);
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'minutes']) assert.ok(r[k] > 0, `${r.id} ${k}`);
    assert.ok(r.ingredients.length >= 15 && r.method.includes('1. '));
    const numbered = r.ingredients.filter(l => /^[\d½¼¾⅓⅔⅛]/.test(l));
    for (const l of numbered) { const p = parseLine(l); assert.ok(p && p.qty > 0, `parses: ${l}`); }
  }
});

console.log(`meal links: ${n} passed`);
