import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * One-time 13+ / Terms acceptance for accounts that never saw the
 * sign-up checkbox.
 *
 * Email sign-up can't proceed without ticking "I am 13 or older and
 * agree to the Terms". Google and Apple could: "Continue with Google"
 * on the sign-in screen creates an account on first use, and the old
 * sign-up screen let the OAuth buttons through unticked. Both stores
 * expect the age gate on every route in.
 *
 * Two ways the acceptance gets recorded, both writing only the new key
 * `S.termsAcceptedAt` (additive — nothing else in state is touched):
 *   1. Ticked on the sign-up form before an OAuth round trip. The page
 *      is gone by the time the session arrives, so AuthScreen leaves a
 *      short-lived marker in localStorage and this consumes it.
 *   2. Otherwise, an account whose ONLY sign-in route is OAuth and
 *      which has no `termsAcceptedAt` gets this sheet, once. Email
 *      accounts never see it — every one of them ticked the box — so
 *      the missing key alone is never the trigger.
 *
 * Waits for `hydrated` (the cloud copy of state) so an optimistic paint
 * from the local backup can't show the sheet to someone who accepted
 * on another device.
 */

export const TERMS_PENDING_KEY = 'vb_terms_pending';
// Long enough for a slow OAuth round trip, short enough that a marker
// left by someone who abandoned sign-up can't be inherited by the next
// person to sign in on a shared device.
const PENDING_TTL_MS = 30 * 60 * 1000;

/** Called by AuthScreen just before an OAuth sign-up leaves the page. */
export function markTermsAcceptedPending() {
  try { localStorage.setItem(TERMS_PENDING_KEY, String(Date.now())); } catch { /* private mode */ }
}

function takePending() {
  try {
    const raw = localStorage.getItem(TERMS_PENDING_KEY);
    if (!raw) return null;
    localStorage.removeItem(TERMS_PENDING_KEY);
    const at = Number(raw);
    if (!Number.isFinite(at) || Date.now() - at > PENDING_TTL_MS) return null;
    return new Date(at).toISOString();
  } catch { return null; }
}

function oauthOnly(user) {
  const md = user?.app_metadata || {};
  const providers = Array.isArray(md.providers) && md.providers.length
    ? md.providers
    : (md.provider ? [md.provider] : []);
  return providers.length > 0 && !providers.includes('email');
}

export default function TermsAcceptanceSheet({ S, update, hydrated, onOpenLegal, onSignOut }) {
  const accepted = !!S?.termsAcceptedAt;
  const [need, setNeed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!hydrated || accepted) return undefined;
    const pendingAt = takePending();
    if (pendingAt) {
      update(prev => (prev.termsAcceptedAt ? prev : { ...prev, termsAcceptedAt: pendingAt }));
      return undefined;
    }
    let live = true;
    supabase.auth.getSession()
      .then(({ data }) => { if (live && oauthOnly(data?.session?.user)) setNeed(true); })
      .catch(() => { /* can't tell — don't block the app on it */ });
    return () => { live = false; };
  }, [hydrated, accepted, update]);

  if (!need || accepted) return null;

  function accept() {
    if (!checked) return;
    const at = new Date().toISOString();
    update(prev => (prev.termsAcceptedAt ? prev : { ...prev, termsAcceptedAt: at }));
    setNeed(false);
  }

  return (
    <div style={st.backdrop} role="dialog" aria-modal="true" aria-labelledby="terms-sheet-title">
      <div style={st.card}>
        <div style={st.eyebrow}>{'// One more thing'}</div>
        <h2 id="terms-sheet-title" style={st.heading}>Before you start</h2>
        <p style={st.body}>
          Vantage is for people aged 13 and over. Please confirm your age and
          that you agree to how the app works and how your data is handled.
        </p>
        <label style={st.check} htmlFor="terms-sheet-age">
          <input
            id="terms-sheet-age"
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            style={st.box}
          />
          <span>
            I am 13 years of age or older and I agree to the{' '}
            <button type="button" style={st.link} onClick={() => onOpenLegal?.('terms')}>Terms of Service</button>
            {' '}and{' '}
            <button type="button" style={st.link} onClick={() => onOpenLegal?.('privacy')}>Privacy Policy</button>
          </span>
        </label>
        <button type="button" style={{ ...st.primary, opacity: checked ? 1 : 0.5 }} disabled={!checked} onClick={accept}>
          CONTINUE →
        </button>
        <button type="button" style={st.secondary} onClick={() => onSignOut?.()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

const st = {
  // Below LegalPage (9000) so the Terms link opens on top of the sheet.
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 8500,
    background: 'rgba(12,12,10,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, boxSizing: 'border-box',
  },
  card: {
    background: 'var(--bg-raised, #fdfaf3)',
    color: 'var(--text, #1c1a17)',
    border: '1px solid var(--border, #e2dccf)',
    borderRadius: 16,
    padding: '26px 24px 20px',
    width: '100%', maxWidth: 420,
    maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto',
    boxSizing: 'border-box',
    boxShadow: '0 18px 48px rgba(0,0,0,0.25)',
    fontFamily: 'var(--sans, "DM Sans", sans-serif)',
  },
  eyebrow: {
    fontFamily: 'var(--mono, "DM Mono", monospace)',
    fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase',
    color: 'var(--em-mid, #2a9e62)', marginBottom: 6,
  },
  heading: {
    fontFamily: 'var(--display, "Playfair Display", serif)',
    fontSize: 24, fontStyle: 'italic', fontWeight: 600,
    color: 'var(--em, #1a7a4a)', margin: '0 0 12px',
  },
  body: { fontSize: 14, lineHeight: 1.55, color: 'var(--text-mid, #4a4540)', margin: '0 0 16px' },
  check: {
    display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer',
    fontSize: 13, lineHeight: 1.55, color: 'var(--text-mid, #4a4540)', marginBottom: 18,
  },
  box: { width: 15, height: 15, marginTop: 2, flexShrink: 0, accentColor: 'var(--em, #1a7a4a)' },
  link: {
    background: 'none', border: 'none', padding: 0, font: 'inherit',
    color: 'var(--em, #1a7a4a)', textDecoration: 'underline', cursor: 'pointer',
  },
  primary: {
    width: '100%', padding: '12px 16px', border: 'none', borderRadius: 10,
    background: 'linear-gradient(180deg, var(--em-mid, #2a9e62) 0%, var(--em, #1a7a4a) 100%)',
    color: '#fff', cursor: 'pointer',
    fontFamily: 'var(--mono, "DM Mono", monospace)', fontSize: 11, letterSpacing: '1.5px',
  },
  secondary: {
    width: '100%', marginTop: 8, padding: '10px 16px', borderRadius: 10,
    background: 'none', border: '1px solid var(--border, #e2dccf)',
    color: 'var(--text-mid, #4a4540)', cursor: 'pointer', fontSize: 13,
    fontFamily: 'var(--sans, "DM Sans", sans-serif)',
  },
};
