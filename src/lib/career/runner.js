/**
 * Run the user's JavaScript against a puzzle's test cases.
 *
 * ── Why a Worker and not eval ────────────────────────────────────────
 * The failure mode that matters here is not malice — it is the owner's
 * own half-written loop. `while (i < n)` with a forgotten `i++` on the
 * main thread locks the tab: no render, no click, no way to stop it, and
 * whatever was in the editor is gone with the reload. A Worker can be
 * terminated from the outside, which is the entire reason for the extra
 * machinery below.
 *
 * The sandboxing is a bonus rather than the point: a Worker has no DOM,
 * no window, and no access to the app's state. It can still reach the
 * network, so this is NOT a safe place to run a stranger's code — but
 * nothing here ever runs anyone's code but the person typing it.
 *
 * ── Why a Blob and not a separate file ───────────────────────────────
 * The worker source is built here and turned into a blob: URL, so there
 * is no second build entry point to keep in step with this file. The
 * site's CSP needs `worker-src 'self' blob:` for that, which netlify.toml
 * carries.
 */

const HARNESS = `
// ── deep equality, structural ───────────────────────────────────────
// JSON.stringify would call {a:1,b:2} and {b:2,a:1} different, and
// would quietly turn NaN and Infinity into null. Both matter: a
// puzzle answer of NaN is a bug worth failing on, not a null.
function same(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var j = 0; j < ka.length; j++) {
    if (!Object.prototype.hasOwnProperty.call(b, ka[j])) return false;
    if (!same(a[ka[j]], b[ka[j]])) return false;
  }
  return true;
}

// ── display ─────────────────────────────────────────────────────────
// Values cross the postMessage boundary as strings, not as structured
// clones: a returned function or a cyclic object would throw on clone
// and take the whole run down instead of failing one case.
function show(v, depth) {
  depth = depth || 0;
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'function') return 'function ' + (v.name || '(anonymous)');
  if (depth > 3) return '…';
  if (Array.isArray(v)) {
    if (v.length > 24) {
      return '[' + v.slice(0, 24).map(function (x) { return show(x, depth + 1); }).join(', ')
        + ', … ' + (v.length - 24) + ' more]';
    }
    return '[' + v.map(function (x) { return show(x, depth + 1); }).join(', ') + ']';
  }
  if (v instanceof Error) return v.name + ': ' + v.message;
  var keys = Object.keys(v);
  return '{' + keys.slice(0, 12).map(function (k) {
    return k + ': ' + show(v[k], depth + 1);
  }).join(', ') + (keys.length > 12 ? ', …' : '') + '}';
}

self.onmessage = function (e) {
  var source = e.data.source, fnName = e.data.fnName, tests = e.data.tests;
  var fn;
  try {
    // The trailing expression hands the named function back out. A
    // declaration inside the Function body is in scope for it.
    fn = new Function(source + '\\n;return typeof ' + fnName + " === 'function' ? " + fnName + ' : null;')();
  } catch (err) {
    self.postMessage({ ok: false, phase: 'compile', error: String(err && err.message || err) });
    return;
  }
  if (typeof fn !== 'function') {
    self.postMessage({
      ok: false, phase: 'compile',
      error: 'No function called ' + fnName + '() was defined. Keep the name — the tests call it.',
    });
    return;
  }

  var results = [];
  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    // Deep-copy the arguments per case: a solution that sorts its input
    // in place would otherwise change the fixture for every later case,
    // and pass or fail depending on the order they happen to run in.
    var args;
    try { args = JSON.parse(JSON.stringify(t.args)); } catch (e2) { args = t.args; }
    var got, threw = null;
    var t0 = Date.now();
    try {
      got = fn.apply(null, args);
    } catch (err) {
      threw = String(err && err.message || err);
    }
    var ms = Date.now() - t0;
    var pass = threw === null && same(got, t.expect);
    results.push({
      name: t.name || null,
      args: show(args).slice(1, -1),
      expected: show(t.expect),
      got: threw === null ? show(got) : null,
      threw: threw,
      pass: pass,
      ms: ms,
      hidden: !!t.hidden,
    });
  }
  self.postMessage({ ok: true, results: results });
};
`;

/**
 * @param source   the user's JS
 * @param fnName   the function the tests call
 * @param tests    [{ args, expect, name?, hidden? }]
 * @param timeoutMs how long before the worker is killed
 * @returns {Promise<{ok, results?, error?, phase?, timedOut?, ms}>}
 */
export function runJs({ source, fnName, tests, timeoutMs = 2500 }) {
  return new Promise(resolve => {
    let url, worker, timer;
    const started = Date.now();

    const finish = payload => {
      clearTimeout(timer);
      try { worker && worker.terminate(); } catch { /* already gone */ }
      if (url) URL.revokeObjectURL(url);
      resolve({ ...payload, ms: Date.now() - started });
    };

    try {
      url = URL.createObjectURL(new Blob([HARNESS], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch (err) {
      // Workers can be blocked outright — an over-tight CSP, or a
      // browser with them disabled. Say which, rather than "failed".
      return finish({
        ok: false, phase: 'environment',
        error: 'Couldn\'t start the sandbox: ' + (err && err.message || err)
          + '. The runner needs Web Workers.',
      });
    }

    worker.onmessage = e => finish(e.data);
    worker.onerror = e => finish({
      ok: false, phase: 'run',
      error: e.message || 'The sandbox stopped unexpectedly.',
    });

    // The whole reason for the Worker. An infinite loop cannot be
    // caught, only killed from outside.
    timer = setTimeout(() => finish({
      ok: false, phase: 'timeout', timedOut: true,
      error: `Still running after ${(timeoutMs / 1000).toFixed(1)}s — stopped it. `
        + 'That is usually a loop whose counter never moves, or a recursion with no base case.',
    }), timeoutMs);

    worker.postMessage({ source, fnName, tests });
  });
}

/** Are Workers available at all? Drives the UI's fallback message. */
export const canRun = () => typeof Worker === 'function' && typeof URL.createObjectURL === 'function';
