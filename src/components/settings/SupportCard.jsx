import { useState } from 'react';
import Icon from '../Icon';
import SettingsGroup from './SettingsGroup';
import { authFetch } from '../../lib/authFetch';

/**
 * Settings → Account → Report a problem.
 *
 * The support channel the app stores ask for. Lands as a ticket in the
 * owner's Security console (netlify/functions/support-ticket.js →
 * public.security_tickets). Five a day per account, enforced server-side.
 *
 * Sends only what is typed here plus the page path — nothing from the
 * user's app state. Disclosed in the privacy policy (section 2).
 */
const CATEGORIES = [
  ['bug', 'Something is broken'],
  ['account', 'Account or sign-in'],
  ['privacy', 'Privacy or my data'],
  ['abuse', 'Someone is abusing the app'],
  ['other', 'Something else'],
];
const TITLE_MAX = 120;
const BODY_MAX = 2000;

// Same look as the export card's inputs (.dx-field input).
const boxStyle = {
  width: '100%', background: 'var(--bg-base, rgba(0,0,0,.05))',
  border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px',
  color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 13.5, outline: 'none',
  boxSizing: 'border-box',
};

export default function SupportCard() {
  const [category, setCategory] = useState('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { kind: 'ok'|'err', text }

  const canSend = title.trim().length >= 3 && !busy;

  async function send() {
    setBusy(true); setMsg(null);
    try {
      const res = await authFetch('/.netlify/functions/support-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          title: title.trim().slice(0, TITLE_MAX),
          body: body.trim().slice(0, BODY_MAX),
          page: typeof window !== 'undefined' ? window.location.pathname : null,
        }),
      });
      let out = {};
      try { out = await res.json(); } catch { /* no body */ }
      if (res.ok && out.ok) {
        setTitle(''); setBody('');
        setMsg({ kind: 'ok', text: 'Sent. Thank you — it goes straight to the people who build Vantage.' });
      } else {
        setMsg({ kind: 'err', text: out.error || 'Could not send right now — try again later.' });
      }
    } catch {
      setMsg({ kind: 'err', text: 'Could not send right now — check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsGroup
      title="Report a problem"
      desc="Something broken, confusing or wrong? Tell us here. We read every report."
    >
      <div className="dx-fields">
        <label className="dx-field">
          <span>What is it about</span>
          <select value={category} onChange={e => setCategory(e.target.value)} style={boxStyle}>
            {CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="dx-field">
          <span>Title</span>
          <input
            type="text" value={title} maxLength={TITLE_MAX}
            onChange={e => setTitle(e.target.value)}
            placeholder="A few words"
          />
        </label>
        <label className="dx-field dx-field-wide">
          <span>Details</span>
          <textarea
            value={body} maxLength={BODY_MAX} rows={4}
            onChange={e => setBody(e.target.value)}
            placeholder="What happened, and what did you expect?"
            style={{ ...boxStyle, resize: 'vertical', minHeight: 90, lineHeight: 1.5 }}
          />
        </label>
      </div>
      <div className="dx-meta">
        <span className="dx-hint">{body.length} / {BODY_MAX}</span>
      </div>
      <p className="dx-note">
        We receive what you type, the category and the page you are on, linked to your account so we can
        follow up. Please do not include passwords or card numbers.
      </p>
      <button className="dx-primary" onClick={send} disabled={!canSend}>
        <Icon name="ticket" size={15} />
        {busy ? 'Sending…' : 'Send report'}
      </button>
      {msg && <div className={`dx-msg dx-msg-${msg.kind}`} role="status">{msg.text}</div>}
    </SettingsGroup>
  );
}
