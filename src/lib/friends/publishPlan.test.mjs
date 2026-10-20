/**
 * usePublishProfile's decisions (items 84, 92; store pack P9).
 * Run: npm run check:privacy
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  streakForFriends, planAvatar, planDirectPatch, PRESENCE_INTERVAL_MS, PRESENCE_REPING_MS,
} from './publishPlan.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ── Shared-streak habit name (P9) ──
{
  eq(streakForFriends(null), { days: 0, name: null }, 'no streak');
  eq(streakForFriends({ days: 0, name: 'Gym' }), { days: 0, name: null }, 'zero days publishes nothing');
  eq(streakForFriends({ days: 12, name: 'No alcohol' }), { days: 12, name: 'No alcohol' }, 'an ordinary habit name passes');
  eq(streakForFriends({ days: 12, name: 'no fucking sugar' }), { days: 12, name: null }, 'a filtered name is dropped, the count stays');
  eq(streakForFriends({ days: 3, name: 'text me 07700 900123' }), { days: 3, name: null }, 'contact details dropped');
  eq(streakForFriends({ days: 3, name: 'www.example.com challenge' }).name, null, 'links dropped');
  eq(streakForFriends({ days: 5, name: 'x'.repeat(80) }).name.length, 60, 'capped');
  eq(streakForFriends({ days: 5, name: 42 }).name, null, 'non-string name dropped');
}

// ── Presence cadence (item 92) ──
{
  eq(PRESENCE_INTERVAL_MS, 5 * 60_000, 'heartbeat every 5 minutes');
  ok(PRESENCE_REPING_MS < PRESENCE_INTERVAL_MS, 'returning to the app can ping sooner than the interval');
  const q = readFileSync(new URL('./queries.js', import.meta.url), 'utf8');
  const m = q.match(/ONLINE_THRESHOLD_MS\s*=\s*([\d\s*]+);/);
  const threshold = Function(`return ${m[1]}`)();
  ok(threshold > 2 * PRESENCE_INTERVAL_MS, 'online threshold survives one missed ping');
  ok(threshold <= 15 * 60_000, 'and still drops a closed app within a quarter hour');
}

// ── Avatar ──
{
  const base = { photoSrc: 'data:image/jpeg;base64,AAAA', hash: 'h1', screen: null, retry: null };
  eq(planAvatar({ ...base, serverAvatar: undefined }), { action: 'send' }, 'new photo, server unknown → send');
  eq(planAvatar({ ...base, serverAvatar: null }), { action: 'send' }, 'new photo, nothing up → send');
  eq(planAvatar({ ...base, screen: { hash: 'h1', ok: true }, serverAvatar: 'data:x' }), { action: 'keep' }, 'approved and up (maybe from another device) → keep');
  eq(planAvatar({ ...base, screen: { hash: 'h1', ok: true }, serverAvatar: null }), { action: 'send' }, 'approved but nothing up → send again');
  eq(planAvatar({ ...base, screen: { hash: 'h1', ok: false }, serverAvatar: 'data:x' }), { action: 'clear' }, 'rejected photo → clear');
  eq(planAvatar({ ...base, screen: { hash: 'h1', ok: false }, serverAvatar: null }), { action: 'keep' }, 'rejected and already clear → nothing to write');
  eq(planAvatar({ ...base, screen: { hash: 'h0', ok: true }, serverAvatar: 'data:x' }), { action: 'send' }, 'a DIFFERENT photo than the approved one → send');
  eq(planAvatar({ ...base, retry: { hash: 'h1', until: 2000 }, serverAvatar: null, now: 1000 }), { action: 'keep' }, 'undecided recently → back off');
  eq(planAvatar({ ...base, retry: { hash: 'h1', until: 2000 }, serverAvatar: null, now: 3000 }), { action: 'send' }, 'back-off over → send');
  eq(planAvatar({ photoSrc: null, hash: null, serverAvatar: 'data:x' }), { action: 'clear' }, 'sharing off / no photo → clear');
  eq(planAvatar({ photoSrc: null, hash: null, serverAvatar: null }), { action: 'keep' }, 'already clear → nothing');
  eq(planAvatar({ ...base, hash: null, serverAvatar: 'data:x' }), { action: 'clear' }, 'no hash (insecure context) → the safe direction');
}

// ── Direct patch ──
{
  const now = 10 * 60_000;
  eq(planDirectPatch({ level: 4, sentLevel: 4, presenceOff: false, sentPresence: 'on', lastPingAt: 0, now }), {}, 'nothing changed → no write');
  eq(planDirectPatch({ level: 5, sentLevel: 4, presenceOff: false, sentPresence: 'on', lastPingAt: now - 1000, now }), { level: 5 }, 'level changed, ping recent → level only');
  eq(planDirectPatch({ level: 5, sentLevel: 4, presenceOff: false, sentPresence: 'on', lastPingAt: 0, now }),
    { level: 5, last_active_at: new Date(now).toISOString() }, 'level changed, ping due → piggy-back presence');
  eq(planDirectPatch({ level: 4, sentLevel: 4, presenceOff: true, sentPresence: 'on', lastPingAt: 0, now }), { last_active_at: null }, 'presence turned off → cleared once');
  eq(planDirectPatch({ level: 4, sentLevel: 4, presenceOff: true, sentPresence: 'off', lastPingAt: 0, now }), {}, '…and not again');
  eq(planDirectPatch({ level: 5, sentLevel: 4, presenceOff: true, sentPresence: 'off', lastPingAt: 0, now }), { level: 5 }, 'presence off never publishes a time');
}

console.log(`publishPlan: ${n} checks passed`);
