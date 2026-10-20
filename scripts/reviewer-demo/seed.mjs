#!/usr/bin/env node
/**
 * Seed the App Review demo accounts (STARTUP_REQUIREMENTS item 122).
 * Steps and the reasons: docs/REVIEWER_KIT.md. Rules: plan.mjs.
 *
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… \
 *   node scripts/reviewer-demo/seed.mjs \
 *     --allow pro@co.example,free@co.example,f1@co.example,f2@co.example \
 *     --pro pro@co.example --free free@co.example \
 *     --friend f1@co.example --friend f2@co.example \
 *     [--create] [--write]
 *
 * Without --write it is a DRY RUN: it reads, decides and prints the
 * plan, and writes nothing. The service key is read from the
 * environment at run time (SUPABASE_SECRET_KEY, or the legacy
 * SUPABASE_SERVICE_ROLE_KEY) and must never be committed or pasted into
 * a file in the repo. --create needs DEMO_ACCOUNT_PASSWORD in the
 * environment; it is used for every created account and never printed.
 *
 * Safety, in order:
 *   1. Only addresses in --allow are ever looked up or touched; every
 *      --pro/--free/--friend must be in it; owner addresses are refused.
 *   2. All reads happen first. If ANY account's user_data row holds data
 *      that this tool did not write (plan.mjs stateWriteDecision), the
 *      run stops before writing anything.
 *   3. user_data is written with a compare-and-set on updated_at, so a
 *      save that lands in between is never overwritten.
 *   4. Everything else is insert-if-absent: profiles fields only fill
 *      blanks (plus the privacy switches off), friendships/messages/
 *      nutrition rows/group only when none exist. Nothing is deleted.
 *      profiles.tier is never written — Pro comes from
 *      reviewer_access_add (supabase/reviewer_access_2026_10.sql).
 *   5. Output names emails and counts only — never ids, keys or passwords.
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  parseArgs, stateWriteDecision, buildProState, buildLightState, nutritionRows,
  messagePlan, inviteCode, DEMO_GROUP, personaFor,
} from './plan.mjs';

const require = createRequire(import.meta.url);
const sbKeys = require('../../netlify/lib/sbKeys.js');

const USAGE = 'usage: node scripts/reviewer-demo/seed.mjs --allow a@x,b@x [--pro a@x] [--free b@x] [--friend c@x …] [--create] [--write]';

const env = process.env;
const parsed = parseArgs(process.argv.slice(2), env);
if (!parsed.ok) { console.error(parsed.error); console.error(USAGE); process.exit(2); }
const { opts } = parsed;
const URL_ = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = sbKeys.serviceKey(env);
if (!URL_ || !KEY) {
  console.error('refusing: set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in the environment for this run only');
  process.exit(2);
}

const WRITE = opts.write;
const now = Date.now();
const say = (...a) => console.log(...a);

async function api(path, init = {}, extra = {}) {
  const res = await fetch(URL_ + path, {
    ...init,
    headers: sbKeys.serviceKeyHeaders(KEY, { 'Content-Type': 'application/json', ...extra }),
  });
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function findUsers(emails) {
  const want = new Set(emails);
  const found = new Map();
  for (let page = 1; page <= 50 && found.size < want.size; page++) {
    const r = await api(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    if (!r.ok) throw new Error(`could not list users (${r.status})`);
    const users = Array.isArray(r.body?.users) ? r.body.users : [];
    for (const u of users) {
      const e = String(u.email || '').toLowerCase();
      if (want.has(e)) found.set(e, { id: u.id, confirmed: !!u.email_confirmed_at, created: u.created_at });
    }
    if (users.length < 1000) break;
  }
  return found;
}

async function createUser(email) {
  const r = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: env.DEMO_ACCOUNT_PASSWORD, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`could not create ${email} (${r.status})`);
  return { id: r.body?.id || r.body?.user?.id, confirmed: true, created: new Date().toISOString() };
}

const pairKey = (a, b) => [a, b].sort().join('|');
const eqAny = (a, b) => `or=(and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a}))`;

async function main() {
  say(WRITE ? '— WRITE RUN —' : '— DRY RUN (add --write to apply) —');

  // 1. Resolve the accounts. Only allow-listed emails are asked about.
  const emails = opts.accounts.map(a => a.email);
  const users = await findUsers(emails);
  let friendIdx = 0;
  const plan = [];
  for (const a of opts.accounts) {
    const idx = a.role === 'friend' ? friendIdx++ : 0;
    plan.push({ ...a, friendIndex: idx, user: users.get(a.email) || null });
  }

  for (const p of plan) {
    if (p.user) continue;
    if (!opts.create) { console.error(`refusing: no account for ${p.email} — create it first, or pass --create`); process.exit(1); }
    if (WRITE) { p.user = await createUser(p.email); say(`created ${p.email} (email confirmed)`); }
    else say(`would create ${p.email}`);
  }

  // 2. Read every user_data row and decide BEFORE writing anything.
  for (const p of plan) {
    if (!p.user) { p.decision = { write: 'insert', reason: 'new account' }; continue; }
    const r = await api(`/rest/v1/user_data?id=eq.${p.user.id}&select=state,updated_at`);
    if (!r.ok) throw new Error(`could not read user_data for ${p.email} (${r.status})`);
    p.row = Array.isArray(r.body) ? r.body[0] || null : null;
    p.decision = stateWriteDecision(p.row);
    say(`${p.email} [${p.role}]: ${p.decision.reason}`);
  }
  const refused = plan.filter(p => !p.decision.write);
  if (refused.length) {
    console.error(`stopping: ${refused.map(p => p.email).join(', ')} — nothing has been written`);
    process.exit(1);
  }

  for (const p of plan) {
    p.state = p.role === 'pro' ? buildProState(now) : buildLightState(p.role, now, p.friendIndex);
    const ageDays = p.user?.created ? Math.floor((now - Date.parse(p.user.created)) / 86_400_000) : 0;
    const days = Object.keys(p.state.logs || {}).length;
    say(`${p.email}: state with ${days} logged days, ${(p.state.habits || []).length} habits, ${Object.keys(p.state.vitalsLog || {}).length} vitals days; account is ${ageDays} days old${ageDays < 28 ? ' (ratings count history only from account creation — create accounts 4–6 weeks before submitting)' : ''}`);
  }
  if (!WRITE) { say('dry run complete — nothing written'); return; }

  // 3. Profiles: fill blanks only; privacy switches off.
  for (const p of plan) {
    const persona = personaFor(p.role, p.friendIndex);
    const r = await api(`/rest/v1/profiles?id=eq.${p.user.id}&select=id,handle,display_name`);
    const cur = r.ok && Array.isArray(r.body) ? r.body[0] : null;
    const fields = { is_searchable: false, leaderboard_optin: false };
    if (!cur?.display_name) fields.display_name = persona.name;
    if (!cur?.handle) fields.handle = persona.handle;
    const send = async (f) => (cur
      ? api(`/rest/v1/profiles?id=eq.${p.user.id}`, { method: 'PATCH', body: JSON.stringify(f) }, { Prefer: 'return=minimal' })
      : api('/rest/v1/profiles', { method: 'POST', body: JSON.stringify({ id: p.user.id, ...f }) }, { Prefer: 'return=minimal' }));
    let w = await send(fields);
    if (!w.ok && fields.handle) { delete fields.handle; w = await send(fields); }          // handle taken
    if (!w.ok) { delete fields.leaderboard_optin; w = await send(fields); }               // column absent
    say(`${p.email}: profile ${w.ok ? 'ok' : `not written (${w.status})`}`);
  }

  // 4. user_data, compare-and-set.
  for (const p of plan) {
    const stamp = new Date().toISOString();
    let w;
    if (p.decision.write === 'insert') {
      w = await api('/rest/v1/user_data', { method: 'POST', body: JSON.stringify({ id: p.user.id, state: p.state, updated_at: stamp }) }, { Prefer: 'return=minimal' });
      if (w.status === 409) { say(`${p.email}: a row appeared meanwhile — skipped, re-run to re-check`); continue; }
    } else {
      const guard = p.row?.updated_at == null ? 'updated_at=is.null' : `updated_at=eq.${encodeURIComponent(p.row.updated_at)}`;
      w = await api(`/rest/v1/user_data?id=eq.${p.user.id}&${guard}&select=id`, { method: 'PATCH', body: JSON.stringify({ state: p.state, updated_at: stamp }) }, { Prefer: 'return=representation' });
      if (w.ok && Array.isArray(w.body) && w.body.length === 0) { say(`${p.email}: row changed meanwhile — skipped, re-run to re-check`); continue; }
    }
    say(`${p.email}: state ${w.ok ? 'written' : `NOT written (${w.status})`}`);
  }

  // 5. Food log for the Pro account, only if it has none.
  const pro = plan.find(p => p.role === 'pro');
  if (pro) {
    const r = await api(`/rest/v1/nutrition_log?user_id=eq.${pro.user.id}&select=id&limit=1`);
    if (r.ok && Array.isArray(r.body) && r.body.length === 0) {
      const rows = nutritionRows(pro.user.id, now);
      const w = await api('/rest/v1/nutrition_log', { method: 'POST', body: JSON.stringify(rows) }, { Prefer: 'return=minimal' });
      say(`${pro.email}: ${w.ok ? rows.length + ' food entries added' : `food log not written (${w.status})`}`);
    } else say(`${pro.email}: food log left as it is`);
  }

  // 6. Friendships among the Pro account and the friends; DM threads Pro↔friend.
  const social = plan.filter(p => p.role === 'pro' || p.role === 'friend');
  const pairs = [];
  for (let i = 0; i < social.length; i++) for (let j = i + 1; j < social.length; j++) pairs.push([social[i], social[j]]);
  const msgPairs = [];
  for (const [a, b] of pairs) {
    const r = await api(`/rest/v1/friendships?${eqAny(a.user.id, b.user.id)}&select=status`);
    if (!r.ok) { say(`friendships unavailable (${r.status}) — skipped`); break; }
    if (r.body.length === 0) {
      const at = new Date(now - 40 * 86_400_000).toISOString();
      const w = await api('/rest/v1/friendships', { method: 'POST', body: JSON.stringify({ requester_id: a.user.id, addressee_id: b.user.id, status: 'accepted', created_at: at, accepted_at: at }) }, { Prefer: 'return=minimal' });
      say(`${a.email} ↔ ${b.email}: ${w.ok ? 'friends' : `not linked (${w.status})`}`);
    } else if (r.body[0].status !== 'accepted') {
      await api(`/rest/v1/friendships?${eqAny(a.user.id, b.user.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted', accepted_at: new Date().toISOString() }) }, { Prefer: 'return=minimal' });
      say(`${a.email} ↔ ${b.email}: request accepted`);
    } else say(`${a.email} ↔ ${b.email}: already friends`);
    if (a.role === 'pro' || b.role === 'pro') msgPairs.push([a, b]);
  }
  const seen = new Set();
  for (const [a, b] of msgPairs) {
    if (seen.has(pairKey(a.email, b.email))) continue;
    seen.add(pairKey(a.email, b.email));
    const q = `or=(and(sender_id.eq.${a.user.id},recipient_id.eq.${b.user.id}),and(sender_id.eq.${b.user.id},recipient_id.eq.${a.user.id}))`;
    const r = await api(`/rest/v1/messages?${q}&select=id&limit=1`);
    if (!r.ok || r.body.length) { say(`${a.email} ↔ ${b.email}: messages left as they are`); continue; }
    const rows = messagePlan([[a.user.id, b.user.id]], now - seen.size * 86_400_000);
    const w = await api('/rest/v1/messages', { method: 'POST', body: JSON.stringify(rows) }, { Prefer: 'return=minimal' });
    say(`${a.email} ↔ ${b.email}: ${w.ok ? rows.length + ' messages' : `messages not written (${w.status})`}`);
  }

  // 7. A league group: the Pro account owns it, friends join.
  if (pro) {
    const m = await api(`/rest/v1/group_members?user_id=eq.${pro.user.id}&select=group_id,role`);
    if (!m.ok) say(`groups unavailable (${m.status}) — skipped`);
    else {
      let groupId = m.body[0]?.group_id || null;
      if (!groupId) {
        for (let attempt = 0; attempt < 5 && !groupId; attempt++) {
          const g = await api('/rest/v1/groups', { method: 'POST', body: JSON.stringify({ ...DEMO_GROUP, invite_code: inviteCode(crypto.randomBytes(8)), owner_id: pro.user.id }) }, { Prefer: 'return=representation' });
          if (g.status === 409) continue;
          if (!g.ok) { say(`group not created (${g.status})`); break; }
          groupId = g.body[0].id;
          const j = await api('/rest/v1/group_members', { method: 'POST', body: JSON.stringify({ group_id: groupId, user_id: pro.user.id, role: 'owner' }) }, { Prefer: 'return=minimal' });
          say(`${pro.email}: group "${DEMO_GROUP.name}" ${j.ok ? 'created' : `created but owner not added (${j.status})`}`);
        }
      } else say(`${pro.email}: already in a group — kept`);
      if (groupId) {
        for (const f of plan.filter(p => p.role === 'friend')) {
          const fm = await api(`/rest/v1/group_members?user_id=eq.${f.user.id}&select=group_id`);
          if (fm.ok && fm.body.length === 0) {
            const j = await api('/rest/v1/group_members', { method: 'POST', body: JSON.stringify({ group_id: groupId, user_id: f.user.id, role: 'member' }) }, { Prefer: 'return=minimal' });
            say(`${f.email}: ${j.ok ? 'joined the group' : `not added (${j.status})`}`);
          } else say(`${f.email}: already in a group — kept`);
        }
      }
    }
  }
  say('done. Next: reviewer_access_add for each account, then review_preflight() — docs/REVIEWER_KIT.md');
}

main().catch((e) => { console.error('stopped:', e.message); process.exit(1); });
