/**
 * AccountPanel — the Account tab of Settings.
 *
 * This is the old mobile-only Profile route (MobileProfileSection),
 * folded into Settings. Profile was its own destination reachable from
 * exactly one place — More → Profile on mobile — while the same account
 * lived under Settings on desktop and the photo lived on the hub card.
 * Three homes for one thing. Settings is where every other account-level
 * control already is, so Profile becomes a tab of it and the standalone
 * route goes away.
 *
 * The controls are unchanged, but the boxes are gone: the old route
 * stacked four bordered `.m-profile-card`s, and Settings dropped exactly
 * that pattern when its subsections were flattened into headed groups.
 * Field-level classes (`.m-profile-input`, `-btn`, `-msg`) are reused so
 * the inputs still look like the ones they replaced.
 *
 * Sensitive actions (email change, password change) keep their feedback
 * inline rather than in a toast — you should see the result without
 * having to chase it.
 */
import { useState, useRef } from 'react';
import Icon from '../Icon';
import SettingsGroup from './SettingsGroup';
import { supabase } from '../../lib/supabase';
import { useOwnHandle } from '../../hooks/useOwnHandle';

export default function AccountPanel({ S, update, userId, userEmail, onSignOut, children }) {
  const profile = S.profile || {};
  const handle = useOwnHandle(userId);
  const fileInputRef = useRef(null);
  const [emailDraft, setEmailDraft] = useState(userEmail || '');
  const [emailMsg, setEmailMsg] = useState(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [pwd, setPwd] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdMsg, setPwdMsg] = useState(null);
  const [pwdBusy, setPwdBusy] = useState(false);

  function setProfileField(field, value) {
    update(prev => ({
      ...prev,
      profile: { ...(prev.profile || {}), [field]: value },
    }));
  }

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setProfileField('photo', ev.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handlePhotoRemove() {
    setProfileField('photo', null);
  }

  async function handleEmailUpdate(e) {
    e.preventDefault();
    setEmailMsg(null);
    const next = emailDraft.trim();
    if (!next || next === userEmail) {
      setEmailMsg({ kind: 'info', text: 'Enter a different email to change it.' });
      return;
    }
    setEmailBusy(true);
    const { error } = await supabase.auth.updateUser({ email: next });
    setEmailBusy(false);
    if (error) {
      setEmailMsg({ kind: 'err', text: error.message || 'Could not update email.' });
    } else {
      // Supabase sends a confirmation link to BOTH addresses by default;
      // the change doesn't take effect until the user clicks through.
      setEmailMsg({
        kind: 'ok',
        text: 'Confirmation email sent. Check your inbox at the new address to finish the change.',
      });
    }
  }

  async function handlePasswordUpdate(e) {
    e.preventDefault();
    setPwdMsg(null);
    if (pwd.length < 8) {
      setPwdMsg({ kind: 'err', text: 'Password must be at least 8 characters.' });
      return;
    }
    if (pwd !== pwdConfirm) {
      setPwdMsg({ kind: 'err', text: 'Passwords don\'t match.' });
      return;
    }
    setPwdBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setPwdBusy(false);
    if (error) {
      setPwdMsg({ kind: 'err', text: error.message || 'Could not update password.' });
    } else {
      setPwd('');
      setPwdConfirm('');
      setPwdMsg({ kind: 'ok', text: 'Password updated. You\'re still signed in on this device.' });
    }
  }

  return (
    <>
      <SettingsGroup
        title="Profile"
        desc="Your photo, name and tagline — what friends see next to your rating."
      >
        <div className="m-profile-photo-row">
          <button
            type="button"
            className="m-profile-photo"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Change profile photo"
          >
            {profile.photo
              ? <img src={profile.photo} alt="Profile" />
              : <span className="m-profile-photo-placeholder"><Icon name="camera" size={20} strokeWidth={1.6} /></span>}
            <span className="m-profile-photo-edit">Edit</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoChange}
          />
          {profile.photo && (
            <button
              type="button"
              className="m-profile-photo-remove"
              onClick={handlePhotoRemove}
            >Remove</button>
          )}
        </div>

        <label className="m-profile-field">
          <span className="m-profile-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Display name
            {handle && <span className="m-profile-handle">@{handle}</span>}
          </span>
          <input
            type="text"
            className="m-profile-input"
            placeholder="Your name"
            defaultValue={profile.name || ''}
            onChange={e => setProfileField('name', e.target.value)}
          />
        </label>

        <label className="m-profile-field">
          <span className="m-profile-label">Tagline</span>
          <input
            type="text"
            className="m-profile-input"
            placeholder="Short bio…"
            defaultValue={profile.tagline || ''}
            onChange={e => setProfileField('tagline', e.target.value)}
          />
        </label>
      </SettingsGroup>

      <SettingsGroup
        title="Sign-in email"
        desc="Changing it requires confirming the new address by clicking the link we email you."
      >
        <form onSubmit={handleEmailUpdate}>
          <input
            type="email"
            className="m-profile-input"
            value={emailDraft}
            onChange={e => setEmailDraft(e.target.value)}
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
          />
          <div className="m-profile-actions">
            <button
              type="submit"
              className="m-profile-btn m-profile-btn-primary"
              disabled={emailBusy}
            >
              {emailBusy ? 'Sending…' : 'Update email'}
            </button>
          </div>
          {emailMsg && <FieldMsg msg={emailMsg} />}
        </form>
      </SettingsGroup>

      <SettingsGroup
        title="Password"
        desc="Applies immediately. You'll stay signed in on this device."
      >
        <form onSubmit={handlePasswordUpdate}>
          <input
            type="password"
            className="m-profile-input"
            placeholder="New password (≥ 8 chars)"
            value={pwd}
            onChange={e => setPwd(e.target.value)}
            autoComplete="new-password"
          />
          <input
            type="password"
            className="m-profile-input"
            placeholder="Confirm new password"
            value={pwdConfirm}
            onChange={e => setPwdConfirm(e.target.value)}
            autoComplete="new-password"
          />
          <div className="m-profile-actions">
            <button
              type="submit"
              className="m-profile-btn m-profile-btn-primary"
              disabled={pwdBusy || !pwd || !pwdConfirm}
            >
              {pwdBusy ? 'Updating…' : 'Update password'}
            </button>
          </div>
          {pwdMsg && <FieldMsg msg={pwdMsg} />}
        </form>
      </SettingsGroup>

      {/* Sign out is only rendered where a handler was passed. Desktop
          already has one in the sidebar; this is the mobile route's,
          which had nowhere else to go once Profile stopped existing. */}
      {onSignOut && (
        <SettingsGroup
          title="Session"
          desc="Signs you out on this device only. Your data stays in the cloud."
        >
          <div className="m-profile-actions">
            <button
              type="button"
              className="m-profile-btn m-profile-btn-danger"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        </SettingsGroup>
      )}

      {/* Export and delete-account, passed in by SettingsSection. They
          were the whole Data tab until it folded in here: both act on
          the account rather than on a feature, and a tab holding two
          groups was a tab for the sake of one. Delete stays last on the
          page, which is where the destructive thing belongs. */}
      {children}
    </>
  );
}

function FieldMsg({ msg }) {
  return (
    <div className={`m-profile-msg m-profile-msg-${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
      {msg.text}
    </div>
  );
}
