import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import Icon from './Icon';
import { isNativeApp } from '../lib/native/platform';
import {
  countSession, alreadyHandled, markShown, markDismissed, mayShowInstallPrompt,
} from '../lib/native/installPrompt';
import '../install-prompt.css';

/* "Add to Home Screen", asked once per browser and only after the
   person has a reason to come back — the rules and their history live
   in lib/native/installPrompt.js.

   Phones get a slim bar docked above the tab bar that RESERVES its own
   height (html.vb-install-bar pads .section by it), so nothing is left
   underneath it. Desktop gets a compact card in the bottom-right corner
   rather than bottom-centre over the content. */

function isIOS() {
  try {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      // iPad on iOS 13+ reports as MacIntel with touch
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch { return false; }
}

function isInStandaloneMode() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  } catch { return false; }
}

function safeStore(name) {
  try { return window[name]; } catch { return null; }
}

export default function InstallPrompt({ engaged = false }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null); // Android / desktop Chrome
  const [visible, setVisible] = useState(false);
  const [blocked] = useState(() =>
    isNativeApp() || isInStandaloneMode() || alreadyHandled(safeStore('localStorage')));
  const [sessions] = useState(() =>
    (blocked ? 0 : countSession(safeStore('localStorage'), safeStore('sessionStorage'))));
  const ios = useRef(isIOS()).current;
  const barRef = useRef(null);

  // Capture the browser's install event as early as possible — it fires
  // once, often before the person counts as engaged.
  useEffect(() => {
    if (blocked || ios) return;
    const handler = e => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [blocked, ios]);

  const eligible = !blocked && mayShowInstallPrompt({
    native: false, standalone: false, handled: false, sessions, engaged,
  });

  useEffect(() => {
    if (!eligible || visible) return;
    if (ios) {
      // A short pause so it never lands on top of the boot animation.
      const t = setTimeout(() => setVisible(true), 3000);
      return () => clearTimeout(t);
    }
    if (deferredPrompt) setVisible(true);
  }, [eligible, ios, deferredPrompt, visible]);

  // At most once per browser: remember it the moment it appears.
  useEffect(() => {
    if (visible) markShown(safeStore('localStorage'));
  }, [visible]);

  // Reserve the bar's height on phones while it is up.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!visible || !barRef.current) return;
    const el = barRef.current;
    const apply = () => root.style.setProperty('--vb-install-h', `${Math.ceil(el.offsetHeight)}px`);
    apply();
    root.classList.add('vb-install-bar');
    let ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(apply); ro.observe(el); }
    return () => {
      if (ro) ro.disconnect();
      root.classList.remove('vb-install-bar');
      root.style.removeProperty('--vb-install-h');
    };
  }, [visible]);

  function dismiss() {
    markDismissed(safeStore('localStorage'));
    setVisible(false);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch { /* the browser declined to show it — nothing to do */ }
    // Accepted or not, it has been asked: don't ask again.
    markDismissed(safeStore('localStorage'));
    setVisible(false);
    setDeferredPrompt(null);
  }

  if (!visible) return null;

  return (
    <div className="vb-install" ref={barRef} role="region" aria-label="Install Vantage">
      <img className="vb-install-icon" src="/icon-192.png" alt="" aria-hidden="true" />
      <div className="vb-install-text">
        <div className="vb-install-title">Add Vantage to your Home Screen</div>
        {ios ? (
          <div className="vb-install-sub">
            Tap <strong>Share</strong> <span aria-hidden="true">⎙</span> then <strong>“Add to Home Screen”</strong>.
          </div>
        ) : (
          <div className="vb-install-sub">Opens full-screen, works offline.</div>
        )}
      </div>
      {!ios && deferredPrompt && (
        <button type="button" className="vb-install-go" onClick={handleInstall}>Install</button>
      )}
      <button type="button" className="vb-install-x" onClick={dismiss} aria-label="Dismiss install prompt">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
