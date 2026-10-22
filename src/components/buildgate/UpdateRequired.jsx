import { useState } from 'react';
import Logo from '../Logo';
import StoreLinks from '../webaccess/StoreLinks';
import '../webaccess/webaccess.css';

/**
 * The update page: this build is older than the minimum the owner set
 * (lib/buildGate.js). Rendered INSTEAD of the app — BuildGateBoundary
 * never mounts Board, so nothing is loaded or saved and this device's
 * local copies (an unsaved edit included) are left exactly as they are
 * for the updated app to pick up.
 *
 * Web: Reload asks the service worker to look for the new version first,
 * then reloads. Native: the store links (or "coming soon" until the
 * listings exist).
 */
export default function UpdateRequired({ native = false, build = 0, onSignOut }) {
  const [reloading, setReloading] = useState(false);

  async function reload() {
    setReloading(true);
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) await Promise.race([reg.update(), new Promise(r => setTimeout(r, 3000))]);
    } catch { /* reload anyway */ }
    window.location.reload();
  }

  return (
    <main className="wa-gate" data-testid="update-required">
      <div className="wa-brand">
        <div className="wa-brand-mark"><Logo size={26} strokeWidth={7} /></div>
        <div className="wa-brand-name">Vantage</div>
      </div>

      <div className="wa-card">
        <div className="wa-eyebrow">// Update needed</div>
        <h1 className="wa-heading">{native ? 'Update Vantage to carry on.' : 'A newer Vantage is ready.'}</h1>
        <p className="wa-text">
          {native
            ? 'This version of the app is too old to open your data safely. Update it from the store, then open it again.'
            : 'This copy of the app is out of date. Reload to get the latest version.'}
        </p>

        {native ? <StoreLinks /> : (
          <div className="wa-actions">
            <button type="button" className="wa-btn" onClick={reload} disabled={reloading} data-testid="update-reload">
              {reloading ? 'Reloading…' : 'Reload'}
            </button>
          </div>
        )}

        <p className="wa-safe">
          Your account and data are safe &mdash; nothing was opened or changed on this device.
        </p>

        <div className="wa-actions">
          <button type="button" className="wa-btn wa-btn-ghost" onClick={onSignOut}>Sign out</button>
        </div>
        {build > 0 && <p className="wa-signed-in">Build {build}</p>}
      </div>
    </main>
  );
}
