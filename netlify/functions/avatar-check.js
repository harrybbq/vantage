/**
 * Netlify function: avatar-check
 *
 * Screens a profile photo before it is published to `profiles.avatar_url`,
 * where friends, handle search and the global leaderboard all show it
 * (Apple 1.2: an image strangers see needs screening, the same as a
 * group crest — netlify/lib/imageModeration.js, used by groups.js).
 *
 * POST { image: "data:image/jpeg;base64,…" }  (the ~96px avatar the
 * client is about to publish, not the full photo)
 *   → { ok: true }                          approved
 *   → { ok: false, reason }                 rejected — do not publish
 *   → { ok: false, pending: true }          could not decide (no key,
 *                                           timeout, unparseable answer)
 *
 * Only the first two are verdicts. `pending` means "ask again later",
 * and the client publishes no avatar meanwhile: failing closed, for the
 * same reason the crest does — the cost is a friend seeing initials for
 * a while; the cost of failing open is the picture, on a public board.
 *
 * This is a gate for honest clients, not an access control: profiles
 * RLS still lets the owner write avatar_url directly. Making it binding
 * needs avatar_url to become server-written (see the audit report).
 *
 * Content moderation of what other people will see, not a user-facing
 * AI feature — so no AI-consent gate, but the privacy policy has to say
 * that profile photos are sent to Anthropic for screening.
 */
const crypto = require('crypto');
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { screenImage, parseDataUrl } = require('../lib/imageModeration');
const { withinDailyAiCap, overDailyCap } = require('../lib/aiQuota');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

/* Verdicts by image hash, per instance. The client caches its own
   verdict in S.avatarScreen, so this only saves the paid call when the
   same picture arrives twice in one warm instance (a second device, a
   retry after a dropped response). Bounded so it cannot grow forever. */
const VERDICTS = new Map();
const VERDICT_CAP = 2000;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const { userId } = auth;
  if (!underLimit('avatar', userId, 4)) return tooMany(CORS);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON body' }); }

  const img = parseDataUrl(body.image);
  if (!img.ok) return json(400, { error: img.error });

  const hash = crypto.createHash('sha256').update(img.base64).digest('hex');
  const known = VERDICTS.get(hash);
  if (known) return json(200, known);

  // No key, no screening — and no reason to spend the caller's daily cap.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(200, { ok: false, pending: true });

  // Every screen is a paid vision call.
  if (!(await withinDailyAiCap('avatar', userId))) return overDailyCap(CORS);

  const verdict = await screenImage(img.base64, img.mediaType, apiKey);
  if (verdict.decision === 'pending') return json(200, { ok: false, pending: true });

  const out = verdict.decision === 'approved'
    ? { ok: true }
    : { ok: false, reason: verdict.reason || 'Does not meet the picture guidelines.' };
  if (VERDICTS.size >= VERDICT_CAP) VERDICTS.delete(VERDICTS.keys().next().value);
  VERDICTS.set(hash, out);
  return json(200, out);
};
