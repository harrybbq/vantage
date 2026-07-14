/**
 * MobileProfileSection
 *
 * Mobile-only Profile route. Surfaces account-level controls that
 * don't have a clean home in the desktop layout (photo + name live
 * on the hub ProfileCard there; email/password live nowhere). On
 * mobile we centralise them under More → Profile.
 *
 * Sections:
 *   - Photo (tap to upload, tap × to remove)
 *   - Display name + tagline (both live in S.profile, debounced save)
 *   - Email (Supabase auth — update triggers a confirmation email
 *     to the new address)
 *   - Change password (Supabase auth — applies immediately)
 *   - Sign out
 *
 * Sensitive actions (password change, account-level mutations) keep
 * their feedback inline so the user always sees a result without
 * having to chase a toast.
 */
import { useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useOwnHandle } from '../../hooks/useOwnHandle';

export default function MobileProfileSection({ S, update, userId, userEmail, onSignOut }) {
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
    <section className="section m-profile-wrap">
      <div className="m-profile">
        {/* Header */}
        <div className="m-section-header-block">
          <div className="m-section-eyebrow">// ACCOUNT</div>
          <div className="m-section-title-row">
            <div className="m-section-title">Profile</div>
          </div>
        </div>

        {/* Photo + name + tagline */}
        <div className="m-profile-card">
          <div className="m-profile-photo-row">
            <button
              type="button"
              className="m-profile-photo"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change profile photo"
            >
              {profile.photo
                ? <img src={profile.photo} alt="Profile" />
                : <span className="m-profile-photo-placeholder">＋</span>}
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
        </div>

        {/* Email */}
        <form className="m-profile-card" onSubmit={handleEmailUpdate}>
          <div className="m-profile-card-eyebrow">Sign-in email</div>
          <p className="m-profile-card-help">
            Change requires confirming the new address by clicking the link we email you.
          </p>
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

        {/* Password */}
        <form className="m-profile-card" onSubmit={handlePasswordUpdate}>
          <div className="m-profile-card-eyebrow">Change password</div>
          <p className="m-profile-card-help">
            Applies immediately. You'll stay signed in on this device.
          </p>
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

        {/* Sign out */}
        <div className="m-profile-card m-profile-card-quiet">
          <div className="m-profile-card-eyebrow">Session</div>
          <p className="m-profile-card-help">
            Signs you out on this device only. Your data stays in the cloud.
          </p>
          <div className="m-profile-actions">
            <button
              type="button"
              className="m-profile-btn m-profile-btn-danger"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function FieldMsg({ msg }) {
  return (
    <div className={`m-profile-msg m-profile-msg-${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
      {msg.text}
    </div>
  );
}
