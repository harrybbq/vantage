import { useEffect, useState } from 'react';
import { checkConnectAccess } from '../../lib/wearables/accessClient';
import './wearables.css';

/**
 * While WHOOP / Oura review Vantage (item 127): one line under an
 * UNCONNECTED provider's panel saying whether this account can link —
 * "You're on the list" or "not on the list yet" — before Connect is
 * pressed. Renders nothing when connects are open, when the account is
 * connected, or when the check fails (Connect still answers clearly).
 * One status call per mount. Mounted with one line inside WearableSync.
 */
export default function WearableAccessNote({ provider, connected }) {
  const [access, setAccess] = useState(null);
  useEffect(() => {
    if (connected) return undefined;
    let live = true;
    checkConnectAccess(provider).then(a => { if (live) setAccess(a); });
    return () => { live = false; };
  }, [provider, connected]);

  if (connected || !access || !access.limited || !access.message) return null;
  return (
    <p className={'wx-note' + (access.allowed ? '' : ' wx-note-limited')} role="status">
      {access.message}
    </p>
  );
}
