/**
 * Re-screen profile pictures published before screening existed
 * (STARTUP_REQUIREMENTS item 112; Online Safety Act draft X4).
 *
 * One button screens the next few never-screened pictures with the same
 * image screen avatar-check uses (netlify/lib/avatarRescreen.js): a small
 * batch per press, the owner's daily AI cap as the ceiling, nothing
 * written when the screen can't decide. A rejection only FLAGS the
 * picture — it appears below, and a person keeps or removes it. Removing
 * goes through the same reset as the report queue: audited, sticky, the
 * user told (never why in a way that points at anyone).
 *
 * Owner-gated in the UI; the moderation function checks the owner on the
 * server. Until supabase/safety_2026_10b.sql is run it says so.
 */
import { useCallback, useEffect, useState } from 'react';
import Icon from '../../Icon';
import { authFetch } from '../../../lib/authFetch';

const ENDPOINT = '/.netlify/functions/moderation';

async function call(path, init) {
  const res = await authFetch(path, init);
  const text = await res.text();
  if (/^\s*<(?:!doctype|html)/i.test(text)) return { status: 404, body: {} };
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  return { status: res.status, body };
}

const post = body => call(ENDPOINT, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export default function AvatarRescreen({ className = '', onChanged }) {
  const [state, setState] = useState('loading');   // loading | ok | not-installed | error
  const [status, setStatus] = useState(null);
  const [flagged, setFlagged] = useState([]);
  const [busy, setBusy] = useState(null);           // 'run' | userId
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const take = useCallback((body) => {
    if (body.status) setStatus(body.status);
    if (Array.isArray(body.flagged)) setFlagged(body.flagged);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { status: code, body } = await call(`${ENDPOINT}?view=rescreen`);
      if (code === 501 || code === 404) { setState('not-installed'); return; }
      if (code !== 200) { setState('error'); setError(body.error || `Couldn't load (HTTP ${code}).`); return; }
      take(body);
      setState('ok');
    } catch {
      setState('error');
      setError("Couldn't reach the server.");
    }
  }, [take]);

  useEffect(() => { load(); }, [load]);

  async function run() {
    setBusy('run'); setError(null); setResult(null);
    try {
      const { status: code, body } = await post({ action: 'rescreen' });
      if (code === 501) { setState('not-installed'); return; }
      if (code !== 200) { setError(body.error || `Screening failed (HTTP ${code}).`); return; }
      take(body);
      const bits = [`${body.screened || 0} screened`, `${body.newlyFlagged || 0} flagged`];
      if (body.pending) bits.push(`${body.pending} couldn't be decided — they stay in the backlog`);
      if (body.capped) bits.push("today's screening cap is reached — try again tomorrow");
      setResult(bits.join(' · ') + '.');
      if (onChanged) onChanged();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(f, decision) {
    if (decision === 'remove' && !window.confirm(`Remove ${f.name || (f.handle ? `@${f.handle}` : 'this')}'s picture? Others will see initials; they'll be told and can choose another.`)) return;
    setBusy(f.userId); setError(null);
    try {
      const { status: code, body } = await post({ action: 'avatar', userId: f.userId, decision });
      if (code !== 200) { setError(body.error || `Couldn't record that (HTTP ${code}).`); return; }
      setFlagged(list => list.filter(x => x.userId !== f.userId));
      setStatus(s => (s ? { ...s, flagged: Math.max(0, (s.flagged || 0) - 1) } : s));
      if (body.warning) setResult(body.warning);
      if (onChanged) onChanged();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  }

  if (state === 'not-installed') {
    return (
      <div className={`upg-review ${className}`}>
        <div className="upg-review-title">Re-screen profile pictures</div>
        <p className="upg-review-empty">
          Needs <code>supabase/safety_2026_10b.sql</code> run (and the moderation function deployed).
          Pictures published before screening existed stay unscreened until then.
        </p>
      </div>
    );
  }

  const left = status ? Number(status.unscreened) || 0 : null;
  return (
    <div className={`upg-review ${className}`} data-sec-focus="avatars">
      <div className="upg-review-head">
        <div>
          <div className="upg-review-title">Re-screen profile pictures{flagged.length ? ` · ${flagged.length} flagged` : ''}</div>
          <p className="upg-review-sub">
            Pictures published before screening existed — or changed without it — run through the same
            screen as new ones, a few at a time. A flag doesn&apos;t remove anything: you keep or remove it.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={load} disabled={!!busy}>
          <Icon name="rotate-ccw" size={13} /> Refresh
        </button>
      </div>

      {status && (
        <div className="ars-stats">
          <span><b>{Number(status.withAvatar) || 0}</b> with a picture</span>
          <span><b>{left}</b> not screened</span>
          <span><b>{Number(status.flagged) || 0}</b> flagged</span>
        </div>
      )}
      {error && <div className="upg-review-error" role="alert">{error}</div>}
      {state === 'loading' && <p className="upg-review-empty">Loading…</p>}
      {state === 'ok' && (
        <div>
          <button type="button" className="btn btn-sm" onClick={run} disabled={!!busy || left === 0}>
            {busy === 'run' ? 'Screening…' : left === 0 ? 'All screened' : 'Screen the next 4'}
          </button>
        </div>
      )}
      {result && <p className="ars-result" role="status">{result}</p>}

      {flagged.map(f => (
        <div key={f.userId} className="ars-row">
          {f.avatarUrl ? <img className="ars-img" src={f.avatarUrl} alt="" /> : <div className="ars-img" />}
          <div className="ars-meta">
            <div className="ars-name">{f.name || (f.handle ? `@${f.handle}` : 'Unknown')}{f.handle && f.name ? <span className="mod-handle"> @{f.handle}</span> : null}</div>
            <div className="ars-why">Screen said: {f.reason || 'not approved'}</div>
          </div>
          <div className="ars-acts">
            <button type="button" className="btn btn-sm" disabled={busy === f.userId} onClick={() => decide(f, 'keep')}>Keep</button>
            <button type="button" className="btn btn-sm mod-act" disabled={busy === f.userId} onClick={() => decide(f, 'remove')}>Remove picture</button>
          </div>
        </div>
      ))}
    </div>
  );
}
