import { useState } from 'react';
import Icon from '../Icon';
import SettingsGroup from './SettingsGroup';
import { encryptExport, decryptExport, passphraseStrength } from '../../lib/data/exportCrypto';

/**
 * Export my data.
 *
 * The encrypted path is the default and the plain one is a deliberate
 * second choice, rather than the other way round. Portability still
 * works either way: the plain file is one click behind a confirmation,
 * and an encrypted file can be opened again right here, so it never
 * becomes a blob you can't do anything with.
 */

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function stamp() {
  return new Date().toISOString().split('T')[0];
}

function envelopeFor(S) {
  return { exportedAt: new Date().toISOString(), appVersion: 'Vantage v1', data: S };
}

function summarise(S) {
  const n = o => Object.keys(o || {}).length;
  const bits = [];
  const days = n(S?.vitalsLog);
  if (days) bits.push(`${days} days of vitals`);
  if ((S?.achievements || []).length) bits.push(`${S.achievements.length} achievements`);
  if ((S?.savings || []).length) bits.push(`${S.savings.length} savings goals`);
  if ((S?.habits || []).length) bits.push(`${S.habits.length} habits`);
  if ((S?.trackers || []).length) bits.push(`${S.trackers.length} trackers`);
  return bits.length ? bits.join(' · ') : 'Everything you have logged';
}

export default function DataExportCard({ S, onOpenLegal }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);      // { kind: 'ok'|'err', text }
  const [openMode, setOpenMode] = useState(false);
  const [openPass, setOpenPass] = useState('');
  const [openFile, setOpenFile] = useState(null);

  const strength = passphraseStrength(pass);
  const mismatch = confirm.length > 0 && confirm !== pass;
  const canEncrypt = pass.length >= 8 && !mismatch && !busy;

  async function handleEncrypted() {
    setBusy(true); setMsg(null);
    try {
      const env = await encryptExport(envelopeFor(S), pass);
      download(`vantage-export-${stamp()}.vantage.json`, JSON.stringify(env, null, 2));
      setPass(''); setConfirm('');
      setMsg({ kind: 'ok', text: 'Downloaded. Keep the passphrase somewhere safe — it is the only way back in.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e.message || 'Could not encrypt the export.' });
    } finally {
      setBusy(false);
    }
  }

  function handlePlain() {
    const ok = window.confirm(
      'Export without a passphrase?\n\nThe file will contain your weight history, everything you have eaten, '
      + 'your savings goals and your habits, readable by anything that opens it.',
    );
    if (!ok) return;
    download(`vantage-export-${stamp()}.json`, JSON.stringify(envelopeFor(S), null, 2));
    setMsg({ kind: 'ok', text: 'Downloaded as plain text.' });
  }

  async function handleOpen() {
    if (!openFile) return;
    setBusy(true); setMsg(null);
    try {
      const env = JSON.parse(await openFile.text());
      const data = await decryptExport(env, openPass);
      download(`vantage-export-${stamp()}-decrypted.json`, JSON.stringify(data, null, 2));
      setOpenPass(''); setOpenFile(null); setOpenMode(false);
      setMsg({ kind: 'ok', text: 'Opened and saved as a readable copy.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e.message || 'Could not open that file.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsGroup title="Your data">
      <p className="dx-sub">
        {summarise(S)}. Yours to take at any time — this is your right to data
        portability under UK GDPR.
      </p>

      {!openMode && (
        <>
          <div className="dx-fields">
            <label className="dx-field">
              <span>Passphrase</span>
              <input
                type="password" autoComplete="new-password" value={pass}
                onChange={e => setPass(e.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            <label className="dx-field">
              <span>Confirm</span>
              <input
                type="password" autoComplete="new-password" value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Type it again"
                aria-invalid={mismatch || undefined}
              />
            </label>
          </div>

          <div className="dx-meta">
            {mismatch
              ? <span className="dx-warn">Those do not match.</span>
              : strength.label
                ? <span className={`dx-strength dx-strength-${strength.score}`}>{strength.label}</span>
                : <span className="dx-hint">A few unrelated words beats one clever one.</span>}
          </div>

          <p className="dx-note">
            The passphrase never leaves this device and we do not keep a copy.
            If you lose it the file cannot be opened — not by us either.
          </p>

          <button className="dx-primary" onClick={handleEncrypted} disabled={!canEncrypt}>
            <Icon name="download" size={15} />
            {busy ? 'Encrypting…' : 'Download encrypted file'}
          </button>

          <div className="dx-alts">
            <button className="dx-link" onClick={handlePlain} disabled={busy}>
              Export as plain text instead
            </button>
            <button className="dx-link" onClick={() => { setOpenMode(true); setMsg(null); }} disabled={busy}>
              Open an encrypted export
            </button>
          </div>
        </>
      )}

      {openMode && (
        <>
          <div className="dx-fields">
            <label className="dx-field dx-field-wide">
              <span>Encrypted file</span>
              <input type="file" accept=".json,application/json"
                     onChange={e => setOpenFile(e.target.files?.[0] || null)} />
            </label>
            <label className="dx-field">
              <span>Passphrase</span>
              <input type="password" value={openPass} autoComplete="current-password"
                     onChange={e => setOpenPass(e.target.value)} />
            </label>
          </div>
          <p className="dx-note">
            Decrypts on this device and saves a readable copy. Nothing is uploaded.
          </p>
          <button className="dx-primary" onClick={handleOpen} disabled={!openFile || !openPass || busy}>
            <Icon name="download" size={15} />
            {busy ? 'Opening…' : 'Open and save a readable copy'}
          </button>
          <div className="dx-alts">
            <button className="dx-link" onClick={() => { setOpenMode(false); setMsg(null); }}>
              Back to export
            </button>
          </div>
        </>
      )}

      {msg && (
        <div className={`dx-msg dx-msg-${msg.kind}`} role="status">{msg.text}</div>
      )}

      {onOpenLegal && (
        <div className="dx-legal">
          <button onClick={() => onOpenLegal('privacy')}>Privacy Policy</button>
          <button onClick={() => onOpenLegal('terms')}>Terms of Service</button>
        </div>
      )}
    </SettingsGroup>
  );
}
