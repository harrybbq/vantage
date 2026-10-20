/**
 * Item 83: the profiles column grants and every client query agree.
 *
 * Once supabase/privacy_lockdown_2026_10b.sql has run, a select naming a
 * column outside the granted list is refused outright ("permission
 * denied for column …") — not filtered, refused, so the whole query
 * fails and the surface that made it goes blank. This test is what
 * stops that from shipping:
 *
 *   1. PUBLIC_PROFILE_COLUMNS matches the SQL file's `grant select (…)`.
 *   2. Every `from('profiles')` chain in src/ selects only those columns
 *      (a bare `.select()` or `'*'` counts as every column). The LEGACY
 *      fallbacks — reached only while the RPC that replaces them is
 *      missing — are allowed in profileReads.js and nowhere else.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './profileColumns.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const PUBLIC = new Set(C.PUBLIC_PROFILE_COLUMNS);
const cols = s => s.split(',').map(c => c.trim()).filter(Boolean)
  // "alias:column" and "column::cast" → column
  .map(c => c.replace(/^[a-z_]+:/i, '').replace(/::.*$/, ''));

// ── 1. The SQL grant list is the client's list ──
{
  const sql = readFileSync(join(root, 'supabase', 'privacy_lockdown_2026_10b.sql'), 'utf8')
    .replace(/--.*$/gm, '');
  const m = sql.match(/grant\s+select\s*\(([^)]*)\)\s*on\s+(?:table\s+)?public\.profiles\s+to\s+authenticated/i);
  ok(m, 'SQL grants a SELECT column list on profiles to authenticated');
  eq(new Set(cols(m[1])), PUBLIC, 'SQL column list === PUBLIC_PROFILE_COLUMNS');
  ok(/revoke\s+select\s+on\s+(?:table\s+)?public\.profiles\s+from\s+authenticated/i.test(sql),
    'the table-wide SELECT is revoked first (a table grant beats a column list)');
  for (const priv of ['tier', 'last_active_at', 'ratings', 'prestige_baseline', 'is_searchable', 'leaderboard_optin']) {
    ok(!PUBLIC.has(priv), `${priv} is not public`);
  }
}

// ── 2. The shared select constants only name public columns ──
for (const name of ['PUBLIC_PROFILE_SELECT', 'OWN_WRITE_RETURNING']) {
  for (const c of cols(C[name])) ok(PUBLIC.has(c), `${name}: ${c} is granted`);
}

// ── 3. Source scan ──
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(f) && !/\.test\.mjs$/.test(f)) out.push(p);
  }
  return out;
}

/** The argument text of the call whose "(" is at `open`. */
function callArg(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i).trim();
  }
  return null;
}

const KNOWN = new Set(['PUBLIC_PROFILE_SELECT', 'OWN_WRITE_RETURNING']);
const LEGACY = new Set(['LEGACY_OWN_PROFILE_SELECT', 'LEGACY_PRESENCE_SELECT']);
const LEGACY_HOME = 'src/lib/friends/profileReads.js';

function checkSelect(arg, file, src, where) {
  if (arg === '') return [`${where}: bare .select() means every column`];
  const lit = arg.match(/^(['"`])([\s\S]*)\1$/);
  if (lit) {
    if (lit[2].includes('${')) return [`${where}: template select — name the columns`];
    return cols(lit[2]).filter(c => !PUBLIC.has(c)).map(c => `${where}: selects "${c}"`);
  }
  if (KNOWN.has(arg)) return [];
  if (LEGACY.has(arg)) return file === LEGACY_HOME ? [] : [`${where}: ${arg} outside ${LEGACY_HOME}`];
  // A parameter: `const run = cols => supabase.from('profiles').select(cols)`
  // → check every literal passed to run(...).
  const fn = src.match(new RegExp(`const\\s+(\\w+)\\s*=\\s*\\(?\\s*${arg}\\s*\\)?\\s*=>`));
  if (fn) {
    const errs = [];
    const re = new RegExp(`\\b${fn[1]}\\(`, 'g');
    let m, calls = 0;
    while ((m = re.exec(src))) {
      const a = callArg(src, m.index + m[0].length - 1);
      if (a === arg) continue; // the definition's own parameter list
      calls++;
      errs.push(...checkSelect(a, file, src, `${where} via ${fn[1]}()`));
    }
    return calls ? errs : [`${where}: ${fn[1]}() is never called with a literal`];
  }
  return [`${where}: can't resolve select(${arg})`];
}

const problems = [];
let chains = 0;
for (const path of walk(join(root, 'src'))) {
  const file = relative(root, path).split('\\').join('/');
  const src = readFileSync(path, 'utf8');
  const re = /\.from\(\s*(['"`])profiles\1\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    chains++;
    const line = src.slice(0, m.index).split('\n').length;
    // The chain runs to the end of the statement.
    const end = src.indexOf(';', m.index);
    const chain = src.slice(m.index, end === -1 ? undefined : end);
    const sre = /\.select\(/g;
    let s;
    while ((s = sre.exec(chain))) {
      const arg = callArg(chain, s.index + s[0].length - 1);
      problems.push(...checkSelect(arg ?? '', file, src, `${file}:${line}`));
    }
  }
}
ok(chains >= 6, `found the profiles queries (${chains})`);
eq(problems, [], 'every client select on profiles names granted columns only');

// ── 4. The scanner itself catches what it should ──
{
  const f = 'src/x.js';
  ok(checkSelect("'id, tier'", f, '', 'x').length === 1, 'catches an ungranted column');
  ok(checkSelect("'*'", f, '', 'x').length === 1, "catches '*'");
  ok(checkSelect('', f, '', 'x').length === 1, 'catches a bare select()');
  ok(checkSelect('LEGACY_OWN_PROFILE_SELECT', f, '', 'x').length === 1, 'legacy outside its home');
  ok(checkSelect('LEGACY_OWN_PROFILE_SELECT', LEGACY_HOME, '', 'x').length === 0, 'legacy in its home');
  ok(checkSelect("'id, handle'", f, '', 'x').length === 0, 'public columns pass');
  const src = "const run = cols => q.select(cols); run('id, last_active_at');";
  ok(checkSelect('cols', f, src, 'x').length === 1, 'follows a parameter to its call sites');
}

console.log(`profileColumns: ${n} checks passed (${chains} profiles queries scanned)`);
