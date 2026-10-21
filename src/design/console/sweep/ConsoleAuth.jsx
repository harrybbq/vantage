/**
 * Console sign-in / create account / reset password.
 *
 * Same props as classic AuthScreen ({ onOpenLegal, webInviteOnly }) and
 * every flow it has, carried over call for call:
 *   - Google and Apple through startOAuth: Supabase redirect on the web,
 *     the system browser on native (nativeOAuth), refusals coming back
 *     through onNativeAuthError
 *   - in sign-up the 13+ / Terms box gates the OAuth buttons too
 *     (oauthBlocked), and a sign-up marks terms accepted pending
 *   - email sign-in bounded by withTimeout(20 s), errors through
 *     friendlyAuthError; "keep me signed in" is vb4_remember
 *   - sign-up and reset links come back to webOrigin()
 *   - password-manager autocomplete tokens, the caps-lock hint, the
 *     invite-only web note, aria-live error and info banners
 *   - Privacy, Terms, Support and Delete account in the footer (store
 *     requirements; the mockup showed two, all four stay)
 *
 * What changes is the order and the look (DIRECTIONS §A, signin390):
 * the one-tap providers lead, email follows under "or with email",
 * sentence-case buttons, no Playfair, no `// Sign in` eyebrow.
 *
 * Rendered only once the no-session design is console, i.e. after the
 * launch flip (README "Gotchas"); verified in a harness until then.
 */
import { useCallback, useEffect, useState } from 'react';
import Logo from '../../../components/Logo';
import { supabase } from '../../../lib/supabase';
import { withTimeout, friendlyAuthError } from '../../../utils/withTimeout';
import { isNativeApp, webOrigin } from '../../../lib/native/platform';
import { nativeOAuth, onNativeAuthError } from '../../../lib/native/deepLinks';
import { markTermsAcceptedPending } from '../../../components/TermsAcceptanceSheet';
import { Button, Checkbox } from '../ui';

const COPY = {
  login: { title: 'Sign in', sub: 'Your ratings, prestige and hub are where you left them.', submit: 'Sign in' },
  signup: { title: 'Create your account', sub: 'Free, with both themes and every core feature.', submit: 'Create account' },
  reset: { title: 'Reset your password', sub: "We'll email you a link to set a new one.", submit: 'Send reset link' },
};

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

function AppleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="currentColor" d="M14.04 9.56c-.02-2.04 1.67-3.02 1.74-3.07-.95-1.39-2.42-1.58-2.95-1.6-1.26-.13-2.45.74-3.09.74-.65 0-1.63-.72-2.68-.7-1.38.02-2.65.8-3.36 2.04-1.43 2.48-.37 6.15 1.03 8.16.68.98 1.5 2.09 2.56 2.05 1.03-.04 1.42-.66 2.66-.66 1.24 0 1.59.66 2.68.64 1.11-.02 1.81-1 2.49-1.98.78-1.14 1.11-2.24 1.13-2.3-.02-.01-2.18-.83-2.21-3.32ZM12.05 3.7c.56-.69.95-1.64.84-2.59-.81.03-1.81.54-2.4 1.22-.52.6-.99 1.57-.87 2.49.91.07 1.85-.46 2.43-1.12Z" />
    </svg>
  );
}

function readRemember() {
  try { return localStorage.getItem('vb4_remember') !== '0'; } catch { return true; }
}

export default function ConsoleAuth({ onOpenLegal, webInviteOnly = false }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(readRemember);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [capsLock, setCapsLock] = useState(false);

  const switchMode = useCallback(next => { setMode(next); setError(''); setInfo(''); }, []);
  useEffect(() => onNativeAuthError(msg => setError(msg)), []);

  const oauthBlocked = mode === 'signup' && !ageConfirmed;

  async function startOAuth(provider, queryParams) {
    if (oauthBlocked) {
      setError('Please confirm you are 13 or older and agree to the Terms first.');
      return;
    }
    if (mode === 'signup') markTermsAcceptedPending();
    if (isNativeApp()) {
      await nativeOAuth(provider, queryParams);
      return;
    }
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin, ...(queryParams ? { queryParams } : {}) },
    });
    if (e) throw e;
  }

  async function google() {
    setError(''); setInfo('');
    try { await startOAuth('google', { prompt: 'select_account' }); } catch (err) { setError(err.message || 'Could not start Google sign-in.'); }
  }
  async function apple() {
    setError(''); setInfo('');
    try { await startOAuth('apple'); } catch (err) { setError(err.message || 'Could not start Apple sign-in.'); }
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);
    try {
      if (mode === 'login') {
        const { error: err } = await withTimeout(supabase.auth.signInWithPassword({ email, password }), 20000);
        if (err) throw err;
        try { localStorage.setItem('vb4_remember', rememberMe ? '1' : '0'); } catch { /* private mode */ }
      } else if (mode === 'signup') {
        if (!ageConfirmed) { setError('Please confirm you are 13 or older.'); setLoading(false); return; }
        const { error: err } = await withTimeout(
          supabase.auth.signUp({ email, password, options: { emailRedirectTo: webOrigin() } }), 20000,
        );
        if (err) throw err;
        setInfo('Check your email to confirm your account, then sign in.');
        setMode('login');
      } else {
        const { error: err } = await withTimeout(supabase.auth.resetPasswordForEmail(email, { redirectTo: webOrigin() }), 20000);
        if (err) throw err;
        setInfo('Password reset email sent. Check your inbox.');
        setMode('login');
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  const c = COPY[mode];
  const legalBtn = (key, label) => (
    <button type="button" className="cx-sweep-auth-link is-quiet" onClick={() => onOpenLegal?.(key)}>{label}</button>
  );

  return (
    <div className="cx-sweep-auth" data-testid="cx-auth">
      <div className="cx-sweep-auth-col">
        <div className="cx-sweep-auth-brand">
          <span className="cx-sweep-auth-mark" aria-hidden="true"><Logo size={36} c="var(--cx-accent)" c2="var(--cx-gold)" /></span>
          <span className="cx-sweep-auth-word">Vantage</span>
        </div>

        <div className="cx-sweep-auth-titles">
          <h1 className="cx-sweep-auth-title">{c.title}</h1>
          <p className="cx-t15 cx-mid">{c.sub}</p>
          {webInviteOnly && <p className="cx-t13 cx-mid">The full app is on iPhone and Android. Web access is by invitation.</p>}
        </div>

        {error && <div className="cx-sweep-auth-banner is-error" role="alert" aria-live="assertive">{error}</div>}
        {info && <div className="cx-sweep-auth-banner is-info" role="status" aria-live="polite">{info}</div>}

        {mode !== 'reset' && (
          <>
            {mode === 'signup' && (
              <div className="cx-sweep-auth-terms">
                <Checkbox checked={ageConfirmed} onChange={setAgeConfirmed} label="I am 13 or older and agree to the Terms of Service and Privacy Policy" />
                {/* Tapping the sentence ticks the box, as classic's <label> did; the links inside still open. */}
                <span className="cx-t13 cx-mid cx-sweep-auth-termtext" onClick={e => { if (!e.target.closest('button')) setAgeConfirmed(v => !v); }}>
                  I am 13 or older and agree to the{' '}
                  <button type="button" className="cx-sweep-auth-link" onClick={() => onOpenLegal?.('terms')}>Terms of Service</button>
                  {' '}and{' '}
                  <button type="button" className="cx-sweep-auth-link" onClick={() => onOpenLegal?.('privacy')}>Privacy Policy</button>
                </span>
              </div>
            )}
            <div className="cx-sweep-auth-oauth">
              {oauthBlocked && <p className="cx-t12 cx-muted" id="cx-auth-oauth-hint">Tick the box above to sign up with Google or Apple.</p>}
              <button
                type="button"
                className="cx-sweep-auth-provider is-google"
                onClick={google}
                disabled={loading || oauthBlocked}
                aria-label={mode === 'signup' ? 'Sign up with Google' : 'Sign in with Google'}
                aria-describedby={oauthBlocked ? 'cx-auth-oauth-hint' : undefined}
              >
                <GoogleGlyph /><span>{mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}</span>
              </button>
              <button
                type="button"
                className="cx-sweep-auth-provider is-apple"
                onClick={apple}
                disabled={loading || oauthBlocked}
                aria-label={mode === 'signup' ? 'Sign up with Apple' : 'Sign in with Apple'}
                aria-describedby={oauthBlocked ? 'cx-auth-oauth-hint' : undefined}
              >
                <AppleGlyph /><span>{mode === 'signup' ? 'Sign up with Apple' : 'Continue with Apple'}</span>
              </button>
            </div>
            <div className="cx-sweep-auth-or" aria-hidden="true"><span />or with email<span /></div>
          </>
        )}

        <form className="cx-sweep-auth-form" onSubmit={submit} noValidate>
          <div className="cx-field">
            <label htmlFor="cx-auth-email">Email</label>
            <input
              id="cx-auth-email" name="email" className="cx-input" type="email" inputMode="email"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username"
              placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required
            />
          </div>
          {mode !== 'reset' && (
            <div className="cx-field">
              <div className="cx-sweep-auth-pwrow">
                <label htmlFor="cx-auth-pw">Password</label>
                {mode === 'login' && <button type="button" className="cx-sweep-auth-link" onClick={() => switchMode('reset')}>Forgot password?</button>}
              </div>
              <input
                id="cx-auth-pw" name="password" className="cx-input" type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
                onBlur={() => setCapsLock(false)} required minLength={6}
              />
              {capsLock && <span className="cx-t12 cx-muted">Caps Lock is on</span>}
            </div>
          )}
          {mode === 'login' && (
            <Checkbox checked={rememberMe} onChange={setRememberMe} label="Keep me signed in on this device" showLabel />
          )}
          <Button type="submit" variant="primary" block disabled={loading} className="cx-sweep-auth-submit">
            {loading ? 'Please wait…' : c.submit}
          </Button>
        </form>

        <p className="cx-sweep-auth-switch cx-t13 cx-mid">
          {mode === 'login' && <>New here? <button type="button" className="cx-sweep-auth-link" onClick={() => switchMode('signup')}>Create an account</button></>}
          {mode === 'signup' && <>Already have an account? <button type="button" className="cx-sweep-auth-link" onClick={() => switchMode('login')}>Sign in</button></>}
          {mode === 'reset' && <button type="button" className="cx-sweep-auth-link" onClick={() => switchMode('login')}>Back to sign in</button>}
        </p>

        <footer className="cx-sweep-auth-legal cx-t12">
          {legalBtn('privacy', 'Privacy')}
          {legalBtn('terms', 'Terms')}
          {legalBtn('support', 'Support')}
          {legalBtn('delete-account', 'Delete account')}
          <span className="cx-muted">Data stored in the EU</span>
        </footer>
      </div>
    </div>
  );
}
