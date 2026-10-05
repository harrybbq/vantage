/**
 * Critical alerts → the owner's phone: config, the ntfy request shape,
 * the threshold, the per-run cap, and the sweep's notify path end to
 * end with a stubbed fetch (new critical → exactly one ntfy POST; repeat
 * → none; re-opened → one; DB unreachable → one; ping failure → the
 * sweep still completes).
 *
 * Run: npm run check:alerts   (also part of npm run build)
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const N = require('./alertNotify.js');
const { headlineFor } = require('./alertText.js');
const { runSweep, alertFor } = require('./securitySweep.js');

const failures = [];
let checked = 0;
const expect = (label, got, want) => {
  checked++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) failures.push(`${label}: got ${g}, want ${w}`);
};

const TOPIC = 'vantage-test-0123456789abcdef0123';     // a fake, test-only topic
const ENV = { ALERT_NTFY_TOPIC: TOPIC, URL: 'https://app.example' };
const ID = '11111111-2222-4333-8444-555555555555';

// ── config ──
expect('not configured', N.alertConfig({}).configured, false);
expect('configured', N.alertConfig(ENV), { configured: true, channels: ['ntfy'], minSeverity: 'critical', topicInvalid: false, weakTopic: false });
expect('bad topic', N.alertConfig({ ALERT_NTFY_TOPIC: 'has spaces/slash' }).topicInvalid, true);
expect('http server refused', N.alertConfig({ ...ENV, ALERT_NTFY_SERVER: 'http://ntfy.local' }).configured, false);
expect('min high', N.alertConfig({ ...ENV, ALERT_MIN_SEVERITY: 'HIGH' }).minSeverity, 'high');
expect('min junk → critical', N.alertConfig({ ...ENV, ALERT_MIN_SEVERITY: 'low' }).minSeverity, 'critical');
expect('webhook only', N.alertConfig({ ALERT_WEBHOOK_URL: 'https://hooks.example/x' }).channels, ['webhook']);
expect('webhook http refused', N.alertConfig({ ALERT_WEBHOOK_URL: 'http://hooks.example/x' }).configured, false);
expect('config exposes no topic', JSON.stringify(N.alertConfig(ENV)).includes(TOPIC), false);

// ── threshold ──
expect('critical ≥ critical', N.atOrAbove('critical', 'critical'), true);
expect('high < critical', N.atOrAbove('high', 'critical'), false);
expect('high ≥ high', N.atOrAbove('high', 'high'), true);
expect('medium < high', N.atOrAbove('medium', 'high'), false);
expect('junk never', N.atOrAbove('urgent', 'low'), false);

// ── links ──
expect('ticket link', N.ticketLink(ID, ENV), `https://app.example/?upgrade=security&ticket=${ID}`);
expect('no id → overview', N.ticketLink(null, ENV), 'https://app.example/?upgrade=security&sec=overview');
expect('bad id → overview', N.ticketLink('x/../y', ENV), 'https://app.example/?upgrade=security&sec=overview');
expect('APP_URL wins', N.appBase({ APP_URL: 'https://vantage.example/', URL: 'https://other.example' }), 'https://vantage.example');
expect('no base', N.ticketLink(ID, {}), '');

// ── header encoding ──
expect('ascii as-is', N.headerSafe('Database disk 93% full'), 'Database disk 93% full');
expect('non-ascii rfc2047', N.headerSafe('Vantage: café — down'), `=?UTF-8?B?${Buffer.from('Vantage: café — down').toString('base64')}?=`);
expect('newlines flattened', N.headerSafe('a\r\nb'), 'a b');

// ── ntfy request ──
const req = N.buildNtfyRequest({ severity: 'critical', title: 'Database unreachable', headline: headlineFor('db_unreachable', {}), ticketId: ID }, ENV);
expect('ntfy url', req.url, `https://ntfy.sh/${TOPIC}`);
expect('ntfy method', req.init.method, 'POST');
expect('ntfy title', req.init.headers.Title, 'Vantage: Database unreachable');
expect('ntfy priority', req.init.headers.Priority, '5');
expect('ntfy tags', req.init.headers.Tags, 'rotating_light,vantage');
expect('ntfy click', req.init.headers.Click, `https://app.example/?upgrade=security&ticket=${ID}`);
expect('ntfy body is the headline', req.init.body, 'The database isn’t answering — the app can’t load or save');
expect('ntfy no auth by default', 'Authorization' in req.init.headers, false);
const reqTok = N.buildNtfyRequest({ severity: 'high', title: 'x' }, { ...ENV, ALERT_NTFY_TOKEN: 'tk_test', ALERT_NTFY_SERVER: 'https://ntfy.example/' });
expect('ntfy bearer', reqTok.init.headers.Authorization, 'Bearer tk_test');
expect('ntfy self-hosted', reqTok.url, `https://ntfy.example/${TOPIC}`);
expect('ntfy high priority', reqTok.init.headers.Priority, '4');
expect('ntfy not configured', N.buildNtfyRequest({}, {}), null);
const wh = N.buildWebhookRequest({ severity: 'critical', title: 'T', headline: 'H', ticketId: ID }, { ...ENV, ALERT_WEBHOOK_URL: 'https://hooks.example/a' });
expect('webhook body', JSON.parse(wh.init.body), { severity: 'critical', title: 'T', headline: 'H', url: `https://app.example/?upgrade=security&ticket=${ID}` });

// ── a stub fetch that records calls ──
function stub(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, handler] of routes) if (String(url).includes(match)) return handler(String(url), init);
    return new Response('not found', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}
const json = (b, status = 200, headers = {}) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function main() {
  // notifyOwner: below threshold → nothing; forced → sent; failure → never throws
  {
    const f = stub([['ntfy.sh', () => new Response('ok')]]);
    expect('below threshold skipped', (await N.notifyOwner({ severity: 'high', title: 'x' }, { env: ENV, fetchImpl: f })).skipped, 'below_threshold');
    expect('below threshold no call', f.calls.length, 0);
    expect('forced test sent', (await N.notifyOwner({ severity: 'high', title: 'x', test: true }, { env: ENV, fetchImpl: f, force: true })).sent, ['ntfy']);
    expect('test tag', f.calls[0].init.headers.Tags, 'warning,test_tube,vantage');
    const boom = async () => { throw new Error('network down'); };
    expect('throwing fetch → failed, no throw', await N.notifyOwner({ severity: 'critical', title: 'x' }, { env: ENV, fetchImpl: boom }), { sent: [], failed: ['ntfy'] });
    const five = async () => new Response('no', { status: 500 });
    expect('500 → failed', (await N.notifyOwner({ severity: 'critical', title: 'x' }, { env: ENV, fetchImpl: five })).failed, ['ntfy']);
    expect('unconfigured skipped', (await N.notifyOwner({ severity: 'critical' }, { env: {}, fetchImpl: f })).skipped, 'not_configured');
  }

  // createNotifier caps per run
  {
    const f = stub([['ntfy.sh', () => new Response('ok')]]);
    const n = N.createNotifier({ max: 6, env: ENV, fetchImpl: f });
    for (let i = 0; i < 9; i++) n.add({ severity: 'critical', title: `t${i}` });
    const r = await n.flush();
    expect('cap: queued 6', r.queued, 6);
    expect('cap: dropped 3', r.dropped, 3);
    expect('cap: 6 posts', f.calls.length, 6);
  }

  // alertFor (pure)
  const crit = { fingerprint: 'db:disk', kind: 'db_disk', severity: 'critical', title: 'Database disk 93% full', detail: { usedPct: 93 } };
  expect('alertFor new', alertFor(crit, { result: 'ok', row: { id: ID, count: 1 } }, undefined, 'critical').why, 'new');
  expect('alertFor repeat', alertFor(crit, { result: 'ok', row: { id: ID, count: 4 } }, 'open', 'critical'), null);
  expect('alertFor reopened', alertFor(crit, { result: 'ok', row: { id: ID, count: 4 } }, 'resolved', 'critical').why, 'reopened');
  expect('alertFor below threshold', alertFor({ ...crit, severity: 'high' }, { result: 'ok', row: { id: ID, count: 1 } }, undefined, 'critical'), null);
  expect('alertFor write failed (not db) → none', alertFor(crit, { result: 'failed', row: null }, undefined, 'critical'), null);
  expect('alertFor headline', alertFor(crit, { result: 'ok', row: { id: ID, count: 1 } }, undefined, 'critical').alert.headline, 'The database disk is 93% full — writes stop when it fills');

  // ── the sweep's notify path, end to end, with a stubbed fetch ──
  const env = { supabaseUrl: 'https://proj.example', serviceKey: 'service-test' };
  const diskReadings = async () => ({ readings: { db: { reachable: true, ms: 40 }, diskUsedPct: 93 }, skipped: [] });

  async function sweepWith({ rpc, prior = [], gather = diskReadings, ntfy = () => new Response('ok') }) {
    const f = stub([
      ['rpc/security_ticket_raise', rpc],
      ['security_tickets?fingerprint=in.', () => json(prior)],
      ['ntfy.sh', ntfy],
    ]);
    const saved = globalThis.fetch;
    globalThis.fetch = f;         // securityData's REST calls use the global fetch
    try {
      const r = await runSweep(env, { gather, alertEnv: ENV, fetchImpl: f });
      return { r, ntfyCalls: f.calls.filter(c => c.url.includes('ntfy.sh')), calls: f.calls };
    } finally {
      globalThis.fetch = saved;
    }
  }

  {
    const { r, ntfyCalls } = await sweepWith({ rpc: () => json({ id: ID, status: 'open', count: 1 }) });
    expect('new critical: sweep ok', r.ok, true);
    expect('new critical: exactly one ntfy POST', ntfyCalls.length, 1);
    const h = ntfyCalls[0] && ntfyCalls[0].init.headers;
    expect('new critical: url', ntfyCalls[0] && ntfyCalls[0].url, `https://ntfy.sh/${TOPIC}`);
    expect('new critical: headers', h && { Title: h.Title, Priority: h.Priority, Tags: h.Tags, Click: h.Click },
      { Title: 'Vantage: Database disk 93% full', Priority: '5', Tags: 'rotating_light,vantage', Click: `https://app.example/?upgrade=security&ticket=${ID}` });
    expect('new critical: body', ntfyCalls[0] && ntfyCalls[0].init.body, 'The database disk is 93% full — writes stop when it fills');
    expect('new critical: alerts summary', r.alerts, { queued: 1, sent: 1, dropped: 0 });
    expect('new critical: ticket id recorded', r.raised[0].ticketId, ID);
  }
  {
    const { r, ntfyCalls } = await sweepWith({ rpc: () => json({ id: ID, status: 'open', count: 7 }), prior: [{ fingerprint: 'db:disk', status: 'open' }] });
    expect('repeat: sweep ok', r.ok, true);
    expect('repeat: no ntfy POST', ntfyCalls.length, 0);
  }
  {
    const { ntfyCalls } = await sweepWith({ rpc: () => json({ id: ID, status: 'open', count: 7 }), prior: [{ fingerprint: 'db:disk', status: 'resolved' }] });
    expect('re-opened: one ntfy POST', ntfyCalls.length, 1);
  }
  {
    // The DB is down: the ticket write fails, and the sweep pings anyway — once.
    const down = async () => ({ readings: { db: { reachable: false, ms: 4000 } }, skipped: [] });
    const { r, ntfyCalls, calls } = await sweepWith({ gather: down, rpc: () => { throw new Error('ECONNREFUSED'); } });
    expect('db down: sweep ok', r.ok, true);
    expect('db down: write failed', r.raised[0].result, 'failed');
    expect('db down: one ntfy POST', ntfyCalls.length, 1);
    expect('db down: overview link', ntfyCalls[0] && ntfyCalls[0].init.headers.Click, 'https://app.example/?upgrade=security&sec=overview');
    expect('db down: no prior-status read', calls.some(c => c.url.includes('fingerprint=in.')), false);
  }
  {
    // The phone service is down: the sweep still completes and reports it.
    const { r, ntfyCalls } = await sweepWith({ rpc: () => json({ id: ID, status: 'open', count: 1 }), ntfy: () => { throw new Error('ntfy unreachable'); } });
    expect('ping failure: sweep ok', r.ok, true);
    expect('ping failure: attempted once', ntfyCalls.length, 1);
    expect('ping failure: ticket still raised', r.raised[0].result, 'ok');
    expect('ping failure: sent 0', r.alerts.sent, 0);
  }
  {
    // Not configured: no prior read, no ping, same tickets.
    const f = stub([['rpc/security_ticket_raise', () => json({ id: ID, status: 'open', count: 1 })]]);
    const saved = globalThis.fetch; globalThis.fetch = f;
    try {
      const r = await runSweep(env, { gather: diskReadings, alertEnv: {}, fetchImpl: f });
      expect('unconfigured: ok', r.ok, true);
      expect('unconfigured: only the RPC was called', f.calls.map(c => c.url.split('/rest/v1/')[1]), ['rpc/security_ticket_raise']);
    } finally { globalThis.fetch = saved; }
  }
  {
    // A high (below the default threshold) never pings; with ALERT_MIN_SEVERITY=high it does.
    const slow = async () => ({ readings: { db: { reachable: true, ms: 2400 } }, skipped: [] });
    const a = await sweepWith({ gather: slow, rpc: () => json({ id: ID, status: 'open', count: 1 }) });
    expect('high below threshold: none', a.ntfyCalls.length, 0);
    const f = stub([['rpc/security_ticket_raise', () => json({ id: ID, status: 'open', count: 1 })], ['fingerprint=in.', () => json([])], ['ntfy.sh', () => new Response('ok')]]);
    const saved = globalThis.fetch; globalThis.fetch = f;
    try {
      await runSweep(env, { gather: slow, alertEnv: { ...ENV, ALERT_MIN_SEVERITY: 'high' }, fetchImpl: f });
      expect('high at threshold high: one', f.calls.filter(c => c.url.includes('ntfy.sh')).length, 1);
    } finally { globalThis.fetch = saved; }
  }

  if (failures.length) {
    console.error(`check:alerts (notify) — ${failures.length} of ${checked} failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`check:alerts (notify) — ${checked} checks passed`);
}

main().catch(e => { console.error(e); process.exit(1); });
