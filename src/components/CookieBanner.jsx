import { useState } from 'react';
import { isNativeApp } from '../lib/native/platform';

const KEY = 'vb4_cookie_consent';

// Web only. The app shell sets no cookies and has no third-party
// browser context to consent to; its storage is covered by the privacy
// policy agreed at sign-up. A website's cookie banner inside a store
// app reads as a wrapped web page.
export default function CookieBanner({ onOpenLegal }) {
  const [visible, setVisible] = useState(() => !isNativeApp() && !localStorage.getItem(KEY));

  function accept() {
    localStorage.setItem(KEY, 'accepted');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      zIndex: 8000,
      background: 'rgba(15,17,24,0.97)',
      backdropFilter: 'blur(12px)',
      borderTop: '1px solid rgba(255,255,255,.1)',
      padding: '14px 20px',
      display: 'flex', alignItems: 'center', gap: '14px',
      flexWrap: 'wrap',
      fontFamily: 'var(--sans, DM Sans, sans-serif)',
    }}>
      <span style={{ flex: 1, fontSize: '12px', color: 'rgba(255,255,255,.7)', lineHeight: 1.6, minWidth: '220px' }}>
        We use essential cookies and localStorage to keep you signed in and remember your preferences. No tracking or advertising cookies.{' '}
        <button
          onClick={() => onOpenLegal('privacy')}
          style={{ background: 'none', border: 'none', color: 'var(--em-light, #4dc485)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontFamily: 'inherit' }}
        >
          Privacy Policy
        </button>
      </span>
      <button
        onClick={accept}
        style={{
          background: 'var(--em, #1a7a4a)', color: '#fff', border: 'none',
          borderRadius: '8px', padding: '8px 20px', fontSize: '12px', fontWeight: 600,
          cursor: 'pointer', fontFamily: 'var(--sans)', whiteSpace: 'nowrap',
        }}
      >
        Got it
      </button>
    </div>
  );
}
