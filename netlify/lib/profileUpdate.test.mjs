/**
 * profile-update (item 84): the rules, and the real handler against a
 * faked fetch — what reaches the database, and what never does.
 *
 * Run: npm run check:privacy
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { planProfileUpdate, diffAgainst, writeError } = require('./profileUpdate.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(400);
const IMG2 = 'data:image/jpeg;base64,' + 'B'.repeat(400);

// ── planProfileUpdate ──
{
  eq(planProfileUpdate({ handle: 'harry_99' }), { ok: true, fields: { handle: 'harry_99' } }, 'valid handle');
  eq(planProfileUpdate({ handle: '  harry_99 ' }).fields.handle, 'harry_99', 'handle trimmed');
  for (const h of ['ab', 'a'.repeat(21), 'has space', 'émoji', '', null, 7]) {
    const r = planProfileUpdate({ handle: h });
    ok(!r.ok && r.field === 'handle' && r.status === 400, `bad handle format: ${JSON.stringify(h)}`);
  }
  const slur = planProfileUpdate({ handle: 'fuck_squad' });
  ok(!slur.ok && slur.field === 'handle' && /isn't allowed/.test(slur.error), 'filtered handle refused');
  ok(!/fuck/i.test(slur.error), 'the refusal never echoes the match');

  eq(planProfileUpdate({ display_name: '  Harry  ' }).fields, { display_name: 'Harry' }, 'name trimmed');
  eq(planProfileUpdate({ display_name: 'x'.repeat(60) }).fields.display_name.length, 40, 'name capped at 40');
  eq(planProfileUpdate({ display_name: '' }).fields, { display_name: null }, "'' clears the name");
  eq(planProfileUpdate({ display_name: null }).fields, { display_name: null }, 'null clears the name');
  eq(planProfileUpdate({ display_name: 'Ha‮rry\u0007' }).fields.display_name, 'Harry', 'bidi/control characters stripped');
  const link = planProfileUpdate({ display_name: 'visit www.example.com' });
  ok(!link.ok && link.field === 'display_name' && /links/.test(link.error), 'contact details refused');
  ok(!planProfileUpdate({ display_name: 42 }).ok, 'a non-string name refused');
  ok(planProfileUpdate({ display_name: 'Scunthorpe Runner' }).ok, 'whole-word filter: ordinary names pass');

  eq(planProfileUpdate({ avatar_url: null }).fields, { avatar: { clear: true } }, 'null clears the avatar');
  const a = planProfileUpdate({ avatar_url: IMG });
  ok(a.ok && a.fields.avatar.mediaType === 'image/jpeg' && a.fields.avatar.dataUrl === IMG, 'avatar data URL parsed');
  ok(!planProfileUpdate({ avatar_url: 'https://evil.example/x.png' }).ok, 'a remote URL is not an avatar');
  ok(!planProfileUpdate({ avatar_url: 'data:image/svg+xml;base64,' + 'A'.repeat(400) }).ok, 'SVG refused');

  ok(!planProfileUpdate({}).ok, 'nothing to save');
  ok(!planProfileUpdate({ tier: 'lifetime' }).ok, 'other columns are not this function\'s business');
  eq(planProfileUpdate({ handle: 'harry_99', tier: 'lifetime', prestige: 99 }).fields, { handle: 'harry_99' }, 'unknown keys dropped, never written');
  ok(!planProfileUpdate(null).ok && !planProfileUpdate([1]).ok, 'junk body');
}

// ── diffAgainst ──
{
  const cur = { handle: 'harry', display_name: 'Harry', avatar_url: IMG };
  eq(diffAgainst({ handle: 'harry', display_name: 'Harry' }, cur), {}, 'no change → nothing');
  eq(diffAgainst({ handle: 'Harry' }, cur), { handle: 'Harry' }, 'a case change is a change');
  eq(diffAgainst({ avatar: { dataUrl: IMG } }, cur), {}, 'same picture → not re-screened');
  ok('avatar' in diffAgainst({ avatar: { dataUrl: IMG2 } }, cur), 'new picture → screened');
  eq(diffAgainst({ avatar: { clear: true } }, { avatar_url: null }), {}, 'clearing nothing is nothing');
  eq(diffAgainst({ display_name: 'A' }, null), { display_name: 'A' }, 'no row yet → everything is a change');
}

// ── writeError ──
{
  eq(writeError(409, { code: '23505', message: 'duplicate key value violates unique constraint "profiles_handle_key"' }).error, 'That handle is taken.', 'unique → taken');
  eq(writeError(400, { code: '23514', message: 'violates check constraint "profiles_display_name_len"' }).field, 'display_name', 'check → field');
  const raw = writeError(500, { code: 'XX000', message: 'internal secret detail' });
  ok(raw.status === 502 && !/secret/.test(raw.error), 'no raw database errors');
}

// ── The handler, end to end with a fake fetch ──
const calls = [];
let row = { id: 'u1', handle: 'harry', display_name: 'Harry', avatar_url: null };
let screenAnswer = 'approve';
let upsertFail = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (u.endsWith('/auth/v1/user')) {
    return init.headers?.Authorization === 'Bearer good.jwt' ? res(200, { id: 'u1', email: 'u1@x.test' }) : res(401, {});
  }
  if (u.includes('/rest/v1/rpc/ai_usage_bump')) return res(200, true);
  if (u.includes('/rest/v1/profiles?id=eq.')) return res(200, row ? [row] : []);
  if (u.includes('/rest/v1/profiles?on_conflict=id')) {
    if (upsertFail) return res(upsertFail.status, upsertFail.body);
    const body = JSON.parse(init.body);
    row = { ...(row || {}), ...body };
    return res(201, [{ id: row.id, handle: row.handle ?? null, display_name: row.display_name ?? null, avatar_url: row.avatar_url ?? null }]);
  }
  if (u.startsWith('https://api.anthropic.com/')) {
    return res(200, { content: [{ type: 'text', text: JSON.stringify({ decision: screenAnswer, reason: screenAnswer === 'reject' ? 'sexual content' : '' }) }] });
  }
  return res(404, {});
};
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy.service.TEST';
process.env.VITE_SUPABASE_ANON_KEY = 'legacy.anon.TEST';
process.env.ANTHROPIC_API_KEY = 'sk-test';
delete process.env.VANTAGE_PAUSE;
const { handler } = require('../functions/profile-update.js');
const call = (body, jwt = 'good.jwt') => handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) });
const writes = () => calls.filter(c => c.url.includes('on_conflict=id'));
const parse = r => JSON.parse(r.body);

{
  calls.length = 0;
  process.env.VANTAGE_PAUSE = 'social';
  const r = await call({ handle: 'newname' });
  eq(r.statusCode, 503, 'paused with the social area');
  eq(calls.length, 0, 'paused: nothing upstream');
  delete process.env.VANTAGE_PAUSE;

  eq((await call({ handle: 'newname' }, 'bad.jwt')).statusCode, 401, 'no session → 401');
  eq(writes().length, 0, 'unauthenticated: no write');

  calls.length = 0;
  const f = await call({ display_name: 'fuck squad' });
  eq(f.statusCode, 400, 'filtered name → 400');
  eq(parse(f).field, 'display_name', 'says which field');
  eq(calls.filter(c => c.url.includes('/rest/v1/')).length, 0, 'filtered: the database is never touched');

  calls.length = 0;
  const same = await call({ handle: 'harry', display_name: 'Harry' });
  eq(same.statusCode, 200, 'no-op ok');
  eq(writes().length, 0, 'no-op: no write');
  eq(calls.filter(c => c.url.includes('ai_usage_bump')).length, 0, 'no-op: does not count toward the daily cap');

  calls.length = 0;
  const h = await call({ handle: 'harry_new', display_name: 'Harry', tier: 'lifetime' });
  eq(h.statusCode, 200, 'handle change ok');
  eq(writes().length, 1, 'one write');
  eq(writes()[0].body, { id: 'u1', handle: 'harry_new' }, 'only the changed field is written — never tier');
  eq(parse(h).profile.handle, 'harry_new', 'returns the saved profile');

  upsertFail = { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "profiles_handle_key"' } };
  const taken = await call({ handle: 'someone' });
  eq(taken.statusCode, 409, 'taken → 409');
  eq(parse(taken).error, 'That handle is taken.', 'taken message');
  upsertFail = null;

  calls.length = 0;
  screenAnswer = 'approve';
  const ap = await call({ avatar_url: IMG });
  eq(parse(ap).avatar, 'approved', 'approved picture');
  eq(writes()[0].body.avatar_url, IMG, 'approved picture stored');
  ok(calls.some(c => c.url.startsWith('https://api.anthropic.com/')), 'it was screened');

  calls.length = 0;
  const again = await call({ avatar_url: IMG });
  eq(parse(again).avatar, 'unchanged', 'the stored picture again → unchanged');
  ok(!calls.some(c => c.url.startsWith('https://api.anthropic.com/')), 'not re-screened');

  calls.length = 0;
  screenAnswer = 'reject';
  const rj = await call({ avatar_url: IMG2 });
  eq(parse(rj).avatar, 'rejected', 'rejected picture');
  eq(parse(rj).reason, 'sexual content', 'reason passed on');
  eq(writes()[0].body.avatar_url, null, 'rejected: the new picture is not stored and the old one is cleared');

  calls.length = 0;
  delete process.env.ANTHROPIC_API_KEY;
  const IMG3 = 'data:image/png;base64,' + 'C'.repeat(400);
  row.avatar_url = null;
  const pend = await call({ avatar_url: IMG3 });
  eq(parse(pend).avatar, 'pending', 'no key → pending (fails closed)');
  eq(writes().length, 0, 'pending with nothing stored: no write at all');
  process.env.ANTHROPIC_API_KEY = 'sk-test';

  const clr = await call({ avatar_url: null });
  eq(parse(clr).avatar, 'unchanged', 'clearing an empty avatar is a no-op');

  eq((await handler({ httpMethod: 'GET', headers: {} })).statusCode, 405, 'GET refused');
  eq((await handler({ httpMethod: 'OPTIONS', headers: {} })).statusCode, 204, 'preflight');
}

// ── Source: the client writes the three public columns only through the function ──
{
  const { readFileSync } = await import('node:fs');
  const q = readFileSync(new URL('../../src/lib/friends/queries.js', import.meta.url), 'utf8');
  const direct = q.match(/\.update\(\s*\{\s*handle\b/);
  ok(!direct, 'queries.js no longer PATCHes handle directly');
  const w = readFileSync(new URL('../../src/lib/friends/profileWrites.js', import.meta.url), 'utf8');
  ok(w.includes('/.netlify/functions/profile-update'), 'profileWrites posts to profile-update');
}

console.log(`profileUpdate: ${n} checks passed`);
