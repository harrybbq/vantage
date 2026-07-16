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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const SYSTEM_PROMPT = `You are a nutrition analysis assistant. When given a food image, identify the food and return ONLY valid JSON — no markdown, no explanation, just the JSON object.

Schema:
{
  "food_name": "descriptive name of the food",
  "brand": "",
  "serving_g": 100,
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
- All numeric values are per 100g unless the image clearly shows a specific serving size
- Use typical average nutritional values for the identified food
- If you can read nutritional info from packaging in the image, use those values
- If you cannot identify any food, return food_name as empty string and confidence as "low"
- confidence: "high" = clear, recognisable food; "medium" = likely identification; "low" = uncertain`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

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
        body: JSON.stringify({ error: 'Could not identify food in image — try pointing at the packaging or use text search', confidence: 'low' }),
      };
    }

    // Ensure all numeric fields are numbers
    const numFields = ['serving_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g', 'sugar_g', 'sodium_mg'];
    numFields.forEach(f => { food[f] = parseFloat(food[f]) || 0; });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ...food, source: 'ai-vision' }),
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
