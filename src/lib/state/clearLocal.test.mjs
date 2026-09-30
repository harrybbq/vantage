/**
 * What an explicit sign-out removes from this device, and — just as
 * important — what it leaves alone.
 */
import assert from 'node:assert/strict';
import { keysToClear } from './clearLocal.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const ME = 'user-a';
const all = [
  'vb4_backup:user-a', 'vb4_visuals:user-a', 'vb4_pending:user-a', 'vb4_seen_user:user-a',
  'vb4_backup:user-b', 'vb4_pending:user-b', 'vb4_seen_user:user-b',
  'vb4_state', 'vb4_photo', 'vb4_bg', 'vb4_weather_cache', 'vb4_streak_dismissed',
  'vb4_appPreview:https://example.com', 'vb_habit_view_h1',
  'vb4_cookie_consent', 'vb4_remember', 'vb4_install_dismissed', 'vb4_push_pre_asked',
  'sb-xyz-auth-token', 'unrelated',
];

{
  const out = keysToClear(all, { userId: ME });
  for (const k of ['vb4_backup:user-a', 'vb4_visuals:user-a', 'vb4_pending:user-a', 'vb4_weather_cache', 'vb4_streak_dismissed',
    'vb4_appPreview:https://example.com', 'vb_habit_view_h1']) {
    ok(out.includes(k), `sign-out clears ${k}`);
  }
  ok(!out.includes('vb4_seen_user:user-a'), 'sign-out keeps the anti-wipe breadcrumb');
  for (const k of ['vb4_state', 'vb4_photo', 'vb4_bg']) {
    ok(!out.includes(k), `legacy migration source ${k} is never cleared (may be the only copy)`);
  }
  ok(!out.some(k => k.endsWith('user-b')), 'another account\'s recovery copies are left alone');
  for (const k of ['vb4_cookie_consent', 'vb4_remember', 'vb4_install_dismissed', 'vb4_push_pre_asked', 'unrelated']) {
    ok(!out.includes(k), `device preference ${k} is kept`);
  }
  ok(!out.includes('sb-xyz-auth-token'), 'the auth token is Supabase\'s own to clear');
}
{
  const out = keysToClear(all, { userId: ME, deleted: true });
  ok(out.includes('vb4_seen_user:user-a'), 'deletion also clears the breadcrumb');
  ok(!out.includes('vb4_seen_user:user-b'), 'but only this account\'s');
}
{
  const out = keysToClear(all, {});
  ok(!out.some(k => k.startsWith('vb4_backup:')), 'no user id → no per-user keys touched');
}
ok(keysToClear([null, undefined, 3], { userId: ME }).length === 0, 'junk keys are ignored');

console.log(`clearLocal: ${n} checks passed`);
