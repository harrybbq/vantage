/**
 * Netlify serverless function: shop-autofill
 *
 * Given a product URL, returns a best-effort {name, price, imageUrl,
 * notes} extracted from the page's metadata. Free + deterministic —
 * no LLM call.
 *
 * Strategy (in priority order):
 *   1. JSON-LD schema.org Product blocks — most reliable when present
 *      (Amazon, Shopify, most modern e-commerce frameworks include
 *      these for SEO).
 *   2. Open Graph tags (og:title, og:image, og:description, og:price).
 *   3. Twitter Card tags (twitter:title, etc) as a last fallback.
 *   4. <title> tag for the name if all else fails.
 *
 * Why server-side: Anthropic's API can't be called from the browser
 * (CORS, key exposure). Even fetching the product URL itself fails
 * cross-origin from the client. The function is the only safe path.
 *
 * No required env vars — works as soon as it's deployed.
 *
 * Spend: $0. No external API calls; the function fetches the URL
 * itself and parses the HTML in-process.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const { fetchWithTimeout, isBlockedHost, extractProductInfo } = require('../lib/productPage');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) }; }

  const url = (body.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'url must start with http:// or https://' }) };
  }

  // Defense — block private / loopback hosts. Without this an attacker
  // could turn this function into an SSRF probe of internal Netlify
  // network or your local services.
  const parsed = new URL(url);
  if (isBlockedHost(parsed.hostname)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'host not allowed' }) };
  }

  let html;
  try {
    html = await fetchWithTimeout(url);
  } catch (e) {
    return {
      statusCode: 200, // 200 with empty result so client can fall back to manual entry cleanly
      headers: CORS,
      body: JSON.stringify({ ok: false, reason: 'fetch_failed', detail: e.message }),
    };
  }

  const result = extractProductInfo(html, parsed);
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ ok: true, ...result }),
  };
};

