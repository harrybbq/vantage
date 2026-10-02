/**
 * Shaping upstream answers for the Security console: traffic series,
 * advisor lints, Netlify site/deploys (projection — no secrets leak),
 * web-vitals p75, and beacon validation.
 *
 * Run: npm run check:secshape   (also part of npm run build)
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const tmp = join(tmpdir(), `securityShape.${process.pid}.cjs`);
writeFileSync(tmp, readFileSync(new URL('./securityShape.js', import.meta.url)));
let lib;
try { lib = require(tmp); } finally { try { unlinkSync(tmp); } catch { /* best effort */ } }
const {
  projectRefFromUrl, toIso, shapeApiCounts, shapeLints, shapeDeploy, shapeSite, shapeFunctions,
  percentile, summariseVitals, shapeVitalsRow, cleanPath, apiCountsError, verdictOf, netlifyLinks,
} = lib;

const failures = [];
let checked = 0;
const expect = (label, got, want) => {
  checked++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) failures.push(`${label}: got ${g}, want ${w}`);
};

// ── project ref ──
expect('ref', projectRefFromUrl('https://abcdefghijklmnopqrst.supabase.co'), 'abcdefghijklmnopqrst');
expect('ref trailing path', projectRefFromUrl('https://abcdefghijklmnopqrst.supabase.co/rest/v1'), 'abcdefghijklmnopqrst');
expect('ref custom domain', projectRefFromUrl('https://db.example.com'), null);
expect('ref junk', projectRefFromUrl('not a url'), null);
expect('ref undefined', projectRefFromUrl(undefined), null);

// ── timestamps ──
expect('iso string', toIso('2026-10-01T12:00:00.000Z'), '2026-10-01T12:00:00.000Z');
expect('iso no zone = UTC', toIso('2026-10-01 12:00:00'), '2026-10-01T12:00:00.000Z');
expect('iso micros', toIso(1759320000000000), '2025-10-01T12:00:00.000Z');
expect('iso millis', toIso(1759320000000), '2025-10-01T12:00:00.000Z');
expect('iso seconds', toIso(1759320000), '2025-10-01T12:00:00.000Z');
expect('iso junk', toIso('yesterday-ish'), null);

// ── traffic ──
const counts = {
  result: [
    { timestamp: '2026-10-01T13:00:00Z', total_rest_requests: 30, total_auth_requests: 4, total_storage_requests: 2, total_realtime_requests: 1 },
    { timestamp: '2026-10-01T12:00:00Z', total_rest_requests: 10, total_auth_requests: 1, total_storage_requests: 0, total_realtime_requests: 0 },
    { timestamp: null, total_rest_requests: 999 },
    { timestamp: '2026-10-01T14:00:00Z', total_rest_requests: -5, total_auth_requests: 'x' },
  ],
};
const tr = shapeApiCounts(counts, '1day');
expect('traffic window', tr.windowHours, 24);
expect('traffic sorted, nulls dropped, junk zeroed', tr.series, [
  { t: '2026-10-01T12:00:00.000Z', rest: 10, auth: 1, storage: 0, realtime: 0 },
  { t: '2026-10-01T13:00:00.000Z', rest: 30, auth: 4, storage: 2, realtime: 1 },
  { t: '2026-10-01T14:00:00.000Z', rest: 0, auth: 0, storage: 0, realtime: 0 },
]);
expect('traffic totals', tr.totals, { rest: 40, auth: 5, storage: 2, realtime: 1, all: 48 });
expect('traffic 7day', shapeApiCounts({ result: [] }, '7day').windowHours, 168);
expect('traffic empty body', shapeApiCounts(null).series, []);

// ── advisors ──
const lints = shapeLints({
  lints: [
    { name: 'unindexed_foreign_keys', title: 'Unindexed foreign keys', level: 'INFO', facing: 'EXTERNAL', categories: ['PERFORMANCE'], description: 'd', detail: 'Table x', remediation: 'https://supabase.com/docs/guides/database/database-linter?lint=0001', cache_key: 'k1', metadata: { schema: 'public' } },
    { name: 'rls_disabled_in_public', title: 'RLS Disabled in Public', level: 'ERROR', categories: ['SECURITY'], detail: 'Table public.t', remediation: 'https://x/0013' },
    { name: 'function_search_path_mutable', title: 'Function Search Path Mutable', level: 'WARN', categories: ['SECURITY'], detail: 'fn' },
  ],
});
expect('lints sorted by level', lints.map(l => l.level), ['ERROR', 'WARN', 'INFO']);
expect('lint projection', lints[0], {
  level: 'ERROR', title: 'RLS Disabled in Public', detail: 'Table public.t', remediation: 'https://x/0013',
  name: 'rls_disabled_in_public', categories: ['SECURITY'], cache_key: null, metadata: null, observed_at: null,
});
expect('lint passes cache_key + metadata', [lints[2].cache_key, lints[2].metadata], ['k1', { schema: 'public' }]);
expect('lint metadata flattened', shapeLints([{ level: 'INFO', title: 't', metadata: { a: { deep: 1 }, b: 'x'.repeat(500), c: 3 } }])[0].metadata,
  { b: 'x'.repeat(200), c: 3 });
expect('lints bare array', shapeLints([{ level: 'warn', title: 't' }])[0].level, 'WARN');
expect('lints junk', shapeLints({ nope: 1 }), []);
expect('lints capped', shapeLints({ lints: Array.from({ length: 250 }, () => ({ level: 'INFO', title: 'x' })) }).length, 150);

// ── usage.api-counts error on a 200 ──
expect('api error none', apiCountsError({ result: [], error: null }), null);
expect('api error string', apiCountsError({ error: 'boom' }), 'boom');
expect('api error object', apiCountsError({ error: { code: 500, errors: [], message: 'Query failed', status: 'x' } }), 'Query failed');

// ── overview verdict ──
expect('verdict operational', verdictOf({ db: 'ok', netlify: 'not_configured', app: 'ok' }, { criticalTickets: 0, advisorsError: null }),
  { verdict: 'operational', issues: 0 });
expect('verdict degraded', verdictOf({ db: 'ok', netlify: 'degraded', app: 'ok' }, { criticalTickets: 1, advisorsError: 1 }),
  { verdict: 'degraded', issues: 3 });
expect('verdict down', verdictOf({ db: 'down', netlify: 'ok', app: 'down' }, {}), { verdict: 'down', issues: 2 });

// ── Netlify links (no API for observability) ──
expect('links', netlifyLinks('vantagevision'), {
  dashboard: 'https://app.netlify.com/sites/vantagevision',
  deploys: 'https://app.netlify.com/sites/vantagevision/deploys',
  functions: 'https://app.netlify.com/sites/vantagevision/logs/functions',
  observability: 'https://app.netlify.com/sites/vantagevision/observability',
  webSecurity: 'https://app.netlify.com/sites/vantagevision/security',
});
expect('links refuse junk', [netlifyLinks('../evil'), netlifyLinks(''), netlifyLinks(undefined)], [null, null, null]);

// ── Netlify site: projection only, secrets never pass ──
const site = {
  id: 's1', name: 'vantagevision', url: 'http://vantagevision.netlify.app', ssl_url: 'https://vantagevision.netlify.app',
  admin_url: 'https://app.netlify.com/sites/vantagevision', state: 'current', password: 'hunter2',
  default_hooks_data: { access_token: 'SECRET-HOOK' },
  build_settings: { env: { SUPABASE_SERVICE_ROLE_KEY: 'SECRET-ENV' }, repo_url: 'x' },
  published_deploy: {
    id: 'd1', state: 'ready', branch: 'master', commit_ref: 'abc123', published_at: '2026-10-01T10:05:00Z',
    function_schedules: [{ name: 'push-dispatch', cron: '* * * * *' }],
  },
};
const shaped = shapeSite(site);
expect('site', shaped, {
  name: 'vantagevision', url: 'https://vantagevision.netlify.app', adminUrl: 'https://app.netlify.com/sites/vantagevision',
  state: 'current', publishedAt: '2026-10-01T10:05:00Z', branch: 'master', commit: 'abc123', deployId: 'd1',
});
expect('no secret survives', /SECRET|hunter2/.test(JSON.stringify({ shaped, f: shapeFunctions(site) })), false);
expect('functions from schedules', shapeFunctions(site).names, ['push-dispatch']);
expect('functions from available_functions', shapeFunctions({ published_deploy: { available_functions: [{ n: 'health' }, { n: 'b' }] } }),
  { count: 2, names: ['b', 'health'], basis: 'deploy' });
expect('functions unknown', shapeFunctions({}), { count: null, names: [], basis: null });

// ── deploys ──
expect('deploy derived time', shapeDeploy({
  id: 'd1', state: 'ready', created_at: '2026-10-01T10:00:00Z', published_at: '2026-10-01T10:02:30Z',
  branch: 'master', commit_ref: 'abc', title: 'Merge #220', error_message: null, context: 'production',
}), {
  id: 'd1', state: 'ready', createdAt: '2026-10-01T10:00:00Z', publishedAt: '2026-10-01T10:02:30Z', deployTimeSec: 150,
  branch: 'master', commit: 'abc', commitUrl: null, title: 'Merge #220', errorMessage: null, context: 'production',
});
expect('deploy_time wins', shapeDeploy({ deploy_time: 77, created_at: '2026-10-01T10:00:00Z' }).deployTimeSec, 77);
expect('failed deploy uses updated_at', shapeDeploy({ state: 'error', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:40Z', error_message: 'Build script returned non-zero exit code: 2' }).deployTimeSec, 40);
expect('building deploy has no time', shapeDeploy({ state: 'building', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:40Z' }).deployTimeSec, null);

// ── percentile (matches Postgres percentile_cont) ──
expect('p75 1..4', percentile([4, 1, 3, 2], 0.75), 3.25);
expect('p75 one', percentile([7], 0.75), 7);
expect('p75 none', percentile([], 0.75), null);
expect('p75 ignores NaN', percentile([NaN, 10, 20], 0.5), 15);

// ── vitals summary ──
const rows = [];
for (let i = 1; i <= 40; i++) rows.push({ path: '/', device: 'mobile', lcp: i * 100, inp: i * 10, cls: i / 400, ttfb: i * 20, fcp: i * 50 });
for (let i = 1; i <= 10; i++) rows.push({ path: '/settings', device: 'desktop', lcp: 5000, inp: null, cls: null, ttfb: 100, fcp: 900 });
const sv = summariseVitals(rows, { windowDays: 7 });
expect('samples', sv.samples, 50);
// 100..4000 step 100, then ten 5000s: index 49 × 0.75 = 36.75 → 3700 + 0.75 × 100
expect('p75 lcp', sv.p75.lcp, 3775);
// inp only from the 40 non-null rows (10..400): index 29.25 → 300 + 0.25 × 10
expect('p75 inp ignores nulls', sv.p75.inp, 303);
expect('rating lcp', sv.ratings.lcp, 'needs-improvement');
expect('rating inp', sv.ratings.inp, 'needs-improvement');
expect('rating ttfb good', sv.ratings.ttfb, 'good');
expect('byPage order', sv.byPage.map(p => [p.path, p.samples]), [['/', 40], ['/settings', 10]]);
expect('byPage p75 lcp', sv.byPage[1].p75.lcp, 5000);
expect('byDevice', Object.keys(sv.byDevice), ['mobile', 'desktop']);
expect('thresholds present', sv.thresholds.lcp, [2500, 4000]);
expect('empty vitals', summariseVitals([]).p75, { lcp: null, inp: null, cls: null, ttfb: null, fcp: null });

// ── beacon validation ──
expect('row ok', shapeVitalsRow({ path: '/hub?x=1#y', lcp: 1200, inp: 90, cls: 0.05, ttfb: 200, fcp: 800, nav: 'navigate', device: 'mobile', userId: 'u1', email: 'a@b.c' }),
  { path: '/hub', lcp: 1200, inp: 90, cls: 0.05, ttfb: 200, fcp: 800, nav_type: 'navigate', device: 'mobile' });
expect('row back_forward', shapeVitalsRow({ path: '/', lcp: 1, nav: 'back_forward' }).nav_type, 'back-forward');
expect('row bad nav/device', shapeVitalsRow({ path: '/', lcp: 1, nav: '<script>', device: 'fridge' }), { path: '/', lcp: 1, inp: null, cls: null, ttfb: null, fcp: null, nav_type: null, device: null });
expect('row out of range', shapeVitalsRow({ path: '/', lcp: 1e9, cls: -1, fcp: 'abc' }), null);
expect('row no path', shapeVitalsRow({ lcp: 100 }), null);
expect('row absolute url refused', shapeVitalsRow({ path: 'https://evil.example/', lcp: 100 }), null);
expect('row array', shapeVitalsRow([1, 2]), null);
expect('path ids collapsed', cleanPath('/u/5f0c9a3e-1b2c-4d5e-8f90-123456789abc/x/123456'), '/u/:id/x/:id');
expect('path odd chars stripped', cleanPath('/a b/<c>'), '/ab/c');

if (failures.length) {
  console.error(`check:secshape — ${failures.length} of ${checked} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check:secshape — ${checked} checks passed`);
