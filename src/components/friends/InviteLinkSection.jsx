import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { getMyInvite, regenerateInvite } from '../../lib/friends/invites';
import './friends-dm.css';

/**
 * Your personal invite link: copy it, share it (the phone's share sheet —
 * WhatsApp, iMessage — where the browser offers one), or let someone
 * scan the QR code off your screen. Sits first in AddFriendModal because
 * a new user has no friends whose handles they could search for.
 *
 * ── Why the QR comes from @zxing/library ─────────────────────────────
 * It is already a dependency (the barcode scanner) and already loaded
 * lazily, so the encoder costs no new package and no bytes on the
 * start-up path: the import below resolves to the same chunk the scanner
 * uses, fetched the first time this modal opens. A hand-rolled encoder
 * would be ~300 lines of Reed–Solomon to own; a new npm package would be
 * a second QR implementation in the bundle. The matrix is drawn as one
 * SVG path, so it stays crisp at any size and prints.
 */
export default function InviteLinkSection({ open }) {
  const [invite, setInvite] = useState(null);     // { code, url, expiresAt }
  const [state, setState] = useState('loading');  // loading | ready | off | error
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const statusTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(statusTimer.current), []);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState('loading'); setStatus('');
    getMyInvite().then(res => {
      if (cancelled) return;
      if (res?.ok) { setInvite(res); setState('ready'); }
      else setState(res?.reason === 'not_configured' ? 'off' : 'error');
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [open]);

  function say(text) {
    setStatus(text);
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(''), 3500);
  }

  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      say('Link copied.');
    } catch {
      say('Couldn\'t copy — press and hold the link to copy it.');
    }
  }

  async function share() {
    if (!invite || !navigator.share) return;
    try {
      await navigator.share({ title: 'Add me on Vantage', text: 'Add me as a friend on Vantage:', url: invite.url });
    } catch { /* dismissed */ }
  }

  async function regenerate() {
    if (!window.confirm('Make a new link? Your current link and QR code will stop working.')) return;
    setBusy(true);
    const res = await regenerateInvite();
    setBusy(false);
    if (!res?.ok) { say(res?.reason === 'not_configured' ? 'Invite links aren\'t switched on yet.' : 'Couldn\'t make a new link. Try again.'); return; }
    setInvite(res);
    say('New link ready. The old one no longer works.');
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <section className="inv-section" aria-labelledby="inv-title">
      <div className="handle-claim-eyebrow" id="inv-title">Invite link</div>
      {state === 'off' ? (
        <div className="inv-note">Invite links aren't switched on yet. You can still add friends by handle below.</div>
      ) : state === 'error' ? (
        <div className="inv-note">Couldn't load your invite link. Close this and try again in a moment.</div>
      ) : (
        <>
          <p className="inv-sub">Send this to a friend. When they open it, they can add you in one tap — you'll see their request here.</p>
          <div className="inv-row">
            <div className="inv-url" title={invite?.url || ''} aria-label="Your invite link">
              <span className="inv-url-text">{state === 'loading' ? 'Making your link…' : invite.url.replace(/^https?:\/\//, '')}</span>
            </div>
            <button type="button" className="btn btn-primary btn-sm inv-btn" onClick={copy} disabled={state !== 'ready'}>
              <Icon name="copy" size={14} /> Copy
            </button>
          </div>
          {canShare && (
            <div className="inv-actions">
              <button type="button" className="btn btn-ghost btn-sm inv-btn" onClick={share} disabled={state !== 'ready'}>
                <Icon name="share" size={14} /> Share…
              </button>
            </div>
          )}
          <div className="inv-qr-wrap">
            <div className="inv-qr">
              {state === 'ready' ? <InviteQR text={invite.url} /> : <span className="inv-qr-ph">QR</span>}
            </div>
            <div className="inv-meta">
              <div>Or let them scan this with their phone camera.</div>
              {invite?.expiresAt && <div>Works until <strong>{fmtDate(invite.expiresAt)}</strong>.</div>}
              <button type="button" className="inv-new" onClick={regenerate} disabled={busy || state !== 'ready'}>
                {busy ? 'Making a new link…' : 'New link'}
              </button>
            </div>
          </div>
          <div className="inv-status" role="status" aria-live="polite">{status}</div>
        </>
      )}
    </section>
  );
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

/** QR code as one SVG path (4-module quiet zone, error correction M). */
export function InviteQR({ text }) {
  const [qr, setQr] = useState(null); // { size, d } | 'error'
  useEffect(() => {
    let cancelled = false;
    setQr(null);
    import('@zxing/library').then(({ QRCodeEncoder, QRCodeDecoderErrorCorrectionLevel }) => {
      if (cancelled) return;
      const m = QRCodeEncoder.encode(text, QRCodeDecoderErrorCorrectionLevel.M).getMatrix();
      const n = m.getWidth();
      let d = '';
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) if (m.get(x, y) === 1) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
      setQr({ size: n + 8, d });
    }).catch(() => { if (!cancelled) setQr('error'); });
    return () => { cancelled = true; };
  }, [text]);
  if (qr === 'error') return <span className="inv-qr-ph">QR unavailable</span>;
  if (!qr) return <span className="inv-qr-ph">…</span>;
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR code for your invite link" shapeRendering="crispEdges">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.d} fill="#111" />
    </svg>
  );
}
