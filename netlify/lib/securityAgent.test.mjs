/**
 * The triage agents' endpoint (functions/security-agent.js): auth
 * (missing env, wrong/missing token, token in the query string), the
 * low/medium severity gate on every action, and that nothing personal
 * leaves in the queue. Also the client-error grouping both the agent
 * and the console read.
 *
 * Run: npm run check:alerts   (also part of npm run build)
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('./agentShape.js');
const { groupClientErrors, firstFrame, supabaseLinks } = require('./securityShape.js');

const failures = [];
let checked = 0;
const expect = (label, got, want) => {
  checked++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) failures.push(`${label}: got ${g}, want ${w}`);
};

// Test-only values: none of these are real.
const TOKEN = 'a'.repeat(64);
const ID_MED = '11111111-2222-4333-8444-555555555551';
const ID_HIGH = '11111111-2222-4333-8444-555555555552';
const USER = '99999999-8888-4777-8666-555555555555';

process.env.SUPABASE_URL = 'https://proj.example';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';

// ── pure: stripping ──
expect('personal keys', ['user_id', 'userId', 'reporter_id', 'email', 'ua', 'handle', 'display_name', 'name', 'bucket'].map(S.isPersonalKey),
  [true, true, true, true, true, true, true, false, false]);
expect('mask text', S.maskText(`mail me at someone@example.com, my id ${USER}`), 'mail me at [email], my id [id]');
expect('strip detail', S.stripDetail({ userId: USER, bucket: 'food', days: 3, nested: { email: 'x@y.co', ok: 1 } }),
  { bucket: 'food', days: 3, nested: { ok: 1 } });
const userRow = {
  id: ID_MED, kind: 'user:bug', severity: 'medium', status: 'open', source: 'user', title: 'Crash when I log food — reach me at me@mail.example',
  detail: { text: `The hub crashes. I am ${USER}`, category: 'bug', page: '/', release: 'index-ab12.js' },
  count: 1, created_at: '2026-10-01T10:00:00Z', last_seen_at: '2026-10-01T10:00:00Z', note: null, reporter_id: USER,
};
const at = S.agentTicket(userRow);
expect('agent ticket: no reporter', 'reporter_id' in at || 'reporter' in at, false);
expect('agent ticket: title masked', at.title, 'Crash when I log food — reach me at [email]');
expect('agent ticket: headline is the title for user tickets', at.headline, at.title);
expect('agent ticket: text masked', at.detail.text, 'The hub crashes. I am [id]');
expect('agent ticket: keeps release + page', [at.detail.release, at.detail.page], ['index-ab12.js', '/']);
expect('agent ticket: nothing personal anywhere', JSON.stringify(at).includes(USER) || JSON.stringify(at).includes('@mail'), false);
const capRow = { id: ID_MED, kind: 'ai_cap_repeat', severity: 'low', status: 'ack', title: 'AI cap hit on 3 days: food_detect', detail: { userId: USER, bucket: 'food_detect', days: 3, cap: 20 }, count: 5 };
const ac = S.agentTicket(capRow);
expect('ai cap: user id stripped', ac.detail, { bucket: 'food_detect', days: 3, cap: 20 });
expect('ai cap: headline', ac.headline, 'One account hit the daily food detect cap on 3 of the last 3 days');
expect('high refused by shape', S.agentTicket({ ...capRow, severity: 'high' }), null);
expect('critical refused by shape', S.agentTicket({ ...capRow, severity: 'critical' }), null);

// ── pure: notes ──
const now = new Date('2026-10-04T12:00:00.000Z');
expect('note line', S.agentNoteLine('note', 'Looks like a null check in Hub', null, now), '[agent] 2026-10-04T12:00:00Z note: Looks like a null check in Hub');
expect('resolve with pr', S.agentNoteLine('resolve', 'Fixed', 'https://github.com/owner/repo/pull/231', now), '[agent] 2026-10-04T12:00:00Z resolve: Fixed · PR: https://github.com/owner/repo/pull/231');
expect('bad pr dropped', S.agentNoteLine('resolve', 'Fixed', 'javascript:alert(1)', now), '[agent] 2026-10-04T12:00:00Z resolve: Fixed');
expect('empty note → null', S.agentNoteLine('note', '   ', null, now), null);
expect('note capped 2000', S.agentNoteLine('note', 'x'.repeat(5000), null, now).length, '[agent] 2026-10-04T12:00:00Z note: '.length + 2000);
expect('append', S.appendNote('owner: looked', '[agent] x'), 'owner: looked\n[agent] x');
expect('append caps from the front', S.appendNote('y'.repeat(9000), 'z').length, 8000);

// ── pure: error grouping ──
const T = i => new Date(Date.parse('2026-10-04T11:00:00Z') + i * 60_000).toISOString();
const rows = [
  ...Array.from({ length: 5 }, (_, i) => ({ message: "Cannot read properties of undefined (reading 'kcal')", stack: "TypeError: Cannot read properties of undefined (reading 'kcal')\n    at MacroRing (https://app.example/assets/index-ab12.js?v=1:1:2345)\n    at renderWithHooks (https://app.example/assets/vendor.js:9:9)", url: 'https://app.example/', release: 'index-ab12.js', kind: 'boundary', occurred_at: T(i), user_id: USER })),
  { message: "Cannot read properties of undefined (reading 'kcal')", stack: 'TypeError\n    at OtherPlace (https://app.example/assets/index-ab12.js:1:99)', url: 'https://app.example/x', release: 'index-ab12.js', kind: 'boundary', occurred_at: T(9) },
  { message: 'Load failed 12345678', stack: 'fetchJson@https://app.example/assets/index-cd34.js:2:10', url: 'https://app.example/track', release: 'index-cd34.js', kind: 'network', occurred_at: T(3) },
  { message: 'Load failed 87654321', stack: 'fetchJson@https://app.example/assets/index-cd34.js:2:10', url: 'https://app.example/hub', release: 'index-cd34.js', kind: 'network', occurred_at: T(4) },
];
const g = groupClientErrors(rows);
expect('groups: 3', g.length, 3);
expect('groups: top count', g[0].count, 5);
expect('groups: frame', g[0].frame, 'MacroRing (/assets/index-ab12.js:1:2345)');
expect('groups: numbers collapse into one group', g[1].count, 2);
expect('groups: latest sample url', g[1].sampleUrl, 'https://app.example/hub');
expect('groups: firefox frame', g[1].frame, 'fetchJson@/assets/index-cd34.js:2:10');
expect('groups: no user id leaks', JSON.stringify(g).includes(USER), false);
expect('groups: first/last seen', [g[0].firstSeen, g[0].lastSeen], [T(0), T(4)]);
expect('frame: none', firstFrame('just a message'), null);
expect('groups: empty', groupClientErrors(null), []);
expect('supabase links', supabaseLinks('abcdefghijklmnopqrst').reports, 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst/reports/database');
expect('supabase links: junk', supabaseLinks('../x'), null);

// ── the handler, with a stubbed fetch ──
const calls = [];
const tickets = {
  [ID_MED]: { id: ID_MED, severity: 'medium', status: 'open', note: null },
  [ID_HIGH]: { id: ID_HIGH, severity: 'high', status: 'open', note: null },
};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, init });
  const json = b => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('/rest/v1/security_tickets?select=')) return json([userRow, capRow, { ...capRow, id: ID_HIGH, severity: 'high' }]);
  const m = u.match(/security_tickets\?id=eq\.([0-9a-f-]+)/);
  if (m && (!init.method || init.method === 'GET')) return json(tickets[m[1]] ? [tickets[m[1]]] : []);
  if (m && init.method === 'PATCH') {
    const t = tickets[m[1]];
    const allowed = /severity=in\.\(low,medium\)/.test(u) && t && ['low', 'medium'].includes(t.severity);
    const patch = JSON.parse(init.body);
    return json(allowed ? [{ id: t.id, status: patch.status || t.status }] : []);
  }
  return new Response('not found', { status: 404 });
};
const { handler } = require('../functions/security-agent.js');
const ev = (o = {}) => ({ httpMethod: 'GET', headers: {}, queryStringParameters: { view: 'queue' }, ...o });
const withToken = (o = {}) => ev({ ...o, headers: { 'x-agent-token': TOKEN, 'x-nf-client-connection-ip': o.ip || '10.0.0.1', ...(o.headers || {}) } });
const body = r => JSON.parse(r.body);

async function main() {
  delete process.env.SECURITY_AGENT_TOKEN;
  let r = await handler(withToken());
  expect('no env → 503', [r.statusCode, body(r).error], [503, 'not_configured']);
  process.env.SECURITY_AGENT_TOKEN = 'short';
  r = await handler(withToken());
  expect('short env → 503', r.statusCode, 503);
  process.env.SECURITY_AGENT_TOKEN = TOKEN;

  r = await handler(ev({ headers: { 'x-nf-client-connection-ip': '10.0.0.2' } }));
  expect('missing token → 401', [r.statusCode, body(r)], [401, { error: 'unauthorized' }]);
  r = await handler(ev({ headers: { 'x-agent-token': 'b'.repeat(64), 'x-nf-client-connection-ip': '10.0.0.2' } }));
  expect('wrong token → same 401', [r.statusCode, body(r)], [401, { error: 'unauthorized' }]);
  r = await handler(ev({ headers: { 'x-agent-token': TOKEN.slice(1), 'x-nf-client-connection-ip': '10.0.0.2' } }));
  expect('wrong length → same 401', [r.statusCode, body(r)], [401, { error: 'unauthorized' }]);
  r = await handler(ev({ queryStringParameters: { view: 'queue', token: TOKEN }, headers: { 'x-nf-client-connection-ip': '10.0.0.3' } }));
  expect('token in query only → 401', r.statusCode, 401);
  r = await handler(withToken({ queryStringParameters: { view: 'queue', agent_token: TOKEN }, ip: '10.0.0.4' }));
  expect('token in query even with header → 401', r.statusCode, 401);
  r = await handler(withToken({ headers: { 'X-Agent-Token': TOKEN } }));
  expect('header any case', r.statusCode, 200);
  expect('no-store', r.headers['Cache-Control'], 'no-store');

  // Repeated failures from one address are throttled.
  for (let i = 0; i < 12; i++) await handler(ev({ headers: { 'x-agent-token': 'nope', 'x-nf-client-connection-ip': '10.9.9.9' } }));
  r = await handler(ev({ headers: { 'x-agent-token': TOKEN, 'x-nf-client-connection-ip': '10.9.9.9' } }));
  expect('failure throttle', r.statusCode, 429);

  // Queue: low/medium only, nothing personal.
  r = await handler(withToken());
  const q = body(r);
  expect('queue ok', r.statusCode, 200);
  expect('queue severities', q.tickets.map(t => t.severity), ['medium', 'low']);
  const qCall = calls.find(c => c.url.includes('security_tickets?select='));
  expect('queue query gates severity', /severity=in\.\(low,medium\)/.test(qCall.url), true);
  expect('queue query never selects reporter_id', qCall.url.includes('reporter_id'), false);
  expect('queue output has no user id', JSON.stringify(q).includes(USER), false);

  // Actions
  const post = (b, ip) => handler(withToken({ httpMethod: 'POST', body: JSON.stringify(b), queryStringParameters: {}, ip }));
  r = await post({ action: 'resolve', id: ID_HIGH, note: 'Fixed it' });
  expect('resolve high → 403', r.statusCode, 403);
  r = await post({ action: 'ack', id: ID_HIGH });
  expect('ack high → 403', r.statusCode, 403);
  r = await post({ action: 'note', id: ID_HIGH, note: 'hi' });
  expect('note high → 403', r.statusCode, 403);
  expect('no PATCH ever sent for high', calls.some(c => c.init.method === 'PATCH' && c.url.includes(ID_HIGH)), false);

  calls.length = 0;
  r = await post({ action: 'resolve', id: ID_MED, note: 'Null check added', pr: 'https://github.com/owner/repo/pull/240' });
  expect('resolve medium → 200', [r.statusCode, body(r).status], [200, 'resolved']);
  const patch = calls.find(c => c.init.method === 'PATCH');
  const pb = JSON.parse(patch.init.body);
  expect('resolve PATCH re-states the severity filter', /severity=in\.\(low,medium\)/.test(patch.url), true);
  expect('resolve note prefixed', /^\[agent\] \S+ resolve: Null check added · PR: https:\/\/github\.com\/owner\/repo\/pull\/240$/.test(pb.note), true);
  expect('resolve fields', Object.keys(pb).sort(), ['note', 'resolved_at', 'resolved_by', 'status', 'updated_at']);
  r = await post({ action: 'resolve', id: ID_MED });
  expect('resolve without note → 400', r.statusCode, 400);
  r = await post({ action: 'note', id: ID_MED, note: 'x'.repeat(2001) });
  expect('note over 2000 → 400', r.statusCode, 400);
  r = await post({ action: 'ban', id: ID_MED });
  expect('unknown action → 400', r.statusCode, 400);
  r = await post({ action: 'note', id: 'not-a-uuid', note: 'x' });
  expect('bad id → 400', r.statusCode, 400);
  r = await post({ action: 'note', id: '11111111-2222-4333-8444-000000000000', note: 'x' });
  expect('unknown ticket → 404', r.statusCode, 404);

  if (failures.length) {
    console.error(`check:alerts (agent) — ${failures.length} of ${checked} failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`check:alerts (agent) — ${checked} checks passed`);
}

main().catch(e => { console.error(e); process.exit(1); });
