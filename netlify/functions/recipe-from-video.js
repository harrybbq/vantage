/**
 * Netlify function: recipe-from-video
 *
 * POST { url } → the recipe a saved cooking video describes:
 *   { title, servings, ingredients: [{ qty, unit, item }], macros:
 *     { kcal, protein, carbs, fat } | null, source, confidence, note }
 *
 * How it reads the video, with no API key of our own:
 *   YouTube   the watch page's player response carries the full
 *             description (shortDescription). YOUTUBE_API_KEY, if set,
 *             is used instead — the supported route, and sturdier.
 *   TikTok    the public oEmbed endpoint returns the caption.
 *   others    refused — Instagram needs a login to read a caption.
 *
 * Claude then pulls the ingredient list out of that text and estimates
 * the macros per serving. `source` says where the list came from:
 * 'description' (it was written there) or 'inferred' (there was no list,
 * so it is a typical version of the dish — the app says so). Structured
 * output (output_config.format, json_schema) guarantees the JSON shape.
 *
 * Required Netlify env var: ANTHROPIC_API_KEY. Optional: YOUTUBE_API_KEY.
 * Signed-in users only; 10 reads a minute each.
 */
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};
const reply = (code, body) => ({ statusCode: code, headers: CORS, body: JSON.stringify(body) });

const MODEL = 'claude-opus-5';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function youtubeId(u) {
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    return u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]+)/) || [])[1] || null;
  }
  return null;
}

async function readYouTube(id) {
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(id)}&key=${key}`);
    if (r.ok) {
      const s = ((await r.json()).items || [])[0]?.snippet;
      if (s) return { title: s.title || '', text: s.description || '', author: s.channelTitle || '' };
    }
  }
  // The watch page. The consent cookies keep an EU egress from being
  // served the cookie wall instead of the page.
  const r = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9', Cookie: 'CONSENT=YES+cb; SOCS=CAI' },
  });
  if (!r.ok) throw new Error(`YouTube ${r.status}`);
  const html = await r.text();
  const str = re => { const m = html.match(re); if (!m) return ''; try { return JSON.parse(`"${m[1]}"`); } catch { return ''; } };
  const text = str(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  const title = str(/"videoDetails":\{[^}]*?"title":"((?:[^"\\]|\\.)*)"/) || str(/<title>([^<]*)<\/title>/);
  const author = str(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/);
  if (!title && !text) throw new Error('YouTube page had no details');
  return { title, text, author };
}

async function readTikTok(url) {
  const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`TikTok ${r.status}`);
  const j = await r.json();
  return { title: j.title || '', text: j.title || '', author: j.author_name || '' };
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'servings', 'ingredients', 'macros', 'source', 'confidence', 'note'],
  properties: {
    title: { type: 'string' },
    servings: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['qty', 'unit', 'item'],
        properties: {
          qty: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          unit: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          item: { type: 'string' },
        },
      },
    },
    macros: {
      anyOf: [{ type: 'null' }, {
        type: 'object',
        additionalProperties: false,
        required: ['kcal', 'protein', 'carbs', 'fat'],
        properties: { kcal: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' } },
      }],
    },
    source: { type: 'string', enum: ['description', 'inferred', 'none'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    note: { type: 'string' },
  },
};

const SYSTEM = `You read the title and description (or caption) of a cooking video and return the recipe it describes, for a UK user planning high-protein meal prep.

- If the text lists ingredients, return exactly those, with source "description". Keep quantities as written, converting cups/oz to metric only when the text gives both.
- If the text has no ingredient list but the title names a clear dish, return a typical version of that dish with source "inferred" and say so in note.
- If you cannot tell what the dish is, return an empty ingredients list, macros null and source "none".
- qty is a number (0.5 for "half"), unit a short unit such as g, kg, ml, tsp, tbsp, cup, clove, tin, or null for a count ("2 eggs" is qty 2, unit null, item "eggs"). item is the ingredient without the quantity, with any prep note after a comma ("chicken thigh, diced").
- servings is how many portions the recipe makes if stated, else your best estimate of portions for a meal-prep batch, or null.
- macros are your estimate PER SERVING from the ingredients and servings (kcal, and grams of protein, carbs, fat), or null if there are no ingredients.
- title is a short, plain name for the dish, not the video's clickbait title.
- note is one short sentence about anything the user should check, or "".`;

async function extract(meta) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      // A small, well-specified extraction: low effort keeps it quick
      // enough for a function's time limit.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Title: ${meta.title}\nChannel: ${meta.author}\n\nDescription:\n${(meta.text || '').slice(0, 12000)}`,
      }],
    }),
  });
  if (!res.ok) {
    console.error('Anthropic error:', res.status, await res.text());
    throw new Error(`Anthropic ${res.status}`);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('The video could not be read.');
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!underLimit('ai-recipe', auth.userId, 10)) return tooMany(CORS);
  if (!process.env.ANTHROPIC_API_KEY) return reply(503, { error: 'Reading videos is not set up on this site yet.' });

  let url;
  try {
    const raw = String(JSON.parse(event.body || '{}').url || '').trim();
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return reply(400, { error: 'That doesn’t look like a link.' });
  }

  let meta;
  try {
    const host = url.hostname.toLowerCase();
    const yt = youtubeId(url);
    if (yt) meta = await readYouTube(yt);
    else if (host.endsWith('tiktok.com')) meta = await readTikTok(url.href);
    else return reply(422, { error: 'Only YouTube and TikTok videos can be read. Paste the ingredients in by hand.' });
  } catch (e) {
    console.error('read video:', e.message);
    return reply(502, { error: 'Couldn’t read that video just now. Try again, or paste the ingredients in by hand.' });
  }

  try {
    const r = await extract(meta);
    return reply(200, {
      title: String(r.title || meta.title || '').slice(0, 120),
      servings: Number.isFinite(r.servings) && r.servings > 0 ? Math.round(r.servings) : null,
      ingredients: (r.ingredients || []).slice(0, 60).map(i => ({
        qty: Number.isFinite(i.qty) ? i.qty : null,
        unit: i.unit ? String(i.unit).slice(0, 12) : null,
        item: String(i.item || '').slice(0, 120),
      })).filter(i => i.item),
      macros: r.macros ? {
        kcal: Math.round(r.macros.kcal || 0), protein: Math.round(r.macros.protein || 0),
        carbs: Math.round(r.macros.carbs || 0), fat: Math.round(r.macros.fat || 0),
      } : null,
      source: r.source,
      confidence: r.confidence,
      note: String(r.note || '').slice(0, 240),
    });
  } catch (e) {
    console.error('extract:', e.message);
    return reply(502, { error: 'Couldn’t pull the ingredients out of that video.' });
  }
};
