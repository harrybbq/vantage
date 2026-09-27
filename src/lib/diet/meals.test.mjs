/** Links between recipes and saved videos. Invented data only. */
import assert from 'node:assert/strict';
import { linkedVideos, linkedRecipes, linkVideo, unlinkVideo } from './meals.js';

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

console.log(`meal links: ${n} passed`);
