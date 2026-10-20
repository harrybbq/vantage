/**
 * Item 122: seed.mjs end to end against an in-process fake of the
 * Supabase REST/Auth endpoints it calls — no real network, no real keys.
 * Proves the data-safety promises: a dry run writes nothing; one account
 * holding real data stops the run before ANY write; an address outside
 * --allow is refused before any request; a real (non-demo) user in the
 * project is never touched; nothing is ever deleted; tier is never set.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SEED = fileURLToPath(new URL('./seed.mjs', import.meta.url));
let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

const uid = (k) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
let db;
function reset() {
  db = {
    users: [
      { id: uid(1), email: 'pro@co.example', email_confirmed_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
      { id: uid(2), email: 'f1@co.example', email_confirmed_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
      { id: uid(9), email: 'real.person@example.org', email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
    ],
    user_data: { [uid(9)]: { state: { profile: { name: 'Real' }, logs: { '2026-10-01': { t1: true } } }, updated_at: '2026-10-01T00:00:00Z' } },
    profiles: {},
    tables: {},
    log: [],
  };
}
const q = (url) => Object.fromEntries(new URL(url, 'http://x').searchParams);
const idOf = (s) => (s || '').replace(/^eq\./, '');

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const params = q(req.url);
  db.log.push({ method: req.method, url: req.url, body });
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  const parsed = body ? JSON.parse(body) : null;

  if (path === '/auth/v1/admin/users' && req.method === 'GET') return send(200, { users: db.users });
  if (path === '/auth/v1/admin/users' && req.method === 'POST') {
    const u = { id: uid(100 + db.users.length), email: parsed.email, email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString() };
    db.users.push(u);
    return send(200, u);
  }
  if (path === '/rest/v1/user_data') {
    if (req.method === 'GET') { const r = db.user_data[idOf(params.id)]; return send(200, r ? [r] : []); }
    if (req.method === 'POST') { if (db.user_data[parsed.id]) return send(409, {}); db.user_data[parsed.id] = { state: parsed.state, updated_at: parsed.updated_at }; return send(201); }
    if (req.method === 'PATCH') {
      const id = idOf(params.id); const r = db.user_data[id];
      const guard = params.updated_at;
      const match = r && (guard === 'is.null' ? r.updated_at == null : `eq.${r.updated_at}` === guard);
      if (!match) return send(200, []);
      db.user_data[id] = { state: parsed.state, updated_at: parsed.updated_at };
      return send(200, [{ id }]);
    }
  }
  if (path === '/rest/v1/profiles') {
    if (req.method === 'GET') { const r = db.profiles[idOf(params.id)]; return send(200, r ? [r] : []); }
    if (req.method === 'POST') { db.profiles[parsed.id] = { ...parsed }; return send(201); }
    if (req.method === 'PATCH') { const id = idOf(params.id); db.profiles[id] = { ...db.profiles[id], ...parsed }; return send(204); }
  }
  const t = path.replace('/rest/v1/', '');
  db.tables[t] = db.tables[t] || [];
  if (req.method === 'GET') return send(200, []);
  if (req.method === 'POST') {
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const out = rows.map((r, i) => ({ id: `${t}-${db.tables[t].length + i}`, ...r }));
    db.tables[t].push(...out);
    return send(201, out);
  }
  return send(405, {});
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

function run(args, extraEnv = {}) {
  const env = { PATH: process.env.PATH, SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', ...extraEnv };
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [SEED, ...args], { env });
    let out = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { out += d; });
    c.on('exit', code => resolve({ code, out }));
  });
}
const writes = () => db.log.filter(l => l.method !== 'GET');
const ALLOW = ['--allow', 'pro@co.example,f1@co.example,new@co.example'];

// 1. Address outside --allow: refused before any request.
reset();
{
  const r = await run([...ALLOW, '--pro', 'real.person@example.org', '--write']);
  eq([r.code, db.log.length], [2, 0], 'outside the allow-list → exit 2, no request at all');
}

// 2. Dry run: reads only.
reset();
{
  const r = await run([...ALLOW, '--pro', 'pro@co.example', '--friend', 'f1@co.example']);
  eq(r.code, 0, 'dry run ok');
  eq(writes().length, 0, 'dry run writes nothing');
  ok(/DRY RUN/.test(r.out), 'says so');
}

// 3. One account holds real data → stop before ANY write.
reset();
db.user_data[uid(2)] = { state: { profile: { name: 'Someone' }, logs: { '2026-10-02': { t1: true } } }, updated_at: '2026-10-02T00:00:00Z' };
{
  const r = await run([...ALLOW, '--pro', 'pro@co.example', '--friend', 'f1@co.example', '--write']);
  eq(r.code, 1, 'refused');
  eq(writes().length, 0, 'not one write — not even for the account that was fine');
  ok(/already holds data/.test(r.out) && /nothing has been written/.test(r.out), 'explains why');
}

// 4. Missing account without --create → refused, nothing written.
reset();
{
  const r = await run([...ALLOW, '--pro', 'pro@co.example', '--friend', 'new@co.example', '--write']);
  eq([r.code, writes().length], [1, 0], 'missing account, no --create → refused');
}

// 5. A full write run, creating one account.
reset();
{
  const r = await run([...ALLOW, '--pro', 'pro@co.example', '--friend', 'f1@co.example', '--friend', 'new@co.example', '--create', '--write'],
    { DEMO_ACCOUNT_PASSWORD: 'test-password-0123' });
  eq(r.code, 0, `write run ok\n${r.out}`);
  const created = db.users.find(u => u.email === 'new@co.example');
  ok(created, 'account created');
  for (const e of ['pro@co.example', 'f1@co.example', 'new@co.example']) {
    const id = db.users.find(u => u.email === e).id;
    ok(db.user_data[id]?.state?.demoSeed?.by === 'reviewer-demo', `${e}: demo state written`);
    eq([db.profiles[id]?.is_searchable, db.profiles[id]?.leaderboard_optin], [false, false], `${e}: off the board and search`);
    ok(!('tier' in (db.profiles[id] || {})), `${e}: tier never written`);
  }
  eq(db.user_data[uid(9)].state.profile.name, 'Real', 'the real user\'s row is untouched');
  ok(!db.log.some(l => l.url.includes(uid(9)) || l.body.includes(uid(9))), 'no request ever names the real user');
  ok(!db.log.some(l => l.method === 'DELETE'), 'nothing deleted');
  eq(db.tables.friendships.length, 3, 'three friendships (pro↔f1, pro↔new, f1↔new)');
  ok(db.tables.friendships.every(f => f.status === 'accepted'), 'accepted');
  ok(db.tables.messages.length >= 10, 'DM threads pro↔each friend');
  eq(db.tables.groups.length, 1, 'one group');
  eq(db.tables.group_members.length, 3, 'owner + two members');
  ok(db.tables.nutrition_log.length > 40, 'food log for the pro account');
  ok(!/test-password|test-service-key/.test(r.out), 'no secret printed');
  ok(!db.users.some(u => r.out.includes(u.id)), 'no user id printed');

  // 6. Re-run over our own rows: allowed; extra rows are insert-if-absent.
  const before = { msgs: db.tables.messages.length };
  const r2 = await run([...ALLOW, '--pro', 'pro@co.example', '--write']);
  eq(r2.code, 0, 're-run on demo-tagged rows ok');
  ok(/written by this tool/.test(r2.out), 'recognised its own row');
  ok(db.tables.messages.length >= before.msgs, 'nothing removed');
}

server.close();
console.log(`reviewer-demo seed: ${n} checks passed`);
