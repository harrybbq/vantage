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
 */
(function () {
  var best = '';
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

  // Was an inline onclick="location.reload(true)". The button sits
  // above this script in the document, so it already exists here.
  var reload = document.getElementById('boot-reload');
  if (reload) {
    reload.addEventListener('click', function () { location.reload(true); });
  }
})();
