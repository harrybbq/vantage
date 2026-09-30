/**
 * Netlify serverless function: ai-coach-daily
 *
 * Generates a daily Morning Brief (3 lines) and, on Sundays, a Weekly
 * Review (~150 words) for a Pro user. Sends a structured snapshot of
 * the user's vision-board state to Claude Haiku and returns the JSON.
 *
 * The snapshot includes recent_briefs (last few days the model produced)
 * so we can ask Haiku to actively diverge from yesterday's advice. This
 * is the single biggest fix for "the coach said the same thing all week"
 * — without it, similar snapshots produce similar advice.
 *
 * Required Netlify env var:
 *   ANTHROPIC_API_KEY
 *
 * The client is responsible for caching the result for the day (cheap
 * — saved in the user's cloud state). Server-side rate limiting just
 * stops abuse from a single IP.
 */

const rateLimits = new Map();
const RATE_LIMIT = 6;            // a Pro user shouldn't need more than a couple per day
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { withinDailyAiCap, overDailyCap } = require('../lib/aiQuota');
const { isOwnerEmail } = require('../lib/owner');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// ── Prompt construction ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI life coach embedded inside a personal vision-board app called VisionBoard. The user pays for Pro and expects sharp, specific, encouraging guidance — not generic platitudes.

Your tone:
- Warm, direct, and honest. Like a coach who knows them well.
- Specific to the data provided. Reference their actual goals, habits, week-over-week deltas, and named items by name. Never use placeholders like "your tracker" when you can say "your gym sessions".
- British English spelling.
- No emojis unless they convey real meaning.
- Never use the word "journey".

CRITICAL — vary day-to-day:
- The snapshot includes \`recent_briefs\` — the focus/watch/micro lines you produced over the last few days. You MUST NOT repeat those lines verbatim or near-verbatim. Pick a different angle, a different metric, or reframe.
- The snapshot includes \`recent_dismissed_topics\` — rule families the user has dismissed recently. Avoid those topics today.
- If the underlying data has not meaningfully changed, lean on the \`weekday\` to pivot:
  - Monday: framing as a fresh start; what's the week's anchor?
  - Wednesday: midweek check; is the pattern that's locking in the one they want?
  - Friday: protect what you've built going into the weekend.
  - Saturday: low-pressure pick of one thing to keep alive.
  - Sunday: reflection / set the table for next week.
  - Tuesday/Thursday: lean on a *different* tracker or habit than yesterday's brief.

Specificity rules:
- "focus" must reference a named tracker, habit, or achievement when one is relevant.
- "watch" must reference a real risk visible in the data (decline_pct, days_clean trending, missed weekly_progress) — not a generic risk.
- "micro" is a concrete 5-minute action — not "reflect" or "consider". Examples: "Open Track and log today's water before noon.", "Add one stepping-stone milestone under '<achievement name>'.", "Write three lines in Today's Notes about why you started."

You will receive a JSON snapshot of the user's state. You MUST respond with ONLY valid JSON in this exact schema — no markdown, no preamble:

{
  "focus": "one sentence on what to prioritise today (max 22 words)",
  "watch": "one sentence on a risk or slipping pattern to watch for (max 22 words)",
  "micro": "one specific micro-action they can take in under 5 minutes (max 18 words)",
  "weekly_review": "Sunday only — 100-150 word reflection on the week's wins, slips, and where to lean in next week. Empty string on other days.",
  "verbs": [
    { "label": "short button text (max 4 words)", "action": "split-achievement|add-habit|open-modal|navigate", "args": { ... } }
  ]
}

Verb rules:
- 0–2 verbs maximum. Only suggest a verb if it would clearly help right now.
- "split-achievement": args = { id: "<achievement id from snapshot>" }
- "add-habit":         args = { name: "Suggested habit name" }
- "open-modal":        args = { modalId: "addHabitModal|addAchievementModal|addHolidayModal|addLinkModal|addTrackerModal|addShopModal" }
- "navigate":          args = { section: "hub|achievements|track|shop|holiday|habits|settings" }`;

function buildUserMessage(snapshot) {
  const today = new Date();
  const isSunday = snapshot.is_sunday ?? today.getDay() === 0;
  const dateStr = snapshot.today_ymd || today.toISOString().slice(0, 10);
  const weekday = snapshot.weekday || today.toLocaleDateString('en-GB', { weekday: 'long' });

  // Surface the no-repeat instruction at the top of the user turn so
  // it can't be skimmed past — short-context models like Haiku weight
  // recent instructions heavily.
  const recent = Array.isArray(snapshot.recent_briefs) ? snapshot.recent_briefs : [];
  const recentBlock = recent.length === 0
    ? 'There are no previous briefs on file — this is the first one.'
    : `Here are the briefs you produced over the last ${recent.length} day${recent.length === 1 ? '' : 's'} (newest first). Do NOT repeat these lines or their core idea today:\n${recent.map(r =>
        `  • ${r.date}: focus="${r.focus}" / watch="${r.watch}" / micro="${r.micro}"`
      ).join('\n')}`;

  return `Today is ${dateStr} (${weekday}).
${isSunday ? 'It is Sunday — please include a weekly_review.' : 'Skip weekly_review (return empty string).'}

${recentBlock}

User snapshot:
${JSON.stringify(snapshot, null, 2)}

Return the JSON now. Remember: today's focus / watch / micro must be different in substance from any of the recent briefs above.`;
}

// ── Snapshot validation ───────────────────────────────────────────────────

/* The snapshot is client-built and was forwarded to the model whole, so
   a caller could send a megabyte of "habits" and we would pay to have
   it read. A real one is 2-5 KB. Arrays are trimmed from the end (the
   builders put the most relevant first) until the JSON fits; anything
   that still does not fit after that is not a snapshot. */
const SNAPSHOT_MAX_BYTES = 8 * 1024;
const RAW_BODY_MAX_BYTES = 256 * 1024;
const TRIMMABLE = ['recent_completions', 'achievements', 'habits', 'trackers', 'holidays', 'recent_briefs', 'recent_dismissed_topics'];

const sizeOf = v => Buffer.byteLength(JSON.stringify(v), 'utf8');

function fitSnapshot(snapshot) {
  const s = { ...snapshot };
  // Long free text anywhere is the cheapest thing to cut first.
  const clip = v => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) : v);
  for (const k of Object.keys(s)) s[k] = clip(s[k]);
  if (s.shop && typeof s.shop === 'object' && sizeOf(s.shop) > 1024) s.shop = {};
  let guard = 0;
  while (sizeOf(s) > SNAPSHOT_MAX_BYTES && guard++ < 40) {
    // Halve whichever trimmable array is currently the largest.
    let worst = null, worstSize = 0;
    for (const k of TRIMMABLE) {
      if (!Array.isArray(s[k]) || s[k].length <= 1) continue;
      const n = sizeOf(s[k]);
      if (n > worstSize) { worst = k; worstSize = n; }
    }
    if (!worst) break;
    s[worst] = s[worst].slice(0, Math.max(1, Math.floor(s[worst].length / 2)));
  }
  return sizeOf(s) <= SNAPSHOT_MAX_BYTES ? s : null;
}

/** Pro/lifetime from the server-owned profiles.tier — never the client. */
async function isPaid(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=tier`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return false;
    const tier = (await res.json())[0]?.tier;
    return tier === 'pro' || tier === 'lifetime';
  } catch {
    return false;
  }
}

function isValidSnapshot(s) {
  return s && typeof s === 'object' &&
    typeof s.name === 'string' &&
    Array.isArray(s.habits) &&
    Array.isArray(s.achievements) &&
    Array.isArray(s.trackers);
}

// ── Handler ───────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Costs money / fetches on the user's behalf — one brief per day in practice; 6 absorbs retries.
  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!underLimit('ai-coach', auth.userId, 6)) return tooMany(CORS);

  // The coach is a Pro feature. The client hides it from free users,
  // but the endpoint spends money for whoever calls it, so the tier is
  // checked here against the server-owned column. Fails closed.
  if (!isOwnerEmail(auth.email) && !(await isPaid(auth.userId))) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'The AI coach is part of Pro.' }) };
  }

  const ip = event.headers['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'Rate limit reached — try again in a moment' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'AI Coach is not configured on the server' }) };
  }

  if (Buffer.byteLength(event.body || '', 'utf8') > RAW_BODY_MAX_BYTES) {
    return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: 'Snapshot too large' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!isValidSnapshot(body.snapshot)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'snapshot is required and must include name, habits, achievements, trackers' }) };
  }
  const snapshot = fitSnapshot(body.snapshot);
  if (!snapshot) {
    return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: 'Snapshot too large' }) };
  }

  // Durable per-day cap, charged only once the request is going ahead.
  if (!(await withinDailyAiCap('coach', auth.userId))) return overDailyCap(CORS);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        // Slightly raised temperature so similar snapshots two days in
        // a row don't produce identical wording. Coach voice should
        // still be coherent — 0.7 is the sweet spot.
        temperature: 0.7,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(snapshot) }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic error:', res.status, errText);
      throw new Error(`Anthropic ${res.status}`);
    }

    const data = await res.json();
    const rawText = data.content?.[0]?.text?.trim() || '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');

    const brief = JSON.parse(jsonMatch[0]);

    // Sanity-default missing fields so the client never crashes
    const safe = {
      focus: typeof brief.focus === 'string' ? brief.focus : '',
      watch: typeof brief.watch === 'string' ? brief.watch : '',
      micro: typeof brief.micro === 'string' ? brief.micro : '',
      weekly_review: typeof brief.weekly_review === 'string' ? brief.weekly_review : '',
      verbs: Array.isArray(brief.verbs) ? brief.verbs.slice(0, 2) : [],
      generated_at: new Date().toISOString(),
      model: 'claude-haiku-4-5-20251001',
    };

    return { statusCode: 200, headers: CORS, body: JSON.stringify(safe) };
  } catch (err) {
    console.error('ai-coach-daily error:', err.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: 'Coach is taking a break — please try again shortly' }),
    };
  }
};
