// node src/lib/data/saveExport.test.mjs
import assert from 'node:assert/strict';
import { saveExport } from './saveExport.js';

class FakeFile { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type; } }
class FakeBlob { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } }

function webEnv() {
  const clicks = [];
  const revoked = [];
  return {
    clicks, revoked,
    env: {
      native: false,
      nav: { share: () => { throw new Error('web must not share'); } },
      doc: { createElement: () => { const a = { click() { clicks.push({ href: a.href, download: a.download }); } }; return a; } },
      URLImpl: { createObjectURL: () => 'blob:x', revokeObjectURL: u => revoked.push(u) },
      BlobImpl: FakeBlob,
      FileImpl: FakeFile,
    },
  };
}

function nativeEnv(nav) {
  return { native: true, nav, doc: undefined, URLImpl: undefined, BlobImpl: FakeBlob, FileImpl: FakeFile };
}

let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', name); }

await t('web: downloads through an <a download>, never the share sheet', async () => {
  const w = webEnv();
  assert.equal(await saveExport('v.json', '{}', w.env), 'downloaded');
  assert.deepEqual(w.clicks, [{ href: 'blob:x', download: 'v.json' }]);
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(w.revoked, ['blob:x']);
});

await t('native: shares a File with the right name and type', async () => {
  let got = null;
  const nav = { canShare: () => true, share: async p => { got = p; } };
  assert.equal(await saveExport('v.json', '{"a":1}', nativeEnv(nav)), 'shared');
  assert.equal(got.files.length, 1);
  assert.equal(got.files[0].name, 'v.json');
  assert.equal(got.files[0].type, 'application/json');
  assert.deepEqual(got.files[0].parts, ['{"a":1}']);
});

await t('native: closing the sheet is "cancelled", not an error', async () => {
  const nav = { canShare: () => true, share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } };
  assert.equal(await saveExport('v.json', '{}', nativeEnv(nav)), 'cancelled');
});

await t('native: other share failures are "failed"', async () => {
  const nav = { canShare: () => true, share: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } };
  assert.equal(await saveExport('v.json', '{}', nativeEnv(nav)), 'failed');
});

await t('native without navigator.share (Android WebView) is "unsupported"', async () => {
  assert.equal(await saveExport('v.json', '{}', nativeEnv({})), 'unsupported');
  assert.equal(await saveExport('v.json', '{}', nativeEnv(undefined)), 'unsupported');
});

await t('native where files cannot be shared is "unsupported", and share is never called', async () => {
  let called = false;
  const nav = { canShare: () => false, share: async () => { called = true; } };
  assert.equal(await saveExport('v.json', '{}', nativeEnv(nav)), 'unsupported');
  assert.equal(called, false);
});

await t('web: a throwing download is "failed", never a throw', async () => {
  const w = webEnv();
  w.env.URLImpl = { createObjectURL: () => { throw new Error('nope'); } };
  assert.equal(await saveExport('v.json', '{}', w.env), 'failed');
});

console.log(`# pass ${n}`);
