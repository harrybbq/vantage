import { useEffect, useState } from 'react';
import SettingsGroup from '../settings/SettingsGroup';
import { cleanEmail, cleanNote, ownerErrorMessage } from '../../lib/webAccess';
import {
  readWebAccessModeFresh, listWebAccess, addWebAccess, removeWebAccess, setWebAccessMode,
} from '../../lib/webAccessClient';
import './webaccess.css';

/**
 * Settings → Tools → Web access (owner-only; compiled out of native via
 * OWNER_SURFACES_IN_BUILD in SettingsSection).
 *
 * The web gate's switch and its allow-list (item 131). Each RPC checks
 * is_app_owner() in Postgres — this panel is only where the controls
 * live. Shows emails, notes and dates; never a user id (the RPCs don't
 * return one). Until supabase/web_access_2026_10b.sql is run every call
 * fails, and the panel says so instead of showing a raw error.
 *
 * A mode change applies to each visitor's next page load — nobody who
 * already has the app open is thrown out mid-session (that could drop an
 * unsaved edit).
 */

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

export default function WebAccessPanel() {
  const [mode, setMode] = useState(null);          // 'open' | 'allowlist' | null (unknown)
  const [list, setList] = useState(null);          // rows | null
  const [setupError, setSetupError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmMode, setConfirmMode] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    const [m, l] = await Promise.all([readWebAccessModeFresh(), listWebAccess()]);
    if (l.error) { setSetupError(ownerErrorMessage(l.error)); setList(null); }
    else { setSetupError(''); setList(Array.isArray(l.data) ? l.data : []); }
    setMode(m.error ? null : m.data.mode);
  }

  useEffect(() => { load(); }, []);

  async function flipMode() {
    const next = mode === 'allowlist' ? 'open' : 'allowlist';
    setBusy(true); setMsg('');
    const res = await setWebAccessMode(next);
    setBusy(false); setConfirmMode(false);
    if (res.error) { setMsg(ownerErrorMessage(res.error)); return; }
    setMode(res.data?.mode || next);
    setMsg(next === 'allowlist'
      ? 'Web is invite-only. People not on the list get the app-store page on their next visit.'
      : 'Web reopened to everyone.');
  }

  async function add(e) {
    e.preventDefault();
    const clean = cleanEmail(email);
    if (!clean) { setMsg('That doesn’t look like an email address.'); return; }
    setBusy(true); setMsg('');
    const res = await addWebAccess(clean, cleanNote(note));
    setBusy(false);
    if (res.error) { setMsg(ownerErrorMessage(res.error)); return; }
    setEmail(''); setNote('');
    setMsg(`${clean} can use the web app.`);
    load();
  }

  async function remove(addr) {
    setBusy(true); setMsg('');
    const res = await removeWebAccess(addr);
    setBusy(false); setConfirmRemove(null);
    if (res.error) { setMsg(ownerErrorMessage(res.error)); return; }
    setMsg(`${addr} removed.`);
    load();
  }

  const invited = list ? list.length : 0;
  const ready = !setupError && mode !== null;
  const isOpen = mode !== 'allowlist';

  return (
    <SettingsGroup
      title="Web access"
      desc="Who can use the full app in a web browser. The iPhone and Android apps, and the privacy, terms, support and delete-account pages, are never affected. You always have access."
    >
      <div className="wa-panel">
        <div className="wa-mode-row">
          <span className={'wa-mode-pill' + (isOpen ? '' : ' wa-mode-pill-locked')} aria-live="polite">
            {mode === null ? 'Mode unknown' : isOpen ? 'Open to everyone' : `Invite-only · ${invited} invited`}
          </span>
          {ready && !confirmMode && (
            <button type="button" className="m-profile-btn" disabled={busy} onClick={() => { setConfirmMode(true); setMsg(''); }}>
              {isOpen ? 'Switch web to invite-only…' : 'Reopen web to everyone…'}
            </button>
          )}
        </div>

        {confirmMode && (
          <div className="wa-confirm" role="alertdialog" aria-label="Confirm web access change">
            <p>
              {isOpen
                ? `Only you and the ${invited} ${invited === 1 ? 'person' : 'people'} on the list will get the app in a browser. Everyone else sees “Vantage is on iPhone and Android” on their next visit. Their accounts and data are untouched.`
                : 'Anyone signed in on the web gets the full app again on their next visit.'}
            </p>
            <div className="wa-confirm-actions">
              <button type="button" className="m-profile-btn" onClick={() => setConfirmMode(false)} disabled={busy}>Cancel</button>
              <button type="button" className={'m-profile-btn ' + (isOpen ? 'm-profile-btn-danger' : 'm-profile-btn-primary')} onClick={flipMode} disabled={busy}>
                {busy ? 'Saving…' : isOpen ? 'Yes, make it invite-only' : 'Yes, reopen the web'}
              </button>
            </div>
          </div>
        )}

        {setupError && <p className="wa-msg wa-msg-warn" role="status">{setupError}</p>}
        {msg && <p className="wa-msg" role="status">{msg}</p>}

        {!setupError && (
          <form className="wa-add" onSubmit={add}>
            <label className="wa-label" htmlFor="wa-email">Invite by email</label>
            <div className="wa-add-row">
              <input id="wa-email" className="m-profile-input" type="email" inputMode="email" autoComplete="off"
                placeholder="their sign-in email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} />
              <input className="m-profile-input" type="text" placeholder="note (optional)" aria-label="Note"
                value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
              <button type="submit" className="m-profile-btn m-profile-btn-primary" disabled={busy || !email.trim()}>Add</button>
            </div>
          </form>
        )}

        {list && (
          list.length === 0 ? (
            <p className="wa-empty">Nobody on the list yet.</p>
          ) : (
            <ul className="wa-list" aria-label="People with web access">
              {list.map(row => (
                <li key={row.email} className="wa-row">
                  <div className="wa-row-main">
                    <span className="wa-row-email">{row.email}</span>
                    <span className="wa-row-meta">
                      {row.note ? `${row.note} · ` : ''}added {fmtDate(row.added_at)}
                    </span>
                  </div>
                  {confirmRemove === row.email ? (
                    <span className="wa-row-actions">
                      <button type="button" className="m-profile-btn" onClick={() => setConfirmRemove(null)} disabled={busy}>Keep</button>
                      <button type="button" className="m-profile-btn m-profile-btn-danger" onClick={() => remove(row.email)} disabled={busy}>Remove</button>
                    </span>
                  ) : (
                    <button type="button" className="m-profile-btn" onClick={() => setConfirmRemove(row.email)} disabled={busy}
                      aria-label={`Remove ${row.email}`}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </SettingsGroup>
  );
}
