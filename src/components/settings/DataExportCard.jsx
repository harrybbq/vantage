import { useState } from 'react';
import Icon from '../Icon';
import SettingsGroup from './SettingsGroup';
import { encryptExport, decryptExport, passphraseStrength } from '../../lib/data/exportCrypto';
import { collectAccountData } from '../../lib/data/accountExport';
import { saveExport } from '../../lib/data/saveExport';
import { isNativeApp, apiBase } from '../../lib/native/platform';

/**
 * Export my data.
 *
 * The encrypted path is the default and the plain one is a deliberate
 * second choice, rather than the other way round. Portability still
 * works either way: the plain file is one click behind a confirmation,
 * and an encrypted file can be opened again right here, so it never
 * becomes a blob you can't do anything with.
 *
 * What's in it (keep INCLUDED and the plain-text confirm in step with
 * this): the app data in `S`, plus the rows that live in their own
 * tables — the food log, your profile, your friendships and the messages
 * you sent or received. A table that can't be read is named in the file
 * (`missing`) rather than silently left out.
 */
const INCLUDED = 'Your app data (vitals, habits, trackers, savings, boards and settings), your food log, '
  + 'your profile, your friend list and your messages.';

// Getting the file out (item 67 / pack P7). On the web it downloads, as
// it always has. In the iOS/Android app `<a download>` does nothing, so
// the file goes to the system share sheet (Save to Files, Drive, mail…)
// — from its own button, because navigator.share needs a fresh tap and
// building + encrypting the file can outlast the first one. Android's
// WebView has no navigator.share at all; until @capacitor/share and
// @capacitor/filesystem are added (native setup), the card says so and
// points at the website. lib/data/saveExport.js has the details.
function shareUnavailableText() {
  return `This device can't save files from inside the app yet. Sign in at ${apiBase().replace(/^https?:\/\//, '')} `
    + 'and export from Settings → Account → Your data — it downloads there.';
}

function stamp() {
  return new Date().toISOString().split('T')[0];
}

async function envelopeFor(S, userId) {
  const { tables, missing } = await collectAccountData(userId);
  return {
    exportedAt: new Date().toISOString(),
    appVersion: 'Vantage v1',
    data: S,
    tables,
    ...(missing.length ? { missing } : {}),
  };
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

export default function DataExportCard({ S, userId, onOpenLegal }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);      // { kind: 'ok'|'err', text }
  const [openMode, setOpenMode] = useState(false);
  const [openPass, setOpenPass] = useState('');
  const [openFile, setOpenFile] = useState(null);

  // { name, text, ok } — a file built in the app, waiting for the tap
  // that opens the share sheet. Never set on the web.
  const [pending, setPending] = useState(null);

  const native = isNativeApp();
  const shareMissing = native && (typeof navigator === 'undefined' || typeof navigator.share !== 'function');

  const strength = passphraseStrength(pass);
  const mismatch = confirm.length > 0 && confirm !== pass;
  const canEncrypt = pass.length >= 8 && !mismatch && !busy;

  // Web: download now. App: hold the file for the share button.
  // `ok(verb)` is the success message, verb = 'Downloaded' | 'Saved'.
  async function deliver(name, text, ok) {
    if (native) {
      setPending({ name, text, ok });
      setMsg(null);
      return true;
    }
    const r = await saveExport(name, text);
    if (r === 'downloaded') { setMsg({ kind: 'ok', text: ok('Downloaded') }); return true; }
    setMsg({ kind: 'err', text: 'Could not save the file. Please try again.' });
    return false;
  }

  // Called straight from the click so the share sheet gets the tap.
  async function handleShare() {
    if (!pending) return;
    const r = await saveExport(pending.name, pending.text);
    if (r === 'shared') { setMsg({ kind: 'ok', text: pending.ok('Saved') }); setPending(null); }
    else if (r === 'cancelled') { /* sheet closed; the file stays ready */ }
    else if (r === 'unsupported') { setMsg({ kind: 'err', text: shareUnavailableText() }); setPending(null); }
    else setMsg({ kind: 'err', text: 'Could not open the share sheet. Try again.' });
  }

  function guardShare() {
    if (!shareMissing) return false;
    setMsg({ kind: 'err', text: shareUnavailableText() });
    return true;
  }

  async function handleEncrypted() {
    if (guardShare()) return;
    setBusy(true); setMsg(null);
    try {
      const env = await encryptExport(await envelopeFor(S, userId), pass);
      const done = await deliver(`vantage-export-${stamp()}.vantage.json`, JSON.stringify(env, null, 2),
        verb => `${verb}. Keep the passphrase somewhere safe — it is the only way back in.`);
      if (done) { setPass(''); setConfirm(''); }
    } catch (e) {
      setMsg({ kind: 'err', text: e.message || 'Could not encrypt the export.' });
    } finally {
      setBusy(false);
    }
  }

  async function handlePlain() {
    const ok = window.confirm(
      'Export without a passphrase?\n\nThe file will contain your app data (weight and vitals history, habits, '
      + 'trackers, savings and settings), everything in your food log, your profile, your friend list and '
      + 'every message you have sent or received — readable by anything that opens it.',
    );
    if (!ok) return;
    if (guardShare()) return;
    setBusy(true); setMsg(null);
    try {
      await deliver(`vantage-export-${stamp()}.json`, JSON.stringify(await envelopeFor(S, userId), null, 2),
        verb => `${verb} as plain text.`);
    } catch (e) {
      setMsg({ kind: 'err', text: e.message || 'Could not build the export.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen() {
    if (!openFile) return;
    if (guardShare()) return;
    setBusy(true); setMsg(null);
    try {
      const env = JSON.parse(await openFile.text());
      const data = await decryptExport(env, openPass);
      const done = await deliver(`vantage-export-${stamp()}-decrypted.json`, JSON.stringify(data, null, 2),
        () => 'Opened and saved as a readable copy.');
      if (done) { setOpenPass(''); setOpenFile(null); setOpenMode(false); }
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
      <p className="dx-note" style={{ marginTop: 0 }}>Includes: {INCLUDED}</p>

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
            {busy ? 'Encrypting…' : native ? 'Create encrypted file' : 'Download encrypted file'}
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

      {pending && (
        <div className="dx-msg dx-msg-ok" role="status">
          <div style={{ marginBottom: 10 }}>Your file is ready: {pending.name}</div>
          <button className="dx-primary" onClick={handleShare}>
            <Icon name="download" size={15} />
            Save or share the file
          </button>
          <div className="dx-alts">
            <button className="dx-link" onClick={() => setPending(null)}>Discard</button>
          </div>
        </div>
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
