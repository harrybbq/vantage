/**
 * Lifts UI helpers: WCAG contrast and the on-accent label, accent
 * adjustment per theme, the token table's ratios, estimate rounding and
 * wording, the ± step, Previous by shift (night first, else day × 0.8 to
 * the step), the PB toast rules, the pad buffer and the breakpoints.
 * Also the warm-up rule in lifts.js and the store's new optional keys.
 * Invented data only — this file is public. Run: npm run check:lifts
 */
import assert from 'node:assert/strict';
import {
  parseColor, luminance, contrast, onAccent, accentFor, accentVars, LF_TOKENS, roundEstimate, fmtEstimate, stepFor,
  realSetText, fmtShortDate, compareScope, nightPrevious, previousFor, pbToastKind, shouldToastPb, priorSessionCount, livePb,
  rpeLine, padInput, padStep, layoutFor, INK_DARK, INK_LIGHT, ESTIMATE_EXPLAINER,
} from './ui.js';
import {
  personalBests, isNewPB, pbTimeline, trend, isWarmup, workingEntries, entriesFor, setTypeOf, DEFAULT_STEP,
} from './lifts.js';
import {
  makeEntry, setLiftRest, setLiftStep, liftsPrefs, setLiftsPref, STEP_CHOICES,
} from './store.js';
import { startWorkout, addExercises, updateSet, toggleDone, activeOf, volume } from './workout.js';
// The accent schemes' `em` (src/components/SettingsSection.jsx SCHEMES — JSX, so copied here).
const SCHEMES = [
  ['Forest Green', '#1a7a4a'], ['Ocean Blue', '#1a4a7a'], ['Slate', '#1a3a5a'], ['Purple', '#5a1a7a'], ['Sunset', '#7a3a1a'],
  ['Rose', '#7a1a4a'], ['Teal', '#0f5e5a'], ['Crimson', '#7a1a1a'], ['Indigo', '#2a1a7a'], ['Amber', '#7a5a1a'],
  ['Magenta', '#7a1a6a'], ['Steel', '#33414f'], ['custom yellow', '#ffd400'], ['custom pale', '#cfe8ff'],
].map(([name, em]) => ({ name, em }));

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg || ''} ${a} ≈ ${b}`);

// ── Colour ──
t('parseColor / luminance / contrast: WCAG formula', () => {
  assert.deepEqual(parseColor('#1a7a4a'), [26, 122, 74]);
  assert.deepEqual(parseColor(' #FFF '), [255, 255, 255]);
  assert.deepEqual(parseColor('rgb(26, 122, 74)'), [26, 122, 74]);
  assert.equal(parseColor('nope'), null);
  assert.equal(luminance('#000'), 0);
  near(luminance('#fff'), 1, 1e-9);
  near(contrast('#000', '#fff'), 21, 1e-9);
  near(contrast('#fff', '#000'), 21, 1e-9, 'order does not matter');
  near(contrast('#777', '#777'), 1, 1e-9);
  assert.equal(contrast('x', '#fff'), null);
  // the brief's measured pair: muted #8F8A81 on #131311 ≈ 5.4
  near(contrast('#8F8A81', '#131311'), 5.4, 0.1);
});
t('onAccent: the label on an accent fill reaches 4.5:1 for every shipped scheme', () => {
  assert.equal(onAccent('#1a7a4a'), INK_LIGHT, 'the default green takes white');
  assert.equal(onAccent('#3FBF7F'), INK_DARK, 'a light green takes near-black');
  assert.equal(onAccent('#FFD400'), INK_DARK);
  assert.equal(onAccent('#000000'), INK_LIGHT);
  assert.equal(onAccent('garbage'), INK_LIGHT, 'unreadable → white');
  for (const sc of SCHEMES) {
    const ink = onAccent(sc.em);
    assert.ok(contrast(ink, sc.em) >= 4.5, `${sc.name} ${sc.em}: ${contrast(ink, sc.em).toFixed(2)}`);
  }
});
t('accentFor / accentVars: the fill reaches 3:1 and the ink 4.5:1 on the Lifts surfaces, both themes', () => {
  const dark = LF_TOKENS['dark-os'], cream = LF_TOKENS['cream-pro'];
  assert.equal(accentFor('#1A7A4A', cream.s1, 3), '#1A7A4A', 'already passes → unchanged');
  const steel = accentFor('#33414f', dark.s1, 3);
  assert.ok(contrast(steel, dark.s1) >= 3, `steel lifted on dark: ${steel}`);
  assert.ok(luminance(steel) > luminance('#33414f'), 'lightened on a dark surface');
  const pale = accentFor('#BFE8D0', cream.s1, 3);
  assert.ok(contrast(pale, cream.s1) >= 3 && luminance(pale) < luminance('#BFE8D0'), 'darkened on a light surface');
  for (const theme of ['dark-os', 'cream-pro']) {
    const tk = LF_TOKENS[theme];
    for (const sc of SCHEMES) {
      const v = accentVars(sc.em, theme);
      assert.ok(contrast(v['--lf-accent'], tk.s1) >= 3, `${theme} ${sc.name} fill ${v['--lf-accent']}`);
      assert.ok(contrast(v['--lf-accent-ink'], tk.s1) >= 4.5, `${theme} ${sc.name} ink on s1`);
      assert.ok(contrast(v['--lf-accent-ink'], tk.s2) >= 4.5, `${theme} ${sc.name} ink on s2`);
      assert.ok(contrast(v['--lf-on-accent'], v['--lf-accent']) >= 4.5, `${theme} ${sc.name} label on fill`);
    }
  }
});
t('token table: text ≥ 4.5:1 and boundaries ≥ 3:1 on s1 and s2, both themes (brief §3.1)', () => {
  for (const [theme, tk] of Object.entries(LF_TOKENS)) {
    for (const surf of ['s1', 's2']) {
      for (const k of ['text', 'mid', 'muted', 'pb', 'night', 'danger']) {
        assert.ok(contrast(tk[k], tk[surf]) >= 4.5, `${theme} ${k} on ${surf}: ${contrast(tk[k], tk[surf]).toFixed(2)}`);
      }
      assert.ok(contrast(tk.lineStrong, tk[surf]) >= 3, `${theme} line-strong on ${surf}`);
    }
    assert.ok(contrast(tk.muted, tk.s3) >= 4.5, `${theme} muted on the pressed cell s3`);
  }
});

// ── Estimates ──
t('roundEstimate / fmtEstimate: 1 kg on tiles, 0.5 in readouts, always "est." and "~"', () => {
  assert.equal(roundEstimate(240.6), 241);
  assert.equal(roundEstimate(240.6, 'tile'), 241);
  assert.equal(roundEstimate(240.6, 'readout'), 240.5);
  assert.equal(roundEstimate(240.8, 'readout'), 241);
  assert.equal(roundEstimate(112.36, 'readout'), 112.5, 'never "112.36"');
  assert.equal(roundEstimate(null), null);
  assert.equal(fmtEstimate(240.6), 'est. 1RM ~241 kg');
  assert.equal(fmtEstimate(240.6, { ctx: 'readout' }), 'est. 1RM ~240.5 kg');
  assert.equal(fmtEstimate(150, { low: true }), 'est. 1RM ≈150 kg');
  assert.equal(fmtEstimate(null), 'est. 1RM —');
  assert.equal(fmtEstimate(100, { label: 'est.', unit: '' }), 'est. ~100');
  assert.ok(/Epley/.test(ESTIMATE_EXPLAINER) && /actually lifted/.test(ESTIMATE_EXPLAINER));
});
t('realSetText / fmtShortDate / compareScope', () => {
  assert.equal(realSetText(192.5, 5), '192.5 × 5');
  assert.equal(realSetText(0, 8, { load: 'bodyweight_plus' }), 'BW × 8');
  assert.equal(realSetText(20, 8, { load: 'bodyweight_plus' }), '+20 × 8');
  assert.equal(realSetText(31.25, 8), '31.25 × 8', 'a real set is exact');
  assert.equal(realSetText(null, 8), '—');
  assert.equal(fmtShortDate('2026-10-12'), '12 Oct');
  assert.equal(fmtShortDate('2025-10-12', '2026-10-19'), '12 Oct 2025');
  assert.equal(fmtShortDate('bad'), '');
  assert.deepEqual(compareScope({ name: 'Machine leg press' }, 'DXC'), { perGym: true, text: 'Compared within DXC', short: 'DXC' });
  assert.deepEqual(compareScope({ name: 'Bench press' }, 'DXC'), { perGym: false, text: 'Compared across gyms', short: 'all gyms' });
  assert.equal(compareScope({ name: 'Bench press', perGym: true }, 'Greenock').text, 'Compared within Greenock', 'the lift’s own switch wins');
});

// ── Step ──
t('stepFor: gym step > lift step > default by load type', () => {
  assert.deepEqual(DEFAULT_STEP, { weight: 2.5, bodyweight_plus: 2.5, per_hand: 1 });
  assert.equal(stepFor({ load: 'weight' }), 2.5);
  assert.equal(stepFor({ load: 'bodyweight_plus' }), 2.5);
  assert.equal(stepFor({ load: 'per_hand' }), 1);
  assert.equal(stepFor(null), 2.5);
  assert.equal(stepFor({ load: 'weight', step: 5 }), 5);
  const m = { load: 'weight', step: 5, stepByGym: { dxc: 1.25 } };
  assert.equal(stepFor(m, 'dxc'), 1.25);
  assert.equal(stepFor(m, 'greenock'), 5, 'no step at that gym → the lift’s');
  assert.equal(stepFor({ load: 'weight', step: -1 }), 2.5, 'nonsense ignored');
});

// ── Previous by shift ──
const LIST = [
  { id: 'lp', name: 'Machine leg press', load: 'weight', unit: 'kg', createdAt: 0 },
  { id: 'dip', name: 'Dip', load: 'bodyweight_plus', unit: 'kg', createdAt: 0 },
  { id: 'cr', name: 'Seated cable row', load: 'weight', unit: 'kg', createdAt: 0, stepByGym: { greenock: 5 } },
];
let c = 0;
const e = (liftId, date, weight, reps, extra = {}) => ({ id: `u${++c}`, liftId, date, weight, reps, createdAt: ++c, gym: 'dxc', ...extra });
const LOG = [
  e('lp', '2026-09-01', 170, 10, { sessionId: 'a' }), e('lp', '2026-09-01', 180, 8, { sessionId: 'a' }),
  e('lp', '2026-09-08', 140, 8, { sessionId: 'b', shift: 'night' }),
  e('lp', '2026-09-15', 175, 10, { sessionId: 'c' }), e('lp', '2026-09-15', 182.5, 8, { sessionId: 'c' }),
  e('lp', '2026-09-20', 200, 6, { sessionId: 'g1', gym: 'greenock' }),
  e('dip', '2026-09-02', 20, 8), e('dip', '2026-09-02', 22.5, 6),
  e('cr', '2026-09-03', 61, 10, { gym: 'greenock' }),
];
const S0 = () => ({ lifts: { list: LIST.map(l => ({ ...l })), log: LOG.map(x => ({ ...x })), sessions: [] } });

t('previousFor (day): the last DAY session at this gym for a machine', () => {
  const S = S0();
  const p = previousFor(S, 'lp', 1, { gym: 'dxc', night: false });
  assert.deepEqual([p.weight, p.reps, p.source, p.label, p.date], [182.5, 8, 'day', '', '2026-09-15']);
  assert.equal(previousFor(S, 'lp', 0, { gym: 'greenock' }).weight, 200, 'gym-scoped for a machine');
  assert.equal(previousFor(S, 'lp', 5, { gym: 'dxc' }).weight, null, 'past the end → no previous');
  assert.equal(previousFor(S, 'lp', 5, { gym: 'dxc', clamp: true }).weight, 182.5, 'clamp → the last set (✓-fill)');
  assert.equal(previousFor(S, 'nope', 0, {}).source, null);
});
t('nightPrevious: last NIGHT session first, else day × 0.8 rounded to the step, labelled ☾ 80 %', () => {
  const S = S0();
  const n1 = nightPrevious(S, 'lp', 0, { gym: 'dxc' });
  assert.deepEqual([n1.weight, n1.reps, n1.source, n1.label], [140, 8, 'night', '☾']);
  const d = nightPrevious(S, 'dip', 1);
  assert.deepEqual([d.weight, d.reps, d.source, d.label], [17.5, 6, 'day×0.8', '☾ 80 %'], '22.5 × 0.8 = 18 → 17.5 at step 2.5');
  // gym step: 61 × 0.8 = 48.8 → 50 at Greenock's step 5
  assert.equal(nightPrevious(S, 'cr', 0, { gym: 'greenock' }).weight, 50);
  assert.equal(nightPrevious(S, 'cr', 0, { gym: 'greenock', scale: 0.5 }).weight, 30, '30.5 → 30 at step 5');
  assert.equal(nightPrevious(S, 'cr', 0, { gym: 'dxc' }).source, null, 'a machine has no DXC history');
  assert.deepEqual(previousFor(S, 'dip', 1, { night: true }), d, 'previousFor routes a night session here');
});
t('previousFor({ active }) reads the workout’s gym and shift', () => {
  let S = startWorkout(S0(), { source: 'blank', now: 0, today: '2026-10-20', shift: 'night', gym: 'dxc', ids: p => `${p}_${++c}` });
  S = addExercises(S, ['lp'], { ids: p => `${p}_${++c}` });
  const p = previousFor(S, 'lp', 0, { active: activeOf(S) });
  assert.equal(p.source, 'night');
  assert.equal(p.weight, 140);
});

// ── PB toast ──
t('pbToastKind / shouldToastPb: heaviest > rep max; ≥ 2 prior sessions; never edited, warm-up or twice', () => {
  assert.equal(pbToastKind({ heaviest: true, repMaxes: [5] }), 'heaviest');
  assert.equal(pbToastKind({ heaviest: false, repMaxes: [8] }), 'repmax');
  assert.equal(pbToastKind({ heaviest: false, repMaxes: [] }), null);
  assert.equal(pbToastKind({ first: true, heaviest: true, repMaxes: [] }), null, 'a first set is a baseline');
  assert.equal(pbToastKind({ warmup: true }), null);
  assert.equal(pbToastKind(null), null);
  const ok = { priorSessions: 2, kind: 'heaviest' };
  assert.equal(shouldToastPb(ok), true);
  assert.equal(shouldToastPb({ ...ok, priorSessions: 1 }), false, 'needs ≥ 2 prior sessions');
  assert.equal(shouldToastPb({ ...ok, editedSet: true }), false);
  assert.equal(shouldToastPb({ ...ok, alreadyToasted: true }), false);
  assert.equal(shouldToastPb({ ...ok, warmup: true }), false);
  assert.equal(shouldToastPb({ ...ok, kind: null }), false);
  assert.equal(shouldToastPb(), false);
});
t('priorSessionCount: sessions or Quick-Log days, gym-scoped for machines, warm-ups aside', () => {
  const lp = LIST[0];
  assert.equal(priorSessionCount(LOG, lp, 'dxc'), 3, 'a, b, c at DXC');
  assert.equal(priorSessionCount(LOG, lp, 'greenock'), 1);
  assert.equal(priorSessionCount(LOG, LIST[1]), 1, 'two quick-logged sets on one day = one');
  const w = [...LOG, e('dip', '2026-09-09', 10, 10, { type: 'W' })];
  assert.equal(priorSessionCount(w, LIST[1]), 1, 'a warm-up-only day is not a session');
});
t('livePb: a ticked real set that beats the gym’s record toasts once; warm-ups and thin history never', () => {
  const ids = p => `${p}_${++c}`;
  let S = startWorkout(S0(), { source: 'blank', now: 0, today: '2026-10-20', gym: 'dxc', ids });
  S = addExercises(S, ['lp', 'dip'], { ids });
  S = toggleDone(updateSet(S, 0, 0, { weight: 185, reps: 8 }), 0, 0, 1);
  const pb = livePb(S, 0, 0);
  assert.equal(pb.kind, 'heaviest');
  assert.match(pb.text, /^New PB · Leg press 185 × 8 · heaviest ever/);
  assert.equal(livePb(S, 0, 0, { toasted: new Set(['lp']) }), null, 'one per exercise per session');
  assert.equal(livePb(S, 0, 0, { edited: true }), null, 'never for an edited set');
  // 185 isn't Greenock's best (200) — but the workout is at DXC, so it counts there only
  const W = { ...S, lifts: { ...S.lifts, active: { ...activeOf(S), exercises: activeOf(S).exercises.map((x, i) => (i === 0 ? { ...x, sets: x.sets.map(st => ({ ...st, type: 'W' })) } : x)) } } };
  assert.equal(livePb(W, 0, 0), null, 'a warm-up is never a PB');
  // dips have one prior session: no toast even for a big set
  S = toggleDone(updateSet(S, 1, 0, { weight: 40, reps: 8 }), 1, 0, 2);
  assert.equal(livePb(S, 1, 0), null, '< 2 prior sessions');
  assert.equal(livePb(S, 1, 5), null);
});

// ── RPE + pad ──
t('rpeLine', () => {
  assert.equal(rpeLine(8), '8 · 2 reps left');
  assert.equal(rpeLine(9), '9 · 1 rep left');
  assert.equal(rpeLine(10), '10 · nothing left');
  assert.equal(rpeLine(9.5), '9.5 · maybe 1 rep left');
  assert.equal(rpeLine(7.5), '7.5 · 2–3 reps left');
  assert.equal(rpeLine(null), '');
});
t('padInput / padStep: fresh replaces, decimals for weight only, 5 digits, steps clamp', () => {
  assert.equal(padInput('82.5', '9', { fresh: true }), '9');
  assert.equal(padInput('8', '2'), '82');
  assert.equal(padInput('82', '.'), '82.');
  assert.equal(padInput('82.', '5'), '82.5');
  assert.equal(padInput('82.5', '.'), null, 'one point');
  assert.equal(padInput('8', '.', { field: 'reps' }), null, 'reps are whole');
  assert.equal(padInput('', '.'), '0.');
  assert.equal(padInput('0', '7'), '7');
  assert.equal(padInput('12345', '6'), null);
  assert.equal(padInput('82.25', '1'), null, 'two decimals at most');
  assert.equal(padInput('82.5', 'back'), '82.');
  assert.equal(padInput('82.5', 'back', { fresh: true }), '');
  assert.equal(padInput('8', 'x'), null);
  assert.equal(padStep('80', 1, 2.5), '82.5');
  assert.equal(padStep('1', -1, 2.5), '0', 'weight floors at 0');
  assert.equal(padStep('1', -1, 1, 'reps'), '1', 'reps floor at 1');
  assert.equal(padStep('9.5', 1, 1, 'rpe'), '10', 'RPE tops out at 10');
  assert.equal(padStep('', 1, 1.25), '1.25');
});
t('layoutFor: width decides layout (pointer decides entry, separately)', () => {
  assert.equal(layoutFor(360), 'phone');
  assert.equal(layoutFor(599), 'phone');
  assert.equal(layoutFor(600), 'tablet');
  assert.equal(layoutFor(1023), 'tablet');
  assert.equal(layoutFor(1024), 'desktop');
  assert.equal(layoutFor(1440), 'desktop');
});

// ── Warm-ups (lifts.js) ──
t('warm-ups never count for PBs, rep maxes, e1RM, the timeline or the trend — but stay in the log and the volume', () => {
  const lift = { id: 'bp', name: 'Bench press', load: 'weight' };
  const L = [
    e('bp', '2026-09-01', 100, 5, { sessionId: 's1' }),
    e('bp', '2026-09-08', 140, 8, { sessionId: 's2', type: 'W' }),    // a "warm-up" heavier than anything
    e('bp', '2026-09-08', 102.5, 5, { sessionId: 's2' }),
    e('bp', '2026-09-08', 60, 12, { sessionId: 's2', type: 'D' }),    // drop sets count
  ];
  assert.equal(isWarmup(L[1]), true);
  assert.equal(setTypeOf(L[3]), 'D');
  assert.equal(setTypeOf({ type: 'Q' }), null);
  assert.equal(entriesFor(L, lift).length, 4, 'the log keeps every set');
  assert.equal(workingEntries(L, lift).length, 3);
  const pb = personalBests(L, lift);
  assert.equal(pb.heaviest.value, 102.5);
  assert.equal(pb.repMaxes[8].weight, 60, 'the 140 × 8 warm-up is not the 8RM (the 60 × 12 drop set is)');
  assert.equal(pb.repMaxes[12].weight, 60, 'the drop set is a real 12RM');
  assert.ok(pb.bestE1rm.entry.type !== 'W', 'e1RM never from a warm-up');
  assert.deepEqual(pbTimeline(L, lift).map(ev => ev.entry.weight), [102.5], 'timeline: the working set only');
  assert.ok(trend(L, lift, { today: '2026-09-10' }).series.every(p => p.entry.type !== 'W'));
  const w = isNewPB(L, { id: 'x', liftId: 'bp', date: '2026-09-15', weight: 200, reps: 5, type: 'W' }, lift);
  assert.equal(w.any, false);
  assert.equal(w.warmup, true);
  assert.equal(isNewPB(L, { id: 'y', liftId: 'bp', date: '2026-09-15', weight: 105, reps: 5 }, lift).heaviest, true, 'judged against working sets');
  assert.equal(volume({ exercises: [{ liftId: 'bp', sets: [{ weight: 140, reps: 8, done: true, type: 'W' }, { weight: 100, reps: 5, done: true }] }] }, [lift]), 1620, 'volume counts the warm-up');
});

// ── Store: optional keys ──
t('makeEntry carries a set type; setLiftRest / setLiftStep / prefs are additive and idempotent', () => {
  assert.equal(makeEntry({ liftId: 'a', date: '2026-10-01', weight: 50, reps: 5, type: 'W' }, { id: 'i' }).type, 'W');
  assert.equal('type' in makeEntry({ liftId: 'a', date: '2026-10-01', weight: 50, reps: 5, type: 'X' }, { id: 'i' }), false);
  assert.equal('type' in makeEntry({ liftId: 'a', date: '2026-10-01', weight: 50, reps: 5 }, { id: 'i' }), false);
  const L0 = { list: LIST.map(l => ({ ...l })), log: [] };
  const R = setLiftRest(L0, 'lp', 180);
  assert.equal(R.list[0].restSec, 180);
  assert.equal(R.list[1], L0.list[1], 'other lifts untouched, same objects');
  assert.equal(setLiftRest(R, 'lp', 180), R, 'same → the store itself');
  assert.equal(setLiftRest(R, 'lp', 5).list[0].restSec, 15, 'clamped');
  assert.equal('restSec' in setLiftRest(R, 'lp', null).list[0], false, 'null clears');
  assert.equal(setLiftRest(L0, 'nope', 90), L0);
  assert.deepEqual(STEP_CHOICES, [1, 1.25, 2, 2.5, 5]);
  const P = setLiftStep(L0, 'lp', 5);
  assert.equal(P.list[0].step, 5);
  assert.equal(setLiftStep(L0, 'lp', 3), L0, 'only the offered steps');
  const G = setLiftStep(P, 'lp', 1.25, 'greenock');
  assert.deepEqual(G.list[0].stepByGym, { greenock: 1.25 });
  assert.equal(G.list[0].step, 5, 'the lift step stays');
  assert.equal(stepFor(G.list[0], 'greenock'), 1.25);
  const G2 = setLiftStep(G, 'lp', null, 'greenock');
  assert.equal('stepByGym' in G2.list[0], false, 'clearing the last gym step drops the map');
  assert.equal('step' in setLiftStep(P, 'lp', null).list[0], false);
  assert.equal(setLiftStep(G, 'lp', 1.25, 'greenock'), G);
  assert.deepEqual(liftsPrefs(L0), {});
  const Q = setLiftsPref(L0, 'restHintSeen', true);
  assert.deepEqual(Q.prefs, { restHintSeen: true });
  assert.equal(setLiftsPref(Q, 'restHintSeen', true), Q);
  assert.deepEqual(setLiftsPref(Q, 'restTone', false).prefs, { restHintSeen: true, restTone: false }, 'other prefs kept');
  assert.equal(Q.list, L0.list, 'prefs never touch the list');
});

console.log(`ui: ${n} tests passed`);
