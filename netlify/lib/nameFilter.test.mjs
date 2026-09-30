/**
 * The public-text filter: what it must catch, and — just as important —
 * the ordinary names it must leave alone.
 *
 * Run: npm run check:names   (also part of npm run build)
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const tmp = join(tmpdir(), `nameFilter.${process.pid}.cjs`);
writeFileSync(tmp, readFileSync(new URL('./nameFilter.js', import.meta.url)));
let mod;
try { mod = require(tmp); } finally { try { unlinkSync(tmp); } catch { /* best effort */ } }
const { checkPublicText } = mod;

const BLOCK = [
  ['fuck squad', 'language'], ['F.U.C.K', 'language'], ['f u c k ers', 'language'],
  ['Fuuuuck', 'language'], ['fuk'.replace('k', 'ck'), 'language'], ['sh1t', 'language'],
  ['c0ck ring', 'language'], ['pu$$y', 'language'], ['N1GGA crew', 'language'],
  ['the r3tards', 'language'], ['Motherfuckers United', 'language'], ['porn stash', 'language'],
  ['Nazi gym', 'language'],
  ['visit www.example.com', 'contact'], ['https://bit.ly/x', 'contact'], ['shop at deals dot com', 'contact'],
  ['cheap stuff mysite.shop', 'contact'], ['call 07700 900123', 'contact'], ['+44 (0)20 7946 0958', 'contact'],
  ['mail me a@b.co', 'contact'],
];
const PASS = [
  'Scunthorpe Runners', 'Essex Lifters', 'Cocktail shaker', 'Spicy noodle club', 'Dickens readers',
  'Class of 2026', 'Team 7', 'Peacock feathers', 'Assassins Creed', 'Shiitake mushrooms',
  'Hancock Park', 'Cumbria cyclists', 'Analyst guild', 'Sony WH-1000XM5', 'Samsung 55" 4K TV',
  'iPhone 15 Pro 256GB', 'Nike Air Max 90', 'Lego set 10497', 'Kettlebell 24kg', 'Coffee grinder £129.99',
  'The Grapes of Wrath', 'Titleist golf balls', 'Therapist fund', 'Pakistan trip', 'Scrapbook kit',
  // Sentence-style names whose next word happens to be a TLD.
  'Time. To. Run', 'Level up. To 99', 'Bike. Me. Now', 'Eat. Sleep. Shop. Repeat',
];

const failures = [];
let checked = 0;
for (const [text, reason] of BLOCK) {
  checked++;
  const r = checkPublicText(text);
  if (r.ok || r.reason !== reason) failures.push(`should block (${reason}): "${text}" → ${JSON.stringify(r)}`);
}
for (const text of PASS) {
  checked++;
  const r = checkPublicText(text);
  if (!r.ok) failures.push(`should pass: "${text}" → ${JSON.stringify(r)}`);
}

if (failures.length) {
  console.error(`✗ name filter: ${failures.length} of ${checked} checks failed`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ name filter — ${checked} checks`);
