import { useEffect, useState } from 'react';
import SettingsGroup from '../settings/SettingsGroup';
import { cleanHandle, cleanNote, accessErrorMessage } from '../../lib/wearables/access';
import {
  listWearableAccess, addWearableAccess, removeWearableAccess, setWearableAccessMode, wearableAccessSummary,
} from '../../lib/wearables/accessClient';
import './wearables.css';

/**
 * Settings → Tools → Wearable access (owner-only; compiled out of native
 * via OWNER_SURFACES_IN_BUILD where it is mounted). Item 127.
 *
 * The switch and the list that decide who may START a WHOOP / Oura
 * connect while the providers review Vantage (each caps an unapproved
 * app at 10 accounts). Mirrors WebAccessPanel. Every RPC checks
 * is_app_owner() in Postgres; this is only where the controls live.
 * Shows handles, names, notes, dates and counts — never a user id or an
 * email. Until supabase/wearable_access_2026_10.sql is run every call
 * fails and the panel says so; connects meanwhile stay open.
 *
 * Accounts already connected are never cut off: they keep syncing and
 * can reconnect whatever the mode.
 */

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

export default function WearableAccessPanel() {
  const [summary, setSummary] = useState(null);   // { mode, listed, cap, whoop_connected, oura_connected }
  const [list, setList] = useState(null);
  const [setupError, setSetupError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmMode, setConfirmMode] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    const [s, l] = await Promise.all([wearableAccessSummary(), listWearableAccess()]);
    if (l.error || s.error) { setSetupError(accessErrorMessage(l.error || s.error)); setList(null); setSummary(null); return; }
    setSetupError('');
    setList(Array.isArray(l.data) ? l.data : []);
    setSummary(s.data || null);
  }

  useEffect(() => { load(); }, []);

  const mode = summary ? summary.mode : null;
  const isOpen = mode !== 'allowlist';
  const cap = summary && Number.isFinite(summary.cap) ? summary.cap : 9;
  const listed = list ? list.length : 0;

  async function flipMode() {
    const next = isOpen ? 'allowlist' : 'open';
    setBusy(true); setMsg('');
    const res = await setWearableAccessMode(next);
    setBusy(false); setConfirmMode(false);
    if (res.error) { setMsg(accessErrorMessage(res.error)); return; }
    setSummary(res.data || summary);
    setMsg(next === 'allowlist'
      ? 'WHOOP and Oura connects are invite-only. Accounts already connected keep syncing.'
      : 'Anyone can connect WHOOP or Oura again.');
  }

  async function add(e) {
    e.preventDefault();
    const clean = cleanHandle(handle);
    if (!clean) { setMsg('That doesn’t look like a handle (3–20 letters, numbers or _).'); return; }
    setBusy(true); setMsg('');
    const res = await addWearableAccess(clean, cleanNote(note));
    setBusy(false);
    if (res.error) { setMsg(accessErrorMessage(res.error)); return; }
    setHandle(''); setNote('');
    setMsg(`@${clean} can connect WHOOP and Oura.`);
    load();
  }

  async function remove(row) {
    setBusy(true); setMsg('');
    const res = await removeWearableAccess(row.id);
    setBusy(false); setConfirmRemove(null);
    if (res.error) { setMsg(accessErrorMessage(res.error)); return; }
    setMsg(`${row.handle ? '@' + row.handle : 'Entry'} removed. If already connected, they keep syncing.`);
    load();
  }

  return (
    <SettingsGroup
      title="Wearable access"
      desc={`Who may connect WHOOP or Oura while they review Vantage. Each allows 10 accounts until it approves the app: you plus ${cap} on this list — keep one for WHOOP’s reviewer. You always have access, and accounts already connected are never cut off.`}
    >
      <div className="wx-panel">
        <div className="wx-mode-row">
          <span className={'wx-pill' + (isOpen ? '' : ' wx-pill-locked')} aria-live="polite">
            {mode === null ? 'Mode unknown' : isOpen ? 'Open to everyone' : `Invite-only · ${listed} of ${cap} invited`}
          </span>
          {summary && !setupError && !confirmMode && (
            <button type="button" className="m-profile-btn" disabled={busy} onClick={() => { setConfirmMode(true); setMsg(''); }}>
              {isOpen ? 'Make connects invite-only…' : 'Reopen connects to everyone…'}
            </button>
          )}
        </div>
        {summary && (
          <p className="wx-counts">
            Connected now: {summary.whoop_connected} WHOOP · {summary.oura_connected} Oura
          </p>
        )}

        {confirmMode && (
          <div className="wx-confirm" role="alertdialog" aria-label="Confirm wearable access change">
            <p className="wx-confirm-text">
              {isOpen
                ? `Only you and the ${listed} ${listed === 1 ? 'account' : 'accounts'} on the list can start a WHOOP or Oura connect. Everyone else is told it’s limited while the providers review Vantage. Nobody already connected loses anything.`
                : 'Any signed-in account can connect WHOOP or Oura again — the providers will refuse past their own limit of 10.'}
            </p>
            <div className="wx-confirm-actions">
              <button type="button" className="m-profile-btn" onClick={() => setConfirmMode(false)} disabled={busy}>Cancel</button>
              <button type="button" className={'m-profile-btn ' + (isOpen ? 'm-profile-btn-danger' : 'm-profile-btn-primary')} onClick={flipMode} disabled={busy}>
                {busy ? 'Saving…' : isOpen ? 'Yes, invite-only' : 'Yes, reopen'}
              </button>
            </div>
          </div>
        )}

        {setupError && <p className="wx-msg wx-msg-warn" role="status">{setupError}</p>}
        {msg && <p className="wx-msg" role="status">{msg}</p>}

        {!setupError && (
          <form className="wx-add" onSubmit={add}>
            <label className="wx-label" htmlFor="wx-handle">Invite by handle</label>
            <div className="wx-add-row">
              <input id="wx-handle" className="m-profile-input" type="text" autoComplete="off" autoCapitalize="off"
                placeholder="@handle" value={handle} onChange={e => setHandle(e.target.value)} maxLength={21} />
              <input className="m-profile-input" type="text" placeholder="note (optional)" aria-label="Note"
                value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
              <button type="submit" className="m-profile-btn m-profile-btn-primary" disabled={busy || !handle.trim() || listed >= cap}>Add</button>
            </div>
          </form>
        )}

        {list && (
          list.length === 0 ? (
            <p className="wx-empty">Nobody on the list yet.</p>
          ) : (
            <ul className="wx-list" aria-label="Accounts that may connect WHOOP or Oura">
              {list.map(row => (
                <li key={row.id} className="wx-row">
                  <div className="wx-row-main">
                    <span className="wx-row-name">{row.handle ? `@${row.handle}` : '(no handle)'}{row.display_name ? ` · ${row.display_name}` : ''}</span>
                    <span className="wx-row-meta">{row.note ? `${row.note} · ` : ''}added {fmtDate(row.added_at)}</span>
                  </div>
                  {confirmRemove === row.id ? (
                    <span className="wx-row-actions">
                      <button type="button" className="m-profile-btn" onClick={() => setConfirmRemove(null)} disabled={busy}>Keep</button>
                      <button type="button" className="m-profile-btn m-profile-btn-danger" onClick={() => remove(row)} disabled={busy}>Remove</button>
                    </span>
                  ) : (
                    <button type="button" className="m-profile-btn" onClick={() => setConfirmRemove(row.id)} disabled={busy}
                      aria-label={`Remove ${row.handle || 'entry'}`}>Remove</button>
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
