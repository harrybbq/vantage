/**
 * netlify/lib/v1Adapter.mjs — the v1-handler-as-v2-function shim behind
 * the rate-limited entries (STARTUP_REQUIREMENTS item 86).
 *
 * What must hold: the handler sees the event it saw under v1 (headers
 * lower-cased, query string, body text vs base64, path/rawUrl), and the
 * client gets back exactly what the handler returned — status, headers
 * (CORS included), body bytes — and nothing the Fetch API would add on
 * its own (a default content-type, a body on a 204).
 *
 * Run: npm run check:ratelimit   (also part of npm run build)
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { adapt, toV1Event, toResponse, shouldBase64Encode } from './v1Adapter.mjs';

let n = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
const deq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

const BASE = 'https://deploy-preview-1--example.netlify.app';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── shouldBase64Encode mirrors Netlify's v1 rule ───────────────────────
{
  eq(shouldBase64Encode('application/json'), false, 'json is text');
  eq(shouldBase64Encode('application/json; charset=utf-8'), false, 'parameters ignored');
  eq(shouldBase64Encode('APPLICATION/JSON'), false, 'case-insensitive');
  eq(shouldBase64Encode('text/plain;charset=UTF-8'), false, 'text/* is text');
  eq(shouldBase64Encode('application/csp-report'), false, 'csp-report is text');
  eq(shouldBase64Encode('application/x-www-form-urlencoded'), false, 'form is text');
  eq(shouldBase64Encode('application/vnd.api+json'), false, '+json is text');
  eq(shouldBase64Encode('image/svg+xml'), false, '+xml is text');
  eq(shouldBase64Encode('image/png'), true, 'images are base64');
  eq(shouldBase64Encode('application/octet-stream'), true, 'octet-stream is base64');
  eq(shouldBase64Encode(''), true, 'no content type → base64 (Netlify\'s rule)');
  eq(shouldBase64Encode(undefined), true, 'absent → base64');
}

// ── Request → event ────────────────────────────────────────────────────
{
  const req = new Request(`${BASE}/.netlify/functions/food-search?mode=name&q=oat%20milk&tag=a&tag=b`, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer user.jwt',
      'X-NF-Client-Connection-IP': '203.0.113.7',
      'X-Forwarded-For': '203.0.113.7, 10.0.0.1',
      'X-Custom-Thing': 'Mixed Case Value',
    },
  });
  const e = await toV1Event(req, { ip: '198.51.100.9' });
  eq(e.httpMethod, 'GET', 'httpMethod');
  eq(e.path, '/.netlify/functions/food-search', 'path is the pathname');
  eq(e.rawUrl, `${BASE}/.netlify/functions/food-search?mode=name&q=oat%20milk&tag=a&tag=b`, 'rawUrl is the full URL');
  eq(e.rawQuery, 'mode=name&q=oat%20milk&tag=a&tag=b', 'rawQuery without "?"');
  deq(e.queryStringParameters, { mode: 'name', q: 'oat milk', tag: 'a, b' }, 'query decoded; repeated keys joined with ", " (netlify-cli)');
  deq(e.multiValueQueryStringParameters, { mode: ['name'], q: ['oat milk'], tag: ['a', 'b'] }, 'multi-value query');
  eq(e.headers.authorization, 'Bearer user.jwt', 'headers lower-cased: authorization');
  eq(e.headers.Authorization, undefined, 'no upper-case duplicate');
  eq(e.headers['x-custom-thing'], 'Mixed Case Value', 'header VALUES keep their case');
  eq(e.headers['x-nf-client-connection-ip'], '203.0.113.7', 'Netlify IP header passes through and beats context.ip');
  eq(e.headers['x-forwarded-for'], '203.0.113.7, 10.0.0.1', 'x-forwarded-for passes through intact');
  deq(e.multiValueHeaders.authorization, ['Bearer user.jwt'], 'multiValueHeaders mirrors headers');
  eq(e.body, null, 'GET → no body');
  eq(e.isBase64Encoded, true, 'no content type → flagged base64, as Netlify does (no body to decode)');
}
{
  const e = await toV1Event(new Request(`${BASE}/.netlify/functions/weather`), {});
  deq(e.queryStringParameters, {}, 'no query → {}');
  eq(e.rawQuery, '', 'no query → empty rawQuery');
}

// IP / geo fallbacks from the v2 context, only when the header is absent.
{
  const e = await toV1Event(new Request(`${BASE}/x`), {
    ip: '198.51.100.9',
    geo: { city: 'Leeds', country: { code: 'GB', name: 'United Kingdom' }, latitude: 53.8, longitude: -1.55, postalCode: 'LS1' },
  });
  eq(e.headers['x-nf-client-connection-ip'], '198.51.100.9', 'context.ip fills a missing IP header');
  const geo = JSON.parse(Buffer.from(e.headers['x-nf-geo'], 'base64').toString('utf8'));
  eq(geo.city, 'Leeds', 'context.geo → base64 JSON x-nf-geo (city)');
  eq(geo.country.code, 'GB', 'country code kept');
  eq(geo.latitude, 53.8, 'latitude kept');
  eq(geo.postal_code, 'LS1', 'postalCode mapped back to the v1 header key');
  eq(geo.postalCode, undefined, 'no camelCase key in the v1 form');

  const raw = Buffer.from(JSON.stringify({ city: 'York' })).toString('base64');
  const e2 = await toV1Event(new Request(`${BASE}/x`, { headers: { 'x-nf-geo': raw } }), { geo: { city: 'Leeds' } });
  eq(e2.headers['x-nf-geo'], raw, 'a real x-nf-geo header is passed through untouched');

  const e3 = await toV1Event(new Request(`${BASE}/x`), { geo: {} });
  eq(e3.headers['x-nf-geo'], undefined, 'empty context.geo → no header invented');
  eq(e3.headers['x-nf-client-connection-ip'], undefined, 'no ip anywhere → no header invented');
}

// Bodies: text stays text, binary arrives base64 (Netlify's v1 rule).
{
  const json = JSON.stringify({ q: 'porridge', note: 'café ☕' });
  const e = await toV1Event(new Request(`${BASE}/x`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json,
  }));
  eq(e.body, json, 'JSON body as UTF-8 text, multibyte intact');
  eq(e.isBase64Encoded, false, 'JSON not flagged base64');

  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
  const e2 = await toV1Event(new Request(`${BASE}/x`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes,
  }));
  eq(e2.isBase64Encoded, true, 'binary flagged base64');
  eq(e2.body, bytes.toString('base64'), 'binary body base64-encoded');
  deq(Buffer.from(e2.body, 'base64'), bytes, 'base64 round-trips to the same bytes');

  const e3 = await toV1Event(new Request(`${BASE}/x`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '',
  }));
  eq(e3.body, null, 'empty POST body → null (handlers read event.body || "{}")');
}

// ── result → Response ──────────────────────────────────────────────────
{
  const res = toResponse({ statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'X-Count': 3 }, body: '{"ok":true,"name":"café"}' });
  eq(res.status, 200, 'status');
  eq(res.headers.get('access-control-allow-origin'), '*', 'CORS origin preserved');
  eq(res.headers.get('access-control-allow-headers'), 'Content-Type, Authorization', 'CORS headers preserved');
  eq(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS', 'CORS methods preserved');
  eq(res.headers.get('content-type'), 'application/json', 'content-type as set');
  eq(res.headers.get('x-count'), '3', 'numeric header value stringified');
  eq(await res.text(), '{"ok":true,"name":"café"}', 'body text intact (UTF-8)');
}
{
  const res = toResponse({ statusCode: 200, headers: { ...CORS }, body: 'plain' });
  eq(res.headers.get('content-type'), null, 'NO content-type synthesized when the handler set none');
  deq([...res.headers.keys()].sort(), Object.keys(CORS).map(k => k.toLowerCase()).sort(), 'exactly the handler\'s headers, nothing added');
}
{
  const res = toResponse({ statusCode: 204, headers: CORS, body: '' });
  eq(res.status, 204, 'OPTIONS preflight: 204');
  eq(res.body, null, '204 has a null body (constructor would throw on "")');
  eq(res.headers.get('access-control-allow-origin'), '*', 'preflight keeps CORS');
  for (const s of [205, 304]) eq(toResponse({ statusCode: s, body: 'x' }).body, null, `${s} → null body`);
}
{
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  const res = toResponse({ statusCode: 200, headers: { 'Content-Type': 'image/png' }, body: png.toString('base64'), isBase64Encoded: true });
  deq(Buffer.from(await res.arrayBuffer()), png, 'isBase64Encoded result → original bytes');
}
{
  const res = toResponse({
    statusCode: 302,
    headers: { Location: '/x', 'Set-Cookie': 'ignored=1' },
    multiValueHeaders: { 'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'] },
    body: '',
  });
  eq(res.status, 302, 'redirect status');
  eq(res.headers.get('location'), '/x', 'location header');
  deq(res.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/'], 'multiValueHeaders appended; the list is the full set');
}
{
  for (const s of [400, 401, 402, 405, 413, 429, 500, 503]) {
    const r = toResponse({ statusCode: s, headers: CORS, body: JSON.stringify({ error: 'x' }) });
    eq(r.status, s, `status ${s} passes through`);
  }
  eq(toResponse({ statusCode: 200, headers: CORS }).body, null, 'undefined body → null');
}

// ── adapt(): end to end ────────────────────────────────────────────────
{
  const seen = [];
  const handler = async (event, ctx) => {
    seen.push({ event, ctx });
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
    if (!event.headers.authorization) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'sign in to use this feature' }) };
    const b = JSON.parse(event.body || '{}');
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ echo: b.q, q: event.queryStringParameters.mode || null }) };
  };
  const fn = adapt(handler);

  const pre = await fn(new Request(`${BASE}/.netlify/functions/t`, {
    method: 'OPTIONS', headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'POST' },
  }), {});
  eq(pre.status, 204, 'adapt: OPTIONS → 204');
  eq(pre.body, null, 'adapt: preflight has no body');
  eq(pre.headers.get('access-control-allow-origin'), '*', 'adapt: preflight CORS');
  eq(seen[0].event.headers.origin, 'capacitor://localhost', 'adapt: handler saw the Origin header');
  deq(seen[0].ctx, {}, 'adapt: handler gets an empty v1 context (no handler reads it)');

  const anon = await fn(new Request(`${BASE}/.netlify/functions/t`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), {});
  eq(anon.status, 401, 'adapt: unauthenticated → 401');
  eq(await anon.text(), '{"error":"sign in to use this feature"}', 'adapt: 401 body byte-identical');
  eq(anon.headers.get('content-type'), null, 'adapt: no content-type added to a handler response without one');

  const okRes = await fn(new Request(`${BASE}/.netlify/functions/t?mode=name`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer j' }, body: '{"q":"oats"}',
  }), { ip: '203.0.113.1' });
  eq(okRes.status, 200, 'adapt: 200');
  deq(await okRes.json(), { echo: 'oats', q: 'name' }, 'adapt: body + query reach the handler');

  let threw = false;
  try { await adapt(async () => { throw new Error('boom'); })(new Request(`${BASE}/x`), {}); } catch (e) { threw = e.message === 'boom'; }
  ok(threw, 'adapt: a handler throw propagates to the runtime (no catch-all)');

  let typeErr = false;
  try { adapt(undefined); } catch (e) { typeErr = e instanceof TypeError; }
  ok(typeErr, 'adapt: refuses a missing handler at load time');
}

console.log(`check:ratelimit (adapter) — ${n} checks passed`);
