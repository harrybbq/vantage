/**
 * Server-side consent (item 98) — the rule, its parity with the app's,
 * consent_events precedence (item 99), batching, failure modes, and the
 * real handlers honouring it. No network: fetch is faked.
 *
 * Run: npm run check:consent
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { consentStatus as clientStatus } from '../../src/lib/consent/consent.js';

const require = createRequire(import.meta.url);
const G = require('./consentGate.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const T = '2026-09-30T10:00:00.000Z';
const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();

// ── 1. The state rule is the app's rule ──
{
  const cases = [undefined, null, {}, { health: T }, { health: null }, { health: false }, { health: '' },
    { health: true }, { ai: T }, { ai: null, health: T }, 'junk', { health: 7 }];
  for (const c of cases) for (const k of G.KINDS) {
    eq(G.stateStatus(c, k), clientStatus(c && typeof c === 'object' ? c : undefined, k), `parity: ${JSON.stringify(c)} / ${k}`);
  }
}

// ── 2. Who is allowed what ──
{
  ok(G.healthSyncAllowed('granted') && G.healthSyncAllowed('unasked'), 'health: granted and never-asked keep syncing (as the app does)');
  ok(!G.healthSyncAllowed('declined'), 'health: declined / withdrawn stops');
  ok(G.aiAllowed('granted'), 'ai: granted');
  ok(!G.aiAllowed('unasked') && !G.aiAllowed('declined'), 'ai: only an explicit yes');
  ok(G.healthSyncAllowed(undefined), 'an account missing from the map counts as never asked for health');
}

// ── 3. consent_events precedence ──
{
  const S = (h) => ({ health: h });
  eq(G.effectiveStatus(S(T), null, 'health', NOW), 'granted', 'no event → the state decides');
  eq(G.effectiveStatus(S(T), { granted: false, created_at: ago(60_000) }, 'health', NOW), 'declined',
    'a withdrawal event beats a state that has not saved yet');
  eq(G.effectiveStatus(S(null), { granted: true, created_at: ago(5_000) }, 'health', NOW), 'granted',
    'a just-granted event beats a state that still says no (the save is debounced)');
  eq(G.effectiveStatus(S(null), { granted: true, created_at: ago(G.STALE_GRANT_MS + 60_000) }, 'health', NOW), 'declined',
    'an OLD grant event loses to a state that says no — a withdrawal whose event never landed');
  eq(G.effectiveStatus(undefined, { granted: true, created_at: ago(G.STALE_GRANT_MS * 10) }, 'ai', NOW), 'granted',
    'grant event, never-asked state → granted');
  eq(G.effectiveStatus({ ai: T }, { granted: 'yes' }, 'ai', NOW), 'granted', 'a malformed event is ignored');
  eq(G.effectiveStatus(S(null), { granted: true, created_at: 'nonsense' }, 'health', NOW), 'declined', 'unparseable time is treated as stale');
}

// ── 4. Batched reads, chunking, failure modes ──
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'legacy.service.TEST' };
function fakeDb({ states = {}, events = [], stateStatus = 200, eventsStatus = 200 } = {}) {
  const calls = [];
  const f = async (url) => {
    const u = String(url);
    calls.push(u);
    const ids = (u.match(/in\.\(([^)]*)\)/)?.[1] || '').split(',').filter(Boolean);
    const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (u.includes('/rest/v1/user_data')) {
      if (stateStatus !== 200) return res(stateStatus, {});
      ok(u.includes('select=id,consent:state->consent'), 'reads ONE JSON path, never the whole state');
      return res(200, ids.filter(id => id in states).map(id => ({ id, consent: states[id] })));
    }
    if (u.includes('/rest/v1/consent_events')) {
      if (eventsStatus !== 200) return res(eventsStatus, {});
      const kind = u.match(/kind=eq\.(\w+)/)[1];
      return res(200, events.filter(e => ids.includes(e.user_id) && e.kind === kind)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }
    return res(404, {});
  };
  return { f, calls };
}
{
  G._resetConsentGate();
  const ids = Array.from({ length: 230 }, (_, i) => `u${i}`);
  const states = { u0: { health: null }, u1: { health: T }, u2: {} };
  const { f, calls } = fakeDb({ states, events: [{ user_id: 'u3', kind: 'health', granted: false, created_at: ago(1000) }] });
  const m = await G.consentStatuses(ids, 'health', env, f);
  eq(m.get('u0'), 'declined', 'declined in state');
  eq(m.get('u1'), 'granted', 'granted in state');
  eq(m.get('u2'), 'unasked', 'empty consent object');
  eq(m.get('u3'), 'declined', 'withdrawal event');
  eq(m.get('u200'), 'unasked', 'no state row at all → never asked');
  eq(calls.filter(c => c.includes('user_data')).length, 3, '230 accounts → 3 batched state reads (100 a time)');
  eq(m.size, 230, 'every account answered');
}
{
  G._resetConsentGate();
  const { f } = fakeDb({ stateStatus: 500 });
  eq(await G.consentStatuses(['a1'], 'health', env, f), null, 'state unreadable → null (callers fail closed)');
}
{
  G._resetConsentGate();
  const { f, calls } = fakeDb({ states: { a1: { ai: T } }, eventsStatus: 404 });
  eq(await G.consentStatus('a1', 'ai', env, f), 'granted', 'no consent_events table yet → the state decides alone');
  calls.length = 0;
  await G.consentStatus('a1', 'ai', env, f);
  ok(!calls.some(c => c.includes('consent_events')), 'a missing table is remembered, not re-asked every call');
  G._resetConsentGate();
}
{
  const { f, calls } = fakeDb();
  await G.consentStatuses(['ok-id', 'bad,id', 'x)y', '../etc'], 'ai', env, f);
  ok(calls.every(c => !c.includes('bad,id') && !c.includes('x)y') && !c.includes('../')), 'ids that could break the filter are never sent');
  let threw = false;
  try { await G.consentStatuses(['a'], 'marketing', env, f); } catch { threw = true; }
  ok(threw, 'an unknown kind is a programming error, not "allowed"');
}
{
  G._resetConsentGate();
  const CORS = { 'Access-Control-Allow-Origin': '*' };
  const declined = fakeDb({ states: { a1: { ai: null } } });
  const r = await G.consentGate('a1', 'ai', CORS, env, declined.f);
  eq(r.statusCode, 403, 'declined AI → 403');
  eq(JSON.parse(r.body).consent, 'ai', 'says which consent');
  ok(/Settings/.test(JSON.parse(r.body).error), 'and where to turn it on');
  const unasked = fakeDb({ states: { a1: {} } });
  eq((await G.consentGate('a1', 'ai', CORS, env, unasked.f)).statusCode, 403, 'never-asked AI → 403');
  eq(await G.consentGate('a1', 'health', CORS, env, unasked.f), null, 'never-asked health → allowed');
  const down = fakeDb({ stateStatus: 503 });
  eq((await G.consentGate('a1', 'ai', CORS, env, down.f)).statusCode, 503, 'unreadable → 503, never a guess');
}

// ── 5. Real handlers ──
const world = { states: {}, events: [], calls: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  world.calls.push(u);
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.endsWith('/auth/v1/user')) {
    const jwt = String(init.headers?.Authorization || '').replace('Bearer ', '');
    return res(200, { id: jwt, email: `${jwt}@x.test` });
  }
  if (u.includes('/rest/v1/user_data')) {
    const ids = (u.match(/in\.\(([^)]*)\)/)?.[1] || '').split(',');
    return res(200, ids.filter(id => id in world.states).map(id => ({ id, consent: world.states[id] })));
  }
  if (u.includes('/rest/v1/consent_events')) return res(200, []);
  if (u.includes('/rest/v1/whoop_tokens?select=user_id')) return res(200, [{ user_id: 'u-declined' }, { user_id: 'u-unasked' }, { user_id: 'u-granted' }]);
  if (u.includes('/rest/v1/whoop_tokens?user_id=eq.')) return res(200, []); // not connected → skipped
  if (u.includes('/rest/v1/profiles')) return res(200, [{ tier: 'pro' }]);
  return res(404, {});
};
Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'legacy.service.TEST', VITE_SUPABASE_ANON_KEY: 'legacy.anon.TEST',
  WHOOP_CLIENT_ID: 'id', WHOOP_CLIENT_SECRET: 'secret', ANTHROPIC_API_KEY: 'sk-test', OWNER_EMAIL: 'owner@x.test',
});
delete process.env.VANTAGE_PAUSE;
world.states = { 'u-declined': { health: null }, 'u-unasked': {}, 'u-granted': { health: T, ai: T } };
{
  G._resetConsentGate();
  world.calls.length = 0;
  const cron = require('../functions/whoop-cron.js');
  const r = await cron.handler({ body: JSON.stringify({ next_run: '2026-10-21T06:00:00Z' }) });
  eq(r.statusCode, 200, 'whoop-cron runs');
  ok(!world.calls.some(c => c.includes('whoop_tokens?user_id=eq.u-declined')), 'whoop-cron never touches a declined account');
  ok(world.calls.some(c => c.includes('whoop_tokens?user_id=eq.u-unasked')), 'never-asked account still synced');
  ok(world.calls.some(c => c.includes('whoop_tokens?user_id=eq.u-granted')), 'granted account synced');
  eq(world.calls.filter(c => c.includes('/rest/v1/user_data')).length, 1, 'one batched consent read for the whole run');
}
{
  const sync = require('../functions/whoop-sync.js');
  const call = jwt => sync.handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${jwt}` }, body: '{}' });
  const d = await call('u-declined');
  eq(d.statusCode, 403, 'whoop-sync refuses a declined account');
  eq(JSON.parse(d.body).consent, 'health', 'with the consent code');
  eq((await call('u-unasked')).statusCode, 404, 'never-asked passes the gate (then: not connected)');
}
{
  const coach = require('../functions/ai-coach-daily.js');
  const call = jwt => coach.handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${jwt}` }, body: JSON.stringify({ snapshot: {} }) });
  world.calls.length = 0;
  const u = await call('u-unasked');
  eq(u.statusCode, 403, 'ai-coach-daily refuses without AI consent');
  ok(!world.calls.some(c => c.startsWith('https://api.anthropic.com/')), 'and never reaches Anthropic');
  const g = await call('u-granted');
  ok(g.statusCode !== 403 || JSON.parse(g.body).consent !== 'ai', 'granted account passes the consent gate');
}
{
  const food = require('../functions/ai-food-detect.js');
  const q = await food.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer u-unasked' } });
  eq(q.statusCode, 200, 'the free-scan quota read needs no consent');
  const s = await food.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer u-unasked' }, body: JSON.stringify({ imageBase64: 'x'.repeat(200) }) });
  eq(s.statusCode, 403, 'a scan without AI consent is refused');
}

console.log(`consentGate: ${n} checks passed`);
