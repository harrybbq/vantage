/**
 * The auto-raise rules: which readings raise which tickets, under which
 * fingerprint, and that "could not check" never raises anything.
 *
 * Run: npm run check:secsweep   (also part of npm run build)
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const tmp = join(tmpdir(), `sweepRules.${process.pid}.cjs`);
writeFileSync(tmp, readFileSync(new URL('./sweepRules.js', import.meta.url)));
let lib;
try { lib = require(tmp); } finally { try { unlinkSync(tmp); } catch { /* best effort */ } }
const { evaluateConditions, repeatCapHits, fingerprint } = lib;

const failures = [];
let checked = 0;
const expect = (label, got, want) => {
  checked++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) failures.push(`${label}: got ${g}, want ${w}`);
};
const fps = r => evaluateConditions(r).map(c => c.fingerprint);
const sev = r => evaluateConditions(r).map(c => c.severity);

// ── fingerprints: stable, safe, no time in them ──
expect('fp basic', fingerprint('db', 'slow'), 'db:slow');
expect('fp cleans', fingerprint('Advisor', 'RLS Disabled in Public!'), 'advisor:rls-disabled-in-public');
expect('fp drops empties', fingerprint('x', null, '', 'y'), 'x:y');
expect('fp capped', fingerprint('k', 'a'.repeat(500)).length, 200);

// ── nothing known → nothing raised ──
expect('empty readings', evaluateConditions({}), []);
expect('nulls everywhere', evaluateConditions({ db: null, diskUsedPct: null, connections: null, errors: null, vitals: null, latestDeploy: null }), []);
expect('healthy', evaluateConditions({
  db: { reachable: true, ms: 120 }, diskUsedPct: 42, connections: { used: 20, max: 60 },
  advisorErrors: [], errors: { lastHour: 2, prev24h: 48 }, staleReports: { count: 0 },
  latestDeploy: { id: 'd1', state: 'ready' }, vitals: { lcpP75: 2100, samples: 300 }, aiCaps: [],
}), []);

// ── database ──
expect('db down', fps({ db: { reachable: false, ms: 4000 } }), ['db:unreachable']);
expect('db down is critical', sev({ db: { reachable: false } }), ['critical']);
expect('db slow', fps({ db: { reachable: true, ms: 1501 } }), ['db:slow']);
expect('db at threshold is fine', fps({ db: { reachable: true, ms: 1500 } }), []);
expect('disk 80 fine', fps({ diskUsedPct: 80 }), []);
expect('disk 85 high', [fps({ diskUsedPct: 85 }), sev({ diskUsedPct: 85 })], [['db:disk'], ['high']]);
expect('disk 95 critical', sev({ diskUsedPct: 95 }), ['critical']);
expect('connections 49/60 > 80%', fps({ connections: { used: 49, max: 60 } }), ['db:connections']);
expect('connections 48/60 = 80% fine', fps({ connections: { used: 48, max: 60 } }), []);
expect('connections max 0 ignored', fps({ connections: { used: 5, max: 0 } }), []);

// ── advisors: one ticket per lint ──
expect('advisor errors', fps({ advisorErrors: [{ name: 'rls_disabled_in_public', title: 'RLS Disabled in Public' }, { name: 'security_definer_view', title: 'Security Definer View' }] }),
  ['advisor:rls_disabled_in_public', 'advisor:security_definer_view']);

// ── client error spike: >3× trailing hourly average AND ≥10 ──
expect('spike', fps({ errors: { lastHour: 40, prev24h: 48 } }), ['app:client-errors-spike']);     // avg 2/h
expect('busy but steady', fps({ errors: { lastHour: 40, prev24h: 24 * 20 } }), []);               // avg 20/h, 2×
expect('spike under floor', fps({ errors: { lastHour: 9, prev24h: 0 } }), []);
expect('spike from zero', fps({ errors: { lastHour: 10, prev24h: 0 } }), ['app:client-errors-spike']);
expect('exactly 3× is not a spike', fps({ errors: { lastHour: 30, prev24h: 240 } }), []);

// ── reports ──
expect('stale reports', fps({ staleReports: { count: 3, oldestAt: '2026-09-29T10:00:00Z' } }), ['moderation:stale-reports']);
expect('stale title singular', evaluateConditions({ staleReports: { count: 1 } })[0].title, '1 report open longer than 24 h');

// ── deploy: fingerprint per deploy, so the next failure is a new ticket ──
expect('deploy failed', fps({ latestDeploy: { id: 'abc123', state: 'error', title: 'Merge #221' } }), ['deploy:failed:abc123']);
expect('deploy building', fps({ latestDeploy: { id: 'abc123', state: 'building' } }), []);

// ── vitals ──
expect('lcp poor', fps({ vitals: { lcpP75: 4200, samples: 25 } }), ['vitals:lcp']);
expect('lcp poor, too few samples', fps({ vitals: { lcpP75: 9000, samples: 19 } }), []);
expect('lcp 4 s exactly fine', fps({ vitals: { lcpP75: 4000, samples: 500 } }), []);

// ── AI caps ──
const caps = { coach: 20, 'food-detect': 40 };
const usage = [
  { user_id: 'u1', bucket: 'coach', day: '2026-09-30', n: 21 },
  { user_id: 'u1', bucket: 'coach', day: '2026-10-01', n: 20 },
  { user_id: 'u1', bucket: 'coach', day: '2026-10-02', n: 3 },
  { user_id: 'u2', bucket: 'coach', day: '2026-10-02', n: 25 },          // once
  { user_id: 'u3', bucket: 'food-detect', day: '2026-10-01', n: 39 },    // under
  { user_id: 'u3', bucket: 'food-detect', day: '2026-10-02', n: 40 },
  { user_id: 'u4', bucket: 'unknown', day: '2026-10-01', n: 999 },
  { user_id: 'u4', bucket: 'unknown', day: '2026-10-02', n: 999 },
];
const hits = repeatCapHits(usage, caps);
expect('repeat cap hits', hits, [{ userId: 'u1', bucket: 'coach', cap: 20, days: 2 }]);
expect('ai cap ticket', fps({ aiCaps: hits }), ['ai-cap:u1:coach']);
expect('ai cap low', sev({ aiCaps: hits }), ['low']);

// ── ordering: most severe first ──
expect('ordering', sev({
  aiCaps: hits, vitals: { lcpP75: 5000, samples: 50 }, db: { reachable: false }, latestDeploy: { id: 'x', state: 'error' },
}), ['critical', 'high', 'medium', 'low']);

// ── every candidate is well-formed ──
const all = evaluateConditions({
  db: { reachable: true, ms: 2000 }, diskUsedPct: 91, connections: { used: 59, max: 60 },
  advisorErrors: [{ name: 'a', title: 'A' }], errors: { lastHour: 50, prev24h: 10 }, staleReports: { count: 2 },
  latestDeploy: { id: 'd', state: 'error' }, vitals: { lcpP75: 6000, samples: 99 }, aiCaps: hits,
});
expect('all conditions', all.length, 9);
expect('well-formed', all.every(c => c.fingerprint && c.kind && ['critical', 'high', 'medium', 'low'].includes(c.severity)
  && c.title && c.title.length <= 200 && c.detail && typeof c.detail === 'object'), true);
expect('unique fingerprints', new Set(all.map(c => c.fingerprint)).size, all.length);

if (failures.length) {
  console.error(`check:secsweep — ${failures.length} of ${checked} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check:secsweep — ${checked} checks passed`);
