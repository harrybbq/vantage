/**
 * src/lib/ratings/prestigeRewards.js — the prestige reward ladder.
 *
 * Lives under src/design/ so `npm run check:console` finds it without a
 * package.json edit (scripts/check-console.mjs runs every *.test.mjs
 * here). Both designs read the module; it is tested once, here.
 * Hermetic: no clock, no env, no network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../lib/ratings/prestigeRewards.js';
import { PRESTIGE_BANDS } from '../lib/ratings/prestige.js';
import { contrast } from '../lib/design/contrast.js';
import { consoleAccentVars, CX_SURFACES, ACCENT_TEXT_MIN } from '../lib/design/design.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ── The ladder ──
{
  const at = R.REWARDS.map(r => r.at);
  ok(at.every((a, i) => i === 0 || a > at[i - 1]), 'one reward per step, ascending');
  for (let p = 1; p <= 12; p++) ok(at.includes(p), `P${p} has a reward`);
  for (const r of R.REWARDS) {
    ok(['accent', 'card', 'frame', 'badge'].includes(r.kind), `${r.id}: known kind`);
    ok(r.name && r.desc && r.desc.length < 140, `${r.id}: named and described briefly`);
    ok(!/level|\bxp\b/i.test(r.name + r.desc), `${r.id}: no Level/XP wording`);
    ok(!/—/.test(r.desc), `${r.id}: no em-dash in UI copy`);
  }
  ok(new Set(R.REWARDS.map(r => r.id)).size === R.REWARDS.length, 'reward ids are unique');
  for (const kind of ['accent', 'card', 'frame', 'badge']) ok(R.REWARDS.some(r => r.kind === kind), `ladder has a ${kind}`);
  // The three honour accents now come early.
  eq(['purple', 'orange', 'pink'].map(id => R.ACCENT_UNLOCKS[id].at), [1, 3, 5], 'old accents at P1/P3/P5');
  // Every accent reward has an unlock rule at the same step, and vice versa.
  for (const r of R.REWARDS.filter(x => x.kind === 'accent')) eq(R.ACCENT_UNLOCKS[r.id]?.at, r.at, `${r.id}: rule matches ladder`);
  eq(Object.keys(R.ACCENT_UNLOCKS).sort(), R.REWARDS.filter(x => x.kind === 'accent').map(x => x.id).sort(), 'no accent rule without a ladder entry');
}

// ── unlocked / next / progress ──
{
  eq(R.unlockedRewards(0), [], 'P0 unlocks nothing');
  eq(R.unlockedRewards(3).map(r => r.id), ['purple', 'rule', 'orange'], 'P3 has three');
  eq(R.nextReward(0).id, 'purple', 'P0 → next is Purple at P1');
  eq(R.nextReward(3).at, 4, 'P3 → next at P4');
  eq(R.nextReward(99), null, 'ladder done');
  eq(R.prestigeName(2), 'Prestige II', 'absolute numerals');
  eq(R.prestigeName(0), '', 'no name at P0');
  const pg = R.prestigeProgress(74, 1);
  eq([pg.toGo, pg.pct, pg.next, pg.nextName, pg.ready], [25, 75, 2, 'Prestige II', false], 'progress at OVR 74, P1');
  eq(R.prestigeProgress(99, 0).ready, true, 'OVR 99 is ready to prestige');
  eq(R.prestigeProgress(null, 0).toGo, null, 'loading ratings → no number');
  eq(R.prestigeProgress(99, 99).next, null, 'P99 has no next');
  eq(R.prestigeProgress('garbage', -4).prestige, 0, 'garbage prestige → 0');
}

// ── Accent access + grandfathering ──
{
  const purple = { id: 'purple' }, moss = { id: 'moss' }, teal = { id: 'teal', pro: true }, green = { id: 'green' };
  const old = { 'ach-3': { unlockedAt: '2026-08-01T10:00:00.000Z' } };
  const fresh = { 'ach-3': { unlockedAt: '2026-12-01T10:00:00.000Z' } };
  const undated = { 'ach-3': { silent: true } };
  eq(R.accentAccess(green, {}).locked, false, 'free accent is free');
  eq(R.accentAccess(purple, {}).locked, true, 'Purple locked for a new P0 user');
  eq(R.accentAccess(purple, {}).title, 'Unlocks at Prestige I', 'lock copy names the prestige');
  eq(R.accentAccess(purple, { prestige: 1 }).why, 'prestige', 'P1 unlocks Purple');
  eq(R.accentAccess(purple, { visions: old }).why, 'grandfathered', 'honour stamped before the cut-off keeps Purple');
  eq(R.accentAccess(purple, { visions: undated }).why, 'grandfathered', 'undated stamp keeps Purple');
  eq(R.accentAccess(purple, { visions: fresh }).locked, true, 'an honour earned after the cut-off no longer unlocks it');
  eq(R.accentAccess(purple, { active: true }).locked, false, 'the selected accent is never stranded');
  eq(R.accentAccess(purple, { hasPro: true }).why, 'pro', 'Pro keeps the original three');
  eq(R.accentAccess(moss, { hasPro: true }).locked, true, 'Pro does not buy prestige-only accents');
  eq(R.accentAccess(moss, { prestige: 8 }).locked, false, 'P8 unlocks Moss');
  eq(R.accentAccess(teal, {}).by, 'pro', 'Pro accent stays Pro');
  eq(R.accentAccess(teal, { prestige: 50 }).locked, true, 'prestige does not buy Pro accents');
  eq(R.accentAccess(teal, { hasPro: true }).locked, false, 'Pro unlocks Pro accents');
}

// ── Frames ──
{
  eq(R.frameFor(0), null, 'P0 has no frame');
  const f1 = R.frameFor(1), f4 = R.frameFor(4), f7 = R.frameFor(7), f10 = R.frameFor(10), f15 = R.frameFor(15);
  eq([f1.ring, f1.badge, f1.halo, f1.band], ['single', 'outline', false, 'forest'], 'P1: single ring, outline badge, green band');
  eq(f4.ring, 'double', 'P4: double ring');
  eq(f7.badge, 'solid', 'P7: solid badge');
  eq([f10.ring, f10.band], ['segmented', 'yellow'], 'P10: segmented ring, yellow band');
  eq(f15.halo, true, 'P15: halo');
  eq(R.frameFor(250).p, 99, 'clamped to P99');
  // Band colours mirror index.css.
  const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');
  for (const b of PRESTIGE_BANDS) {
    const m = new RegExp(`\\.prestige-${b.key}\\s*\\{\\s*--pb-c:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
    ok(m, `index.css has .prestige-${b.key}`);
    eq(m[1].toLowerCase(), R.PRESTIGE_BAND_COLOURS[b.key], `${b.key}: colour matches index.css`);
  }
}

// ── Card styles ──
{
  eq(R.CARD_STYLES[0].id, 'plain', 'plain first');
  eq(R.resolveCardStyle({}), 'plain', 'no choice → plain');
  eq(R.resolveCardStyle({ cardStyle: 'gilt', prestige: 3 }), 'plain', 'locked choice → plain (P3, gilt is P9)');
  eq(R.resolveCardStyle({ cardStyle: 'rule', prestige: 3 }), 'rule', 'unlocked choice kept');
  eq(R.resolveCardStyle({ cardStyle: 'nonsense', prestige: 30 }), 'plain', 'unknown → plain');
  const prev = { prestige: 2, coins: 5, visions: { a: 1 } };
  const next = R.withCardStyle(prev, 'rule');
  eq(next, { prestige: 2, coins: 5, visions: { a: 1 }, cardStyle: 'rule' }, 'additive write of one key');
  ok(next.visions === prev.visions, 'other keys untouched (same references)');
  ok(R.withCardStyle(prev, 'gilt') === prev, 'locked style → no write');
  ok(R.withCardStyle(next, 'rule') === next, 'same style → no write');
  ok(R.withCardStyle(prev, 'zzz') === prev, 'unknown style → no write');
}

// ── New accents: readable in both designs, both themes ──
{
  const CLASSIC = { cream: '#f7f1e3', creamCard: '#fdf8ed', dark: '#0c0c0b', darkCard: '#131311' };
  for (const a of R.PRESTIGE_ACCENTS) {
    ok(contrast(a.em, '#FFFFFF') >= 4.5, `${a.id}: white on em ≥ 4.5 (${contrast(a.em, '#FFFFFF').toFixed(2)})`);
    ok(contrast(a.em, CLASSIC.cream) >= 4.5 && contrast(a.em, CLASSIC.creamCard) >= 4.5, `${a.id}: em as text on Cream ≥ 4.5`);
    ok(contrast(a.light, CLASSIC.dark) >= 4.5 && contrast(a.light, CLASSIC.darkCard) >= 4.5, `${a.id}: light as text on Dark OS ≥ 4.5`);
    for (const theme of ['dark-os', 'cream-pro']) {
      const v = consoleAccentVars(a.em, theme);
      const s = CX_SURFACES[theme];
      ok(contrast(v['--cx-accent'], s.s1) >= ACCENT_TEXT_MIN[theme], `${a.id}: console ${theme} accent text`);
      ok(contrast(v['--cx-accent-fill'], s.s1) >= 3, `${a.id}: console ${theme} fill ≥ 3`);
    }
  }
  // Distinct from the accents that already exist (SettingsSection SCHEMES).
  const EXISTING = ['#1a7a4a', '#1a4a7a', '#1a3a5a', '#5a1a7a', '#7a3a1a', '#7a1a4a', '#0f5e5a', '#7a1a1a', '#2a1a7a', '#7a5a1a', '#7a1a6a', '#33414f'];
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const dist = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  for (const a of R.PRESTIGE_ACCENTS) {
    const nearest = Math.min(...EXISTING.map(e => dist(a.em, e)));
    ok(nearest >= 40, `${a.id}: not a near-copy of an existing accent (${nearest.toFixed(0)})`);
  }
}

console.log(`prestigeRewards: ${n} checks passed`);
