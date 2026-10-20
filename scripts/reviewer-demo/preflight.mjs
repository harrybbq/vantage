#!/usr/bin/env node
/**
 * Before every store submission: run public.review_preflight()
 * (supabase/reviewer_access_2026_10.sql) and print its checks —
 * config.pro_live, the reviewer list, each demo account's age, tier,
 * privacy switches and seeded data, and whether the Apple revocation
 * table exists. Same output as `select * from public.review_preflight();`
 * in the SQL editor, for when a terminal is handier.
 *
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/reviewer-demo/preflight.mjs
 *
 * Read-only. The service key is read from the environment at run time
 * and never printed. Exit code 1 when any check fails.
 *
 * Netlify env can't be read from here; check by hand in Netlify →
 * Site configuration → Environment variables (names in
 * docs/REVIEWER_KIT.md, "Before every submission").
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sbKeys = require('../../netlify/lib/sbKeys.js');

const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = sbKeys.serviceKey(process.env);
if (!url || !key) {
  console.error('set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) for this run');
  process.exit(2);
}

const res = await fetch(`${url}/rest/v1/rpc/review_preflight`, {
  method: 'POST',
  headers: sbKeys.serviceKeyHeaders(key, { 'Content-Type': 'application/json' }),
  body: '{}',
});
if (res.status === 404) {
  console.error('review_preflight() not found — run supabase/reviewer_access_2026_10.sql first');
  process.exit(1);
}
if (!res.ok) {
  console.error(`preflight failed (${res.status})`);
  process.exit(1);
}
const rows = await res.json();
let failed = 0;
for (const r of rows) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.check_name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(failed ? `\n${failed} check(s) to fix before submitting.` : '\nAll checks pass.');
process.exit(failed ? 1 : 0);
