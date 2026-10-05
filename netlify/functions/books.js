/**
 * Netlify function: books — the owner's bookkeeping (Upgrade → Books).
 * OWNER-ONLY on every route, exactly like security-console.js: the JWT is
 * verified with Supabase (requireUser) and the VERIFIED email is checked
 * against OWNER_EMAIL (isOwnerEmail). A non-owner gets the same 401 as a
 * bad token. Upgrade's useIsOwner is a UI gate only.
 *
 * Books produces clean figures and an export for an accountant. It files
 * nothing with HMRC or Companies House.
 *
 * Storage: supabase/books_2026_10.sql (books_entries, books_recurring,
 * books_config). Until that is run, every route answers 200
 * { ok:false, reason:'not_configured', hint } (GET views and POST actions
 * alike), so the UI can show its setup card.
 *
 *   GET ?view=overview&from=YYYY-MM-DD&to=YYYY-MM-DD
 *         → { ok, from, to, entries:[{ id, occurred_on, kind, category,
 *             amount_pence, currency, gbp_pence, source }], prefs, recurring }
 *           (live rows only; the client builds reports with src/lib/books)
 *           from/to default to the current calendar year.
 *       ?view=entries&from&to&q&category&kind&source&limit&before&deleted=only
 *         → { ok, entries:[full rows], nextBefore }   newest first, keyset
 *           paged: pass nextBefore back as `before`. limit 1..200 (50).
 *       ?view=config     → { ok, prefs }
 *       ?view=recurring  → { ok, bills }
 *       ?view=export&year=YYYY  (or &from&to)
 *         → text/csv, Books' native format (src/lib/books/importers.js
 *           NATIVE_HEADERS), live rows of that calendar year. Re-importable.
 *       ?view=revenuecat → { ok, mrr, activeSubscriptions, activeTrials,
 *           revenue28d, currency, fetchedAt } — INFORMATION ONLY. Never
 *           booked: income comes from store reports / bank, so booking
 *           RevenueCat too would count the same sales twice.
 *
 *   POST { action, … }
 *       entry.add      { entry }              manual entries only
 *       entry.update   { id, patch }          EDITABLE fields only
 *       entry.delete   { id }                 soft: sets deleted_at
 *       entry.restore  { id }                 clears deleted_at
 *       import.preview { source, rows }       source = import format
 *         ('bank-generic' | 'apple-financial' | 'google-earnings' |
 *         'books-native'); rows = entries from importers.toEntries.
 *         → { ok, add, duplicates, invalid, counts }   NO writes
 *       import.commit  { source, rows }       inserts with
 *         on conflict (source, source_ref) do nothing
 *         → { ok, inserted, duplicates, invalid, invalidRows }
 *       config.set     { key:'prefs', value }
 *       recurring.add    { bill }
 *       recurring.update { id, patch }
 *       recurring.delete { id }               sets active = false
 *       recurring.post   { upTo? }            due bills → entries (source
 *         'recurring', source_ref 'recurring:<id>:<date>'), idempotent;
 *         advances next_due. upTo defaults to today, at most a year ahead.
 *
 * Every write is validated with lib/booksCore.js — the CommonJS mirror of
 * the client's src/lib/books rules, parity-tested by books.test.mjs.
 * Nothing in Books is ever hard-deleted by this function.
 *
 * Micro DB: projections only, keyset paging, de-dup lookups in chunks,
 * no full-table reads; the RevenueCat answer is cached 10 min per instance.
 * Never logs a figure, a description or a key.
 *
 * Env (names only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL;
 * optional REVENUECAT_PROJECT_ID + REVENUECAT_METRICS_API_KEY (falls back
 * to REVENUECAT_SECRET_API_KEY).
 */
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { isOwnerEmail } = require('../lib/owner');
const { pageAll, chunk } = require('../lib/pgPage');
const B = require('../lib/booksCore');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });
const denied = () => reply(401, { error: 'session expired — sign in again' });

const HINT_SQL = 'Run supabase/books_2026_10.sql in the Supabase SQL editor — it creates the three Books tables (service-role only, additive).';
const HINT_ENV = 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for functions.';
const notConfigured = (hint = HINT_SQL) => reply(200, { ok: false, reason: 'not_configured', hint });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 8000;
const MAX_BODY = 2 * 1024 * 1024;
const enc = encodeURIComponent;

const OVERVIEW_COLS = 'id,occurred_on,kind,category,amount_pence,currency,gbp_pence,source';
const ENTRY_COLS = 'id,occurred_on,kind,category,amount_pence,currency,fx_rate,gbp_pence,vat_pence,counterparty,description,source,source_ref,note,created_at,updated_at,deleted_at';
const EXPORT_COLS = 'id,occurred_on,kind,category,amount_pence,currency,fx_rate,gbp_pence,vat_pence,counterparty,description,source,source_ref,note';
const BILL_COLS = 'id,name,kind,category,amount_pence,currency,gbp_pence,cadence,next_due,anchor_day,active,note,created_at,updated_at';
const BILL_EDITABLE = ['name', 'kind', 'category', 'amount_pence', 'currency', 'gbp_pence', 'cadence', 'next_due', 'anchor_day', 'active', 'note'];

// ── Supabase REST ────────────────────────────────────────────────────

class NotConfigured extends Error {}

function env() {
  return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
}

async function timed(url, init = {}, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

function rest(e, path, init = {}) {
  return timed(`${e.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: e.key,
      Authorization: `Bearer ${e.key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

// PostgREST's answers for "that table / column isn't there yet".
const MISSING_CODES = new Set(['42P01', 'PGRST205', 'PGRST204', '42703', 'PGRST200']);

/** Throws NotConfigured for a missing table, Error otherwise; returns res when OK. */
async function need(res, what) {
  if (res.ok) return res;
  let code = null;
  try { code = (await res.clone().json())?.code || null; } catch { /* not json */ }
  if (res.status === 404 || MISSING_CODES.has(code)) throw new NotConfigured(what);
  const err = new Error(`${what} ${res.status}`);
  err.status = res.status;
  throw err;
}

async function readJson(res, what) {
  await need(res, what);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

function range(q) {
  const y = todayIso().slice(0, 4);
  let from = B.isIsoDate(q.from) ? q.from : `${y}-01-01`;
  let to = B.isIsoDate(q.to) ? q.to : `${y}-12-31`;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

async function readPrefs(e) {
  const rows = await readJson(await rest(e, 'books_config?key=eq.prefs&select=value'), 'config read');
  return rows[0]?.value && typeof rows[0].value === 'object' ? rows[0].value : {};
}

async function readBills(e) {
  return readJson(await rest(e, `books_recurring?select=${BILL_COLS}&order=active.desc,next_due.asc,id.asc&limit=500`), 'recurring read');
}

// ── GET views ────────────────────────────────────────────────────────

async function overview(e, q) {
  const { from, to } = range(q);
  const entries = await pageAll((offset, limit) => rest(e,
    `books_entries?select=${OVERVIEW_COLS}&deleted_at=is.null&occurred_on=gte.${from}&occurred_on=lte.${to}`
    + `&order=occurred_on.asc,id.asc&limit=${limit}&offset=${offset}`), { what: 'books overview', maxPages: 20 })
    .catch(err => { if (err.status === 404) throw new NotConfigured('entries'); throw err; });
  const [prefs, recurring] = await Promise.all([readPrefs(e), readBills(e)]);
  return { ok: true, from, to, entries, prefs, recurring, generatedAt: new Date().toISOString() };
}

/** Strip PostgREST/LIKE syntax from a search term; quote it for or=(). */
function searchTerm(q) {
  const s = String(q || '').replace(/["\\*%(),]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || null;
}

async function entriesView(e, q) {
  const limit = Math.max(1, Math.min(200, parseInt(q.limit, 10) || 50));
  const parts = [];
  if (q.deleted === 'only') parts.push('deleted_at=not.is.null'); else parts.push('deleted_at=is.null');
  if (B.isIsoDate(q.from)) parts.push(`occurred_on=gte.${q.from}`);
  if (B.isIsoDate(q.to)) parts.push(`occurred_on=lte.${q.to}`);
  if (B.KINDS.includes(q.kind)) parts.push(`kind=eq.${q.kind}`);
  if (typeof q.category === 'string' && /^[a-z0-9-]{1,40}$/.test(q.category)) parts.push(`category=eq.${q.category}`);
  if (B.SOURCES.includes(q.source)) parts.push(`source=eq.${q.source}`);
  const and = [];
  const term = searchTerm(q.q);
  if (term) {
    const t = `"*${term}*"`;
    and.push(`or(description.ilike.${t},counterparty.ilike.${t},note.ilike.${t})`);
  }
  // Keyset cursor: "<occurred_on>_<id>" of the last row of the previous page.
  const m = typeof q.before === 'string' && q.before.match(/^(\d{4}-\d{2}-\d{2})_([0-9a-f-]{36})$/i);
  if (m && B.isIsoDate(m[1]) && UUID.test(m[2])) {
    and.push(`or(occurred_on.lt.${m[1]},and(occurred_on.eq.${m[1]},id.lt.${m[2].toLowerCase()}))`);
  }
  if (and.length) parts.push(`and=${enc(`(${and.join(',')})`)}`);
  const rows = await readJson(await rest(e,
    `books_entries?select=${ENTRY_COLS}&${parts.join('&')}&order=occurred_on.desc,id.desc&limit=${limit + 1}`), 'entries read');
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { ok: true, entries: page, nextBefore: rows.length > limit && last ? `${last.occurred_on}_${last.id}` : null };
}

async function exportCsv(e, q) {
  let from; let to; let name;
  if (/^\d{4}$/.test(String(q.year || ''))) {
    from = `${q.year}-01-01`; to = `${q.year}-12-31`; name = `books-${q.year}.csv`;
  } else {
    ({ from, to } = range(q));
    name = `books-${from}-to-${to}.csv`;
  }
  const rows = await pageAll((offset, limit) => rest(e,
    `books_entries?select=${EXPORT_COLS}&deleted_at=is.null&occurred_on=gte.${from}&occurred_on=lte.${to}`
    + `&order=occurred_on.asc,id.asc&limit=${limit}&offset=${offset}`), { what: 'books export', maxPages: 50 })
    .catch(err => { if (err.status === 404) throw new NotConfigured('entries'); throw err; });
  return {
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
    body: B.nativeCsv(rows),
  };
}

// ── RevenueCat (information only) ────────────────────────────────────
// Endpoint: GET https://api.revenuecat.com/v2/projects/{project_id}/metrics/overview
// (optional ?currency=), Authorization: Bearer <v2 secret key with the
// charts_metrics:overview:read permission>. Path, currency parameter and
// permission name from RevenueCat's API v2 reference and changelog
// ("New REST API v2 functionality: app management, overview metrics",
// 2023-11-02) as quoted by search results on 2026-10-05:
//   https://www.revenuecat.com/docs/api-v2
//   https://www.revenuecat.com/changelog/release/new-rest-api-v2-functionality-app-management-overview-metrics-2023-11-02
// TODO UNVERIFIED: revenuecat.com was blocked from the build container, so
// the RESPONSE SHAPE (metric ids / fields) and whether a v2 secret key (vs
// an OAuth token) is accepted were not confirmed — shapeRevenueCatOverview
// reads several shapes, and a refusal surfaces as `unavailable` with a hint.
const REVENUECAT_OVERVIEW_URL = 'https://api.revenuecat.com/v2/projects/{project_id}/metrics/overview';
const RC_TTL = 10 * 60_000;
const rcCache = { at: 0, value: null };

async function readRevenueCatOverview() {
  const key = process.env.REVENUECAT_METRICS_API_KEY || process.env.REVENUECAT_SECRET_API_KEY;
  const project = process.env.REVENUECAT_PROJECT_ID;
  if (!key || !project) {
    return { ok: false, reason: 'not_configured', hint: 'Set REVENUECAT_PROJECT_ID and REVENUECAT_METRICS_API_KEY (a v2 secret key with charts_metrics:overview:read) in Netlify, Functions scope.' };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(project)) return { ok: false, reason: 'not_configured', hint: 'REVENUECAT_PROJECT_ID does not look like a project id.' };
  if (rcCache.value && Date.now() - rcCache.at < RC_TTL) return rcCache.value;
  let value;
  try {
    const url = `${REVENUECAT_OVERVIEW_URL.replace('{project_id}', enc(project))}?currency=GBP`;
    const res = await timed(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) {
      value = { ok: false, reason: 'unavailable', hint: 'RevenueCat refused the key — it needs to be a v2 secret key with the charts_metrics:overview:read permission.' };
    } else if (!res.ok) {
      value = { ok: false, reason: 'unavailable', hint: `RevenueCat answered ${res.status}.` };
    } else {
      const shaped = B.shapeRevenueCatOverview(await res.json(), 'GBP');
      value = shaped
        ? { ok: true, ...shaped, fetchedAt: new Date().toISOString(), informationOnly: true }
        : { ok: false, reason: 'unavailable', hint: 'RevenueCat answered in a shape Books does not recognise.' };
    }
  } catch {
    value = { ok: false, reason: 'unavailable', hint: 'RevenueCat did not answer.' };
  }
  rcCache.at = Date.now();
  rcCache.value = value;
  return value;
}

// ── Entries ──────────────────────────────────────────────────────────

/** The columns a write may set — a projection, so UI-only fields (row, confidence, needs_fx) never reach the DB. */
const WRITE_COLS = ['occurred_on', 'kind', 'category', 'amount_pence', 'currency', 'fx_rate', 'gbp_pence', 'vat_pence', 'counterparty', 'description', 'source', 'source_ref', 'note'];
const writable = entry => {
  const out = {};
  for (const k of WRITE_COLS) out[k] = entry[k] ?? null;
  if (entry.id) out.id = entry.id;
  return out;
};

async function entryAdd(e, b) {
  const entry = B.normaliseEntry(b.entry);
  delete entry.id;
  if (entry.source !== 'manual') return [400, { error: 'only manual entries can be added here — use import for files' }];
  const v = B.validateEntry(entry);
  if (!v.ok) return [400, { error: 'invalid entry', errors: v.errors }];
  const rows = await readJson(await rest(e, `books_entries?select=${ENTRY_COLS}`, {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(writable(entry)),
  }), 'entry add');
  return [200, { ok: true, entry: rows[0] || null }];
}

async function readEntry(e, id) {
  const rows = await readJson(await rest(e, `books_entries?id=eq.${id}&select=${ENTRY_COLS}`), 'entry read');
  return rows[0] || null;
}

async function entryUpdate(e, b) {
  const id = String(b.id || '').toLowerCase();
  if (!UUID.test(id)) return [400, { error: 'id required' }];
  if (!b.patch || typeof b.patch !== 'object') return [400, { error: 'patch required' }];
  const cur = await readEntry(e, id);
  if (!cur) return [404, { error: 'no such entry' }];
  if (cur.deleted_at) return [409, { error: 'restore the entry before editing it' }];
  const patch = {};
  for (const k of B.EDITABLE) if (Object.prototype.hasOwnProperty.call(b.patch, k)) patch[k] = b.patch[k];
  if (!Object.keys(patch).length) return [400, { error: 'nothing to change' }];
  const merged = { ...cur, ...patch, fx_rate: patch.fx_rate !== undefined ? patch.fx_rate : (cur.fx_rate == null ? null : Number(cur.fx_rate)) };
  // A new amount, rate or currency without a new GBP value: re-derive it.
  if (!('gbp_pence' in patch) && ('amount_pence' in patch || 'fx_rate' in patch || 'currency' in patch)) merged.gbp_pence = null;
  const next = B.normaliseEntry(merged);
  const v = B.validateEntry(next);
  if (!v.ok) return [400, { error: 'invalid entry', errors: v.errors }];
  const body = { updated_at: new Date().toISOString() };
  for (const k of B.EDITABLE) body[k] = next[k] ?? null;
  const rows = await readJson(await rest(e, `books_entries?id=eq.${id}&deleted_at=is.null&select=${ENTRY_COLS}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body),
  }), 'entry update');
  if (!rows.length) return [409, { error: 'the entry changed — reload and try again' }];
  return [200, { ok: true, entry: rows[0] }];
}

async function entrySoftDelete(e, b, restore) {
  const id = String(b.id || '').toLowerCase();
  if (!UUID.test(id)) return [400, { error: 'id required' }];
  const now = new Date().toISOString();
  const filter = restore ? 'deleted_at=not.is.null' : 'deleted_at=is.null';
  const rows = await readJson(await rest(e, `books_entries?id=eq.${id}&${filter}&select=id,deleted_at`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ deleted_at: restore ? null : now, updated_at: now }),
  }), restore ? 'entry restore' : 'entry delete');
  if (rows.length) return [200, { ok: true, id, deleted_at: rows[0].deleted_at }];
  // Nothing changed: either already in the wanted state (idempotent) or no such row.
  const cur = await readEntry(e, id);
  if (!cur) return [404, { error: 'no such entry' }];
  return [200, { ok: true, id, deleted_at: cur.deleted_at, unchanged: true }];
}

// ── Import ───────────────────────────────────────────────────────────

/** Which of these (source, ref) pairs and ids already exist — deleted rows included. */
async function existingFor(e, rows) {
  const refsBySource = new Map();
  const ids = [];
  for (const r of rows) {
    const n = B.normaliseEntry(r);
    if (n.source_ref && B.SOURCES.includes(n.source) && /^[A-Za-z0-9:._-]{1,200}$/.test(n.source_ref)) {
      if (!refsBySource.has(n.source)) refsBySource.set(n.source, new Set());
      refsBySource.get(n.source).add(n.source_ref);
    }
    if (n.id) ids.push(n.id);
  }
  const refs = new Set();
  for (const [source, set] of refsBySource) {
    for (const part of chunk([...set], 100)) {
      const list = part.map(r => `"${r}"`).join(',');
      const found = await readJson(await rest(e,
        `books_entries?select=source,source_ref&source=eq.${source}&source_ref=in.${enc(`(${list})`)}&limit=1000`), 'dedup read');
      for (const f of found) refs.add(`${f.source}|${f.source_ref}`);
    }
  }
  const idSet = new Set();
  for (const part of chunk([...new Set(ids)], 100)) {
    const found = await readJson(await rest(e, `books_entries?select=id&id=in.(${part.join(',')})&limit=1000`), 'dedup id read');
    for (const f of found) idSet.add(f.id);
  }
  return { refs, ids: idSet };
}

function importArgs(b) {
  if (!B.IMPORT_FORMATS.includes(b.source)) return { error: `source must be one of ${B.IMPORT_FORMATS.join(', ')}` };
  if (!Array.isArray(b.rows)) return { error: 'rows must be an array' };
  if (b.rows.length > B.MAX_IMPORT_ROWS) return { error: `at most ${B.MAX_IMPORT_ROWS} rows per request — send the file in parts` };
  return { format: b.source, rows: b.rows };
}

async function importPreview(e, b) {
  const a = importArgs(b);
  if (a.error) return [400, { error: a.error }];
  const plan = B.planImport(a.format, a.rows, await existingFor(e, a.rows));
  return [200, {
    ok: true, ...plan,
    counts: { add: plan.add.length, duplicates: plan.duplicates.length, invalid: plan.invalid.length },
  }];
}

/** Insert entries, skipping any (source, source_ref) already present. → number inserted. */
async function insertIgnoringDuplicates(e, entries, what) {
  let inserted = 0;
  // PostgREST bulk inserts need every object to carry the same keys
  // (PGRST102), and `id` is only present on round-tripped exports — so rows
  // with and without an id go in separate batches.
  const withId = entries.filter(x => x.id);
  const withoutId = entries.filter(x => !x.id);
  for (const part of [...chunk(withoutId, 500), ...chunk(withId, 500)]) {
    const rows = await readJson(await rest(e, 'books_entries?on_conflict=source,source_ref&select=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(part.map(writable)),
    }), what);
    inserted += rows.length;
  }
  return inserted;
}

async function importCommit(e, b) {
  const a = importArgs(b);
  if (a.error) return [400, { error: a.error }];
  const plan = B.planImport(a.format, a.rows, await existingFor(e, a.rows));
  const inserted = plan.add.length ? await insertIgnoringDuplicates(e, plan.add, 'import commit') : 0;
  return [200, {
    ok: true,
    inserted,
    duplicates: plan.duplicates.length + (plan.add.length - inserted),
    invalid: plan.invalid.length,
    invalidRows: plan.invalid.slice(0, 200),
  }];
}

// ── Config ───────────────────────────────────────────────────────────

async function configSet(e, b) {
  const check = B.CONFIG_KEYS[b.key];
  if (!check) return [400, { error: `unknown config key — one of ${Object.keys(B.CONFIG_KEYS).join(', ')}` }];
  const v = check(b.value);
  if (!v.ok) return [400, { error: v.error }];
  await need(await rest(e, 'books_config?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: b.key, value: v.value, updated_at: new Date().toISOString() }),
  }), 'config set');
  return [200, { ok: true, key: b.key, value: v.value }];
}

// ── Recurring ────────────────────────────────────────────────────────

const billRow = r => {
  const out = {};
  for (const k of BILL_EDITABLE) out[k] = r[k] ?? null;
  out.active = r.active !== false;
  return out;
};

async function recurringAdd(e, b) {
  const bill = B.normaliseRecurring(b.bill);
  delete bill.id;
  const v = B.validateRecurring(bill);
  if (!v.ok) return [400, { error: 'invalid bill', errors: v.errors }];
  const rows = await readJson(await rest(e, `books_recurring?select=${BILL_COLS}`, {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(billRow(bill)),
  }), 'recurring add');
  return [200, { ok: true, bill: rows[0] || null }];
}

async function readBill(e, id) {
  const rows = await readJson(await rest(e, `books_recurring?id=eq.${id}&select=${BILL_COLS}`), 'recurring read');
  return rows[0] || null;
}

async function recurringUpdate(e, b) {
  const id = String(b.id || '').toLowerCase();
  if (!UUID.test(id)) return [400, { error: 'id required' }];
  if (!b.patch || typeof b.patch !== 'object') return [400, { error: 'patch required' }];
  const cur = await readBill(e, id);
  if (!cur) return [404, { error: 'no such bill' }];
  const patch = {};
  for (const k of BILL_EDITABLE) if (Object.prototype.hasOwnProperty.call(b.patch, k)) patch[k] = b.patch[k];
  if (!Object.keys(patch).length) return [400, { error: 'nothing to change' }];
  const merged = { ...cur, ...patch };
  // A moved due date without an explicit day re-anchors on the new date.
  if ('next_due' in patch && !('anchor_day' in patch)) merged.anchor_day = null;
  const next = B.normaliseRecurring(merged);
  const v = B.validateRecurring(next);
  if (!v.ok) return [400, { error: 'invalid bill', errors: v.errors }];
  const rows = await readJson(await rest(e, `books_recurring?id=eq.${id}&select=${BILL_COLS}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...billRow(next), updated_at: new Date().toISOString() }),
  }), 'recurring update');
  return [200, { ok: true, bill: rows[0] || null }];
}

async function recurringDelete(e, b) {
  const id = String(b.id || '').toLowerCase();
  if (!UUID.test(id)) return [400, { error: 'id required' }];
  const rows = await readJson(await rest(e, `books_recurring?id=eq.${id}&select=id,active`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
  }), 'recurring delete');
  if (!rows.length) return [404, { error: 'no such bill' }];
  return [200, { ok: true, id, active: false }];
}

async function recurringPost(e, b) {
  const today = todayIso();
  const upTo = b.upTo == null || b.upTo === '' ? today : String(b.upTo);
  if (!B.isIsoDate(upTo)) return [400, { error: 'upTo must be YYYY-MM-DD' }];
  if (upTo > addDays(today, 366)) return [400, { error: 'upTo can be at most a year ahead' }];
  const bills = await readJson(await rest(e,
    `books_recurring?select=${BILL_COLS}&active=is.true&next_due=lte.${upTo}&order=next_due.asc&limit=200`), 'recurring due');
  let posted = 0; let due = 0; let advanced = 0; const invalidBills = [];
  for (const bill of bills) {
    const { entries, nextDue } = B.postingsFor(bill, upTo);
    if (!entries.length) continue;
    // A bill whose postings don't validate (e.g. edited into a bad state by
    // hand) is left where it is — never advanced past bills it didn't post.
    if (!entries.every(x => B.validateEntry(x).ok)) { invalidBills.push(bill.id); continue; }
    due += entries.length;
    posted += await insertIgnoringDuplicates(e, entries, 'recurring post');
    // Guarded on the old next_due, so two overlapping posts can't double-advance.
    const res = await rest(e, `books_recurring?id=eq.${bill.id}&next_due=eq.${bill.next_due}&select=id`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ next_due: nextDue, updated_at: new Date().toISOString() }),
    });
    if ((await readJson(res, 'recurring advance')).length) advanced++;
  }
  return [200, { ok: true, upTo, bills: bills.length, due, posted, alreadyPosted: due - posted, advanced, invalidBills }];
}

// ── Handler ──────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return reply(405, { error: 'method not allowed' });

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!isOwnerEmail(auth.email)) return denied();
  if (!underLimit('books', auth.userId, 120)) return tooMany(CORS);

  const e = env();
  if (!e.url || !e.key) return notConfigured(HINT_ENV);

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      switch (q.view) {
        case 'overview': return reply(200, await overview(e, q));
        case 'entries': return reply(200, await entriesView(e, q));
        case 'config': return reply(200, { ok: true, prefs: await readPrefs(e) });
        case 'recurring': return reply(200, { ok: true, bills: await readBills(e) });
        case 'export': return await exportCsv(e, q);
        case 'revenuecat': return reply(200, await readRevenueCatOverview());
        default: return reply(400, { error: 'unknown view' });
      }
    }

    if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY) return reply(413, { error: 'too large — send the file in parts' });
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'invalid json' }); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return reply(400, { error: 'invalid body' });

    let out;
    switch (b.action) {
      case 'entry.add': out = await entryAdd(e, b); break;
      case 'entry.update': out = await entryUpdate(e, b); break;
      case 'entry.delete': out = await entrySoftDelete(e, b, false); break;
      case 'entry.restore': out = await entrySoftDelete(e, b, true); break;
      case 'import.preview': out = await importPreview(e, b); break;
      case 'import.commit':
        if (!underLimit('books-import', auth.userId, 20)) return tooMany(CORS);
        out = await importCommit(e, b);
        break;
      case 'config.set': out = await configSet(e, b); break;
      case 'recurring.add': out = await recurringAdd(e, b); break;
      case 'recurring.update': out = await recurringUpdate(e, b); break;
      case 'recurring.delete': out = await recurringDelete(e, b); break;
      case 'recurring.post':
        if (!underLimit('books-post', auth.userId, 10)) return tooMany(CORS);
        out = await recurringPost(e, b);
        break;
      default: return reply(400, { error: 'unknown action' });
    }
    return reply(out[0], out[1]);
  } catch (err) {
    if (err instanceof NotConfigured) return notConfigured();
    console.error('books:', err?.message);
    return reply(500, { error: 'failed' });
  }
};

// For tests only.
exports._internal = { searchTerm, rcCache, REVENUECAT_OVERVIEW_URL };
