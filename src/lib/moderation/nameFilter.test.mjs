/**
 * The client name filter — and that it is still the SAME filter as the
 * server's (netlify/lib/nameFilter.js). A word added to one list and
 * not the other would let a name through on one side only, so the word
 * lists are compared as data and every case runs through both.
 *
 * Run: npm run check:namesclient   (also part of npm run build)
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPublicText, publicNameProblem } from './nameFilter.js';

const serverPath = new URL('../../../netlify/lib/nameFilter.js', import.meta.url);
const clientPath = new URL('./nameFilter.js', import.meta.url);

const require = createRequire(import.meta.url);
const tmp = join(tmpdir(), `nameFilter.client.${process.pid}.cjs`);
writeFileSync(tmp, readFileSync(serverPath));
let server;
try { server = require(tmp); } finally { try { unlinkSync(tmp); } catch { /* best effort */ } }

const failures = [];
let checked = 0;

// ── Same lists ──
// Pull the quoted words out of the EXACT Set and the STEMS array of each
// file's source, and the three contact regexes as written.
function lists(src) {
  const exact = src.match(/const EXACT = new Set\(\[([\s\S]*?)\]\);/);
  const stems = src.match(/const STEMS = \[([\s\S]*?)\];/);
  const words = block => [...block.matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  const line = name => (src.match(new RegExp(`^const ${name} = .*$`, 'm')) || [''])[0];
  return {
    exact: exact ? words(exact[1]) : null,
    stems: stems ? words(stems[1]) : null,
    leet: line('LEET'),
    url: line('URL_RE'), email: line('EMAIL_RE'), phone: line('PHONE_RE'),
  };
}
const a = lists(readFileSync(serverPath, 'utf8'));
const b = lists(readFileSync(clientPath, 'utf8'));
for (const key of Object.keys(a)) {
  checked++;
  if (!a[key] || !a[key].length) failures.push(`could not read ${key} from the server filter — has it moved?`);
  else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
    failures.push(`${key} differs between netlify/lib/nameFilter.js and src/lib/moderation/nameFilter.js`);
  }
}

// ── Same verdicts ──
// The server suite's cases, plus the name- and handle-shaped ones.
const BLOCK = [
  ['fuck squad', 'language'], ['F.U.C.K', 'language'], ['f u c k ers', 'language'],
  ['Fuuuuck', 'language'], ['sh1t', 'language'],
  ['c0ck ring', 'language'], ['pu$$y', 'language'], ['N1GGA crew', 'language'],
  ['the r3tards', 'language'], ['Motherfuckers United', 'language'], ['porn stash', 'language'],
  ['Nazi gym', 'language'],
  ['visit www.example.com', 'contact'], ['https://bit.ly/x', 'contact'], ['shop at deals dot com', 'contact'],
  ['cheap stuff mysite.shop', 'contact'], ['call 07700 900123', 'contact'], ['+44 (0)20 7946 0958', 'contact'],
  ['mail me a@b.co', 'contact'],
  // Handles: underscores split words, so a slur can't hide behind one.
  ['fuck_face', 'language'], ['big_d1ck', 'language'], ['xXx_sniper', 'language'],
  // A nine-digit run in a handle reads as a phone number and is refused
  // on purpose — "runner123456789" is not a name anyone needs.
  ['runner123456789', 'contact'], ['user_07700900123', 'contact'],
  ['Harry (insta: harry.co)', 'contact'],
];
const PASS = [
  'Scunthorpe Runners', 'Essex Lifters', 'Cocktail shaker', 'Spicy noodle club', 'Dickens readers',
  'Class of 2026', 'Team 7', 'Peacock feathers', 'Assassins Creed', 'Shiitake mushrooms',
  'Hancock Park', 'Cumbria cyclists', 'Analyst guild', 'The Grapes of Wrath', 'Therapist fund',
  'Pakistan trip', 'Scrapbook kit', 'Time. To. Run', 'Level up. To 99',
  // Real names and ordinary handles.
  'Harry', 'Harry M', 'Zoë Dubois', 'José Álvarez', 'Siobhán Ní Dhomhnaill', 'Nguyễn Văn An',
  'Mo Farah', 'Anne-Marie', "O'Connor", 'Blackburn Rovers',
  'harry_m', 'runner_2003', 'lift_heavy_99', 'coach_kate',
  // Known false positive, kept visible rather than hidden: the surname
  // "Dyke" is a whole-word match. Changing that is a list decision for
  // both files, not this test.
];

for (const [text, reason] of BLOCK) {
  for (const [side, fn] of [['client', checkPublicText], ['server', server.checkPublicText]]) {
    checked++;
    const r = fn(text);
    if (r.ok || r.reason !== reason) failures.push(`${side} should block (${reason}): "${text}" → ${JSON.stringify(r)}`);
  }
}
for (const text of PASS) {
  for (const [side, fn] of [['client', checkPublicText], ['server', server.checkPublicText]]) {
    checked++;
    const r = fn(text);
    if (!r.ok) failures.push(`${side} should pass: "${text}" → ${JSON.stringify(r)}`);
  }
}

// ── The message never echoes the text ──
checked++;
const msg = publicNameProblem('fuck squad', 'handle');
if (!msg || /fuck/i.test(msg) || !/handle/.test(msg)) failures.push(`bad message: ${msg}`);
checked++;
if (publicNameProblem('Harry') !== null) failures.push('a fine name should have no message');

if (failures.length) {
  console.error(`✗ client name filter: ${failures.length} of ${checked} checks failed`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ client name filter — ${checked} checks, lists match the server's`);
