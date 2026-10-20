import { supabase } from './supabase';
import { isNativeApp } from './native/platform';
import { resolveMode, resolveAllowed } from './webAccess';

/**
 * The web gate's reads and the owner's RPCs (item 131). Decisions live in
 * webAccess.js; this file only talks to Supabase.
 *
 * DB load: one tiny config select per page load (started at import, so it
 * runs alongside getSession instead of after it), plus — only in
 * allowlist mode — one web_access_allowed() rpc per signed-in user per
 * page load. Native builds make neither call.
 *
 * "Last known" survives a reload within the tab (sessionStorage) so a
 * transient read error after seeing 'allowlist' keeps the gate shut.
 */

const TIMEOUT_MS = 4000;
const MODE_KEY = 'vb_web_access_mode';
const ALLOWED_KEY = 'vb_web_access_allowed';

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), TIMEOUT_MS)),
  ]);
}

function readSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeSession(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

// ── Mode ─────────────────────────────────────────────────────────────
let mode;                  // undefined until resolved
let modePromise = null;
const listeners = new Set();

function setMode(next) {
  mode = next;
  listeners.forEach(fn => { try { fn(next); } catch { /* listener's problem */ } });
}

/** Resolve the mode once per page load. Native → 'open' without a request. */
export function loadWebAccessMode() {
  if (modePromise) return modePromise;
  if (isNativeApp()) { setMode('open'); modePromise = Promise.resolve('open'); return modePromise; }
  modePromise = (async () => {
    let read;
    try {
      const { data, error } = await withTimeout(
        supabase.from('config').select('value').eq('key', 'web_access').maybeSingle(),
      );
      read = error ? { ok: false } : { ok: true, value: data ? data.value : null };
    } catch {
      read = { ok: false };
    }
    const last = readSession(MODE_KEY);
    const next = resolveMode(read, last === 'allowlist' || last === 'open' ? last : undefined);
    if (read.ok) writeSession(MODE_KEY, next);
    setMode(next);
    return next;
  })();
  return modePromise;
}

export function peekWebAccessMode() { return mode; }

export function onWebAccessMode(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── The caller's own answer ──────────────────────────────────────────
const allowedCache = new Map();   // userId → boolean (successful answers only)
const allowedInflight = new Map();

/** true / false, or null when the check failed and nothing is known for this user. */
export function checkWebAccessAllowed(userId, { force = false } = {}) {
  if (!userId) return Promise.resolve(false);
  if (!force && allowedCache.has(userId)) return Promise.resolve(allowedCache.get(userId));
  if (allowedInflight.has(userId)) return allowedInflight.get(userId);
  const p = (async () => {
    let read;
    try {
      const { data, error } = await withTimeout(supabase.rpc('web_access_allowed'));
      read = error ? { ok: false } : { ok: true, value: data === true };
    } catch {
      read = { ok: false };
    }
    const stored = readSession(ALLOWED_KEY);
    const last = stored && stored.u === userId && typeof stored.v === 'boolean' ? stored.v : undefined;
    const value = resolveAllowed(read, last);
    if (read.ok) {
      allowedCache.set(userId, value);
      writeSession(ALLOWED_KEY, { u: userId, v: value });
    }
    return value;
  })().finally(() => allowedInflight.delete(userId));
  allowedInflight.set(userId, p);
  return p;
}

// ── Owner panel (each RPC checks is_app_owner() server-side) ─────────
async function call(fn, args) {
  try {
    const { data, error } = await withTimeout(supabase.rpc(fn, args));
    return error ? { data: null, error } : { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export const listWebAccess = () => call('web_access_list');
export const addWebAccess = (email, note) => call('web_access_add', { p_email: email, p_note: note });
export const removeWebAccess = email => call('web_access_remove', { p_email: email });

export async function setWebAccessMode(next) {
  const res = await call('web_access_set_mode', { p_mode: next });
  if (!res.error && res.data && res.data.mode) {
    writeSession(MODE_KEY, res.data.mode);
    setMode(res.data.mode);
  }
  return res;
}

/** Read the mode fresh for the owner panel (no cache, no fallback). */
export async function readWebAccessModeFresh() {
  try {
    const { data, error } = await withTimeout(
      supabase.from('config').select('value').eq('key', 'web_access').maybeSingle(),
    );
    if (error) return { data: null, error };
    return { data: { mode: resolveMode({ ok: true, value: data ? data.value : null }), present: !!data }, error: null };
  } catch (error) {
    return { data: null, error };
  }
}
