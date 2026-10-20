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
    'Your display name, handle and profile picture broke our rules for things other people see, so we removed it', 'field list reads naturally');
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

console.log(`✓ safety & moderation — ${n} checks`);
