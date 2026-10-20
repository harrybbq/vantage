// AI coach red-team, live-model layer (item 105, DPIA G15). OWNER-RUN.
//
//   ANTHROPIC_API_KEY=... node scripts/coach-redteam/live.mjs
//   ANTHROPIC_API_KEY=... node scripts/coach-redteam/live.mjs --only ed-low-calorie-tracker,relapse-gambling
//   ANTHROPIC_API_KEY=... node scripts/coach-redteam/live.mjs --repeat 3
//
// Never part of the build. Without ANTHROPIC_API_KEY it prints a skip line
// and exits 0. The key is read from the environment and never printed.
//
// Each case in cases.mjs (invented data only) runs twice against the
// production model, through the production code:
//   production  buildSnapshot → prepareBrief → callModel → finaliseBrief,
//               exactly what a user would see (self-harm cases make no call);
//   prompt-only the same, with the pre-checks and policy switched off, so
//               the record shows whether the system prompt ALONE holds for
//               anything the pre-checks might miss.
// Both are scored with checkBriefPolicy for the case's expected modes.
// Results go into docs/COACH_REDTEAM_RESULTS.md between the LIVE markers
// (replacing the previous live run). Exit 1 if any production-path case
// fails the policy — that is a bug to fix before launch; prompt-only
// failures are a record, not a gate.
//
// Cost: ~70 short Haiku calls per pass (a few pence).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.log('coach red-team live: skipped (ANTHROPIC_API_KEY is not set). Deterministic layer: node scripts/coach-redteam/redteam.test.mjs');
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const coach = require('../../netlify/lib/coachPrompt.js');
const safety = require('../../netlify/lib/coachSafety.js');
const { CASES } = await import('./cases.mjs');
const { buildSnapshot } = await import('../../src/lib/coach/snapshot.js');

const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const only = (arg('--only') || '').split(',').filter(Boolean);
const repeat = Math.max(1, Math.min(5, Number(arg('--repeat')) || 1));
const cases = only.length ? CASES.filter(c => only.includes(c.id)) : CASES;

const clip = (s, n = 140) => String(s || '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, n);

async function runOnce(c, mode) {
  const snapshot = buildSnapshot(c.state());
  const opts = mode === 'prompt-only' ? { apiKey, safety: false } : { apiKey };
  try {
    const r = await coach.generateBrief(snapshot, opts);
    if (!r.brief) return { ok: false, violations: ['too-large'], called: r.called };
    const check = safety.checkBriefPolicy(r.brief, c.expect.modes);
    return { ok: check.ok, violations: check.violations, called: r.called, brief: r.brief };
  } catch (e) {
    return { ok: false, violations: [`error: ${clip(e.message, 60)}`], called: true };
  }
}

const rows = [];
let prodFails = 0, promptFails = 0;
for (const c of cases) {
  for (let k = 0; k < repeat; k++) {
    const prod = await runOnce(c, 'production');
    const bare = await runOnce(c, 'prompt-only');
    if (!prod.ok) prodFails++;
    if (!bare.ok) promptFails++;
    rows.push({ c, k, prod, bare });
    console.log(`${prod.ok ? 'pass' : 'FAIL'} / ${bare.ok ? 'pass' : 'fail'}  ${c.id}${repeat > 1 ? ` #${k + 1}` : ''}`
      + (prod.ok ? '' : `  production: ${prod.violations.join(', ')}`)
      + (bare.ok ? '' : `  prompt-only: ${bare.violations.join(', ')}`));
  }
}

const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const show = r => (r.ok ? 'pass' : `**fail** (${r.violations.join(', ')})`);
const out = [
  '<!-- LIVE:START — written by scripts/coach-redteam/live.mjs; do not edit by hand -->',
  `### Live run — ${stamp}`,
  '',
  `Model \`${coach.MODEL}\`, ${cases.length} case(s) × ${repeat}. Production path: **${rows.length - prodFails}/${rows.length} pass**. Prompt alone (pre-checks off): ${rows.length - promptFails}/${rows.length} pass.`,
  '',
  'Production "pass" with "replaced" means the model broke the policy and the fixed brief was shown instead: safe for the user, but worth reading the prompt-only column for why.',
  '',
  '| Case | Expected modes | Production | Model called | Model reply replaced | Prompt only | What the user saw (production) |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(({ c, k, prod, bare }) => `| \`${c.id}\`${repeat > 1 ? ` #${k + 1}` : ''} | ${c.expect.modes.join(', ') || '—'} | ${show(prod)} | ${prod.called ? 'yes' : 'no'} | ${prod.brief && prod.brief.policy_fallback ? 'replaced' : '—'} | ${show(bare)} | ${prod.brief ? clip(`${prod.brief.focus} / ${prod.brief.watch} / ${prod.brief.micro}`, 220) : '—'} |`),
  '',
  '<!-- LIVE:END -->',
].join('\n');

const docPath = path.join(here, '../../docs/COACH_REDTEAM_RESULTS.md');
let doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '# AI coach red-team results\n\n';
const a = doc.indexOf('<!-- LIVE:START');
const b = doc.indexOf('<!-- LIVE:END -->');
doc = a >= 0 && b > a ? doc.slice(0, a) + out + doc.slice(b + '<!-- LIVE:END -->'.length) : doc.trimEnd() + '\n\n' + out + '\n';
fs.writeFileSync(docPath, doc);

console.log(`\nproduction ${rows.length - prodFails}/${rows.length} pass; prompt-only ${rows.length - promptFails}/${rows.length} pass. Written to docs/COACH_REDTEAM_RESULTS.md`);
process.exit(prodFails ? 1 : 0);
