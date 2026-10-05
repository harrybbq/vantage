/**
 * Netlify serverless function: ai-food-detect
 *
 * Accepts a base64 JPEG image from the camera scanner, sends it to
 * Claude (Haiku 4.5) via the Anthropic API, and returns identified
 * food with estimated nutritional values per 100g.
 *
 * NOTE: this previously used claude-3-haiku-20240307, which was RETIRED
 * on 2026-04-19 — every request 404'd at the API, which is why
 * "Identify with AI" silently stopped working. Keep this model id
 * current when Anthropic deprecates models.
 *
 * Required Netlify env var:
 *   ANTHROPIC_API_KEY — from console.anthropic.com
 *
 * Rate limit: 5 requests / IP / minute (AI calls are expensive)
 */

const rateLimits = new Map();
const RATE_LIMIT = 5;
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
const { FREE_WEEKLY, decide, usedThisWeek, noteLocalUse, isPaidUser, resetsOnIso } = require('../lib/freeAllowance');
const { isOwnerEmail } = require('../lib/owner');

// Free accounts get a small weekly allowance of AI scans; Pro and
// lifetime are limited only by the daily cap (aiQuota). Barcode and text
// search never come here and stay free for everyone.
const FREE_LIMIT = FREE_WEEKLY['food-detect'];

/** Where this caller stands: { paid, limit, used, left, resetsOn }. */
async function allowanceFor(auth) {
  const paid = isOwnerEmail(auth.email) || (await isPaidUser(auth.userId));
  if (paid) return { paid: true, limit: null, used: null, left: null, resetsOn: null };
  const { used } = await usedThisWeek('food-detect', auth.userId);
  const d = decide({ paid: false, used, limit: FREE_LIMIT });
  return { paid: false, limit: FREE_LIMIT, used, left: d.left, resetsOn: resetsOnIso() };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

const SYSTEM_PROMPT = `You are a nutrition analysis assistant. When given a food image, identify the food and return ONLY valid JSON — no markdown, no explanation, just the JSON object.

Schema:
{
  "food_name": "descriptive name of the food",
  "brand": "",
  "serving_g": 100,
  "serving_unit": "g",
  "calories": 0,
  "protein_g": 0,
  "carbs_g": 0,
  "fat_g": 0,
  "fibre_g": 0,
  "sugar_g": 0,
  "sodium_mg": 0,
  "confidence": "high|medium|low",
  "notes": "e.g. estimated average values, specify if per 100g or per serving"
}

Rules:
- serving_unit is "ml" if the food is a liquid or beverage (milk, juice, soft drinks, coffee, soup you'd drink, alcohol), otherwise "g"
- All numeric values are per 100g (or per 100ml for liquids) unless the image clearly shows a specific serving size
- Use typical average nutritional values for the identified food
- If you can read nutritional info from packaging in the image, use those values
- If you cannot identify any food, return food_name as empty string and confidence as "low"
- confidence: "high" = clear, recognisable food; "medium" = likely identification; "low" = uncertain`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  // GET → the caller's allowance, so the scanner can say "2 of 3 free
  // scans left this week" before anyone spends one.
  if (event.httpMethod === 'GET') {
    const auth = await requireUser(event, CORS);
    if (auth.error) return auth.error;
    if (!underLimit('ai-food-quota', auth.userId, 30)) return tooMany(CORS);
    const a = await allowanceFor(auth);
    return { statusCode: 200, headers: { ...CORS, 'Cache-Control': 'no-store' }, body: JSON.stringify(a) };
  }
  if (event.httpMethod !== 'POST') {

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Costs money / fetches on the user's behalf — vision tokens are the priciest call in the app.
  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!underLimit('ai-food', auth.userId, 8)) return tooMany(CORS);

  const ip = event.headers['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'Rate limit reached — try again in a moment' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'AI food detection is not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { imageBase64 } = body;
  if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'imageBase64 is required' }) };
  }

  // Sanity-check size (max ~3MB base64 ≈ 4MB image)
  if (imageBase64.length > 4_000_000) {
    return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: 'Image too large — reduce camera resolution' }) };
  }

  // Free accounts: refuse once this week's allowance is used, BEFORE any
  // money is spent. 402 + `free_limit` so the app opens the paywall
  // rather than showing an error.
  const allowance = await allowanceFor(auth);
  if (!allowance.paid && allowance.left <= 0) {
    return {
      statusCode: 402,
      headers: CORS,
      body: JSON.stringify({
        error: 'free_limit',
        message: `You've used your ${FREE_LIMIT} free AI scans this week. Barcode and text search are still free — or go Pro for unlimited scans.`,
        limit: FREE_LIMIT, left: 0, resetsOn: allowance.resetsOn,
      }),
    };
  }

  // Durable per-day cap. Pro is charged up front, as before. A free scan
  // is charged once Anthropic has answered (below), so a network failure
  // doesn't eat one of only three.
  if (allowance.paid && !(await withinDailyAiCap('food-detect', auth.userId))) return overDailyCap(CORS);

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
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
            },
            {
              type: 'text',
              text: 'Identify this food and return the JSON.',
            },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic error:', res.status, errText);
      throw new Error(`Anthropic ${res.status}`);
    }

    // The model looked at the photo, so this counts — even if it then
    // finds no food (that call still cost money, and counting it is what
    // stops a free account scanning the ceiling for free).
    let freeLeft = null;
    if (!allowance.paid) {
      const within = await withinDailyAiCap('food-detect', auth.userId);
      noteLocalUse('food-detect', auth.userId);
      freeLeft = Math.max(0, allowance.left - 1);
      if (!within) return overDailyCap(CORS);
    }

    const anthropicData = await res.json();
    const rawText = anthropicData.content?.[0]?.text?.trim() || '';

    // Extract JSON object from the response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');

    const food = JSON.parse(jsonMatch[0]);

    if (!food.food_name) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ error: 'Could not identify food in image — try pointing at the packaging or use text search', confidence: 'low', freeScansLeft: freeLeft }),
      };
    }

    // Ensure all numeric fields are numbers
    const numFields = ['serving_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g', 'sugar_g', 'sodium_mg'];
    numFields.forEach(f => { food[f] = parseFloat(food[f]) || 0; });
    // Normalise the unit — anything that isn't explicitly ml is grams.
    food.serving_unit = food.serving_unit === 'ml' ? 'ml' : 'g';

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ...food, source: 'ai-vision', freeScansLeft: freeLeft }),
    };
  } catch (err) {
    console.error('ai-food-detect error:', err.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: 'AI detection failed — try text search instead' }),
    };
  }
};
