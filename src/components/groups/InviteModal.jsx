/**
 * The invite sheet — a code, and the seats left.
 *
 * Groups are invite-only, and the code IS the invite: unguessable, and
 * rotatable by the owner the moment it ends up somewhere it should not
 * be. The alphabet drops O/0 and I/1/L because this is a string people
 * read out loud and type back in.
 */
import { useState } from 'react';
import { backdropClose } from '../../utils/backdropClose';

export default function InviteModal({ group, seatsLeft, onRotate, onClose }) {
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [code, setCode] = useState(group.inviteCode);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated and blocked outright in some
      // in-app browsers. The code is on screen either way.
      window.prompt('Copy the invite code', code);
    }
  }

  async function rotate() {
    if (!window.confirm('Change the code? The old one stops working immediately.')) return;
    setRotating(true);
    try {
      const out = await onRotate();
      if (out?.code) setCode(out.code);
    } catch (e) {
      window.alert(e.message || 'Could not change the code.');
    }
    setRotating(false);
  }

  return (
    <div className="modal-overlay open" {...backdropClose(onClose)}>
      <div className="modal grp-invite" style={{ maxWidth: 460 }}>
        <div className="grp-invite-eyebrow">Invite only</div>
        <h3 className="grp-invite-title">Add to {group.name}</h3>
        <p className="grp-invite-sub">
          {seatsLeft > 0
            ? <>Share the code. {seatsLeft} seat{seatsLeft === 1 ? '' : 's'} left of 20.</>
            : <>Every seat is taken — someone has to leave before another can join.</>}
        </p>

        <div className="grp-code">
          <span className="grp-code-value">{code}</span>
          <button type="button" className="btn btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>

        <p className="grp-invite-note">
          Anyone with this code can join while there is a seat. If it gets out, change it —
          the old one stops working straight away.
        </p>

        <div className="grp-invite-actions">
          {group.isOwner && (
            <button type="button" className="btn btn-sm" onClick={rotate} disabled={rotating}>
              {rotating ? 'Changing…' : 'New code'}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
