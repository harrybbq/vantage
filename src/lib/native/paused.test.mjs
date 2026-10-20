// node src/lib/native/paused.test.mjs — the client side of the kill switch.
import assert from 'node:assert/strict';
import { calmPaused, PAUSED_MESSAGE, isPausedBody } from './paused.js';

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// A paused answer becomes the calm line on `error`, still a 503.
{
  const r = await calmPaused(json(503, { error: 'paused', area: 'sync', message: 'x' }, { 'Retry-After': '600' }));
  assert.equal(r.status, 503);
  assert.equal(r.ok, false);
  const b = await r.json();
  assert.equal(b.error, PAUSED_MESSAGE);
  assert.equal(b.message, PAUSED_MESSAGE);
  assert.equal(b.area, 'sync');
  assert.equal(isPausedBody(b), true);
  assert.equal(r.headers.get('Retry-After'), '600');
}

// Other responses pass through untouched — the same object.
{
  const okRes = json(200, { a: 1 });
  assert.equal(await calmPaused(okRes), okRes);
  assert.equal((await okRes.json()).a, 1, 'body still readable: only a 503 is cloned');
  const other503 = json(503, { error: 'not configured' });
  const same = await calmPaused(other503);
  assert.equal(same, other503);
  assert.equal((await same.json()).error, 'not configured', 'a non-pause 503 keeps its own message');
  const html503 = new Response('<html>down</html>', { status: 503 });
  assert.equal(await calmPaused(html503), html503, 'non-JSON 503 untouched');
  assert.equal(await calmPaused(null), null);
  assert.equal(isPausedBody({ error: 'x' }), false);
}

console.log('paused (client): ok');
