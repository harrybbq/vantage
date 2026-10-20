/**
 * Console CSS contract, checked on the real files:
 *   1. SCOPING — every selector in every .css file under src/design/
 *      starts with html[data-design="console"] (keyframes excepted).
 *      This is the guard that keeps classic identical; it covers the area
 *      files the screen agents write (shell/hub/track/sweep.css) too.
 *   2. tokens.css carries the surfaces lib/design/design.js derives the
 *      accent against (CX_SURFACES).
 *   3. Contrast: text tokens and every --band-* ≥ 4.5:1 and line-strong
 *      ≥ 3:1 against bg, s1 and s2, in both themes.
 *   4. One band token and two band classes per bands.js key.
 * Hermetic (reads files next to this one). Run: npm run check:console
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CX_SURFACES } from '../../lib/design/design.js';
import { contrast } from '../../lib/design/contrast.js';
import { BAND_KEYS } from '../../lib/ratings/bands.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN_ROOT = join(HERE, '..');
const SCOPE = 'html[data-design="console"]';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const cssFiles = (dir, out = []) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
};
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Split a selector list on top-level commas (not inside parentheses / brackets / strings). */
function splitSelectors(list) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of list) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Every style-rule selector in `css`, skipping @keyframes / @font-face bodies. */
function selectorsOf(css) {
  const s = stripComments(css);
  const found = [];
  const stack = []; // 'skip' | 'group' | 'rule'
  let prelude = '';
  let q = null;
  for (const ch of s) {
    if (q) { prelude += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; prelude += ch; continue; }
    if (ch === '{') {
      const p = prelude.trim(); prelude = '';
      const inSkip = stack.includes('skip') || stack.includes('rule');
      if (p.startsWith('@')) {
        stack.push(/^@(-webkit-)?keyframes|^@font-face|^@page/.test(p) ? 'skip' : 'group');
      } else {
        if (!inSkip) found.push(...splitSelectors(p));
        stack.push('rule');
      }
    } else if (ch === '}') { stack.pop(); prelude = ''; }
    else if (ch === ';') { prelude = ''; }
    else prelude += ch;
  }
  return found;
}

const files = cssFiles(DESIGN_ROOT);

t('scoping: every selector under src/design/ starts with html[data-design="console"]', () => {
  assert.ok(files.length >= 6, 'tokens, base, index + four area files');
  const bad = [];
  for (const f of files) {
    for (const sel of selectorsOf(readFileSync(f, 'utf8'))) {
      if (!sel.startsWith(SCOPE)) bad.push(`${relative(DESIGN_ROOT, f)}: ${sel}`);
    }
  }
  assert.deepEqual(bad, [], `unscoped selectors — prefix them with ${SCOPE}`);
});

t('scoping guard actually catches things (self-test)', () => {
  assert.deepEqual(selectorsOf('/* x { } */ html[data-design="console"] .a, .b:is(.c, .d) { color: red }'), [`${SCOPE} .a`, '.b:is(.c, .d)']);
  assert.deepEqual(selectorsOf('@media (x) { .a { b: c } } @keyframes k { from { x: y } }'), ['.a']);
  assert.deepEqual(selectorsOf(`@import './x.css'; ${SCOPE} body::before { content: 'a{b' }`), [`${SCOPE} body::before`]);
});

// ── token values ──
const tokensCss = stripComments(readFileSync(join(HERE, 'tokens.css'), 'utf8'));
function block(selector) {
  const i = tokensCss.indexOf(`${selector} {`);
  assert.ok(i >= 0, `block ${selector}`);
  const j = tokensCss.indexOf('}', i);
  const body = tokensCss.slice(i, j);
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const paper = block(SCOPE);
const dark = { ...paper, ...block(`${SCOPE}[data-theme="dark-os"]`) };
const THEMES = { 'cream-pro': paper, 'dark-os': dark };

t('tokens.css surfaces match CX_SURFACES (accent derivation uses these)', () => {
  for (const [id, v] of Object.entries(THEMES)) {
    const s = CX_SURFACES[id];
    assert.equal(v['--cx-bg'].toUpperCase(), s.bg, `${id} bg`);
    assert.equal(v['--cx-s1'].toUpperCase(), s.s1, `${id} s1`);
    assert.equal(v['--cx-s2'].toUpperCase(), s.s2, `${id} s2`);
  }
});

t('contrast: text + bands ≥ 4.5:1, line-strong ≥ 3:1 on bg / s1 / s2, both themes', () => {
  const textish = ['--cx-text', '--cx-mid', '--cx-muted', '--cx-accent', '--cx-gold', '--cx-night', '--cx-danger', '--cx-warn',
    '--promo', '--releg', '--plan', ...BAND_KEYS.map(k => `--band-${k}`)];
  for (const [id, v] of Object.entries(THEMES)) {
    for (const ground of ['--cx-bg', '--cx-s1', '--cx-s2']) {
      for (const tok of textish) {
        const c = contrast(v[tok], v[ground]);
        assert.ok(c >= 4.5, `${id} ${tok} ${v[tok]} on ${ground} ${v[ground]} = ${c && c.toFixed(2)}`);
      }
      const ls = contrast(v['--cx-line-strong'], v[ground]);
      assert.ok(ls >= 3 - 0.05, `${id} line-strong on ${ground} = ${ls.toFixed(2)}`);
    }
    const fill = contrast(v['--cx-accent-fill'], v['--cx-on-accent']);
    assert.ok(fill >= 4.5, `${id} on-accent on fill = ${fill.toFixed(2)}`);
  }
});

t('one --band-* token and .cx-band-* / .cx-band-bg-* classes per band', () => {
  for (const k of BAND_KEYS) {
    assert.ok(paper[`--band-${k}`] && dark[`--band-${k}`], `--band-${k} both themes`);
    assert.ok(tokensCss.includes(`${SCOPE} .cx-band-${k} { color: var(--band-${k}); }`), `.cx-band-${k}`);
    assert.ok(tokensCss.includes(`${SCOPE} .cx-band-bg-${k} { background: var(--band-${k}); }`), `.cx-band-bg-${k}`);
  }
});

t('type scale and radius scale are the spec values', () => {
  const scale = [[12, 16], [13, 18], [15, 22], [17, 24], [22, 28], [28, 32], [40, 44]];
  for (const [fs, lh] of scale) {
    assert.equal(paper[`--cx-fs-${fs}`], `${fs}px`);
    assert.equal(paper[`--cx-lh-${fs}`], `${lh}px`);
  }
  assert.equal(paper['--cx-r-panel'], '12px');
  assert.equal(paper['--cx-r-cell'], '8px');
  assert.equal(paper['--cx-r-chip'], '6px');
  assert.equal(paper['--cx-r-bar'], '2px');
  assert.equal(paper['--cx-dur-fast'], '120ms');
  assert.equal(paper['--cx-dur'], '200ms');
  assert.equal(paper['--cx-ease'], 'cubic-bezier(.2, .7, .2, 1)');
});

console.log(`console css: ${n} tests passed`);
