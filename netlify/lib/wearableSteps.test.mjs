/**
 * Steps arriving from WHOOP (Cycle.step_count, added 2026-09-23) and
 * Oura (daily_activity.steps) land on the vitals row under their own
 * keys, and nothing else in the mapping changes.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mapWhoop } = require('./whoop.js');
const { mapOura } = require('./oura.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// WHOOP
{
  const { vitals } = mapWhoop({ cycles: [
    { start: '2026-10-05T23:10:00Z', score: { strain: 11.2, kilojoule: 9000 }, step_count: 8234 },
    { start: '2026-10-04T23:00:00Z', score: { strain: 9 }, step_count: null },
    { start: '2026-10-03T23:00:00Z', score: { strain: 9, step_count: 4100 } },
    { start: '2026-10-02T23:00:00Z', score: {}, step_count: 0 },
  ] });
  eq(vitals['2026-10-05'].stepsWhoop, 8234, 'top-level step_count is read');
  eq(vitals['2026-10-05'].strain, 11.2, 'strain unchanged alongside it');
  eq('stepsWhoop' in vitals['2026-10-04'], false, 'null (band not worn all day) writes nothing');
  eq(vitals['2026-10-03'].stepsWhoop, 4100, 'a count inside score is read as a fallback');
  eq(!!(vitals['2026-10-02'] && 'stepsWhoop' in vitals['2026-10-02']), false, 'zero writes nothing');
}

// Oura
{
  const { vitals } = mapOura({ activity: [
    { day: '2026-10-05', total_calories: 2400, steps: 9050 },
    { day: '2026-10-04', total_calories: 2100, steps: 0 },
    { day: '2026-10-03', total_calories: 2000 },
  ] });
  eq(vitals['2026-10-05'], { burnKcal: 2400, stepsOura: 9050 }, 'steps sit beside calories');
  eq(vitals['2026-10-04'], { burnKcal: 2100 }, 'zero steps writes nothing');
  eq(vitals['2026-10-03'], { burnKcal: 2000 }, 'no steps field writes nothing');
}

console.log(`wearable steps: ${n} checks passed`);
