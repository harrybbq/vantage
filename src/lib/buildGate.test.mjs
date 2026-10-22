// node src/lib/buildGate.test.mjs — the update gate and build census (Phase 0, docs/STATE_SIZE_PLAN.md).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  currentBuild, minBuildFor, decideBuildGate, latchGate, mayMountApp,
  censusMarker, shouldNoteBuild, FUTURE_MARGIN_MS, PLATFORMS,
} from './buildGate.js';
import BuildGateBoundary from '../components/buildgate/BuildGateBoundary.js';

let n = 0;
const t = (name, fn) => { fn(); n++; void name; };

const NOW = 1792700000000;              // fixed; never the wall clock
const OLD = NOW - 30 * 86400000;        // a build from a month ago
const NEW = NOW - 86400000;             // yesterday's build

t('no stamp outside a vite build', () => {
  assert.equal(currentBuild(), 0);
  assert.deepEqual([...PLATFORMS], ['web', 'native']);
});

t('minBuildFor: only a sane whole number counts', () => {
  assert.equal(minBuildFor({ web: NEW, native: OLD }, 'web', NOW), NEW);
  assert.equal(minBuildFor({ web: NEW, native: OLD }, 'native', NOW), OLD);
  assert.equal(minBuildFor({ web: 0, native: 0 }, 'web', NOW), 0, 'the shipped default enforces nothing');
  for (const v of [null, undefined, 'x', 42, [], { web: -1 }, { web: 1.5 }, { web: 'abc' }, { web: null }, { native: NEW }]) {
    assert.equal(minBuildFor(v, 'web', NOW), 0, JSON.stringify(v));
  }
  assert.equal(minBuildFor({ web: NEW }, 'ios', NOW), 0, 'unknown platform');
  assert.equal(minBuildFor({ web: String(NEW) }, 'web', NOW), NEW, 'a numeric string is read as its number');
});

t('a minimum from the future is a typo and is ignored', () => {
  assert.equal(minBuildFor({ web: NOW + FUTURE_MARGIN_MS - 1 }, 'web', NOW), NOW + FUTURE_MARGIN_MS - 1);
  assert.equal(minBuildFor({ web: NOW + FUTURE_MARGIN_MS + 1 }, 'web', NOW), 0);
  assert.equal(minBuildFor({ web: NOW * 1000 }, 'web', NOW), 0, 'seconds/ms mix-up');
  // So even the newest build is never stopped by it.
  assert.equal(decideBuildGate({ read: { ok: true, value: { web: NOW * 10 } }, build: NOW, platform: 'web', now: NOW }), 'ok');
});

t('decideBuildGate fails open', () => {
  const d = (read, build = OLD, platform = 'web') => decideBuildGate({ read, build, platform, now: NOW });
  assert.equal(d(undefined), 'pending', 'in flight: hold the loader');
  assert.equal(d({ ok: false }), 'ok', 'read error / timeout / table missing');
  assert.equal(d(null), 'ok');
  assert.equal(d({ ok: true, value: null }), 'ok', 'no row');
  assert.equal(d({ ok: true, value: { web: 0, native: 0 } }), 'ok', 'the default');
  assert.equal(d({ ok: true, value: { web: NEW } }), 'update', 'older than the minimum');
  assert.equal(d({ ok: true, value: { web: OLD } }), 'ok', 'equal to the minimum');
  assert.equal(d({ ok: true, value: { web: NEW } }, NEW + 1), 'ok', 'newer');
  assert.equal(d({ ok: true, value: { native: NEW } }, OLD, 'web'), 'ok', 'the other platform’s minimum');
  assert.equal(d({ ok: true, value: { native: NEW } }, OLD, 'native'), 'update');
  assert.equal(d({ ok: true, value: { web: NEW } }, 0), 'ok', 'an unstamped build is never stopped');
});

t('the latch: once mounted, never taken away', () => {
  for (const dec of ['pending', 'ok', 'update']) {
    assert.equal(latchGate(dec, true), 'ok', dec);
    assert.equal(latchGate(dec, false), dec, dec);
  }
});

t('census marker: once per user, platform and build', () => {
  assert.equal(censusMarker('u1', 'web', NEW), `u1|web|${NEW}`);
  assert.equal(censusMarker(null, 'web', NEW), null);
  assert.equal(censusMarker('u1', 'ios', NEW), null);
  assert.equal(censusMarker('u1', 'web', 0), null, 'no stamp → no census');
  assert.equal(shouldNoteBuild(null, 'u1', 'web', NEW), true, 'first open');
  assert.equal(shouldNoteBuild(`u1|web|${NEW}`, 'u1', 'web', NEW), false, 'same build again');
  assert.equal(shouldNoteBuild(`u1|web|${OLD}`, 'u1', 'web', NEW), true, 'a new build');
  assert.equal(shouldNoteBuild(`u1|web|${NEW}`, 'u2', 'web', NEW), true, 'another account on this device');
  assert.equal(shouldNoteBuild(null, 'u1', 'web', 0), false);
});

// ── The update path never mounts the state hook ──────────────────────
t('boundary never renders Board unless ok', () => {
  let calls = 0;
  function useVisionBoardState() { calls++; return { S: {}, hydrated: false }; }
  function Board() { useVisionBoardState(); return createElement('div', { id: 'board' }, 'board'); }
  const fallback = createElement('div', { id: 'update' }, 'update');
  for (const decision of ['pending', 'update', 'ok', undefined, 'anything']) {
    calls = 0;
    const html = renderToStaticMarkup(createElement(BuildGateBoundary, { decision, fallback }, createElement(Board)));
    const mounted = decision === 'ok';
    assert.equal(mayMountApp(decision), mounted, String(decision));
    assert.equal(calls, mounted ? 1 : 0, `${decision}: state hook calls`);
    assert.equal(html.includes('id="board"'), mounted);
    assert.equal(html.includes('id="update"'), !mounted);
  }
});

// App.jsx: the one <Board> sits inside BuildGateBoundary, which wraps
// WebAccessBoundary — so both boundary tests cover it.
t('App.jsx mounts Board only through the build gate', () => {
  const src = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const i = src.indexOf('<Board ');
  assert.ok(i !== -1 && (src.match(/<Board[\s>]/g) || []).length === 1, 'one <Board>');
  const open = src.lastIndexOf('<BuildGateBoundary', i);
  const close = src.indexOf('</BuildGateBoundary>', i);
  assert.ok(open !== -1 && close !== -1 && open < i && i < close, '<Board> sits inside <BuildGateBoundary>');
  assert.equal((src.slice(open, i).match(/<\/BuildGateBoundary>/g) || []).length, 0, 'no gate closes before it');
  const web = src.lastIndexOf('<WebAccessBoundary', i);
  assert.ok(web > open, 'the build gate is outermost');
});

// The client must stay fail-open and off the boot path.
t('buildGateClient: capped read, delayed best-effort census', () => {
  const src = readFileSync(new URL('./buildGateClient.js', import.meta.url), 'utf8');
  const ms = Number((src.match(/READ_TIMEOUT_MS = (\d+)/) || [])[1]);
  assert.ok(ms > 0 && ms <= 3000, 'the gate read is capped at ≤ 3 s');
  assert.match(src, /from\('app_config'\)\.select\('value'\)\.eq\('key', 'min_build'\)/);
  assert.match(src, /rpc\('note_client_build'/);
  assert.ok(!/from\('user_data'\)/.test(src), 'never touches user_data');
  const clear = readFileSync(new URL('./state/clearLocal.js', import.meta.url), 'utf8');
  assert.match(clear, /'vb_build_noted'/, 'the census marker (holds a user id) is cleared on sign-out');
});

console.log(`buildGate: ${n} groups passed`);
