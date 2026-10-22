/**
 * Item 126 (gaps C5–C8): WHOOP's score is called WHOOP Recovery, Oura's
 * is called Oura Readiness, neither is renamed as the other, and when the
 * log cannot say whose a score is, the words name neither company.
 *
 * Display only — every check here also confirms the state it read is
 * untouched (the stored key stays `recovery`).
 *
 * Run: node src/lib/vitals/recoverySource.test.mjs
 */
import assert from 'node:assert/strict';
import {
  recoveryProviderOn, recoveryProvider, recoveryName, recoveryShort, whoopBand, WHOOP_RECOVERY_COLOURS, providerText,
} from './recoverySource.js';
import { readinessFor } from './readiness.js';
import { metricAvailability, metricSeries, metricLabel, metricByKey, sourceLabel } from './metrics.js';
import { autoProvenance, ruleChip, ruleLabel, sourceById, sourceWords } from '../trackers/autoLog.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const D1 = '2026-10-20', D2 = '2026-10-21', D3 = '2026-10-22';
const whoopRow = r => ({ recovery: r, strain: 9.4, hrv: 61, rhr: 52, sleep: 7.2 });
const ouraRow = r => ({ recovery: r, stepsOura: 8100, hrv: 48, rhr: 55, sleep: 7.6 });
const frozen = S => JSON.stringify(S);

// ── bands ──────────────────────────────────────────────────────────
eq(WHOOP_RECOVERY_COLOURS, { green: '#16EC06', yellow: '#FFDE00', red: '#FF0026' }, 'the doc’s hexes, unchanged');
eq([100, 67, 66.6, 66, 34, 33.5, 33, 0].map(whoopBand), ['green', 'green', 'green', 'yellow', 'yellow', 'yellow', 'red', 'red'],
  'green ≥ 67, yellow 34–66, red ≤ 33, on the rounded score');
eq(whoopBand(null), null, 'no score → no band');

// ── provider per day ───────────────────────────────────────────────
{
  const S = { whoopConnected: true, vitalsLog: { [D1]: whoopRow(71), [D2]: ouraRow(80), [D3]: { recovery: 50 } } };
  const before = frozen(S);
  eq(recoveryProviderOn(S, D1), 'whoop', 'strain on the row → WHOOP');
  eq(recoveryProviderOn(S, D2), 'oura', 'stepsOura on the row → Oura, even with WHOOP connected now');
  eq(recoveryProviderOn(S, D3), 'whoop', 'no marker → the one connected device');
  eq(recoveryProviderOn(S, '2026-01-01'), null, 'no row → null');
  eq(frozen(S), before, 'reading never writes');
}
eq(recoveryProviderOn({ vitalsLog: { [D1]: { ...whoopRow(70), stepsOura: 9000 } } }, D1), null, 'both markers → null, never a tie-break');
eq(recoveryProviderOn({ whoopConnected: true, ouraConnected: true, vitalsLog: { [D1]: { recovery: 70 } } }, D1), null, 'both connected, no marker → null');
eq(recoveryProviderOn({ vitalsLog: { [D1]: { recovery: 70 } } }, D1), null, 'nothing connected, no marker → null');
eq(recoveryProviderOn({ ouraConnected: true, vitalsLog: { [D1]: { recovery: 70, stepsWhoop: 4000 } } }, D1), 'whoop', 'stepsWhoop is a WHOOP marker');

// ── provider for the log ───────────────────────────────────────────
eq(recoveryProvider({ whoopConnected: true, vitalsLog: { [D1]: whoopRow(71), [D2]: whoopRow(40) } }), 'whoop', 'all WHOOP → WHOOP');
eq(recoveryProvider({ ouraConnected: true, vitalsLog: { [D1]: ouraRow(71) } }), 'oura', 'all Oura → Oura');
eq(recoveryProvider({ vitalsLog: { [D1]: whoopRow(71), [D2]: ouraRow(80) } }), null, 'a mix → neutral');
eq(recoveryProvider({ whoopConnected: true, vitalsLog: {} }), 'whoop', 'no scores yet → the connected device');
eq(recoveryProvider({}), null, 'nothing at all → neutral');

eq([recoveryName('whoop'), recoveryName('oura'), recoveryName(null)], ['WHOOP Recovery', 'Oura Readiness', 'Recovery / Readiness'], 'names');
eq([recoveryShort('whoop'), recoveryShort('oura'), recoveryShort(null)], ['Recovery', 'Readiness', 'Score'], 'short names; neutral names neither metric');
eq([providerText('whoop'), providerText('oura'), providerText('both'), providerText(null)], ['WHOOP', 'Oura', 'WHOOP + Oura', null], 'provider as text');

// ── readiness words ────────────────────────────────────────────────
{
  const log = { [D3]: whoopRow(71) };
  const w = readinessFor(log, D3, 30, { provider: 'whoop' });
  eq([w.score, w.state, w.source, w.provider], [71, 'green', 'device', 'whoop'], 'WHOOP score in WHOOP’s band words');
  eq(w.note, 'WHOOP’s own Recovery score, shown as WHOOP reports it.', 'note names WHOOP');
  const o = readinessFor({ [D3]: ouraRow(71) }, D3, 30, { provider: 'oura' });
  eq([o.state, o.provider], ['steady', 'oura'], 'Oura keeps the neutral words — no invented bands');
  eq(o.note, 'Oura’s own Readiness score, shown as Oura reports it.', 'note names Oura');
  const u = readinessFor(log, D3);
  eq(u.note, 'Your device’s own score, shown as it reports it.', 'unknown → names neither');
  eq(u.provider, null, 'and says so');
  eq(readinessFor({ [D3]: { sleep: 7, rhr: 50 } }, D3, 30, { provider: 'whoop' }).provider, null, 'a computed score has no provider');
  eq(readinessFor({ [D3]: whoopRow(20) }, D3, 30, { provider: 'whoop' }).state, 'red', 'red band');
}

// ── metric labels, everywhere they flow ────────────────────────────
{
  const W = { whoopConnected: true, vitalsLog: { [D3]: whoopRow(71) } };
  const O = { ouraConnected: true, vitalsLog: { [D3]: ouraRow(71) } };
  const B = { whoopConnected: true, ouraConnected: true, vitalsLog: { [D2]: whoopRow(60), [D3]: ouraRow(71) } };
  const rec = metricByKey('recovery');
  eq(rec.label, 'Recovery', 'the base definition is untouched');
  eq([metricLabel(rec, W), metricLabel(rec, O), metricLabel(rec, B)], ['WHOOP Recovery', 'Oura Readiness', 'Recovery / Readiness'], 'metricLabel');
  eq(metricAvailability(O).find(m => m.key === 'recovery').label, 'Oura Readiness', 'pickers get the provider’s name');
  eq(metricSeries(W, ['recovery'], 3650)[0].label, 'WHOOP Recovery', 'chart series too');
  eq(metricLabel(metricByKey('weight'), W), 'Weight', 'other metrics unchanged');
  eq([sourceLabel(rec, W), sourceLabel(rec, O), sourceLabel(rec, B)], ['whoop', 'oura', '2 src'], 'tile corner never guesses');
  eq(sourceLabel(metricByKey('strain'), B), 'whoop', 'only WHOOP reports strain');
  eq(sourceLabel(metricByKey('burnKcal'), B), '2 src', 'both report all-day burn');
}

// ── auto-fill words ────────────────────────────────────────────────
{
  const tracker = { id: 't1', name: 'Recovered', type: 'boolean', auto: { source: 'recovery', threshold: 60 } };
  const base = { trackers: [tracker], logs: {}, logsAuto: {} };
  const W = { ...base, whoopConnected: true, vitalsLog: { [D3]: whoopRow(71) }, logs: { [D3]: { t1: true } }, logsAuto: { [D3]: { t1: 'recovery' } } };
  const O = { ...base, ouraConnected: true, vitalsLog: { [D3]: ouraRow(82) }, logs: { [D3]: { t1: true } }, logsAuto: { [D3]: { t1: 'recovery' } } };
  eq(autoProvenance(W, D3, 't1').text, 'WHOOP Recovery: 71 %', 'a WHOOP-filled cell names WHOOP Recovery');
  eq(autoProvenance(O, D3, 't1').text, 'Oura Readiness: 82 %', 'an Oura-filled cell names Oura Readiness');
  const both = { ...W, vitalsLog: { [D3]: { ...whoopRow(71), stepsOura: 5000 } } };
  eq(autoProvenance(both, D3, 't1').text, 'Recovery / Readiness: 71 %', 'ambiguous → neutral');
  eq([ruleChip(tracker, 'whoop'), ruleChip(tracker, 'oura'), ruleChip(tracker)], ['Recovery ≥ 60%', 'Readiness ≥ 60%', 'Score ≥ 60%'], 'chip (neutral names neither metric)');
  eq(ruleLabel(tracker, 'whoop'), 'WHOOP Recovery at or above 60%', 'rule sentence');
  eq(sourceWords(sourceById('sleep'), 'whoop'), sourceById('sleep'), 'other sources untouched');
  eq(sourceById('recovery').id, 'recovery', 'the stored source id is unchanged');
}

console.log(`recoverySource: ${n} checks passed`);
