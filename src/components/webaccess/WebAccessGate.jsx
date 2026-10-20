import { useState } from 'react';
import Logo from '../Logo';
import StoreLinks from './StoreLinks';
import { confirmAndDeleteAccount } from '../../lib/account/deleteAccount';
import './webaccess.css';

/**
 * The web gate page (item 131): signed in on the web, mode 'allowlist',
 * not on the list. Rendered INSTEAD of the app — App.jsx's
 * WebAccessBoundary never mounts Board for this visitor, so nothing of
 * theirs is loaded or saved. Their account and data are untouched.
 *
 * What it offers: the store apps, Sign out, and Delete my account —
 * Google Play requires deletion on the web even for people without the
 * app, so the gate keeps the SAME flow Settings uses
 * (lib/account/deleteAccount.js: two confirms, store-subscription
 * warning, server function, local cleanup, sign-out).
 *
 * Sign out here is a plain auth sign-out: it does not clear this device's
 * local copies (the app never ran this load, so there is nothing new to
 * flush, and an old pending edit left by an earlier web session must not
 * be thrown away by a page that never loaded it).
 *
 * `unverified`: the access check failed and nothing is known — same page,
 * plus a line saying so; "Check again" re-asks.
 */
export default function WebAccessGate({ userId, email, unverified = false, onRetry, onSignOut, onOpenLegal }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function handleDelete() {
    setError('');
    try {
      await confirmAndDeleteAccount(userId, { onStart: () => setDeleting(true) });
    } catch (e) {
      setError(e?.message || 'Something went wrong.');
      setDeleting(false);
    }
  }

  function retry() {
    setChecking(true);
    onRetry?.();
    setTimeout(() => setChecking(false), 1500);
  }

  return (
    <main className="wa-gate">
      <div className="wa-brand">
        <div className="wa-brand-mark"><Logo size={26} strokeWidth={7} /></div>
        <div className="wa-brand-name">Vantage</div>
      </div>

      <div className="wa-card">
        <div className="wa-eyebrow">// On your phone</div>
        <h1 className="wa-heading">Vantage is on iPhone and Android.</h1>
        <p className="wa-text">
          The full app lives in the iPhone and Android apps. In a web browser it&rsquo;s by invitation.
        </p>

        <StoreLinks />

        <p className="wa-safe">
          Your account and data are safe &mdash; sign in on the app to pick up where you left off.
        </p>

        {unverified && (
          <p className="wa-msg wa-msg-warn" role="status">
            We couldn&rsquo;t check your web access just now.
          </p>
        )}

        <div className="wa-actions">
          <button type="button" className="wa-btn" onClick={onSignOut}>Sign out</button>
          <button type="button" className="wa-btn wa-btn-ghost" onClick={retry} disabled={checking}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
        {email && <p className="wa-signed-in">Signed in as {email}</p>}

        <section className="wa-delete" aria-labelledby="wa-delete-title">
          <h2 id="wa-delete-title" className="wa-delete-title">Delete my account</h2>
          <p className="wa-delete-text">
            Permanently deletes your Vantage account and everything in it &mdash; your login, profile,
            friends, messages, food log, vitals, boards, trackers and settings. It cannot be undone.
          </p>
          <p className="wa-delete-text">
            Paying for Pro through the App Store or Google Play? Deleting your account does not cancel
            that subscription &mdash; cancel it in the store first.
            {' '}<strong>iPhone:</strong> Settings &rarr; your name &rarr; Subscriptions &rarr; Vantage &rarr; Cancel.
            {' '}<strong>Android:</strong> Google Play &rarr; profile icon &rarr; Payments &amp; subscriptions &rarr; Subscriptions &rarr; Vantage &rarr; Cancel.
          </p>
          {error && <p className="wa-msg wa-msg-err" role="alert">Error: {error}</p>}
          <button type="button" className="wa-btn wa-btn-danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
        </section>

        <div className="wa-legal" role="navigation" aria-label="Legal and support">
          <button type="button" onClick={() => onOpenLegal?.('privacy')}>Privacy Policy</button>
          <button type="button" onClick={() => onOpenLegal?.('terms')}>Terms of Service</button>
          <button type="button" onClick={() => onOpenLegal?.('support')}>Support</button>
        </div>
      </div>
    </main>
  );
}
