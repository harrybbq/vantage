/**
 * The design switch (lib/design/design.js): resolution, the owner preview
 * gate, the one-line launch flip, the additive updater, and the accent
 * derivation per theme. Hermetic: no env, no DOM. Run: npm run check:console
 */
import assert from 'node:assert/strict';
import {
  DESIGNS, DEFAULT_DESIGN, isDesign, isConsoleGated, resolveDesign, withDesign,
  consoleAccentVars, CONSOLE_ACCENT_PROPS, CX_SURFACES, ACCENT_TEXT_MIN,
} from './design.js';
import { contrast } from './contrast.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('two designs; the shipped default is classic until launch', () => {
  assert.deepEqual([...DESIGNS], ['classic', 'console']);
  assert.ok(isDesign(DEFAULT_DESIGN));
  assert.equal(DEFAULT_DESIGN, 'classic', 'flip this only at the public launch');
  assert.ok(Object.isFrozen(DESIGNS));
});

t('isDesign accepts only the two ids', () => {
  for (const v of ['classic', 'console']) assert.equal(isDesign(v), true);
  for (const v of [undefined, null, '', 'Console', 'dark-os', 1, {}, ['console']]) assert.equal(isDesign(v), false);
});

t('absent / garbage S.design → the default', () => {
  for (const S of [undefined, null, {}, { design: null }, { design: 'nope' }, { design: 7 }, { design: ' console' }]) {
    assert.equal(resolveDesign(S), 'classic');
    assert.equal(resolveDesign(S, { allowConsole: true }), 'classic');
    assert.equal(resolveDesign(S, { allowConsole: true, defaultDesign: 'console' }), 'console');
    assert.equal(resolveDesign(S, { allowConsole: false, defaultDesign: 'console' }), 'console');
  }
});

t('preview: console is owner-only while the default is classic', () => {
  assert.equal(resolveDesign({ design: 'console' }, { allowConsole: true }), 'console', 'owner gets it');
  assert.equal(resolveDesign({ design: 'console' }, { allowConsole: false }), 'classic', 'non-owner does not');
  assert.equal(resolveDesign({ design: 'console' }), 'classic', 'no option = not allowed');
  assert.equal(resolveDesign({ design: 'classic' }, { allowConsole: true }), 'classic', 'owner who chose classic keeps it');
  assert.equal(isConsoleGated(), true);
  assert.equal(isConsoleGated('classic'), true);
});

t('launch flip: default console opens the gate for everyone, classic stays selectable', () => {
  const launch = { defaultDesign: 'console' };
  assert.equal(isConsoleGated('console'), false);
  assert.equal(resolveDesign({}, launch), 'console', 'absent → console for a non-owner');
  assert.equal(resolveDesign({ design: 'console' }, launch), 'console');
  assert.equal(resolveDesign({ design: 'classic' }, launch), 'classic', 'the backup is still selectable');
  assert.equal(resolveDesign({ design: 'garbage' }, launch), 'console');
});

t('a garbage defaultDesign option falls back to classic (never throws)', () => {
  assert.equal(resolveDesign({}, { defaultDesign: 'nope' }), 'classic');
  assert.equal(resolveDesign({ design: 'console' }, { defaultDesign: 'nope' }), 'classic');
  assert.equal(isConsoleGated('nope'), true);
});

t('withDesign is additive: one key, never a rewrite', () => {
  const prev = { theme: 'dark-os', habits: [{ id: 'h1' }], nested: { a: 1 } };
  const next = withDesign(prev, 'console');
  assert.notEqual(next, prev);
  assert.equal(next.design, 'console');
  assert.deepEqual(Object.keys(next).sort(), ['design', 'habits', 'nested', 'theme']);
  assert.equal(next.habits, prev.habits, 'other keys carried by reference, untouched');
  assert.equal(next.nested, prev.nested);
  assert.equal(prev.design, undefined, 'prev not mutated');
  assert.equal(withDesign(next, 'console'), next, 'no change → same object (no save queued)');
  assert.equal(withDesign(prev, 'garbage'), prev, 'unknown value → same object');
  assert.equal(withDesign(prev, undefined), prev);
  assert.deepEqual(withDesign(undefined, 'classic'), { design: 'classic' });
});

t('accent: fill ≥ 3:1 on s1, text ≥ the theme target on s1 and s2, label ≥ 4.5:1 on fill', () => {
  // The schemes' `em` (SettingsSection SCHEMES is JSX, so copied) + custom extremes.
  const ems = ['#1a7a4a', '#1a4a7a', '#1a3a5a', '#5a1a7a', '#7a3a1a', '#7a1a4a', '#0f5e5a', '#7a1a1a', '#2a1a7a',
    '#7a5a1a', '#7a1a6a', '#33414f', '#ffd400', '#cfe8ff', '#000000', '#ffffff'];
  for (const theme of ['dark-os', 'cream-pro']) {
    const s = CX_SURFACES[theme];
    for (const em of ems) {
      const v = consoleAccentVars(em, theme);
      assert.deepEqual(Object.keys(v), [...CONSOLE_ACCENT_PROPS]);
      assert.ok(contrast(v['--cx-accent-fill'], s.s1) >= 3 - 1e-9, `${theme} ${em} fill`);
      const min = ACCENT_TEXT_MIN[theme];
      assert.ok(contrast(v['--cx-accent'], s.s1) >= min - 1e-9, `${theme} ${em} text on s1`);
      assert.ok(contrast(v['--cx-accent'], s.s2) >= min - 1e-9, `${theme} ${em} text on s2`);
      if (!['#33414f'].includes(em)) assert.ok(contrast(v['--cx-accent-fill'], v['--cx-on-accent']) >= 4.5, `${theme} ${em} label`);
      assert.match(v['--cx-accent-tint'], /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/);
    }
  }
});

t('accent: the default green lands on the Direction A table where the table allows', () => {
  const d = consoleAccentVars('#1a7a4a', 'dark-os');
  assert.equal(d['--cx-accent-fill'], '#1A7A4A');
  assert.equal(d['--cx-on-accent'], '#FFFFFF');
  assert.equal(d['--cx-accent'], '#2CCE7D', 'bright accent text on near-black (table: #3FBF7F, 7.22:1)');
  const p = consoleAccentVars('#1a7a4a', 'cream-pro');
  assert.equal(p['--cx-accent-fill'], '#1A7A4A');
  assert.equal(p['--cx-accent'], '#1A7A4A', 'already ≥ 4.5 on Paper (table: #17744A)');
  assert.deepEqual(consoleAccentVars('garbage', 'dark-os'), d, 'unreadable → default green');
  assert.deepEqual(consoleAccentVars(undefined, 'dark-os'), d);
  assert.deepEqual(consoleAccentVars('#1a7a4a', 'cream'), p, 'unknown theme → Paper');
});

console.log(`design: ${n} tests passed`);
