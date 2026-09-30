/**
 * What a client error report is allowed to contain, and how often one
 * may be sent. Pure — the network half lives in reportError.js.
 *
 * The rule is: enough to find the bug, nothing about the person. So a
 * report carries the error's own message and stack, the page PATH, the
 * browser and the build — and every URL in any of those loses its query
 * string and fragment (tokens, search terms and ids ride there), email
 * addresses are masked, and nothing from the user's state is ever an
 * input to this module.
 */

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/** Drop ?query and #fragment from every URL in a string. */
export function stripQueries(text) {
  return String(text == null ? '' : text)
    .replace(/(https?:\/\/[^\s?#)'"]*)[?#][^\s)'"]*/gi, '$1')
    .replace(/(\/[\w./-]*)\?[^\s)'"]*/g, '$1');
}

/** Mask anything shaped like an email address. */
export function maskEmails(text) {
  return String(text == null ? '' : text).replace(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi, '[email]');
}

const clean = (text, max) => maskEmails(stripQueries(text)).slice(0, max);

/**
 * Normalise anything that was thrown into a report body.
 * `where` is the page location object (or a stub in tests).
 */
export function shapeReport(kind, error, { where, ua, release } = {}) {
  const isErr = error && typeof error === 'object';
  const message = isErr ? (error.message || error.reason || String(error)) : String(error);
  const stack = isErr && typeof error.stack === 'string' ? error.stack : '';
  return {
    kind: String(kind || 'error').slice(0, 40),
    message: clean(message, MAX_MESSAGE),
    stack: clean(stack, MAX_STACK),
    // Origin + path only. The path of a SPA never carries user data here
    // (routes are section names), and the query string is gone.
    url: where ? clean(`${where.origin || ''}${where.pathname || ''}`, 300) : '',
    ua: String(ua || '').slice(0, 300),
    release: String(release || '').slice(0, 80),
  };
}

/** The same bug reported twice is one report. */
export function signature(report) {
  const firstFrame = (report.stack || '').split('\n').map(l => l.trim()).find(l => l.startsWith('at ') || l.includes('@')) || '';
  return `${report.kind}|${report.message}|${firstFrame}`;
}

/**
 * At most `perMinute` sends in any rolling minute, and the same
 * signature at most once per `dedupeMs`. A render loop that throws on
 * every frame costs five requests, not thousands.
 */
export function makeLimiter({ perMinute = 5, dedupeMs = 10 * 60_000 } = {}) {
  const sent = [];
  const seen = new Map();
  return function allow(sig, now = Date.now()) {
    while (sent.length && now - sent[0] >= 60_000) sent.shift();
    const last = seen.get(sig);
    if (last != null && now - last < dedupeMs) return false;
    if (sent.length >= perMinute) return false;
    sent.push(now);
    seen.set(sig, now);
    if (seen.size > 200) seen.delete(seen.keys().next().value);
    return true;
  };
}
