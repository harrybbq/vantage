// node src/lib/ratings/ctx.test.mjs — the app's rating counts what the server counts (Nov 2026).
//
// The bug: after a prestige the app read OVR 99 again while the
// leaderboard said 22. The app's local sum had no account creation
// time, so it counted logged days from before the account existed with
// no day cap, and it had no friend count. The server's sum had both.
// The prestige baseline came from the server, so the gap showed up as
// a climb that was "already full".
import assert from 'node:assert/strict';
import { derivePoints, deriveRatings, ratingCtx, cleanRatingInputs } from './derive.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const DAY = 86400000;
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const now = Date.now();
const createdAt = new Date(now - 60 * DAY).toISOString();   // a two-month-old account…

// …carrying a year of fitness logging migrated in from before it existed.
const logs = {};
for (let i = 0; i < 365; i++) logs[ymd(now - i * DAY)] = { gym: true, steps: true };
const S = {
  trackers: [{ id: 'gym', name: 'Gym', category: 'fitness', type: 'boolean' }, { id: 'steps', name: 'Steps', category: 'fitness', type: 'boolean' }],
  logs,
  achievements: [],
};

t('without the creation time the app counts days the server does not', () => {
  const server = derivePoints(S, { createdAt });
  const appBefore = derivePoints(S, {});
  assert.ok(appBefore.fitness > server.fitness * 1.5, `${appBefore.fitness} vs ${server.fitness}`);
});

t('the bug: straight after a prestige the old app read a full climb', () => {
  const baseline = derivePoints(S, { createdAt });            // what prestige-up snapshots
  const server = deriveRatings(S, { createdAt, baseline });
  const appBefore = deriveRatings(S, { baseline });            // no createdAt, as before the fix
  assert.ok(server.ovr <= 5, `server ${server.ovr}`);
  assert.ok(appBefore.ovr >= 60, `app ${appBefore.ovr}`);
});

t('the fix: with S.ratingInputs the app is the server’s sum', () => {
  const baseline = derivePoints(S, { createdAt });
  const withInputs = { ...S, ratingInputs: { friends: 3, macroDays: 12, createdAt } };
  const ctx = ratingCtx(withInputs);
  assert.deepEqual(ctx, { friendCount: 3, macroDays: 12, createdAt });
  const app = deriveRatings(withInputs, { ...ctx, baseline });
  const server = deriveRatings(S, { friendCount: 3, macroDays: 12, createdAt, baseline });
  for (const k of ['brain', 'finance', 'fitness', 'social', 'ovr']) assert.equal(app[k], server[k], k);
});

t('before the server has answered: the session’s created_at stands in', () => {
  const ctx = ratingCtx(S, { friendCount: 0, macroDays: 4, createdAt });
  assert.deepEqual(ctx, { friendCount: 0, macroDays: 4, createdAt });
  assert.deepEqual(ratingCtx({}), { friendCount: 0, macroDays: 0, createdAt: null });
});

t('server inputs are cleaned before they are cached', () => {
  assert.deepEqual(cleanRatingInputs({ friends: '4', macroDays: 7.9, createdAt }), { friends: 4, macroDays: 7, createdAt });
  assert.deepEqual(cleanRatingInputs({ friends: -2, macroDays: 'x', createdAt: 'nope' }), { friends: 0, macroDays: 0, createdAt: null });
  assert.equal(cleanRatingInputs(null), null);
});

console.log(`rating inputs: ${n} tests passed`);
