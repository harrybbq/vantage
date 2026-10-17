/*
 * Boot fallback — surfaces a boot failure on the static screen in
 * index.html (#boot-fallback), which React replaces on mount.
 *
 * Moved out of an inline <script> on 2026-09-30 (item 60) so the CSP
 * can be enforced with `script-src 'self'` and no 'unsafe-inline'. The
 * behaviour is unchanged: loaded as a classic, blocking <script src>
 * placed after the fallback markup and BEFORE the module bundle, so the
 * listeners below exist before the bundle can throw. Do not add
 * defer/async/type=module to its tag — any of those lets the bundle
 * run first.
 *
 * Deliberately plain ES5: if the failure IS a parse error in the
 * bundle, anything fancier here would die the same way. public/ is
 * outside ESLint and Vite copies this file verbatim.
 *
 * 2026-10-17: the "LOADING…" label and the "couldn't start" panel used
 * to be static markup in index.html (the panel hidden with
 * display:none). Anything that reads the HTML without running it — a
 * search crawler, a link-preview scraper, a no-JS browser — saw
 * "Vantage couldn't start" as the page's text. Both are now built here,
 * so they exist only where JavaScript runs; index.html carries a
 * neutral <noscript> sentence instead. The failure behaviour is the
 * same as before: the panel appears on an error, a rejection, or after
 * 12 s without a mount.
 */
(function () {
  var best = '';

  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  }

  // Build the loading label and the (hidden) error panel inside the
  // static fallback. React replaces all of it on mount.
  (function build() {
    var root = document.getElementById('boot-fallback');
    if (!root) return;
    root.appendChild(el('div', 'font-size:13px;letter-spacing:2px;', 'LOADING…'));
    var box = el('div', 'display:none;max-width:34em;line-height:1.7;font-size:12px;color:#c9c9c2;');
    box.id = 'boot-error';
    box.appendChild(el('p', 'margin:0 0 12px;color:#d99114;', 'Vantage couldn’t start.'));
    var detail = el('p', 'margin:0 0 16px;font-size:12px;color:#8a8a85;word-break:break-word;');
    detail.id = 'boot-error-detail';
    box.appendChild(detail);
    var btn = el('button', 'font:inherit;font-size:12px;padding:9px 18px;border-radius:8px;' +
      'border:1px solid #2f6b4f;background:transparent;color:#3f9a6f;cursor:pointer;', 'Reload');
    btn.type = 'button';
    btn.id = 'boot-reload';
    box.appendChild(btn);
    box.appendChild(el('p', 'margin:16px 0 0;font-size:12px;opacity:.75;',
      'If this keeps happening, your saved data is safe — it lives on the server, not in the app.'));
    root.appendChild(box);
  })();

  function paint() {
    var box = document.getElementById('boot-error');
    var detail = document.getElementById('boot-error-detail');
    if (!box) return;                       // app mounted, nothing to do
    if (detail) {
      detail.textContent = (window.__vantageBootError || best ||
        'The app failed to start. This is usually a temporary connection ' +
        'problem — reloading normally fixes it.').slice(0, 300);
    }
    box.style.display = 'block';
  }
  // NOT latched. A failed image or font fires `error` first with an
  // empty message, and latching on that buried the real cause the
  // module threw a moment later.
  window.addEventListener('error', function (e) {
    if (e && e.message && !best) best = e.message;
    paint();
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    if (r && !best) best = r.message || String(r);
    paint();
  });
  setTimeout(function () { paint(); }, 12000);

  // Was an inline onclick="location.reload(true)". The button is built
  // at the top of this file, so it already exists here.
  var reload = document.getElementById('boot-reload');
  if (reload) {
    reload.addEventListener('click', function () { location.reload(true); });
  }
})();
