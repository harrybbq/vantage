// node src/lib/webAccess.test.mjs — the web gate (item 131).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  normalizeMode, resolveMode, resolveAllowed, decideWebAccess, mayMountBoard, isGated,
  inviteAppOnly, cleanEmail, cleanNote, ownerErrorMessage, latchDecision, WEB_ACCESS_MODES,
} from './webAccess.js';
import WebAccessBoundary from '../components/webaccess/WebAccessBoundary.js';

let n = 0;
const t = (name, fn) => { fn(); n++; void name; };

// ── normalizeMode ─────────────────────────────────────────────────────
t('modes', () => {
  assert.deepEqual([...WEB_ACCESS_MODES], ['open', 'allowlist']);
  for (const v of ['allowlist', ' ALLOWLIST ', 'AllowList']) assert.equal(normalizeMode(v), 'allowlist', v);
  for (const v of ['open', 'OPEN', '', 'closed', 'allow-list', 'true', null, undefined, 1, {}, []]) {
    assert.equal(normalizeMode(v), 'open', String(v));
  }
});

// ── resolveMode: read × lastKnown ────────────────────────────────────
t('resolveMode table', () => {
  const reads = {
    okAllow: { ok: true, value: 'allowlist' },
    okOpen: { ok: true, value: 'open' },
    noRow: { ok: true, value: null },
    junk: { ok: true, value: 'nonsense' },
    error: { ok: false },
    nothing: undefined,
  };
  const table = [
    // read      lastKnown     → mode
    ['okAllow', undefined, 'allowlist'],
    ['okAllow', 'open', 'allowlist'],
    ['okAllow', 'allowlist', 'allowlist'],
    ['okOpen', undefined, 'open'],
    ['okOpen', 'allowlist', 'open'],      // a successful read always wins: reopening works
    ['noRow', undefined, 'open'],         // SQL not run → open
    ['noRow', 'allowlist', 'open'],       // a successful "no row" is authoritative
    ['junk', 'allowlist', 'open'],
    ['error', undefined, 'open'],         // fail open while the switch is off
    ['error', 'open', 'open'],
    ['error', 'allowlist', 'allowlist'],  // seen allowlist this session → keep it
    ['nothing', undefined, 'open'],
    ['nothing', 'allowlist', 'allowlist'],
  ];
  for (const [r, last, want] of table) assert.equal(resolveMode(reads[r], last), want, `${r}/${last}`);
});

// ── resolveAllowed ───────────────────────────────────────────────────
t('resolveAllowed table', () => {
  const table = [
    [{ ok: true, value: true }, undefined, true],
    [{ ok: true, value: false }, true, false],   // success wins over memory (removed from the list)
    [{ ok: true, value: 'yes' }, undefined, false],
    [{ ok: true, value: null }, undefined, false],
    [{ ok: false }, true, true],
    [{ ok: false }, false, false],
    [{ ok: false }, undefined, null],
    [undefined, undefined, null],
  ];
  for (const [read, last, want] of table) assert.equal(resolveAllowed(read, last), want, JSON.stringify([read, last]));
});

// ── decideWebAccess: the full matrix ─────────────────────────────────
// mode × native × owner × listed × public route × signed in
t('decideWebAccess matrix', () => {
  const modes = [undefined, 'open', 'allowlist'];
  const bools = [false, true];
  const alloweds = [undefined, null, false, true];
  let cases = 0;
  for (const native of bools) for (const publicRoute of bools) for (const mode of modes)
  for (const signedIn of bools) for (const owner of [false, true, undefined]) for (const allowed of alloweds) {
    const d = decideWebAccess({ native, publicRoute, mode, signedIn, owner, allowed });
    cases++;
    let want;
    if (native) want = 'full';
    else if (publicRoute) want = 'public';
    else if (!signedIn) want = mode === 'allowlist' ? 'invite-only' : 'full';
    else if (mode === undefined) want = 'pending';
    else if (mode === 'open') want = 'full';
    else if (owner === true || allowed === true) want = 'full';
    else if (allowed === false) want = 'gate';
    else if (allowed === null) want = 'unverified';
    else want = 'pending';
    assert.equal(d, want, JSON.stringify({ native, publicRoute, mode, signedIn, owner, allowed }));

    // Invariants that matter more than the exact label:
    if (native) assert.ok(mayMountBoard(d, signedIn) === signedIn, 'native: never gated');
    if (publicRoute && !native) assert.equal(mayMountBoard(d, signedIn), false, 'public page renders alone');
    if (!native && !publicRoute && mode === 'allowlist' && signedIn && owner !== true && allowed !== true) {
      assert.equal(mayMountBoard(d, signedIn), false, 'not allowed / unknown → the app never mounts');
    }
    if (!native && !publicRoute && mode === 'open' && signedIn) assert.equal(mayMountBoard(d, true), true, 'open = today');
  }
  assert.equal(cases, 2 * 2 * 3 * 2 * 3 * 4);
});

t('named scenarios', () => {
  const web = { native: false, publicRoute: false, signedIn: true };
  assert.equal(decideWebAccess({ ...web, mode: 'open' }), 'full', 'today, switch off');
  assert.equal(decideWebAccess({ ...web, mode: 'allowlist', allowed: true }), 'full', 'listed friend');
  assert.equal(decideWebAccess({ ...web, mode: 'allowlist', owner: true, allowed: null }), 'full', 'owner survives a failed check');
  assert.equal(decideWebAccess({ ...web, mode: 'allowlist', allowed: false }), 'gate', 'stranger');
  assert.equal(decideWebAccess({ ...web, mode: 'allowlist', allowed: null }), 'unverified');
  assert.equal(decideWebAccess({ ...web, mode: 'allowlist' }), 'pending', 'check in flight');
  assert.equal(decideWebAccess({ ...web, mode: undefined }), 'pending', 'mode in flight');
  assert.equal(decideWebAccess({ ...web, native: true, mode: 'allowlist', allowed: false }), 'full', 'store app');
  assert.equal(decideWebAccess({ ...web, publicRoute: true, mode: 'allowlist', allowed: false }), 'public');
  assert.equal(decideWebAccess({ native: false, signedIn: false, mode: 'allowlist' }), 'invite-only');
  assert.equal(decideWebAccess({ native: false, signedIn: false, mode: undefined }), 'full', 'signed out never waits');
  assert.equal(decideWebAccess(), 'full');
  // Read error after seeing allowlist → still gated, end to end.
  const mode = resolveMode({ ok: false }, 'allowlist');
  assert.equal(decideWebAccess({ ...web, mode, allowed: resolveAllowed({ ok: false }, false) }), 'gate');
  // Read error with nothing seen → open, end to end.
  assert.equal(decideWebAccess({ ...web, mode: resolveMode({ ok: false }, undefined) }), 'full');
});

t('latchDecision: a mounted app is never unmounted mid-session', () => {
  const u = 'user-a';
  for (const d of ['pending', 'gate', 'unverified']) {
    assert.equal(latchDecision(d, { signedIn: true, userId: u, latchedUser: u }), 'full', d);
    assert.equal(latchDecision(d, { signedIn: true, userId: u, latchedUser: null }), d, `${d}: nothing latched`);
    assert.equal(latchDecision(d, { signedIn: true, userId: u, latchedUser: 'user-b' }), d, `${d}: other user`);
    assert.equal(latchDecision(d, { signedIn: false, userId: u, latchedUser: u }), d, `${d}: signed out`);
  }
  for (const d of ['full', 'public', 'invite-only']) {
    assert.equal(latchDecision(d, { signedIn: true, userId: u, latchedUser: u }), d, d);
  }
  assert.equal(latchDecision('gate'), 'gate');
});

t('isGated / inviteAppOnly / mayMountBoard', () => {
  for (const d of ['public', 'full', 'pending', 'invite-only', 'gate', 'unverified']) {
    assert.equal(isGated(d), d === 'gate' || d === 'unverified', d);
    assert.equal(inviteAppOnly(d), d === 'gate' || d === 'unverified' || d === 'invite-only', d);
    assert.equal(mayMountBoard(d, true), d === 'full', d);
    assert.equal(mayMountBoard(d, false), false, d);
  }
});

// ── The gated path never mounts the state hook ───────────────────────
// A stand-in for Board: its render calls a spy named after the real hook.
// For every decision but 'full'+signed-in, the spy must not run at all.
t('boundary never renders Board unless full', () => {
  let calls = 0;
  function useVisionBoardState() { calls++; return { S: {}, hydrated: false }; }
  function Board() { useVisionBoardState(); return createElement('div', { id: 'board' }, 'board'); }
  const fallback = createElement('div', { id: 'gate' }, 'gate');
  for (const decision of ['public', 'pending', 'invite-only', 'gate', 'unverified', 'full']) {
    for (const signedIn of [false, true]) {
      calls = 0;
      const html = renderToStaticMarkup(
        createElement(WebAccessBoundary, { decision, signedIn, fallback }, createElement(Board)),
      );
      const mounted = decision === 'full' && signedIn;
      assert.equal(calls, mounted ? 1 : 0, `${decision}/${signedIn}: state hook calls`);
      assert.equal(html.includes('id="board"'), mounted);
      assert.equal(html.includes('id="gate"'), !mounted);
    }
  }
});

// App.jsx: Board is rendered in exactly one place, and that place is
// inside WebAccessBoundary — so the boundary test above covers it.
t('App.jsx mounts Board only through the boundary', () => {
  const src = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const boards = src.match(/<Board[\s>]/g) || [];
  assert.equal(boards.length, 1, 'one <Board> in App.jsx');
  const i = src.indexOf('<Board ');
  const open = src.lastIndexOf('<WebAccessBoundary', i);
  const close = src.indexOf('</WebAccessBoundary>', i);
  assert.ok(open !== -1 && close !== -1 && open < i && i < close, '<Board> sits inside <WebAccessBoundary>');
  assert.equal((src.slice(open, i).match(/<\/WebAccessBoundary>/g) || []).length, 0, 'no boundary closes before it');
  // useVisionBoardState is only called inside Board.
  const calls = [...src.matchAll(/useVisionBoardState\(/g)].map(m => m.index);
  const boardStart = src.indexOf('function Board(');
  const appStart = src.indexOf('export default function App(');
  assert.ok(calls.length >= 1 && calls.every(c => c > boardStart && c < appStart), 'state hook only in Board');
});

// ── Owner panel input ────────────────────────────────────────────────
t('cleanEmail / cleanNote', () => {
  assert.equal(cleanEmail('  Friend@Example.COM '), 'friend@example.com');
  for (const bad of ['', 'a', 'no-at.com', 'a@b', 'a b@c.com', '@c.com', null, 42, 'x'.repeat(250) + '@a.co']) {
    assert.equal(cleanEmail(bad), null, String(bad));
  }
  assert.equal(cleanNote('  school  '), 'school');
  assert.equal(cleanNote('   '), null);
  assert.equal(cleanNote(undefined), null);
  assert.equal(cleanNote('x'.repeat(300)).length, 200);
});

t('ownerErrorMessage never leaks the raw error', () => {
  const raw = 'relation "public.web_access_allowlist" leaked detail SELECT secret';
  assert.match(ownerErrorMessage({ code: 'PGRST202', message: 'Could not find the function public.web_access_list' }), /run supabase\/web_access_2026_10b\.sql/);
  assert.match(ownerErrorMessage({ code: '42883', message: 'x' }), /isn’t set up yet/);
  assert.match(ownerErrorMessage({ code: '42501', message: 'not allowed' }), /Only the app owner/);
  assert.match(ownerErrorMessage({ code: '22023', message: 'invalid email' }), /email address/);
  assert.match(ownerErrorMessage({ message: 'invalid mode' }), /Unknown mode/);
  const generic = ownerErrorMessage({ message: raw });
  assert.ok(!generic.includes('relation') && !generic.includes('secret'));
  assert.match(ownerErrorMessage(null), /connection/);
});

console.log(`webAccess: ${n} groups passed`);
