/**
 * A group's picture, and the leader's control over it.
 *
 * Read-only for everyone but the leader: a circle with the picture in
 * it, or the group's initials on its colour when there is no picture —
 * which is what the crest has always been, so nothing regresses for a
 * group that never sets one.
 *
 * For the leader it is also the control. Clicking it opens the file
 * picker, and what comes back is resized to a 160px square in the
 * browser before it is sent (see lib/groups/crestImage.js). Under it,
 * when there is something to say, the status: waiting to be checked, or
 * refused and why. An approved picture says nothing, because a label
 * reading "approved" on your own crest forever is noise.
 *
 * ── Why a status at all ──────────────────────────────────────────────
 * The division table is public. A picture is screened before strangers
 * see it, and until it clears, the only people who can see it are the
 * group's own members. Telling the leader that plainly is the
 * difference between "checking" and "broken".
 */
import { useRef, useState } from 'react';
import Icon from '../Icon';
import { toCrestDataUrl, crestStatusNote, CREST_ACCEPT } from '../../lib/groups/crestImage';

function initials(name) {
  return (name || '?').replace(/^@/, '').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function GroupCrest({
  name, color, image, status = 'none', note,
  canEdit = false, onSet, onRemove, busy = false, size = 'lg',
}) {
  const fileRef = useRef(null);
  const [working, setWorking] = useState(false);
  const [localError, setLocalError] = useState(null);

  const disabled = busy || working;
  const statusNote = canEdit ? crestStatusNote(status, note) : null;

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';           // so choosing the same file twice fires
    if (!file) return;
    setLocalError(null);
    setWorking(true);
    try {
      const dataUrl = await toCrestDataUrl(file);
      await onSet(dataUrl);
    } catch (err) {
      setLocalError(err?.message || 'Could not use that image.');
    } finally {
      setWorking(false);
    }
  }

  const face = image
    ? <img className="grp-crest-img" src={image} alt={`${name} group picture`} />
    : <span className="grp-crest-initials">{initials(name)}</span>;

  const style = image ? undefined : (color ? { background: color } : undefined);

  if (!canEdit) {
    return <div className={`grp-crest is-${size}`} style={style}>{face}</div>;
  }

  return (
    <div className="grp-crest-edit">
      <button
        type="button"
        className={`grp-crest is-${size} is-editable${disabled ? ' is-busy' : ''}`}
        style={style}
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
        title={image ? 'Change the group picture' : 'Add a group picture'}
        aria-label={image ? 'Change the group picture' : 'Add a group picture'}
      >
        {face}
        <span className="grp-crest-overlay" aria-hidden="true">
          <Icon name="image" size={14} />
        </span>
      </button>
      <input
        ref={fileRef} type="file" accept={CREST_ACCEPT}
        style={{ display: 'none' }} onChange={pick}
      />

      {image && (
        <button
          type="button" className="grp-crest-clear" disabled={disabled}
          onClick={() => { setLocalError(null); onRemove(); }}
        >Remove picture</button>
      )}

      {working && <div className="grp-crest-note is-wait">Checking the picture…</div>}
      {!working && localError && <div className="grp-crest-note is-bad">{localError}</div>}
      {!working && !localError && statusNote && (
        <div className={`grp-crest-note is-${statusNote.tone}`}>{statusNote.text}</div>
      )}
    </div>
  );
}
