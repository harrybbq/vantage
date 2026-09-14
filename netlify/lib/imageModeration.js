/**
 * Screening a picture before strangers see it.
 *
 * A division board is a public surface, and the first thing an open
 * image field on a public surface attracts is the image you would least
 * like to be hosting. So a group picture is screened before it is shown
 * to anyone outside the group.
 *
 * ── What this is and is not ──────────────────────────────────────────
 * It is a first pass, not a verdict. It runs on upload, it is cheap, and
 * it is wrong sometimes in both directions — so a human can overturn it
 * either way from the review queue, and that decision is the one that
 * sticks (`crest_reviewed_at` records that a person looked).
 *
 * ── Which way it fails ───────────────────────────────────────────────
 * Closed, every time. No API key, a timeout, a 500, an answer that does
 * not parse: the picture stays PENDING, which means the group's own
 * members can see it and nobody else can. The cost of failing closed is
 * a leader waiting for a person to look; the cost of failing open is
 * whatever was in the picture, on a public board, under our name.
 *
 * Verdict shape: { decision: 'approved' | 'rejected' | 'pending',
 *                  reason: string }
 * `reason` is shown to the leader, so it says what was wrong without
 * repeating it back in detail.
 */

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You screen images that people upload as the picture for a small social group inside a personal-wellbeing app. The picture is shown to strangers on a public league table, at about 40 pixels across.

Return ONLY valid JSON, no markdown and no commentary:
{"decision":"approve"|"reject","reason":"<short phrase, max 12 words>"}

Reject if the image contains any of:
- nudity, sexual or suggestive content
- graphic violence, gore, injury or death
- hate symbols, extremist insignia, or slurs (in the image or as text in it)
- harassment of, or an attempt to impersonate, an identifiable real person
- illegal goods, drug use, or self-harm
- shock content intended to disgust

Approve otherwise. Normal things people choose are fine and should be approved: photographs of the uploaders themselves or their friends, pets, sports teams and crests, landscapes, food, gym or running photos, cartoons, logos, text, abstract patterns, memes that are not doing any of the above, and plain colours.

A blurry, dark, low-quality or boring image is not a reason to reject — it is their picture, not ours. Reject only for the list above. If genuinely uncertain between the two, reject and say why; a person reviews the queue.

"reason" is shown to the person who uploaded it. State the category plainly ("sexual content", "graphic violence", "hate symbol") without describing the image back to them.`;

const PENDING = reason => ({ decision: 'pending', reason });

/**
 * @param {string} base64  raw base64 (no data: prefix)
 * @param {string} mediaType  'image/jpeg' | 'image/png' | 'image/webp'
 * @param {string} apiKey
 */
async function screenImage(base64, mediaType, apiKey, { timeoutMs = 12_000 } = {}) {
  if (!apiKey) return PENDING('Waiting for review.');
  if (!base64 || base64.length < 100) return PENDING('Waiting for review.');

  // A hung upstream must not hold the upload open — the picture is
  // already stored as pending by the time this is consulted.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 128,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Screen this group picture and return the JSON.' },
          ],
        }],
      }),
    });
    if (!res.ok) return PENDING('Waiting for review.');
    const body = await res.json();
    const text = (body?.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    // Tolerate a fenced block; refuse to guess at anything else.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return PENDING('Waiting for review.');
    let parsed;
    try { parsed = JSON.parse(match[0]); } catch { return PENDING('Waiting for review.'); }

    const reason = String(parsed.reason || '').slice(0, 120);
    if (parsed.decision === 'approve') return { decision: 'approved', reason: '' };
    if (parsed.decision === 'reject') {
      return { decision: 'rejected', reason: reason || 'Does not meet the picture guidelines.' };
    }
    return PENDING('Waiting for review.');
  } catch {
    return PENDING('Waiting for review.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull a data URL apart, with the checks a server has to do itself.
 *
 * Returns { ok:false, error } for anything it will not accept, so the
 * caller never has to reason about what a client sent.
 */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/* ~260 KB of base64 ≈ a 195 KB image. The client resizes to 160px and
 * encodes JPEG, which lands around 10-20 KB — this is a ceiling on
 * abuse, not a target. The column is text in a row read on every board
 * draw, so it stays small. */
const MAX_BASE64_CHARS = 260_000;

function parseDataUrl(value) {
  if (typeof value !== 'string') return { ok: false, error: 'No image was sent.' };
  const m = value.match(/^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { ok: false, error: 'That is not an image file we can read.' };
  const [, mediaType, base64] = m;
  if (!ALLOWED_TYPES.has(mediaType)) return { ok: false, error: 'Use a JPEG, PNG or WebP.' };
  if (base64.length < 100) return { ok: false, error: 'That image is empty.' };
  if (base64.length > MAX_BASE64_CHARS) return { ok: false, error: 'That image is too large — try a smaller one.' };
  return { ok: true, mediaType, base64, dataUrl: value };
}

module.exports = { screenImage, parseDataUrl, MAX_BASE64_CHARS };
