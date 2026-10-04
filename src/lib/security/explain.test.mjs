/**
 * Alerts that explain themselves: every ticket kind gets a headline
 * with its numbers, a why, 2–4 steps and a source; unknown kinds still
 * read as words, never JSON; the server's copy of the headlines
 * (netlify/lib/alertText.js) says exactly the same; deep links parse.
 *
 * Run: npm run check:alerts   (also part of npm run build)
 */
import { createRequire } from 'node:module';
import { explain, ticketHeadline, genericFacts, humanKey, fmtWait } from './explain.js';
import { parseSecurityLink, stripSecurityParams } from './deepLink.js';
import { normaliseTicket } from './status.js';

const require = createRequire(import.meta.url);
const { headlineFor } = require('../../../netlify/lib/alertText.js');

const failures = [];
let checked = 0;
const expect = (label, got, want) => {
  checked++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) failures.push(`${label}: got ${g}, want ${w}`);
};
const ok = (label, cond) => { checked++; if (!cond) failures.push(label); };

const NOW = Date.parse('2026-10-04T12:00:00Z');
const LINKS = {
  netlifySite: 'example-site',
  netlify: { deploys: 'https://app.netlify.com/sites/example-site/deploys' },
  supabase: {
    project: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst',
    reports: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst/reports/database',
    advisors: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst/advisors/security',
    tableEditor: 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst/editor',
  },
};
const tk = (kind, detail, extra = {}) => ({
  ...normaliseTicket({ id: 't1', kind, severity: 'high', title: extra.title || `Title for ${kind}`, detail, status: 'open', source: extra.source || 'auto', created_at: '2026-10-04T10:00:00Z' }),
  raw: extra.raw || {},
});

// One sample per auto kind (the details sweepRules.js writes).
const SAMPLES = {
  db_unreachable: { message: 'The REST endpoint did not answer the health ping.' },
  db_slow: { ms: 2400, thresholdMs: 1500 },
  db_disk: { usedPct: 86.4, thresholdPct: 80 },
  db_connections: { used: 68, max: 80, thresholdPct: 80 },
  advisor_error: { name: 'rls_disabled_in_public', detail: 'Table `public.x` is public, but RLS has not been enabled.', remediation: 'https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public' },
  client_errors_spike: { lastHour: 42, trailingHourlyAvg: 3 },
  reports_stale: { count: 12, oldestAt: '2026-10-01T12:00:00Z' },
  deploy_failed: { deployId: '66ff0a1b2c3d4e5f60718293', branch: 'master', error: 'Build script returned non-zero exit code: 2', createdAt: '2026-10-04T11:40:00Z' },
  vitals_lcp_poor: { lcpP75Ms: 4600, samples: 380, thresholdMs: 4000 },
  ai_cap_repeat: { userId: '99999999-8888-4777-8666-555555555555', bucket: 'food_detect', days: 3, cap: 20 },
};

// ── every kind: headline, why, 2–4 steps, a source; server parity ──
for (const [kind, detail] of Object.entries(SAMPLES)) {
  const e = explain(tk(kind, detail), { links: LINKS, now: NOW });
  ok(`${kind}: headline`, typeof e.headline === 'string' && e.headline.length > 20 && !e.headline.includes('undefined') && !e.headline.includes('NaN'));
  ok(`${kind}: why`, typeof e.why === 'string' && e.why.length > 10);
  ok(`${kind}: 2–4 steps`, e.steps.length >= 2 && e.steps.length <= 4);
  ok(`${kind}: source`, e.source && (e.source.tab || e.source.href || e.source.inline));
  ok(`${kind}: facts are words`, e.facts.length > 0 && e.facts.every(f => typeof f.value === 'string' && !/^[[{]/.test(f.value)));
  expect(`${kind}: server headline matches`, headlineFor(kind, detail, { now: NOW }), e.headline);
}

// ── the numbers land in the headline ──
const H = (kind, d) => explain(tk(kind, d), { links: LINKS, now: NOW }).headline;
expect('db_slow', H('db_slow', SAMPLES.db_slow), 'The database took 2.4 s to answer — normal is under 300 ms');
expect('db_disk', H('db_disk', SAMPLES.db_disk), 'The database disk is 86% full — writes stop when it fills');
expect('db_connections', H('db_connections', SAMPLES.db_connections), '68 of 80 database connections are in use — new requests will queue');
expect('spike', H('client_errors_spike', SAMPLES.client_errors_spike), '42 app errors in the last hour — about 14× the usual 3/h');
expect('spike from zero', H('client_errors_spike', { lastHour: 12, trailingHourlyAvg: 0 }), '12 app errors in the last hour — usually there are none');
expect('stale', H('reports_stale', SAMPLES.reports_stale), '12 user reports waiting over a day — the oldest for 3 days');
expect('stale one', H('reports_stale', { count: 1, oldestAt: '2026-10-03T06:00:00Z' }), '1 user report waiting over a day — the oldest for 30 h');
expect('lcp', H('vitals_lcp_poor', SAMPLES.vitals_lcp_poor), '1 in 4 page loads takes 4.6 s or longer to show its main content — good is under 2.5 s');
expect('ai cap', H('ai_cap_repeat', SAMPLES.ai_cap_repeat), 'One account hit the daily food detect cap on 3 of the last 3 days');
expect('advisor', H('advisor_error', SAMPLES.advisor_error), 'Supabase’s security advisor flags an error: rls disabled in public');
expect('missing numbers read as dashes', H('db_disk', {}), 'The database disk is —% full — writes stop when it fills');

// ── sources ──
const S = (kind, d, links = LINKS) => explain(tk(kind, d), { links, now: NOW }).source;
expect('disk source', [S('db_disk', SAMPLES.db_disk).tab, S('db_disk', SAMPLES.db_disk).focus], ['database', 'disk']);
expect('connections focus', S('db_connections', SAMPLES.db_connections).focus, 'connections');
expect('advisor focus + fix guide', [S('advisor_error', SAMPLES.advisor_error).focus, S('advisor_error', SAMPLES.advisor_error).href],
  ['advisor:rls_disabled_in_public', SAMPLES.advisor_error.remediation]);
expect('advisor without https guide → advisors page', S('advisor_error', { name: 'x', remediation: 'javascript:alert(1)' }).href, LINKS.supabase.advisors);
expect('deploy log url', S('deploy_failed', SAMPLES.deploy_failed).href, 'https://app.netlify.com/sites/example-site/deploys/66ff0a1b2c3d4e5f60718293');
expect('deploy focus', S('deploy_failed', SAMPLES.deploy_failed).focus, 'deploy:66ff0a1b2c3d4e5f60718293');
expect('deploy log needs the site name', S('deploy_failed', SAMPLES.deploy_failed, null).href, null);
expect('deploy log refuses odd ids', S('deploy_failed', { deployId: '../../x' }).href, null);
expect('stale source', [S('reports_stale', SAMPLES.reports_stale).tab, S('reports_stale', SAMPLES.reports_stale).focus], ['moderation', 'stale']);
expect('spike is inline', S('client_errors_spike', SAMPLES.client_errors_spike).inline, 'errors');
expect('lcp source', S('vitals_lcp_poor', SAMPLES.vitals_lcp_poor).focus, 'vitals');
expect('db reports link', S('db_slow', SAMPLES.db_slow).href, LINKS.supabase.reports);
expect('no links → no href', S('db_slow', SAMPLES.db_slow, null).href, null);

// ── user + owner + unknown ──
const user = explain(tk('user:bug', { text: 'The macro ring shows NaN after I log a meal.', category: 'bug', page: '/track', release: 'index-ab12.js' },
  { title: 'Macro ring says NaN', source: 'user', raw: { reporter: { handle: 'finlay', name: 'Finlay' } } }), { now: NOW });
expect('user headline is their title', user.headline, 'Macro ring says NaN');
expect('user: title kept as the row line', user.useHeadline, false);
const uf = Object.fromEntries(user.facts.map(f => [f.label, f.value]));
expect('user facts', [uf['Their words'], uf['Reported by'], uf.Category, uf.Page, uf['App build']],
  ['The macro ring shows NaN after I log a meal.', '@finlay (Finlay)', 'Bug', '/track', 'index-ab12.js']);
expect('user: reporter gone', Object.fromEntries(explain(tk('user:other', { text: 'x' }, { title: 'Hi', source: 'user' })).facts.map(f => [f.label, f.value]))['Reported by'], 'Unknown (account deleted)');
expect('user server line is generic', headlineFor('user:bug', { text: 'private words' }), 'A user reported a bug problem');
ok('user server line has no user text', !headlineFor('user:privacy', { text: 'my email is a@b.c' }).includes('a@b.c'));
const own = explain(tk('manual', { text: 'Rotate the Netlify token before 1 Nov' }, { title: 'Rotate token', source: 'owner' }));
expect('owner ticket', [own.headline, own.facts[0].value], ['Rotate token', 'Rotate the Netlify token before 1 Nov']);
const unk = explain(tk('something_new', { queueDepth: 42, lastRunAt: '2026-10-04T11:00:00Z', nested: { a: 1, b: 'two' }, list: [1, 2, 3], latencyMs: 2300, okFlag: true }, { title: 'Queue backed up' }), { now: NOW });
expect('unknown: title', unk.headline, 'Queue backed up');
expect('unknown: labels', unk.facts.map(f => f.label), ['Queue depth', 'Last run at', 'Nested', 'List', 'Latency ms', 'Ok flag']);
expect('unknown: values', unk.facts.map(f => f.value).filter((v, i) => i !== 1), ['42', 'a: 1 · b: two', '1, 2, 3', '2.3 s', 'yes']);
ok('unknown: time is relative + exact', / · /.test(unk.facts[1].value));
ok('unknown: never raw JSON', unk.facts.every(f => !/[{}"]/.test(f.value)));
expect('unknown: string detail', genericFacts('just words'), [{ label: 'Detail', value: 'just words', wide: true }]);
expect('unknown: null detail', explain(tk('mystery', null)).facts, []);
ok('unknown: still has steps', unk.steps.length >= 2);
expect('row headline: auto uses headline', ticketHeadline(tk('db_disk', SAMPLES.db_disk)), 'The database disk is 86% full — writes stop when it fills');
expect('row headline: user keeps title', ticketHeadline(tk('user:bug', {}, { title: 'Broken', source: 'user' })), 'Broken');
expect('humanKey', [humanKey('trailingHourlyAvg'), humanKey('oldest_at'), humanKey('x')], ['Trailing hourly avg', 'Oldest at', 'X']);
expect('fmtWait', [fmtWait(5 * 3600e3), fmtWait(30 * 3600e3), fmtWait(73 * 3600e3), fmtWait(null)], ['5 h', '30 h', '3 days', null]);

// ── deep links ──
const ID = '11111111-2222-4333-8444-555555555555';
expect('link: ticket', parseSecurityLink(`?upgrade=security&ticket=${ID}`), { tab: 'tickets', focus: `ticket:${ID}` });
expect('link: short form', parseSecurityLink(`?sec=tickets&ticket=${ID.toUpperCase()}`), { tab: 'tickets', focus: `ticket:${ID}` });
expect('link: tab', parseSecurityLink('?upgrade=security&sec=database'), { tab: 'database', focus: null });
expect('link: overview default', parseSecurityLink('?upgrade=security'), { tab: 'overview', focus: null });
expect('link: bad tab', parseSecurityLink('?upgrade=security&sec=../../x'), { tab: 'overview', focus: null });
expect('link: bad ticket', parseSecurityLink('?upgrade=security&ticket=<script>'), { tab: 'overview', focus: null });
expect('link: other upgrade section', parseSecurityLink('?upgrade=diet'), null);
expect('link: none', parseSecurityLink('?whoop=connected'), null);
expect('link: empty', parseSecurityLink(''), null);
expect('strip', stripSecurityParams(`https://app.example/?upgrade=security&ticket=${ID}&x=1#h`), '/?x=1#h');
expect('strip all', stripSecurityParams(`https://app.example/?upgrade=security&ticket=${ID}`), '/');

if (failures.length) {
  console.error(`check:alerts (explain) — ${failures.length} of ${checked} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check:alerts (explain) — ${checked} checks passed`);
