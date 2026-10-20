// node netlify/lib/lockScreenSafe.test.mjs
// Lock-screen-safe push text (item 104, DPIA G8): every push kind gets
// fixed, generic text; nothing from the queued payload reaches the
// title or body; `data` carries only the kind and id-shaped references;
// push-dispatch.js actually uses it. Hermetic: no network, no env.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of Object.keys(process.env)) {
  if (/^(SUPABASE_|ANTHROPIC_|FCM_)/.test(k)) delete process.env[k];
}
globalThis.fetch = () => { throw new Error('network is off in this test'); };

const require = createRequire(import.meta.url);
const { lockScreenSafe, LOCK_SCREEN_KINDS } = require('./lockScreenSafe.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

let fails = 0, n = 0;
function ok(cond, msg) {
  n++;
  if (!cond) { console.log('  FAIL ' + msg); fails++; }
}

// A payload stuffed with everything that must never show on a lock screen.
const SENSITIVE = {
  title: 'Weight 61.2 kg — down 3.4 kg this month',
  body: 'You logged 640 kcal yesterday. "No gambling" streak broke after 41 days.',
  requester_name: 'Alex Morgan', requester_handle: 'alexm_99', friend_handle: 'sam.k',
  message: 'I relapsed last night and feel awful', preview: 'Can we talk about the drinking?',
  report_reason: 'Self-harm or suicide risk', report_details: 'They said they want to hurt themselves',
  habit: 'Sober October', tracker: 'Laxatives', calories: 640, weight: 61.2,
  requester_id: '7b1f6a52-1d1e-4b8e-9b55-2e4c0b8f0a11', friend_id: 'not an id; it has spaces',
  nudge_id: 'n_42', thread_id: 'thr-9', message_id: 'msg-77', notice_id: 'ntc_1', vision_id: 'century',
  deep_link: '/habits/no-gambling',
};
const SENSITIVE_STRINGS = ['61.2', '640', 'kcal', 'gambling', 'Alex', 'alexm', 'sam.k', 'relapse', 'drinking',
  'Self-harm', 'hurt', 'Sober', 'Laxatives', 'streak', 'Weight', 'not an id'];

// Every kind the queue accepts (the SQL check constraint), plus the kinds
// with no writer yet that must be safe the day one appears.
const sql = fs.readFileSync(path.join(root, 'supabase', 'notifications_schema.sql'), 'utf8');
const check = sql.slice(sql.indexOf('check (kind in ('), sql.indexOf('))', sql.indexOf('check (kind in (')));
const SQL_KINDS = [...check.matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
ok(SQL_KINDS.length >= 6, `read ${SQL_KINDS.length} kinds from the schema`);
const KINDS = [...new Set([...SQL_KINDS, 'direct-message', 'group-message', 'safety-notice'])];

console.log('every kind');
for (const kind of KINDS) {
  ok(Object.prototype.hasOwnProperty.call(LOCK_SCREEN_KINDS, kind), `${kind}: has its own fixed text`);
  const m = lockScreenSafe(kind, SENSITIVE);
  const shown = `${m.title} ${m.body}`;
  // Everything except the wire kind name itself ("streak-warning" is a
  // routing key, never drawn).
  const all = JSON.stringify({ title: m.title, body: m.body, data: { ...m.data, kind: undefined } });
  ok(m.title === LOCK_SCREEN_KINDS[kind].title && m.body === LOCK_SCREEN_KINDS[kind].body, `${kind}: title/body are the fixed text`);
  ok(!/\d/.test(shown), `${kind}: no numbers on the lock screen`);
  for (const s of SENSITIVE_STRINGS) ok(!all.includes(s), `${kind}: "${s}" not anywhere in the push`);
  ok(m.data.kind === kind, `${kind}: data.kind`);
  ok(Object.values(m.data).every(v => typeof v === 'string'), `${kind}: data values are strings (FCM)`);
  ok(Object.keys(m.data).every(k => k === 'kind' || /_id$/.test(k)), `${kind}: data is kind + ids only (${Object.keys(m.data)})`);
  ok(!('title' in m.data) && !('body' in m.data) && !('deep_link' in m.data), `${kind}: payload text is not smuggled through data`);
}

console.log('specifics');
{
  const fr = lockScreenSafe('friend-request', SENSITIVE);
  ok(fr.title === 'New friend request' && fr.data.requester_id === SENSITIVE.requester_id, 'friend request: generic text, keeps the requester id');
  ok(!('friend_id' in lockScreenSafe('friend-accepted', SENSITIVE).data), 'an id with spaces is dropped');
  ok(lockScreenSafe('coach-nudge', SENSITIVE).title === 'Your coach has a note for you', 'coach nudge title');
  ok(lockScreenSafe('direct-message', SENSITIVE).title === 'New message from a friend', 'DM title, no sender name');
  ok(lockScreenSafe('safety-notice', SENSITIVE).body === 'Open Vantage to read it.', 'notice body carries no report details');
  const unk = lockScreenSafe('weight-alert', SENSITIVE);
  ok(unk.title === 'Vantage' && unk.body === 'You have a new notification.' && JSON.stringify(unk.data) === '{"kind":"notification"}', 'unknown kind → most generic text, no ids');
  ok(lockScreenSafe('__proto__', {}).title === 'Vantage', 'prototype keys are not kinds');
  ok(lockScreenSafe('coach-nudge', null).body === 'Open Vantage to read it.', 'missing payload is fine');
  ok(lockScreenSafe('coach-nudge', 'raw string').data.kind === 'coach-nudge', 'non-object payload is ignored');
}

console.log('wiring');
{
  const src = fs.readFileSync(path.join(root, 'netlify', 'functions', 'push-dispatch.js'), 'utf8');
  ok(/require\('\.\.\/lib\/lockScreenSafe'\)/.test(src), 'push-dispatch requires the helper');
  ok(/lockScreenSafe\(row\.kind, row\.payload\)/.test(src), 'every queued row goes through it');
  ok(!/row\.payload\?*\.(?:title|body)/.test(src), 'no queued title/body is sent');
  ok(!/\.\.\.stringifyValues\(row\.payload/.test(src) && !/\.\.\.\s*row\.payload/.test(src), 'the raw payload is not spread into data');
  ok(/visibility:\s*'PRIVATE'/.test(src), 'Android notification visibility is PRIVATE');
  const sendCalls = [...src.matchAll(/sendFcm\(accessToken,\s*tk\.token,\s*([a-zA-Z_]+)\)/g)].map(m => m[1]);
  ok(sendCalls.length >= 1 && sendCalls.every(a => a === 'message'), 'sendFcm only ever gets the safe message');

  const client = fs.readFileSync(path.join(root, 'src', 'lib', 'push', 'handlers.js'), 'utf8');
  ok(!/msg\.body/.test(client), 'client toasts never show a push body');

  const fixSql = fs.readFileSync(path.join(root, 'supabase', 'notifications_lockscreen_2026_10.sql'), 'utf8');
  const bodies = fixSql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  ok(!/display_name|handle/.test(bodies), 'owner SQL: triggers no longer queue names or handles');
  ok(!/\b(drop|delete|truncate|alter\s+table)\b/i.test(bodies), 'owner SQL: functions only, nothing dropped or deleted');
}

console.log(fails ? `\nlockScreenSafe: ${fails} of ${n} checks FAILED` : `\nlockScreenSafe: ${n} checks passed`);
process.exit(fails ? 1 : 0);
