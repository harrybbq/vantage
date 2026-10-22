/**
 * v1Adapter — run an unchanged v1 (Lambda-style) handler as a v2 function.
 *
 * Why this exists (STARTUP_REQUIREMENTS item 86): Netlify's per-IP rate
 * limit for functions is declared in the function's own source as
 * `export const config = { rateLimit: {…} }`, and the bundler only reads
 * that from a v2 function — one with a default export and no `handler`
 * export (@netlify/zip-it-and-ship-it, in_source_config/index.js: the v1
 * branch never looks at `config`). The rate limit is enforced by Netlify
 * before the function is invoked, so a flood costs no invocation, no
 * Supabase call and no third-party spend.
 *
 * Rewriting 13 handlers to the Request/Response API would be a large,
 * risky diff for a change whose only purpose is the rate limit. Instead
 * each converted function is a thin `.mjs` entry that exports the config
 * and `adapt(handler)`, and the handler itself moved, unchanged apart
 * from its require paths, to netlify/lib/handlers/<name>.js.
 *
 * The contract is "byte-for-byte the same response as v1":
 *
 *   Request → event
 *     · headers: lower-cased, repeated values comma-joined — exactly what
 *       the Fetch `Headers` iterator yields, and what v1 handlers already
 *       read (`event.headers['x-nf-client-connection-ip']`, `x-nf-geo`,
 *       `authorization`, …). Netlify's v2 bootstrap builds the Request
 *       from the same Lambda event v1 receives and copies every header
 *       across (@netlify/serverless-functions-api, `fromEventHeaders`), so
 *       those headers are present; `context.ip` / `context.geo` only fill
 *       in if one is somehow missing.
 *     · body: text, or base64 with isBase64Encoded = true when the
 *       content type is binary — the same rule Netlify uses for v1
 *       (@netlify/dev-utils `shouldBase64Encode`). No body → null; every
 *       converted handler reads `event.body || '{}'`.
 *     · queryStringParameters: repeated keys joined with ', ' (netlify-cli
 *       lib/functions/server.js does the same), plus the multi-value form.
 *     · path, rawUrl, rawQuery, httpMethod, multiValueHeaders.
 *
 *   result → Response
 *     · statusCode, headers (numbers stringified), multiValueHeaders
 *       (appended, so Set-Cookie survives), body.
 *     · The body goes in as BYTES, never as a string: `new Response('x')`
 *       would add `content-type: text/plain;charset=UTF-8` to a response
 *       whose handler set none. Bytes add no headers.
 *     · isBase64Encoded → the body is decoded to the original bytes.
 *     · 101/103/204/205/304 get a null body — every converted function
 *       answers OPTIONS with `204, body: ''`, and the Response constructor
 *       throws on any body (even '') with those statuses.
 *
 * A handler that throws is left to throw: the runtime turns it into an
 * error response, as it did for v1. The adapter adds no catch-all.
 */
import { Buffer } from 'node:buffer';

// @netlify/dev-utils 6.0.4, src/lib/base64.ts — content types Netlify
// passes to a v1 function as text even though they are not text/*.
const TEXT_EXCEPTIONS = new Set([
  'application/csp-report',
  'application/graphql',
  'application/json',
  'application/javascript',
  'application/x-www-form-urlencoded',
  'application/x-ndjson',
  'application/xml',
]);

/** Netlify's v1 rule: is this request body handed over as base64? */
export function shouldBase64Encode(contentType) {
  if (!contentType) return true;
  const ct = String(contentType).split(';')[0].trim().toLowerCase();
  if (ct.startsWith('text/')) return false;
  if (ct.endsWith('+json') || ct.endsWith('+xml')) return false;
  return !TEXT_EXCEPTIONS.has(ct);
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** Encode Netlify's v2 `context.geo` back into the v1 `x-nf-geo` header form. */
function geoHeaderFrom(geo) {
  if (!geo || typeof geo !== 'object' || Object.keys(geo).length === 0) return '';
  const { postalCode, ...rest } = geo;
  const v1 = postalCode === undefined ? rest : { ...rest, postal_code: postalCode };
  return Buffer.from(JSON.stringify(v1)).toString('base64');
}

/** Build the v1 event a Lambda-style handler expects from a v2 Request. */
export async function toV1Event(req, context = {}) {
  const url = new URL(req.url);

  const headers = {};
  for (const [name, value] of req.headers) headers[name] = value;
  if (!headers['x-nf-client-connection-ip'] && typeof context.ip === 'string' && context.ip) {
    headers['x-nf-client-connection-ip'] = context.ip;
  }
  if (!headers['x-nf-geo']) {
    const geo = geoHeaderFrom(context.geo);
    if (geo) headers['x-nf-geo'] = geo;
  }
  const multiValueHeaders = {};
  for (const [name, value] of Object.entries(headers)) multiValueHeaders[name] = [value];

  const multiValueQueryStringParameters = {};
  for (const [key, value] of url.searchParams) {
    (multiValueQueryStringParameters[key] ||= []).push(value);
  }
  const queryStringParameters = {};
  for (const [key, values] of Object.entries(multiValueQueryStringParameters)) {
    queryStringParameters[key] = values.join(', ');
  }

  const isBase64Encoded = shouldBase64Encode(headers['content-type']);
  let body = null;
  if (req.body !== null && req.method !== 'GET' && req.method !== 'HEAD') {
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length > 0) body = bytes.toString(isBase64Encoded ? 'base64' : 'utf8');
  }

  return {
    path: url.pathname,
    httpMethod: req.method,
    headers,
    multiValueHeaders,
    queryStringParameters,
    multiValueQueryStringParameters,
    body,
    isBase64Encoded,
    rawUrl: url.toString(),
    rawQuery: url.search.slice(1),
  };
}

/** Turn a v1 handler result into a Fetch Response, adding nothing. */
export function toResponse(result) {
  const r = result || {};
  const status = Number(r.statusCode) || 200;

  const headers = new Headers();
  for (const [name, value] of Object.entries(r.headers || {})) {
    if (value !== undefined && value !== null) headers.set(name, String(value));
  }
  for (const [name, values] of Object.entries(r.multiValueHeaders || {})) {
    if (!Array.isArray(values)) continue;
    // A name in both maps: the multi-value list is the complete set.
    headers.delete(name);
    for (const value of values) {
      if (value !== undefined && value !== null) headers.append(name, String(value));
    }
  }

  let body = null;
  if (!NULL_BODY_STATUS.has(status) && r.body !== undefined && r.body !== null) {
    const text = typeof r.body === 'string' ? r.body : String(r.body);
    body = r.isBase64Encoded ? Buffer.from(text, 'base64') : Buffer.from(text, 'utf8');
  }
  return new Response(body, { status, headers });
}

/**
 * Wrap a v1 handler as a v2 default export:
 *   export default adapt(require('../lib/handlers/x.js').handler)
 */
export function adapt(handler) {
  if (typeof handler !== 'function') throw new TypeError('adapt: handler must be a function');
  return async function v2Handler(req, context) {
    const event = await toV1Event(req, context || {});
    const result = await handler(event, {});
    return toResponse(result);
  };
}
