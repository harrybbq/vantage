import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import Logo from './Logo';

/**
 * AuthScreen
 *
 * Login / signup / reset surface, redesigned to match the cream Hub's
 * visual language so the moment a user authenticates there's no
 * visual jolt — same parchment surface, same forest-green accent,
 * same Playfair italic + DM Mono eyebrow rhythm used throughout the
 * Hub and its panels.
 *
 * The card shell is static — only the inner heading + form animate
 * on mode switch, so the user's eye can stay anchored.
 *
 * Mode-specific copy (eyebrow / heading / submit label) lives in the
 * three lookup objects below; everything else is mode-agnostic.
 */

const EYEBROWS = {
  login:  '// Sign in',
  signup: '// Create account',
  reset:  '// Reset password',
};
const HEADINGS = {
  login:  'Welcome back.',
  signup: 'Start your board.',
  reset:  'Forgot your password?',
};
const SUBMIT_LBL = {
  login:  'SIGN IN →',
  signup: 'CREATE ACCOUNT →',
  reset:  'SEND RESET EMAIL →',
};

// Shared motion tokens. Subtle 6px slide + fade — enough to register
// as "the form changed" without feeling like a transition between
// pages.
const contentMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
};
const exitFastMotion = {
  ...contentMotion,
  transition: { duration: 0.18, ease: 'easeIn' },
};

function Spinner() {
  // Inline SVG so we don't need to ship an icon library for one button.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
      style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }}>
      <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
      <path d="M8 2 A6 6 0 0 1 14 8" stroke="#fff" strokeWidth="2" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate"
          from="0 8 8" to="360 8 8" dur="0.7s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

/**
 * Google "G" mark — official 4-colour glyph. Inline SVG to avoid an
 * extra image fetch on the auth screen (and to dodge the privacy
 * concern of any third-party CDN serving the icon).
 */
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.86 2.69-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.71A5.41 5.41 0 0 1 3.66 9c0-.6.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l2.99-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A8.94 8.94 0 0 0 9 0 9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * Apple logo glyph. Apple's HIG mandates a black-on-white OR
 * white-on-black button — we use black-on-white to match the Google
 * button treatment so the two read as a pair.
 */
function AppleGlyph() {
  // Inherits parent text colour via currentColor so the same SVG
  // works on a black (white logo) or white (black logo) button.
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="currentColor" d="M14.04 9.56c-.02-2.04 1.67-3.02 1.74-3.07-.95-1.39-2.42-1.58-2.95-1.6-1.26-.13-2.45.74-3.09.74-.65 0-1.63-.72-2.68-.7-1.38.02-2.65.8-3.36 2.04-1.43 2.48-.37 6.15 1.03 8.16.68.98 1.5 2.09 2.56 2.05 1.03-.04 1.42-.66 2.66-.66 1.24 0 1.59.66 2.68.64 1.11-.02 1.81-1 2.49-1.98.78-1.14 1.11-2.24 1.13-2.3-.02-.01-2.18-.83-2.21-3.32ZM12.05 3.7c.56-.69.95-1.64.84-2.59-.81.03-1.81.54-2.4 1.22-.52.6-.99 1.57-.87 2.49.91.07 1.85-.46 2.43-1.12Z" />
    </svg>
  );
}

export default function AuthScreen({ onOpenLegal }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('vb4_remember') !== '0');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [capsLock, setCapsLock] = useState(false);

  const switchMode = useCallback(next => {
    setMode(next); setError(''); setInfo('');
  }, []);

  /**
   * Google OAuth sign-in. Supabase handles the full redirect dance —
   * we just point it at the Google provider and tell it where to send
   * the user back to. `redirectTo` is the current origin (preserves
   * port for local dev, falls back to the deployed origin in prod).
   *
   * The browser will full-page navigate away to accounts.google.com,
   * so any state we set here is discarded — no need for a loading
   * spinner on success.
   *
   * Pre-requisites (one-time, outside the app — see playbook F5):
   *   1. Google Cloud Console → OAuth 2.0 Client ID with this app's
   *      origins as Authorized JavaScript Origins + Supabase callback
   *      URL as Authorized Redirect URI.
   *   2. Supabase Dashboard → Authentication → Providers → Google →
   *      paste the client ID + secret and enable.
   *   3. Supabase Dashboard → Authentication → URL Configuration →
   *      add this app's origins to the allowed redirect list.
   *
   * Without those, the Google button still renders (so the UI is
   * complete) but clicking it surfaces the Supabase error message
   * via the existing error banner.
   */
  async function handleGoogleSignIn() {
    setError('');
    setInfo('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          // queryParams.prompt forces the account chooser so a user with
          // multiple Google accounts isn't auto-signed-in to the wrong one.
          queryParams: { prompt: 'select_account' },
        },
      });
      if (error) throw error;
      // No state to set on success — the page is about to redirect away.
    } catch (err) {
      setError(err.message || 'Could not start Google sign-in.');
    }
  }

  /**
   * Apple OAuth sign-in. Required by App Store rule 4.8 — if any
   * third-party social sign-in (Google here) is offered, Sign in
   * with Apple MUST also be offered on iOS. Easier to ship it on
   * web too than to render conditionally on platform.
   *
   * Pre-requisites (one-time, outside the app — see playbook):
   *   1. Apple Developer Portal → Certificates, IDs & Profiles →
   *      Identifiers — register an App ID + a Services ID. Enable
   *      'Sign in with Apple' on both.
   *   2. Create a Sign in with Apple key (.p8). Note the Key ID +
   *      Team ID.
   *   3. Supabase Dashboard → Authentication → Providers → Apple →
   *      paste the Services ID (client_id), Team ID, Key ID, and
   *      the .p8 contents. Enable.
   *   4. Supabase URL config already covers the redirect — same
   *      origin allow-list as Google.
   */
  async function handleAppleSignIn() {
    setError('');
    setInfo('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err) {
      setError(err.message || 'Could not start Apple sign-in.');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        localStorage.setItem('vb4_remember', rememberMe ? '1' : '0');
      } else if (mode === 'signup') {
        if (!ageConfirmed) {
          setError('Please confirm you are 13 or older.');
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo('Check your email to confirm your account, then log in.');
        setMode('login');
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setInfo('Password reset email sent. Check your inbox.');
        setMode('login');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.overlay}>
      {/* Brand mark — sits above the card, not inside it, so the
          wordmark introduces the form rather than competing with
          the heading. */}
      <div style={S.logoWrap}>
        <div style={S.logoMark}><Logo size={28} strokeWidth={7} /></div>
        <div>
          <div style={S.logoTitle}>Vision Board</div>
        </div>
      </div>

      {/* Card — static. Only the contents swap. */}
      <div className="auth-card" style={S.card}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`h-${mode}`} {...contentMotion}>
            <div style={S.eyebrow}>{EYEBROWS[mode]}</div>
            <h1 style={S.heading}>{HEADINGS[mode]}</h1>
          </motion.div>
        </AnimatePresence>

        {error && <div style={S.errorBanner} role="alert" aria-live="assertive">{error}</div>}
        {info  && <div style={S.infoBanner}  role="status" aria-live="polite">{info}</div>}

        <AnimatePresence mode="wait" initial={false}>
          <motion.form
            key={`f-${mode}`}
            onSubmit={handleSubmit}
            style={S.form}
            noValidate
            initial={exitFastMotion.initial}
            animate={contentMotion.animate}
            exit={exitFastMotion.exit}
            transition={contentMotion.transition}
          >
            <div style={S.fg}>
              <label htmlFor="auth-email" style={S.label}>Email</label>
              <input
                id="auth-email"
                className="auth-input"
                style={S.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>

            {mode !== 'reset' && (
              <div style={S.fg}>
                <label htmlFor="auth-pw" style={S.label}>Password</label>
                <input
                  id="auth-pw"
                  className="auth-input"
                  style={S.input}
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
                  onBlur={() => setCapsLock(false)}
                  required
                  minLength={6}
                />
                {capsLock && <span style={S.capsHint}>⇪ Caps Lock is on</span>}
              </div>
            )}

            {mode === 'login' && (
              <label style={S.checkLabel} htmlFor="auth-remember">
                <input
                  id="auth-remember"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  style={S.checkbox}
                />
                <span style={S.checkText}>Remember me</span>
              </label>
            )}

            {mode === 'signup' && (
              <label style={{ ...S.checkLabel, alignItems: 'flex-start' }} htmlFor="auth-age">
                <input
                  id="auth-age"
                  type="checkbox"
                  checked={ageConfirmed}
                  onChange={e => setAgeConfirmed(e.target.checked)}
                  style={{ ...S.checkbox, marginTop: 2, flexShrink: 0 }}
                />
                <span style={{ ...S.checkText, lineHeight: 1.55 }}>
                  I am 13 years of age or older and I agree to the{' '}
                  <button type="button" onClick={() => onOpenLegal?.('terms')} style={S.inlineLegal}>Terms of Service</button>
                  {' '}and{' '}
                  <button type="button" onClick={() => onOpenLegal?.('privacy')} style={S.inlineLegal}>Privacy Policy</button>
                </span>
              </label>
            )}

            <motion.button
              type="submit"
              disabled={loading}
              className="auth-submit"
              style={{ ...S.btn, opacity: loading ? 0.82 : 1 }}
              whileHover={loading ? undefined : { y: -1 }}
              whileTap={loading ? undefined : { y: 0 }}
              transition={{ duration: 0.14 }}
            >
              {loading ? <><Spinner />PLEASE WAIT…</> : SUBMIT_LBL[mode]}
            </motion.button>
          </motion.form>
        </AnimatePresence>

        {/* OAuth sign-in — Google + Apple. Sit BELOW the email/password
            form so credentials stay the primary affordance. Apple is
            mandatory for App Store review (rule 4.8) if any other
            social sign-in is offered — present on web too so the
            iOS native build doesn't need a platform-specific render. */}
        {mode !== 'reset' && (
          <>
            <div style={S.divider} aria-hidden="true">
              <span style={S.dividerLine} />
              <span style={S.dividerText}>OR</span>
              <span style={S.dividerLine} />
            </div>
            <div style={S.oauthStack}>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="auth-google"
                style={S.googleBtn}
                aria-label={mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
              >
                <GoogleGlyph />
                <span style={S.googleLabel}>
                  {mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}
                </span>
              </button>
              <button
                type="button"
                onClick={handleAppleSignIn}
                disabled={loading}
                className="auth-apple"
                style={S.appleBtn}
                aria-label={mode === 'signup' ? 'Sign up with Apple' : 'Sign in with Apple'}
              >
                <AppleGlyph />
                <span style={S.googleLabel}>
                  {mode === 'signup' ? 'Sign up with Apple' : 'Continue with Apple'}
                </span>
              </button>
            </div>
          </>
        )}

        {/* Mode-switch links */}
        <div style={S.links}>
          {mode === 'login' && (
            <>
              <button type="button" className="auth-mode-link" onClick={() => switchMode('signup')}>No account? Sign up</button>
              <button type="button" className="auth-mode-link" onClick={() => switchMode('reset')}>Forgot password?</button>
            </>
          )}
          {mode !== 'login' && (
            <button type="button" className="auth-mode-link" onClick={() => switchMode('login')}>← Back to sign in</button>
          )}
        </div>

        {/* Legal footer */}
        <div style={S.legalFooter}>
          <button type="button" className="auth-legal-link" onClick={() => onOpenLegal?.('privacy')}>Privacy Policy</button>
          <span style={{ color: 'var(--border)', fontSize: 11 }}>·</span>
          <button type="button" className="auth-legal-link" onClick={() => onOpenLegal?.('terms')}>Terms of Service</button>
        </div>
      </div>
    </div>
  );
}

// All visuals are inline-style objects so the file is self-contained
// and matches the convention the rest of the app uses for "leaf"
// surfaces (the Hub uses index.css; small components like this one
// keep their styles co-located). The only CSS that lives outside is
// the pseudo-class behaviour (:focus on inputs, :hover on link
// buttons) — see the .auth-input / .auth-mode-link / .auth-legal-link
// rules in index.css.
const S = {
  overlay: {
    position: 'fixed',
    inset: 0,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    fontFamily: 'var(--sans, "DM Sans", sans-serif)',
    backgroundColor: 'var(--bg-base, #f8f4ec)',
    backgroundImage: [
      'radial-gradient(circle at 20% 0%, rgba(26,122,74,0.05), transparent 60%)',
      'radial-gradient(circle at 80% 100%, rgba(26,122,74,0.06), transparent 55%)',
    ].join(', '),
    overflowY: 'auto',
  },
  logoWrap: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 },
  logoMark: {
    width: 40, height: 40,
    background: 'linear-gradient(145deg, var(--em-mid, #2a9e62) 0%, var(--em, #1a7a4a) 100%)',
    borderRadius: 11,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--display, "Playfair Display", serif)',
    fontSize: 20, fontStyle: 'italic', color: '#fff',
    boxShadow: '0 4px 14px rgba(26,122,74,0.28)',
  },
  logoTitle: {
    fontFamily: 'var(--display, "Playfair Display", serif)',
    fontSize: 17, fontStyle: 'italic', fontWeight: 600,
    color: 'var(--em, #1a7a4a)', lineHeight: 1.15,
  },
  logoSub: {
    fontFamily: 'var(--mono, "DM Mono", monospace)',
    fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase',
    color: 'var(--text-muted, #8a8278)', marginTop: 2,
  },

  card: {
    background: 'var(--bg-raised, #fdfaf3)',
    border: '1px solid var(--border, #e2dccf)',
    borderRadius: 18,
    padding: '36px 36px 28px',
    width: '100%', maxWidth: 420,
    boxShadow: [
      '0 1px 0 rgba(255,255,255,0.7) inset',
      '0 14px 36px rgba(26,122,74,0.10)',
      '0 2px 8px rgba(28,26,23,0.06)',
    ].join(', '),
  },

  eyebrow: {
    fontFamily: 'var(--mono, "DM Mono", monospace)',
    fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase',
    color: 'var(--em-mid, #2a9e62)', marginBottom: 6, fontWeight: 500,
  },
  heading: {
    fontFamily: 'var(--display, "Playfair Display", serif)',
    fontSize: 26, fontStyle: 'italic', fontWeight: 600,
    color: 'var(--em, #1a7a4a)',
    marginBottom: 22, lineHeight: 1.15, letterSpacing: '-0.3px',
  },

  errorBanner: {
    background: 'rgba(220,38,38,0.07)',
    border: '1px solid rgba(220,38,38,0.22)',
    borderRadius: 9, padding: '10px 14px',
    color: '#b91c1c', fontSize: 13, lineHeight: 1.5, marginBottom: 14,
  },
  infoBanner: {
    background: 'rgba(26,122,74,0.07)',
    border: '1px solid rgba(26,122,74,0.22)',
    borderRadius: 9, padding: '10px 14px',
    color: 'var(--em, #1a7a4a)', fontSize: 13, lineHeight: 1.5, marginBottom: 14,
  },

  // Google OAuth button. White surface + 'Continue with Google' wording
  // is the standard Google sign-in branding pattern — users recognise
  // it immediately, which is the whole point of OAuth.
  oauthStack: {
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  googleBtn: {
    width: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 10,
    padding: '11px 16px',
    background: '#fff',
    border: '1px solid var(--border, #e2dccf)',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: 'var(--sans, "DM Sans", sans-serif)',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text, #1c1a17)',
    transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
  },
  appleBtn: {
    width: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 10,
    padding: '11px 16px',
    background: '#000',
    border: '1px solid #000',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: 'var(--sans, "DM Sans", sans-serif)',
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
  },
  googleLabel: {
    letterSpacing: 0.2,
  },
  divider: {
    display: 'flex', alignItems: 'center', gap: 10,
    margin: '14px 0',
  },
  dividerLine: {
    flex: 1, height: 1,
    background: 'var(--border, #e2dccf)',
  },
  dividerText: {
    fontFamily: 'var(--mono, "DM Mono", monospace)',
    fontSize: 9, letterSpacing: '2px',
    color: 'var(--text-muted, #8a8278)',
  },

  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  fg:   { display: 'flex', flexDirection: 'column', gap: 5 },
  label: {
    fontFamily: 'var(--mono, "DM Mono", monospace)',
    fontSize: 10, letterSpacing: '1.8px', textTransform: 'uppercase',
    color: 'var(--text-muted, #8a8278)', fontWeight: 500,
  },
  input: {
    background: 'var(--bg-overlay, #f0eadd)',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border, #e2dccf)',
    borderRadius: 10,
    padding: '10px 13px',
    color: 'var(--text, #1c1a17)', fontSize: 14,
    fontFamily: 'var(--sans, "DM Sans", sans-serif)',
    outline: 'none', width: '100%', boxSizing: 'border-box',
    transition: 'border-color 0.18s, box-shadow 0.18s',
  },
  capsHint: {
    fontFamily: 'var(--mono, "DM Mono", monospace)',
    fontSize: 9, letterSpacing: '1px',
    color: 'var(--text-muted, #8a8278)', marginTop: 3,
  },

  checkLabel: { display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', userSelect: 'none' },
  checkbox:   { width: 15, height: 15, accentColor: 'var(--em, #1a7a4a)', cursor: 'pointer' },
  checkText:  { fontSize: 13, color: 'var(--text-mid, #4a4540)', fontFamily: 'var(--sans, "DM Sans", sans-serif)' },
  inlineLegal: {
    background: 'none', border: 'none', padding: 0,
    color: 'var(--em, #1a7a4a)', fontSize: 13, cursor: 'pointer',
    textDecoration: 'underline',
    fontFamily: 'var(--sans, "DM Sans", sans-serif)',
  },

  btn: {
    marginTop: 4,
    background: 'linear-gradient(180deg, var(--em-mid, #2a9e62) 0%, var(--em, #1a7a4a) 100%)',
    color: '#fff', border: 'none', borderRadius: 10,
    padding: '12px 16px', fontSize: 11, fontWeight: 500,
    fontFamily: 'var(--mono, "DM Mono", monospace)', letterSpacing: '1.5px',
    cursor: 'pointer',
    boxShadow: '0 2px 10px rgba(26,122,74,0.28)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%',
  },

  links: {
    marginTop: 18,
    display: 'flex', flexDirection: 'column', gap: 8,
    alignItems: 'center',
  },
  legalFooter: {
    marginTop: 20, paddingTop: 16,
    borderTop: '1px solid var(--border, #e2dccf)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12,
  },
};
