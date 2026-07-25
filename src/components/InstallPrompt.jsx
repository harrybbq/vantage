import { useState, useEffect } from 'react';
import Icon from './Icon';

const DISMISSED_KEY = 'vb4_install_dismissed';

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPad on iOS 13+ reports as MacIntel with touch
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null); // Android Chrome
  const [showIOSHint, setShowIOSHint] = useState(false);       // iOS Safari
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already installed or previously dismissed
    if (isInStandaloneMode()) return;
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    if (isIOS()) {
      // Show iOS manual instructions after a short delay
      const t = setTimeout(() => { setShowIOSHint(true); setVisible(true); }, 3000);
      return () => clearTimeout(t);
    }

    // Android Chrome: capture the native install event
    const handler = e => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setVisible(false);
    setDeferredPrompt(null);
  }

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: showIOSHint ? '80px' : '16px', // clear iOS nav bar
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 7500,
      width: 'calc(100% - 32px)',
      maxWidth: '400px',
      background: 'rgba(15,17,24,0.97)',
      backdropFilter: 'blur(16px)',
      border: '1px solid rgba(255,255,255,.15)',
      borderRadius: '16px',
      padding: '16px 18px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      fontFamily: 'var(--sans, DM Sans, sans-serif)',
      animation: 'sheet-up 300ms cubic-bezier(0.34,1.56,0.64,1) both',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        {/* App icon */}
        <img
          src="/icon-192.png"
          alt="Vantage"
          style={{ width: '48px', height: '48px', borderRadius: '12px', flexShrink: 0 }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff', marginBottom: '3px' }}>
            Add to Home Screen
          </div>

          {showIOSHint ? (
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,.65)', lineHeight: 1.6 }}>
              Tap <strong style={{ color: '#fff' }}>Share</strong>{' '}
              <span style={{ fontSize: '14px' }}>⎙</span>{' '}
              then <strong style={{ color: '#fff' }}>"Add to Home Screen"</strong> to install Vantage.
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,.65)', lineHeight: 1.6 }}>
              Install for a faster, full-screen experience with offline support.
            </div>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={dismiss}
          style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,.4)',
            fontSize: '18px', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0,
          }}
          aria-label="Dismiss install prompt"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* Android install button */}
      {!showIOSHint && deferredPrompt && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
          <button
            onClick={dismiss}
            style={{
              flex: 1, padding: '9px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.15)',
              background: 'transparent', color: 'rgba(255,255,255,.6)', fontSize: '13px',
              cursor: 'pointer', fontFamily: 'var(--sans)',
            }}
          >
            Not now
          </button>
          <button
            onClick={handleInstall}
            style={{
              flex: 2, padding: '9px', borderRadius: '10px', border: 'none',
              background: 'var(--em, #1a7a4a)', color: '#fff', fontSize: '13px',
              fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--sans)',
            }}
          >
            Install App
          </button>
        </div>
      )}

      {/* iOS: just a dismiss link */}
      {showIOSHint && (
        <button
          onClick={dismiss}
          style={{
            display: 'block', width: '100%', marginTop: '12px', padding: '8px',
            borderRadius: '10px', border: '1px solid rgba(255,255,255,.1)',
            background: 'transparent', color: 'rgba(255,255,255,.5)', fontSize: '12px',
            cursor: 'pointer', fontFamily: 'var(--sans)',
          }}
        >
          Maybe later
        </button>
      )}

      {/* iOS arrow pointing to share button */}
      {showIOSHint && (
        <div style={{
          position: 'absolute', bottom: '-10px', left: '50%', transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '10px solid transparent',
          borderRight: '10px solid transparent',
          borderTop: '10px solid rgba(15,17,24,0.97)',
        }} />
      )}
    </div>
  );
}
