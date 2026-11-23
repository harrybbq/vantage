// node src/lib/lifts/sessionColour.test.mjs
import assert from 'node:assert/strict';
import { SESSION_COLOURS, sessionKey, sessionKeyOf, sessionVars } from './sessionColour.js';
import { LF_TOKENS, contrast, parseColor } from './ui.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('the five sessions and nothing else have a colour', () => {
  assert.deepEqual(Object.keys(SESSION_COLOURS).sort(), ['legs', 'lower', 'pull', 'push', 'upper']);
  for (const [name, key] of [['Push', 'push'], ['pull', 'pull'], ['Legs', 'legs'], ['Leg day', 'legs'], ['Upper', 'upper'], ['Lower (adaptive)', 'lower'], ['  upper body', 'upper']]) assert.equal(sessionKey(name), key, name);
  for (const name of ['', null, undefined, 'Arms', 'My push day', 'Pushups', 'Uppercut', 'Full body']) assert.equal(sessionKey(name), null, String(name));
});

t('a record is read by its rota code first, then its name', () => {
  assert.equal(sessionKeyOf({ rotaSession: 'Legs', name: 'Friday' }), 'legs');
  assert.equal(sessionKeyOf({ name: 'Upper' }), 'upper');
  assert.equal(sessionKeyOf({ session: 'Pull', short: 'Pull' }), 'pull');
  assert.equal(sessionKeyOf({ name: 'Arms and abs' }), null);
  assert.equal(sessionKeyOf(null), null);
});

t('no colour → null, so the caller keeps the accent', () => {
  assert.equal(sessionVars('Arms', 'dark-os'), null);
  assert.equal(sessionVars({ name: 'Custom' }, 'cream-pro'), null);
});

t('every session passes contrast on both themes: fill 3:1, text 4.5:1, label on the fill 4.5:1', () => {
  for (const theme of ['dark-os', 'cream-pro']) {
    const s = LF_TOKENS[theme];
    for (const key of Object.keys(SESSION_COLOURS)) {
      const v = sessionVars(key, theme);
      const fill = v['--lf-accent'], ink = v['--lf-accent-ink'], on = v['--lf-on-accent'];
      assert.ok(contrast(fill, s.s1) >= 3, `${theme} ${key} fill on s1 ${contrast(fill, s.s1)}`);
      assert.ok(contrast(ink, s.s1) >= 4.5 && contrast(ink, s.s2) >= 4.5, `${theme} ${key} ink`);
      assert.ok(contrast(on, fill) >= 4.5, `${theme} ${key} label on fill ${contrast(on, fill)}`);
      assert.ok(v['--lf-done-tint'].includes(fill) && v['--lf-focus'] === fill);
    }
  }
});

// Hue distance, so a session can't be mistaken for a best (gold), a night (indigo) or a problem (red).
const hue = hex => { const [r, g, b] = parseColor(hex).map(x => x / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
const apart = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };

t('the five keep clear of gold and red, and of each other', () => {
  for (const theme of ['dark-os', 'cream-pro']) {
    const s = LF_TOKENS[theme];
    const keys = Object.keys(SESSION_COLOURS);
    for (const k of keys) {
      assert.ok(apart(SESSION_COLOURS[k], s.pb) >= 30, `${theme} ${k} vs gold ${apart(SESSION_COLOURS[k], s.pb)}`);
      assert.ok(apart(SESSION_COLOURS[k], s.danger) >= 30, `${theme} ${k} vs red ${apart(SESSION_COLOURS[k], s.danger)}`);
    }
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) assert.ok(apart(SESSION_COLOURS[keys[i]], SESSION_COLOURS[keys[j]]) >= 25, `${keys[i]} vs ${keys[j]}`);
  }
});

console.log(`\n${n} tests passed`);
