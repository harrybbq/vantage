/**
 * Hand an export file to the person — a download on the web, the share
 * sheet in the app.
 *
 * `<a download>` (what Settings → Your data used everywhere) does nothing
 * inside a Capacitor WebView: there is no browser download manager to
 * catch it, so the button looked dead in the iOS and Android apps
 * (STARTUP_REQUIREMENTS item 67 / pack P7). In the app we offer the file
 * to the system share sheet instead (navigator.share with a File), where
 * "Save to Files", Drive, mail and so on all live.
 *
 * Where that isn't available we say so plainly rather than pretend:
 *   - iOS WKWebView supports Web Share with files (iOS 15+).
 *   - Android's System WebView does NOT implement navigator.share, so
 *     until @capacitor/share + @capacitor/filesystem are added (native
 *     setup: npm install, `npx cap sync`), Android gets 'unsupported'
 *     and the card points at the website, where the download works.
 *
 * Pure apart from the injected `env`, so it can be tested in Node
 * (saveExport.test.mjs). Never throws; the result says what happened:
 *   'downloaded' | 'shared' | 'cancelled' | 'unsupported' | 'failed'
 */
export async function saveExport(name, text, env = defaultEnv()) {
  const { native, nav, doc, URLImpl, BlobImpl, FileImpl } = env;

  if (!native) {
    try {
      const url = URLImpl.createObjectURL(new BlobImpl([text], { type: 'application/json' }));
      const a = doc.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      // Revoke on the next tick: some browsers start the download
      // asynchronously and a synchronous revoke can cancel it.
      setTimeout(() => URLImpl.revokeObjectURL(url), 0);
      return 'downloaded';
    } catch {
      return 'failed';
    }
  }

  // In the app: the share sheet, with the file attached.
  if (!nav || typeof nav.share !== 'function' || typeof FileImpl !== 'function') return 'unsupported';
  let file;
  try {
    file = new FileImpl([text], name, { type: 'application/json' });
  } catch {
    return 'unsupported';
  }
  const payload = { files: [file], title: name };
  if (typeof nav.canShare === 'function') {
    let ok = false;
    try { ok = nav.canShare({ files: [file] }); } catch { ok = false; }
    if (!ok) return 'unsupported';
  }
  try {
    await nav.share(payload);
    return 'shared';
  } catch (e) {
    // The person closed the sheet — not an error, nothing to report.
    if (e && e.name === 'AbortError') return 'cancelled';
    // NotAllowedError (no user gesture) / DataError (type refused).
    return 'failed';
  }
}

function defaultEnv() {
  const w = typeof window !== 'undefined' ? window : undefined;
  let native = false;
  try {
    const cap = w && w.Capacitor;
    native = !!cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : !!cap.isNative);
  } catch { native = false; }
  if (import.meta.env && import.meta.env.VITE_NATIVE_BUILD === 'true') native = true;
  return {
    native,
    nav: typeof navigator !== 'undefined' ? navigator : undefined,
    doc: typeof document !== 'undefined' ? document : undefined,
    URLImpl: typeof URL !== 'undefined' ? URL : undefined,
    BlobImpl: typeof Blob !== 'undefined' ? Blob : undefined,
    FileImpl: typeof File !== 'undefined' ? File : undefined,
  };
}
