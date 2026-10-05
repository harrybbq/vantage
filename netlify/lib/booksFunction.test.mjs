/**
 * netlify/functions/books.js against an in-memory PostgREST stand-in:
 * owner-only auth, the not_configured path, validation, import preview /
 * commit de-duplication, recurring idempotence, soft delete, export,
 * RevenueCat info view.
 *
 * Every figure, name and email here is INVENTED test data.
 *
 * Run: npm run check:books   (also part of npm run build)
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { parseCsv, toEntries } from '../../src/lib/books/importers.js';
import { summarise } from '../../src/lib/books/reports.js';

const require = createRequire(import.meta.url);

let n = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
const deq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// ── Environment (invented) ───────────────────────────────────────────
const SB = 'https://example-project.supabase.invalid';
process.env.SUPABASE_URL = SB;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.OWNER_EMAIL = 'owner@example.test';
delete process.env.REVENUECAT_SECRET_API_KEY;
delete process.env.REVENUECAT_METRICS_API_KEY;
delete process.env.REVENUECAT_PROJECT_ID;

// ── A small PostgREST stand-in ───────────────────────────────────────
const db = { installed: false, tables: { books_entries: [], books_recurring: [], books_config: [] }, log: [] };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Split "a,b(c,d),"e,f"" at depth-0 commas, honouring quotes. */
function splitTop(s) {
  const out = []; let depth = 0; let q = false; let cur = '';
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') depth--;
    if (!q && depth === 0 && ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unq = v => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);
const cmp = (a, b) => (a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0);

function test(row, col, opval) {
  const v = row[col];
  if (opval.startsWith('not.')) return !test(row, col, opval.slice(4));
  const i = opval.indexOf('.');
  const op = opval.slice(0, i); const raw = opval.slice(i + 1);
  switch (op) {
    case 'eq': return String(v) === unq(raw);
    case 'gte': return v != null && cmp(String(v), raw) >= 0;
    case 'lte': return v != null && cmp(String(v), raw) <= 0;
    case 'lt': return v != null && cmp(String(v), raw) < 0;
    case 'gt': return v != null && cmp(String(v), raw) > 0;
    case 'is': return raw === 'null' ? v == null : raw === 'true' ? v === true : v === false;
    case 'in': return splitTop(raw.slice(1, -1)).map(unq).includes(String(v));
    case 'ilike': {
      const pat = unq(raw).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return v != null && new RegExp(`^${pat}$`, 'i').test(String(v));
    }
    default: throw new Error(`fake postgrest: op ${op}`);
  }
}
function logic(row, expr) {
  const m = expr.match(/^(and|or)\((.*)\)$/);
  if (m) {
    const parts = splitTop(m[2]);
    return m[1] === 'and' ? parts.every(p => logic(row, p)) : parts.some(p => logic(row, p));
  }
  const i = expr.indexOf('.');
  return test(row, expr.slice(0, i), expr.slice(i + 1));
}

const UNIQUE = { books_entries: [['id'], ['source', 'source_ref']], books_recurring: [['id']], books_config: [['key']] };
const clash = (table, a, b, cols) => cols.every(c => a[c] != null && a[c] === b[c]);
function defaults(table, r) {
  const now = new Date().toISOString();
  if (table === 'books_entries') return { id: randomUUID(), currency: 'GBP', source: 'manual', created_at: now, updated_at: now, deleted_at: null, ...r };
  if (table === 'books_recurring') return { id: randomUUID(), kind: 'expense', currency: 'GBP', active: true, created_at: now, updated_at: now, ...r };
  return { updated_at: now, ...r };
}

async function postgrest(url, init) {
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');
  const method = init.method || 'GET';
  db.log.push(`${method} ${table}`);
  if (!db.installed) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'` });
  const rows = db.tables[table];
  if (!rows) return json(404, { code: 'PGRST205' });
  const params = [...u.searchParams.entries()];
  const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
  const match = r => params.every(([k, v]) => reserved.has(k) || (k === 'and' || k === 'or' ? logic(r, `${k}${v}`) : test(r, k, v)));
  const select = u.searchParams.get('select');
  const project = r => (select && select !== '*' ? Object.fromEntries(select.split(',').map(c => [c, r[c] ?? null])) : { ...r });
  const prefer = (init.headers && init.headers.Prefer) || '';

  if (method === 'GET') {
    let out = rows.filter(match);
    const order = u.searchParams.get('order');
    if (order) {
      const keys = order.split(',').map(s => s.split('.'));
      out = out.slice().sort((a, b) => {
        for (const [col, dir] of keys) {
          const c = cmp(a[col], b[col]);
          if (c) return dir === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    const off = Number(u.searchParams.get('offset') || 0);
    const lim = Math.min(1000, Number(u.searchParams.get('limit') || 1000));   // Supabase max-rows
    return json(200, out.slice(off, off + lim).map(project));
  }
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    const list = Array.isArray(body) ? body : [body];
    const keys = JSON.stringify(Object.keys(list[0] || {}).sort());
    if (list.some(r => JSON.stringify(Object.keys(r).sort()) !== keys)) return json(400, { code: 'PGRST102', message: 'All object keys must match' });
    const ignore = /ignore-duplicates/.test(prefer);
    const merge = /merge-duplicates/.test(prefer);
    const inserted = [];
    for (const raw of list) {
      const r = defaults(table, raw);
      const hit = rows.find(x => UNIQUE[table].some(cols => clash(table, x, r, cols)));
      if (hit) {
        if (ignore) continue;
        if (merge) { Object.assign(hit, raw); inserted.push(hit); continue; }
        return json(409, { code: '23505', message: 'duplicate key' });
      }
      rows.push(r);
      inserted.push(r);
    }
    return json(201, /return=representation/.test(prefer) ? inserted.map(project) : []);
  }
  if (method === 'PATCH') {
    const patch = JSON.parse(init.body);
    const hit = rows.filter(match);
    for (const r of hit) Object.assign(r, patch);
    return json(200, hit.map(project));
  }
  return json(405, { message: `fake postgrest: ${method} not supported` });
}

// RevenueCat stand-in.
const rc = { status: 200, body: { object: 'overview_metrics', metrics: [
  { object: 'overview_metric', id: 'active_trials', name: 'Active Trials', value: 7, unit: '#' },
  { object: 'overview_metric', id: 'active_subscriptions', name: 'Active Subscriptions', value: 42, unit: '#' },
  { object: 'overview_metric', id: 'mrr', name: 'MRR', value: 123.45, unit: '£' },
  { object: 'overview_metric', id: 'revenue', name: 'Revenue', value: 150.5, unit: '£' },
] }, calls: [] };

globalThis.fetch = async (url, init = {}) => {
  const s = String(url);
  if (s === `${SB}/auth/v1/user`) {
    const auth = init.headers.Authorization;
    if (auth === 'Bearer owner-token') return json(200, { id: 'owner-id', email: 'Owner@Example.test' });
    if (auth === 'Bearer user-token') return json(200, { id: 'user-id', email: 'someone@example.test' });
    return json(401, { msg: 'bad jwt' });
  }
  if (s.startsWith(`${SB}/rest/v1/`)) return postgrest(s, init);
  if (s.startsWith('https://api.revenuecat.com/')) {
    rc.calls.push({ url: s, auth: init.headers.Authorization });
    return json(rc.status, rc.body);
  }
  throw new Error(`unexpected fetch ${s}`);
};

const { handler, _internal } = require('../functions/books.js');

const call = async (method, { token = 'owner-token', query, body } = {}) => {
  const res = await handler({
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    queryStringParameters: query || {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = /json/.test(res.headers['Content-Type']) ? JSON.parse(res.body || '{}') : res.body;
  return { status: res.statusCode, headers: res.headers, body: parsed };
};
const get = (query, opts) => call('GET', { ...opts, query });
const post = (body, opts) => call('POST', { ...opts, body });

// ══ Auth ════════════════════════════════════════════════════════════
eq((await call('OPTIONS')).status, 204, 'OPTIONS');
const noTok = await get({ view: 'overview' }, { token: null });
eq(noTok.status, 401, 'no token → 401');
const badTok = await get({ view: 'overview' }, { token: 'forged' });
const nonOwner = await get({ view: 'overview' }, { token: 'user-token' });
eq(badTok.status, 401, 'bad token → 401');
eq(nonOwner.status, 401, 'non-owner → 401');
deq(nonOwner.body, badTok.body, 'non-owner gets the same body as a bad token');
eq((await post({ action: 'entry.add', entry: {} }, { token: 'user-token' })).status, 401, 'non-owner POST → 401');
eq(db.log.length, 0, 'refused callers never reach the database');
eq((await call('DELETE')).status, 405, 'DELETE method refused');

// ══ Not configured (SQL not run yet) ═══════════════════════════════
for (const view of ['overview', 'entries', 'config', 'recurring', 'export']) {
  const r = await get({ view });
  eq(r.status, 200, `${view} soft-fails with 200`);
  eq(r.body.ok, false, `${view} ok:false`);
  eq(r.body.reason, 'not_configured', `${view} reason`);
  ok(/books_2026_10\.sql/.test(r.body.hint), `${view} hint names the SQL file`);
  eq(r.headers['Cache-Control'], 'no-store', `${view} no-store`);
}
const pre = await post({ action: 'entry.add', entry: { occurred_on: '2026-03-01', kind: 'expense', category: 'hosting', amount_pence: 100 } });
eq(pre.body.reason, 'not_configured', 'POST soft-fails too');
const rcOff = await get({ view: 'revenuecat' });
eq(rcOff.body.reason, 'not_configured', 'RevenueCat not configured');
eq(rc.calls.length, 0, 'RevenueCat not called without env');
{
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await get({ view: 'overview' });
  eq(r.body.reason, 'not_configured', 'missing service key → not_configured');
  process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
}

db.installed = true;

// ══ Validation ══════════════════════════════════════════════════════
const manual = { occurred_on: '2026-03-01', kind: 'expense', category: 'hosting', amount_pence: 2500, description: 'Database plan' };
const added = await post({ action: 'entry.add', entry: manual });
eq(added.status, 200, 'manual add ok');
eq(added.body.entry.gbp_pence, 2500, 'gbp derived server-side');
eq(added.body.entry.source, 'manual', 'manual source');
const id1 = added.body.entry.id;
for (const [bad, field] of [
  [{ ...manual, amount_pence: 0 }, 'amount_pence'],
  [{ ...manual, kind: 'dividend' }, 'kind'],
  [{ ...manual, kind: 'income' }, 'category'],
  [{ ...manual, occurred_on: '2026-02-30' }, 'occurred_on'],
  [{ ...manual, currency: 'USD' }, 'gbp_pence'],
]) {
  const r = await post({ action: 'entry.add', entry: bad });
  eq(r.status, 400, `invalid ${field} → 400`);
  ok(r.body.errors && r.body.errors[field], `error names ${field}`);
}
eq((await post({ action: 'entry.add', entry: { ...manual, source: 'bank_csv', source_ref: 'bank:x' } })).status, 400, 'non-manual add refused');
eq((await post({ action: 'entry.add', entry: { ...manual, source: 'revenuecat', source_ref: 'rc:1' } })).status, 400, 'RevenueCat never booked');
eq((await post({ action: 'nope' })).status, 400, 'unknown action');
eq((await get({ view: 'nope' })).status, 400, 'unknown view');
eq((await call('POST', { body: undefined })).status, 400, 'empty body');
{
  const r = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer owner-token' }, body: '{not json' });
  eq(r.statusCode, 400, 'bad json');
}
eq(db.tables.books_entries.length, 1, 'only the valid entry was written');

// ══ Update ══════════════════════════════════════════════════════════
const up = await post({ action: 'entry.update', id: id1, patch: { amount_pence: 3000, source: 'apple', source_ref: 'apple:x', note: 'Upgraded plan' } });
eq(up.status, 200, 'update ok');
eq(up.body.entry.amount_pence, 3000, 'amount changed');
eq(up.body.entry.gbp_pence, 3000, 'gbp follows for GBP');
eq(up.body.entry.source, 'manual', 'source is not editable');
eq(up.body.entry.source_ref, null, 'source_ref is not editable');
const toUsd = await post({ action: 'entry.update', id: id1, patch: { currency: 'USD', fx_rate: 0.8 } });
eq(toUsd.body.entry.gbp_pence, 2400, 'currency change re-derives gbp from fx');
eq((await post({ action: 'entry.update', id: id1, patch: { kind: 'income' } })).status, 400, 'invalid update refused');
eq((await post({ action: 'entry.update', id: randomUUID(), patch: { note: 'x' } })).status, 404, 'unknown id');
eq((await post({ action: 'entry.update', id: 'nope', patch: { note: 'x' } })).status, 400, 'bad id');
await post({ action: 'entry.update', id: id1, patch: { currency: 'GBP' } });

// ══ Soft delete / restore ═══════════════════════════════════════════
const del = await post({ action: 'entry.delete', id: id1 });
eq(del.status, 200, 'delete ok');
ok(del.body.deleted_at, 'deleted_at set');
eq(db.tables.books_entries.length, 1, 'row still exists (soft delete)');
eq((await get({ view: 'overview', from: '2026-01-01', to: '2026-12-31' })).body.entries.length, 0, 'deleted rows leave the overview');
eq((await get({ view: 'entries', deleted: 'only' })).body.entries.length, 1, 'deleted rows listable for restore');
eq((await post({ action: 'entry.update', id: id1, patch: { note: 'x' } })).status, 409, 'deleted entries are not editable');
const del2 = await post({ action: 'entry.delete', id: id1 });
eq(del2.body.unchanged, true, 'delete is idempotent');
const res1 = await post({ action: 'entry.restore', id: id1 });
eq(res1.body.deleted_at, null, 'restore clears deleted_at');
eq((await get({ view: 'overview', from: '2026-01-01', to: '2026-12-31' })).body.entries.length, 1, 'restored row is back');
ok(!db.log.some(l => l.startsWith('DELETE')), 'no hard DELETE ever issued');

// ══ Import preview / commit de-dup ═════════════════════════════════
const BANK = [
  'Date,Description,Money out,Money in,Balance',
  '01/03/2026,SUPABASE INC,25.00,,974.00',
  '02/03/2026,APPLE DISTRIBUTION INTL PAYOUT,,412.37,1386.37',
  '03/03/2026,COFFEE SHOP,4.99,,1381.38',
  '03/03/2026,COFFEE SHOP,4.99,,1376.39',
  '04/03/2026,STRIPE PAYMENTS UK,,120.00,1496.39',
].join('\n');
const parsed = toEntries(null, parseCsv(BANK));
const before = db.tables.books_entries.length;
const logMark = db.log.length;
const prev = await post({ action: 'import.preview', source: 'bank-generic', rows: parsed.entries });
eq(prev.status, 200, 'preview ok');
deq(prev.body.counts, { add: 5, duplicates: 0, invalid: 0 }, 'preview: all new');
eq(db.tables.books_entries.length, before, 'preview never writes');
ok(!db.log.slice(logMark).some(l => /^(POST|PATCH)/.test(l)), 'preview issued only reads');
const com = await post({ action: 'import.commit', source: 'bank-generic', rows: parsed.entries });
eq(com.body.inserted, 5, 'commit inserts five');
eq(db.tables.books_entries.length, before + 5, 'five rows written');
ok(db.tables.books_entries.every(r => !('row' in r) && !('confidence' in r) && !('needs_fx' in r)), 'UI-only fields never stored');
const again = await post({ action: 'import.preview', source: 'bank-generic', rows: toEntries(null, parseCsv(BANK)).entries });
deq(again.body.counts, { add: 0, duplicates: 5, invalid: 0 }, 're-import of the same file: all duplicates');
const com2 = await post({ action: 'import.commit', source: 'bank-generic', rows: parsed.entries });
eq(com2.body.inserted, 0, 're-commit inserts nothing');
eq(com2.body.duplicates, 5, 're-commit reports duplicates');
eq(db.tables.books_entries.length, before + 5, 'no growth on re-commit');
// Duplicates within one batch, invalid rows, wrong source for the format.
const mixed = [
  { ...parsed.entries[0], source_ref: 'bank:fresh1' },
  { ...parsed.entries[0], source_ref: 'bank:fresh1', row: 7 },
  { ...parsed.entries[1], source_ref: 'bank:fresh2', category: 'not-a-category', row: 8 },
  { ...parsed.entries[1], source: 'apple', source_ref: 'apple:fresh3', row: 9 },
  { ...parsed.entries[1], source_ref: undefined, row: 10 },
];
const mp = await post({ action: 'import.preview', source: 'bank-generic', rows: mixed });
deq(mp.body.counts, { add: 1, duplicates: 1, invalid: 3 }, 'mixed batch split');
eq(mp.body.duplicates[0].reason, 'Repeated in this file', 'in-batch duplicate explained');
deq(mp.body.invalid.map(x => x.row), [8, 9, 10], 'invalid rows keep the client row numbers');
ok(mp.body.invalid.every(x => typeof x.reason === 'string' && x.reason), 'every invalid row has a reason');
eq((await post({ action: 'import.preview', source: 'paypal', rows: [] })).status, 400, 'unknown format refused');
eq((await post({ action: 'import.preview', source: 'bank-generic', rows: 'x' })).status, 400, 'rows must be an array');
eq((await post({ action: 'import.preview', source: 'bank-generic', rows: new Array(2001).fill({}) })).status, 400, 'row cap');
// Soft-deleted rows still count as present: a re-import never resurrects them.
const someBank = db.tables.books_entries.find(r => r.source === 'bank_csv');
await post({ action: 'entry.delete', id: someBank.id });
deq((await post({ action: 'import.preview', source: 'bank-generic', rows: parsed.entries })).body.counts.add, 0, 'deleted rows are not re-added');
await post({ action: 'entry.restore', id: someBank.id });

// ══ Overview payload + entries paging + search ═════════════════════
const ov = await get({ view: 'overview', from: '2026-03-01', to: '2026-03-31' });
eq(ov.body.ok, true, 'overview ok');
eq(ov.body.entries.length, 6, 'overview: manual + five imported');
deq(Object.keys(ov.body.entries[0]).sort(), ['amount_pence', 'category', 'currency', 'gbp_pence', 'id', 'kind', 'occurred_on', 'source'], 'overview projects only the needed columns');
const sum = summarise(ov.body.entries, { from: '2026-03-01', to: '2026-03-31' });
eq(sum.incomePence, 12000, 'client report: Stripe income only (payout is a transfer)');
eq(sum.expensePence, 3000 + 2500 + 499 + 499, 'client report: costs');
eq(sum.transferPence, 41237, 'payout excluded from profit');
deq(ov.body.prefs, {}, 'no prefs yet');
deq(ov.body.recurring, [], 'no bills yet');
const ovDefault = await get({ view: 'overview' });
ok(/^\d{4}-01-01$/.test(ovDefault.body.from) && /^\d{4}-12-31$/.test(ovDefault.body.to), 'overview defaults to the calendar year');

const p1 = await get({ view: 'entries', limit: '4' });
eq(p1.body.entries.length, 4, 'page 1');
ok(p1.body.nextBefore, 'cursor for page 2');
const p2 = await get({ view: 'entries', limit: '4', before: p1.body.nextBefore });
eq(p2.body.entries.length, 2, 'page 2');
eq(p2.body.nextBefore, null, 'no page 3');
eq(new Set([...p1.body.entries, ...p2.body.entries].map(r => r.id)).size, 6, 'pages do not overlap');
ok(p1.body.entries[0].occurred_on >= p1.body.entries[3].occurred_on, 'newest first');
const coffee = await get({ view: 'entries', q: 'coffee' });
eq(coffee.body.entries.length, 2, 'search finds both coffees');
eq((await get({ view: 'entries', q: 'coffee"),id.eq.(x' })).body.entries.length, 0, 'search syntax is neutralised, not injected');
eq(_internal.searchTerm('a"b*c(d),e'), 'a b c d e', 'searchTerm strips syntax');
eq((await get({ view: 'entries', kind: 'transfer' })).body.entries.length, 1, 'kind filter');
eq((await get({ view: 'entries', category: 'hosting' })).body.entries.length, 2, 'category filter');

// ══ Export ══════════════════════════════════════════════════════════
const ex = await get({ view: 'export', year: '2026' });
eq(ex.status, 200, 'export ok');
ok(/^text\/csv/.test(ex.headers['Content-Type']), 'export is text/csv');
ok(/books-2026\.csv/.test(ex.headers['Content-Disposition']), 'export filename');
eq(ex.headers['Cache-Control'], 'no-store', 'export no-store');
const exRows = parseCsv(ex.body);
eq(exRows.length, 7, 'header + six live rows');
const reimp = toEntries(null, exRows);
eq(reimp.format, 'books-native', 'export re-detected as books-native');
deq((await post({ action: 'import.preview', source: 'books-native', rows: reimp.entries })).body.counts, { add: 0, duplicates: 6, invalid: 0 }, 'export round trip: all duplicates');
eq(parseCsv((await get({ view: 'export', year: '2025' })).body).length, 1, 'other years: header only');
// Native rows with and without ids in one commit (restoring into an empty ledger).
{
  const saved = db.tables.books_entries;
  db.tables.books_entries = [];
  const mixedNative = [...reimp.entries, { ...reimp.entries[0], id: undefined, source: 'manual', source_ref: 'native:extra1', occurred_on: '2026-03-20' }];
  const r = await post({ action: 'import.commit', source: 'books-native', rows: mixedNative });
  eq(r.body.inserted, 7, 'mixed id / no-id native rows all restore');
  ok(reimp.entries.every(x => db.tables.books_entries.some(row => row.id === x.id)), 'round-tripped ids preserved');
  db.tables.books_entries = saved;
}

// ══ Config ══════════════════════════════════════════════════════════
eq((await post({ action: 'config.set', key: 'prefs', value: { defaultView: 'ytd', defaultCurrency: 'gbp', fx: { USD: 0.79 } } })).status, 200, 'prefs saved');
deq((await get({ view: 'config' })).body.prefs, { defaultView: 'ytd', defaultCurrency: 'GBP', fx: { USD: 0.79 } }, 'prefs read back, normalised');
eq((await post({ action: 'config.set', key: 'prefs', value: { defaultView: 'accounting-year' } })).status, 400, 'bad prefs refused');
eq((await post({ action: 'config.set', key: 'company', value: {} })).status, 400, 'no company config');
eq((await post({ action: 'config.set', key: 'shareholders', value: [] })).status, 400, 'no shareholders config');

// ══ Recurring ═══════════════════════════════════════════════════════
const billIn = { name: 'Database plan', kind: 'expense', category: 'hosting', amount_pence: 2000, cadence: 'monthly', next_due: '2026-01-31' };
const ba = await post({ action: 'recurring.add', bill: billIn });
eq(ba.status, 200, 'bill added');
eq(ba.body.bill.anchor_day, 31, 'anchor stored');
const billId = ba.body.bill.id;
eq((await post({ action: 'recurring.add', bill: { ...billIn, cadence: 'weekly' } })).status, 400, 'bad cadence refused');
const countBefore = db.tables.books_entries.length;
const post1 = await post({ action: 'recurring.post', upTo: '2026-04-30' });
eq(post1.body.posted, 4, 'four month-end postings');
eq(db.tables.books_entries.length, countBefore + 4, 'entries materialised');
deq(db.tables.books_entries.filter(r => r.source === 'recurring').map(r => r.occurred_on).sort(), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'], 'dates clamp to month end');
eq(db.tables.books_recurring[0].next_due, '2026-05-31', 'next_due advanced back to the 31st');
const post2 = await post({ action: 'recurring.post', upTo: '2026-04-30' });
eq(post2.body.posted, 0, 'second post is a no-op');
eq(db.tables.books_entries.length, countBefore + 4, 'no growth');
// Even with next_due rewound by hand, the refs stop a double post.
db.tables.books_recurring[0].next_due = '2026-01-31';
const post3 = await post({ action: 'recurring.post', upTo: '2026-04-30' });
eq(post3.body.posted, 0, 'rewound bill posts nothing new');
eq(post3.body.alreadyPosted, 4, 'reports the already-posted ones');
eq(db.tables.books_recurring[0].next_due, '2026-05-31', 'and still advances');
eq((await post({ action: 'recurring.post', upTo: '2099-01-01' })).status, 400, 'upTo capped at a year ahead');
eq((await post({ action: 'recurring.post', upTo: 'soon' })).status, 400, 'upTo must be a date');
const bu = await post({ action: 'recurring.update', id: billId, patch: { next_due: '2026-06-15', amount_pence: 2200 } });
eq(bu.body.bill.anchor_day, 15, 'moving the date re-anchors');
eq(bu.body.bill.amount_pence, 2200, 'amount updated');
const bd = await post({ action: 'recurring.delete', id: billId });
eq(bd.body.active, false, 'delete = inactive');
eq(db.tables.books_recurring.length, 1, 'bill row kept');
eq((await post({ action: 'recurring.post', upTo: '2026-12-31' })).body.posted, 0, 'inactive bill posts nothing');
eq((await get({ view: 'recurring' })).body.bills.length, 1, 'recurring view lists it');

// ══ RevenueCat (information only) ══════════════════════════════════
process.env.REVENUECAT_PROJECT_ID = 'proj_example1';
process.env.REVENUECAT_METRICS_API_KEY = 'sk_example_not_real';
_internal.rcCache.at = 0; _internal.rcCache.value = null;
const entriesBeforeRc = db.tables.books_entries.length;
const rcOn = await get({ view: 'revenuecat' });
deq([rcOn.body.ok, rcOn.body.mrr, rcOn.body.activeSubscriptions, rcOn.body.activeTrials, rcOn.body.revenue28d, rcOn.body.currency],
  [true, 123.45, 42, 7, 150.5, 'GBP'], 'RevenueCat overview shaped');
eq(rc.calls[0].url, 'https://api.revenuecat.com/v2/projects/proj_example1/metrics/overview?currency=GBP', 'endpoint URL');
eq(rc.calls[0].auth, 'Bearer sk_example_not_real', 'Bearer auth');
eq(db.tables.books_entries.length, entriesBeforeRc, 'RevenueCat figures are never booked');
await get({ view: 'revenuecat' });
eq(rc.calls.length, 1, 'cached between calls');
_internal.rcCache.at = 0;
rc.status = 403;
const rcBad = await get({ view: 'revenuecat' });
eq(rcBad.body.reason, 'unavailable', 'refused key → unavailable');
ok(!JSON.stringify(rcBad.body).includes('sk_example'), 'key never echoed');
_internal.rcCache.at = 0;
rc.status = 200; rc.body = { mrr: 10, active_subscriptions: 3, active_trials: 1, revenue_last_28_days: 12 };
eq((await get({ view: 'revenuecat' })).body.activeSubscriptions, 3, 'flat shape tolerated');
_internal.rcCache.at = 0;
rc.body = { something: 'else' };
eq((await get({ view: 'revenuecat' })).body.reason, 'unavailable', 'unknown shape → unavailable');

// ══ Database errors stay generic ═══════════════════════════════════
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes('/rest/v1/') ? json(500, { message: 'internal detail' }) : realFetch(url, init));
  const r = await get({ view: 'config' });
  eq(r.status, 500, 'upstream failure → 500');
  deq(r.body, { error: 'failed' }, 'generic error body');
  globalThis.fetch = realFetch;
}

console.log(`books function: ${n} checks passed`);
