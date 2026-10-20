/**
 * Safety & moderation, the pure parts (STARTUP_REQUIREMENTS 110, 111,
 * 112, 118):
 *   - the DM filter: what it blocks, what it must NOT block, and that
 *     its lists are a subset of the name filter's and identical to the
 *     database's (supabase/safety_2026_10b.sql);
 *   - report reasons: old stored values still read, urgency, and the
 *     server copy (netlify/lib/reportReasons.js) agrees;
 *   - notice text: every kind renders, the reported user is never told
 *     who reported, the reporter's notice names who they reported;
 *   - safety error classification;
 *   - the moderation core's reset/notice helpers (hashing parity with
 *     the SQL's vb_reset_hash normalisation).
 *
 * Run: npm run check:modqueue   (also part of npm run build)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checkMessageText, messageTextProblem, DM_EXACT, DM_STEMS, MESSAGE_FILTERED_TEXT } from './messageFilter.js';
import { REASONS, reasonInfo, isUrgent, URGENT_LABELS } from './reasons.js';
import { noticeText, sortNotices, safetyErrorKind, SUSPENDED_SHORT } from './notices.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const require = createRequire(import.meta.url);
// netlify/package.json makes netlify/** CommonJS, so plain require works.
const loadCjs = rel => require(fileURLToPath(new URL(rel, import.meta.url)));

// ── DM filter: blocks ──
for (const text of [
  'you n1gger', 'N I G G E R', 'n.i.g.g.e.r', 'niggerish', 'f4gg0t', 'nïgger', 'ｎｉｇｇｅｒ',
  'BLOWJOBS lol', 'b l o w j o b', 'p@ki', 'go0k.', 'raghead', 'milf', '#nigger',
]) {
  ok(!checkMessageText(text).ok, `should block: ${text}`);
}

// ── DM filter: must pass (false positives the lead named, UK slang,
//    help-seeking words, ordinary swearing between friends, links) ──
for (const text of [
  'Scunthorpe', 'assessment', 'Scunthorpe assessment tomorrow', 'love you xxx', 'cocktail', 'therapist',
  'Dick Turpin', 'Niger and Nigeria', 'snigger', 'night out', 'Pakistan trip', 'off for a fag',
  'a chink in the armour', 'spic and span', 'blue tits on the feeder', 'he tried to rape her',
  'a pedo messaged me, what do I do', 'never send nudes', 'what the fuck', 'shit day', 'Analyst',
  'https://www.example.com/recipe', 'call me on 07700 900123', 'a@b.co', 'Zoë', 'naïve café', '🙂', '',
  'Hancock', 'Cumbria', 'Shiitake', 'Assassins Creed', 'Essex',
]) {
  ok(checkMessageText(text).ok, `should pass: ${JSON.stringify(text)}`);
}
eq(messageTextProblem('Scunthorpe'), null, 'fine text has no message');
ok(messageTextProblem('you n1gger') === MESSAGE_FILTERED_TEXT, 'blocked text gets the inline message');
ok(!/nigg/i.test(MESSAGE_FILTERED_TEXT), 'the message never repeats the word');

// ── DM lists ⊆ name filter lists ──
{
  const src = readFileSync(new URL('./nameFilter.js', import.meta.url), 'utf8');
  const words = block => [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const exact = new Set(words(src.match(/const EXACT = new Set\(\[([\s\S]*?)\]\);/)[1]));
  const stems = new Set(words(src.match(/const STEMS = \[([\s\S]*?)\];/)[1]));
  for (const w of DM_EXACT) ok(exact.has(w), `DM word "${w}" must also be in nameFilter EXACT`);
  for (const w of DM_STEMS) ok(stems.has(w), `DM stem "${w}" must also be in nameFilter STEMS`);
}

// ── DM lists identical to the database function ──
{
  const sql = readFileSync(new URL('../../../supabase/safety_2026_10b.sql', import.meta.url), 'utf8');
  const fn = sql.match(/create or replace function public\.vb_message_text_blocked[\s\S]*?\$\$;/);
  ok(fn, 'vb_message_text_blocked found in the SQL');
  const arr = name => {
    const m = fn[0].match(new RegExp(`${name} constant text\\[\\] := array\\[([\\s\\S]*?)\\];`));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).sort() : null;
  };
  eq(arr('dm_exact'), [...DM_EXACT].sort(), 'SQL dm_exact == messageFilter DM_EXACT');
  eq(arr('dm_stems'), [...DM_STEMS].sort(), 'SQL dm_stems == messageFilter DM_STEMS');
  // Same l33t map as nameFilter's LEET, in translate() form.
  const leet = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };
  const tr = fn[0].match(/translate\(norm, '([^']+)', '([^']+)'\)/);
  ok(tr && tr[1].length === tr[2].length, 'translate() maps are the same length');
  eq(Object.fromEntries([...tr[1]].map((c, i) => [c, tr[2][i]])), Object.fromEntries(Object.entries(leet).map(([k, v]) => [String(k), v])), 'SQL l33t map == nameFilter LEET');
}

// ── Report reasons ──
{
  // Every label stored before this change still reads as itself.
  for (const old of ['Harassment or bullying', 'Inappropriate handle or display name', 'Spam', 'Impersonation', 'Something else']) {
    eq(reasonInfo(old).label, old, `old stored reason "${old}" still recognised`);
  }
  eq(reasonInfo('harassment or bullying ').id, 'harassment', 'case/space tolerant');
  eq(reasonInfo(null).id, 'other', 'empty → other');
  eq(reasonInfo('made up by an old client').id, 'other', 'unknown → other');
  for (const id of ['child', 'threat', 'selfharm', 'sexual', 'scam', 'harassment', 'other', 'hate']) {
    ok(REASONS.some(r => r.id === id), `reason ${id} offered`);
  }
  ok(isUrgent('Child safety') && isUrgent('Threats or violence') && isUrgent('Self-harm or suicide risk'), 'urgent reasons');
  ok(!isUrgent('Spam') && !isUrgent('Harassment or bullying'), 'non-urgent reasons');
  ok(/116 123/.test(reasonInfo('Self-harm or suicide risk').signpost), 'self-harm shows Samaritans');
  ok(/0800 1111/.test(reasonInfo('Self-harm or suicide risk').signpost), 'self-harm shows Childline');
  ok(/999/.test(reasonInfo('Child safety').signpost) && /CEOP/.test(reasonInfo('Child safety').signpost), 'child safety signposts 999 + CEOP');
  eq(new Set(REASONS.map(r => r.label)).size, REASONS.length, 'labels unique');

  const server = loadCjs('../../../netlify/lib/reportReasons.js');
  eq([...server.URGENT_LABELS].sort(), [...URGENT_LABELS].sort(), 'server urgent labels == client');
  for (const l of server.NO_NOTICE_LABELS) ok(REASONS.some(r => r.label === l), `server no-notice label "${l}" exists client-side`);
  ok(server.isUrgent('child safety') && !server.isUrgent('Spam'), 'server isUrgent');
  ok(server.quietToReported('Child safety') && !server.quietToReported('Threats or violence'), 'child-safety reports never notify the reported user');
}

// ── Notice text ──
{
  const kinds = ['report_received', 'report_actioned', 'report_dismissed', 'account_suspended', 'account_restored', 'content_reset'];
  for (const kind of kinds) {
    const t = noticeText({ id: 1, kind, meta: { handle: 'sam', fields: ['display_name'] } });
    ok(t && t.title && t.body, `${kind} renders`);
  }
  // Same list as the table's CHECK.
  const sql = readFileSync(new URL('../../../supabase/safety_2026_10b.sql', import.meta.url), 'utf8');
  const chk = sql.match(/safety_notices_kind_check check \(kind in \(([\s\S]*?)\)\)/);
  eq([...chk[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort(), [...kinds].sort(), 'notice kinds == SQL CHECK');

  ok(/@sam/.test(noticeText({ kind: 'report_received', meta: { handle: 'sam' } }).body), 'reporter is told who they reported');
  ok(/Bad Name/.test(noticeText({ kind: 'report_actioned', meta: { name: 'Bad Name' } }).body), 'falls back to the name');
  ok(/this person/.test(noticeText({ kind: 'report_dismissed', meta: {} }).body), 'neutral fallback');
  ok(/24 hours/.test(noticeText({ kind: 'report_received', meta: {} }).body), 'acknowledgement gives the expected time');
  ok(/won't be told who reported/.test(noticeText({ kind: 'report_received', meta: {} }).body), 'acknowledgement promises anonymity');
  // Reported-user notices never carry the reporter — even if meta held one.
  for (const kind of ['account_suspended', 'content_reset', 'account_restored']) {
    const t = noticeText({ kind, meta: { handle: 'reporter_handle', name: 'Reporter Name', fields: ['avatar'] } });
    ok(!/reporter_handle|Reporter Name/.test(t.title + t.body), `${kind} never names anyone`);
  }
  ok(/Report a problem/.test(noticeText({ kind: 'account_suspended' }).body), 'suspension says how to appeal');
  ok(noticeText({ kind: 'account_suspended' }).persistent === true, 'suspension notice is persistent');
  eq(noticeText({ kind: 'content_reset', meta: { fields: ['display_name', 'handle', 'avatar'] } }).body.split('.')[0],
    'Your display name, handle and profile picture broke our rules for things other people see, so we removed them', 'field list reads naturally');
  ok(/removed it\. You can choose a new one/.test(noticeText({ kind: 'content_reset', meta: { fields: ['handle'] } }).body), 'singular wording');
  eq(noticeText({ kind: 'content_reset', meta: { fields: ['avatar'] } }).body.split(' broke')[0], 'Your profile picture', 'one field');
  eq(noticeText({ kind: 'content_reset', meta: {} }).body.split(' broke')[0], 'Part of your profile', 'no fields');
  eq(noticeText({ kind: 'something_new' }), null, 'unknown kind → null (skipped)');
  eq(noticeText(null), null, 'null → null');

  const sorted = sortNotices([
    { id: 1, kind: 'report_received', created_at: '2026-10-01', read_at: '2026-10-02' },
    { id: 2, kind: 'report_actioned', created_at: '2026-10-03' },
    { id: 3, kind: 'nope', created_at: '2026-10-04' },
    { id: 4, kind: 'report_dismissed', created_at: '2026-10-05' },
  ]);
  eq(sorted.map(x => x.id), [4, 2, 1], 'unread first, newest first, unknown dropped');
}

// ── Safety error classification ──
{
  eq(safetyErrorKind({ hint: 'vantage:suspended', message: 'x' }), 'suspended', 'hint suspended');
  eq(safetyErrorKind({ hint: 'vantage:filtered' }), 'filtered', 'hint filtered');
  eq(safetyErrorKind({ hint: 'vantage:peer-suspended' }), 'peer-suspended', 'hint peer');
  eq(safetyErrorKind({ message: 'Your account is suspended, so messages are paused.' }), 'suspended', 'message fallback');
  eq(safetyErrorKind({ message: "That message includes a word we don't allow in messages." }), 'filtered', 'filtered message fallback');
  eq(safetyErrorKind({ message: 'new row violates row-level security policy' }), null, 'plain RLS is not classified');
  eq(safetyErrorKind(null), null, 'null');
  ok(/suspended/.test(SUSPENDED_SHORT) && /read/.test(SUSPENDED_SHORT), 'suspended line says what still works');
}

// ── Moderation core helpers ──
{
  const core = loadCjs('../../../netlify/lib/moderationCore.js');
  const { createHash } = await import('node:crypto');
  const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');
  eq(core.resetHash('reset_display_name', '  Bad   NAME '), sha('bad name'), 'display name hash: case/space folded like vb_reset_hash');
  eq(core.resetHash('reset_handle', 'SamX'), sha('samx'), 'handle hash: lower-cased');
  eq(core.resetHash('reset_avatar', 'data:image/png;base64,AAA'), sha('data:image/png;base64,AAA'), 'avatar hash: exact');
  eq(core.resetHash('reset_display_name', null), null, 'null value → null hash');
  eq(core.cleanResetFields(['display_name', 'handle', 'avatar', 'tier', 'avatar']), ['display_name', 'handle', 'avatar'], 'reset fields whitelisted + deduped');
  eq(core.cleanResetFields('display_name'), [], 'non-array → nothing');
  eq(core.reporterNoticeKind('action'), 'report_actioned', 'action → actioned');
  eq(core.reporterNoticeKind('dismiss'), 'report_dismissed', 'dismiss → dismissed');
  const meta = core.reporterMeta({ reported_snapshot: { handle: '@sam', display_name: 'Sam S', where: 'messages' }, reporter_id: 'x' });
  eq(meta, { handle: 'sam', name: 'Sam S' }, 'reporter notice meta: who they reported, nothing else');
}

// ── Moderation core against a fake PostgREST: who gets told what ──
{
  const core = loadCjs('../../../netlify/lib/moderationCore.js');
  const env = { supabaseUrl: 'https://db.test', serviceKey: 'service-test' };
  const R = '11111111-1111-4111-8111-111111111111';     // report
  const REPORTER = '22222222-2222-4222-8222-222222222222';
  const TARGET = '33333333-3333-4333-8333-333333333333';
  const OWNER = '44444444-4444-4444-8444-444444444444';
  let calls = [];
  let fixtures = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname.replace('/rest/v1/', ''), search: decodeURIComponent(u.search), body });
    const key = `${method} ${u.pathname.replace('/rest/v1/', '')}`;
    const data = typeof fixtures[key] === 'function' ? fixtures[key](u, body) : (fixtures[key] ?? []);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-range': '0-0/1' } });
  };
  const posts = table => calls.filter(c => c.method === 'POST' && c.path === table).map(c => c.body);

  try {
    // Dismiss: the reporter hears, nobody else.
    calls = [];
    fixtures = { 'GET reports': [{ id: R, reporter_id: REPORTER, reported_id: TARGET, reason: 'Spam', status: 'open', reported_snapshot: { handle: 'sam' } }] };
    let [code, out] = await core.decideReport(env, OWNER, { id: R, action: 'dismiss' });
    eq([code, out.status, out.reporterTold], [200, 'dismissed', true], 'dismiss closes and tells the reporter');
    eq(posts('safety_notices'), [{ user_id: REPORTER, kind: 'report_dismissed', meta: { handle: 'sam' }, report_id: R }], 'one notice, to the reporter, naming who they reported');

    // Suspend on a threats report: reporter told, reported told (no report id, no reporter).
    calls = [];
    fixtures = {
      'GET reports': [{ id: R, reporter_id: REPORTER, reported_id: TARGET, reason: 'Threats or violence', status: 'open', reported_snapshot: { handle: 'sam' } }],
      'GET profiles': [{ suspended_at: null }],
      'PATCH profiles': [{ id: TARGET }],
    };
    [code, out] = await core.decideReport(env, OWNER, { id: R, action: 'action', suspend: true, note: 'threats in DMs' });
    eq([code, out.suspended, out.reportedTold], [200, true, true], 'suspended, reported user told');
    const n2 = posts('safety_notices');
    eq(n2.map(x => [x.user_id, x.kind]), [[TARGET, 'account_suspended'], [REPORTER, 'report_actioned']], 'suspended user + reporter notices');
    eq([n2[0].report_id, n2[0].meta], [null, {}], 'the reported user\'s notice carries no report id and no names');
    eq(posts('moderation_actions').map(a => [a.action, a.target_id, a.actor_id, a.report_id]), [['suspend', TARGET, OWNER, R]], 'suspension audited');

    // Child safety: never tell the reported person.
    calls = [];
    fixtures['GET reports'] = [{ id: R, reporter_id: REPORTER, reported_id: TARGET, reason: 'Child safety', status: 'open', reported_snapshot: {} }];
    [code, out] = await core.decideReport(env, OWNER, { id: R, action: 'action', suspend: true });
    eq(posts('safety_notices').map(x => [x.user_id, x.kind]), [[REPORTER, 'report_actioned']], 'child-safety suspension: reporter only');
    eq(out.reportedTold, false, 'reportedTold false on child safety');

    // Already suspended: no second notice, original time kept.
    calls = [];
    fixtures['GET reports'] = [{ id: R, reporter_id: null, reported_id: TARGET, reason: 'Spam', status: 'open' }];
    fixtures['GET profiles'] = [{ suspended_at: '2026-10-01T00:00:00Z' }];
    await core.decideReport(env, OWNER, { id: R, action: 'action', suspend: true });
    eq(calls.filter(c => c.method === 'PATCH' && c.path === 'profiles').length, 0, 'no re-suspend PATCH');
    eq(posts('safety_notices').length, 0, 'no duplicate notice (and no reporter left to tell)');

    // A report closed twice isn't re-announced.
    calls = [];
    fixtures['GET reports'] = [{ id: R, reporter_id: REPORTER, reported_id: TARGET, reason: 'Spam', status: 'dismissed' }];
    await core.decideReport(env, OWNER, { id: R, action: 'dismiss' });
    eq(posts('safety_notices').length, 0, 'already-closed report: reporter not told again');

    // Reset: audit hash first, then the PATCH, then the notice.
    calls = [];
    fixtures = { 'GET profiles': [{ id: TARGET, display_name: 'Bad  Name', handle: 'badhandle', avatar_url: null }] };
    [code, out] = await core.resetProfile(env, OWNER, { userId: TARGET, fields: ['display_name', 'avatar', 'tier'], reportId: R, note: 'slur' });
    eq([code, out.reset, out.told, out.warning], [200, ['display_name'], true, undefined], 'only fields with a value are reset; tier ignored');
    const order = calls.map(c => `${c.method} ${c.path}`);
    ok(order.indexOf('POST moderation_actions') < order.indexOf('PATCH profiles'), 'audit hash written before the reset');
    eq(calls.find(c => c.method === 'PATCH' && c.path === 'profiles').body, { display_name: null }, 'PATCH clears only the published name');
    eq(posts('moderation_actions')[0].value_hash, core.resetHash('reset_display_name', 'Bad  Name'), 'hash of the removed value');
    eq(posts('safety_notices'), [{ user_id: TARGET, kind: 'content_reset', meta: { fields: ['display_name'] }, report_id: null }], 'user told what was reset, nothing else');
    eq((await core.resetProfile(env, OWNER, { userId: TARGET, fields: [] }))[0], 400, 'no fields → 400');
    eq((await core.resetProfile(env, OWNER, { userId: 'nope', fields: ['handle'] }))[0], 400, 'bad id → 400');

    // Notices table missing (SQL not run): the decision still lands.
    calls = [];
    fixtures = { 'GET reports': [{ id: R, reporter_id: REPORTER, reported_id: TARGET, reason: 'Spam', status: 'open' }] };
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => (String(url).includes('safety_notices')
      ? new Response('{"code":"PGRST205"}', { status: 404 }) : prevFetch(url, init));
    [code, out] = await core.decideReport(env, OWNER, { id: R, action: 'dismiss' });
    eq([code, out.status, out.reporterTold], [200, 'dismissed', false], 'fail soft: closed even without the notices table');
    globalThis.fetch = prevFetch;

    // Urgent reports join the first page, first.
    calls = [];
    fixtures = {
      'GET reports': (u) => (u.searchParams.get('reason')
        ? [{ id: 'u1', reason: 'Child safety', created_at: '2026-09-01T00:00:00Z' }]
        : [{ id: 'n1', reason: 'Spam', created_at: '2026-10-19T00:00:00Z' }, { id: 'u1', reason: 'Child safety', created_at: '2026-09-01T00:00:00Z' }]),
    };
    [code, out] = await core.listOpenReports(env, 0);
    eq(out.items.map(i => [i.id, i.urgent]), [['u1', true], ['n1', false]], 'urgent first, de-duplicated');
    ok(calls.some(c => c.search.includes('reason=in.("Threats or violence","Child safety","Self-harm or suicide risk")')), 'urgent query names the three labels');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── Avatar re-screen: flags, never removes; no key → nothing screened ──
{
  const AR = loadCjs('../../../netlify/lib/avatarRescreen.js');
  const env = { supabaseUrl: 'https://db.test', serviceKey: 'service-test' };
  const OWNER = '44444444-4444-4444-8444-444444444444';
  const A = '55555555-5555-4555-8555-555555555555';
  const B = '66666666-6666-4666-8666-666666666666';
  const goodPic = `data:image/jpeg;base64,${'A'.repeat(200)}`;
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ u, method: init.method || 'GET', body });
    if (u.startsWith('https://api.anthropic.com')) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"decision":"reject","reason":"sexual content"}' }] }), { status: 200 });
    }
    if (u.includes('rpc/avatar_screen_candidates')) {
      return new Response(JSON.stringify([
        { user_id: A, avatar_url: goodPic, avatar_hash: 'a'.repeat(64) },
        { user_id: B, avatar_url: 'data:image/gif;base64,R0lG', avatar_hash: 'b'.repeat(64) },
      ]), { status: 200 });
    }
    if (u.includes('rpc/avatar_screen_status')) return new Response('{"withAvatar":2,"unscreened":0,"flagged":2}', { status: 200 });
    if (u.includes('rpc/avatar_screen_flagged')) return new Response('[]', { status: 200 });
    return new Response('[]', { status: 200 });
  };
  try {
    eq((await AR.rescreenBatch(env, OWNER, ''))[0], 503, 'no API key → nothing screened, said plainly');
    eq(calls.length, 0, 'no key → no database or model calls');
    const [code, out] = await AR.rescreenBatch(env, OWNER, 'test-key');
    eq([code, out.screened, out.newlyFlagged, out.approved], [200, 2, 2, 0], 'both flagged (one by the screen, one unreadable)');
    const verdicts = calls.filter(c => c.u.includes('avatar_screenings')).map(c => [c.body.user_id, c.body.decision]);
    eq(verdicts.sort(), [[A, 'rejected'], [B, 'rejected']].sort(), 'verdicts recorded against the hash');
    ok(!calls.some(c => c.method === 'PATCH' && c.u.includes('/profiles')), 'a flag never touches the profile');
    eq(calls.filter(c => c.u.startsWith('https://api.anthropic.com')).length, 1, 'only the readable picture is sent to the model');
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(`✓ safety & moderation — ${n} checks`);
