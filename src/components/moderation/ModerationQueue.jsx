/**
 * The report queue: what people reported, and the owner's decision on
 * each (Apple 1.2 — "a mechanism to report… and timely responses").
 *
 * Renders beside the group-picture queue in Upgrade → Review, which is
 * owner-gated in the UI only. The gate that matters is on the server:
 * /.netlify/functions/moderation verifies the JWT and the owner's email
 * before it answers, exactly like `crestQueue`. Nothing here reads
 * `reports` directly — RLS gives clients no read on it, correctly.
 *
 * Decisions:
 *   Dismiss  — nothing wrong; the report closes.
 *   Action   — the report was right. Optionally suspend the account,
 *              which hides it from the leaderboard, search, trending and
 *              group boards server-side. A note records what was done.
 *
 * Until the function is deployed (or its SQL run) the endpoint answers
 * 501/404, and the panel says "not installed" rather than looking empty
 * or broken — see lib/moderation/queue.js.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../Icon';
import { authFetch } from '../../lib/authFetch';
import { readQueueResponse, openCounts, sortQueue } from '../../lib/moderation/queue';

const ENDPOINT = '/.netlify/functions/moderation';

const WHERE_LABEL = {
  leaderboard: 'Leaderboard',
  group: 'Group board',
  messages: 'Messages',
  'friend-card': 'Friend card',
};

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = Math.floor((Date.now() - d.getTime()) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function ModerationQueue() {
  const [state, setState] = useState('loading');   // loading | ok | not-installed | forbidden | error
  const [reports, setReports] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState(() => new Set()); // expanded contexts

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authFetch(ENDPOINT);
      const out = readQueueResponse(res.status, await res.text());
      setState(out.state);
      setReports(out.reports);
      if (out.error) setError(out.error);
    } catch {
      setState('error');
      setError("Couldn't reach the server.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(r, action) {
    const who = r.name || (r.handle ? `@${r.handle}` : 'this account');
    let suspend = false;
    let note = null;
    if (action === 'action') {
      if (!r.deleted && !r.suspended) {
        suspend = window.confirm(`Suspend ${who} as well?\n\nOK suspends (hidden from the leaderboard, search, trending and group boards). Cancel records the action without suspending.`);
      }
      note = window.prompt('What was done? (kept with the report)', r.note || '');
      if (note === null) return;
    } else {
      note = window.prompt('Dismiss — optional note', '');
      if (note === null) return;
    }
    setBusyId(r.id);
    setError(null);
    try {
      const res = await authFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r.id, action, suspend, note: note.trim() || undefined }),
      });
      const out = readQueueResponse(res.status, await res.text());
      if (out.state === 'not-installed') { setState('not-installed'); return; }
      if (out.state !== 'ok') throw new Error(out.error || 'Could not record that.');
      const status = action === 'dismiss' ? 'dismissed' : 'actioned';
      setReports(list => list.map(x => {
        if (x.id === r.id) return { ...x, status, note: note.trim() || x.note };
        if (suspend && x.reportedId && x.reportedId === r.reportedId) return { ...x, suspended: true };
        return x;
      }));
    } catch (e) {
      setError(e?.message || 'Could not record that.');
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => openCounts(reports), [reports]);
  const shown = useMemo(
    () => sortQueue(reports).filter(r => showClosed || r.status === 'open'),
    [reports, showClosed],
  );
  const openN = reports.filter(r => r.status === 'open').length;

  if (state === 'not-installed') {
    return (
      <div className="upg-review mod-queue">
        <div className="upg-review-title">Reports</div>
        <p className="upg-review-empty">
          The report queue isn&apos;t installed yet — it needs the <code>moderation</code> function
          deployed and <code>supabase/audit_schema_2026_10.sql</code> run. Reports are still being
          filed; they&apos;ll all be here once it is.
        </p>
      </div>
    );
  }

  return (
    <div className="upg-review mod-queue">
      <div className="upg-review-head">
        <div>
          <div className="upg-review-title">
            Reports{state === 'ok' ? ` · ${openN} open` : ''}
          </div>
          <p className="upg-review-sub">
            What people reported from friend cards, messages, the leaderboard and group boards.
            Aim to decide within 24 hours. Suspending hides the account everywhere public.
          </p>
        </div>
        <div className="mod-head-acts">
          <label className="mod-closed-toggle">
            <input type="checkbox" checked={showClosed} onChange={() => setShowClosed(v => !v)} />
            Show closed
          </label>
          <button type="button" className="btn btn-sm" onClick={load}>
            <Icon name="rotate-ccw" size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="upg-review-error">{error}</div>}
      {state === 'loading' && <p className="upg-review-empty">Loading…</p>}
      {state === 'ok' && shown.length === 0 && !error && (
        <p className="upg-review-empty">{showClosed ? 'No reports yet.' : 'Nothing open. That is the normal state.'}</p>
      )}

      {shown.map(r => {
        const repeat = r.reportedId ? counts.get(r.reportedId) || 0 : 0;
        const expanded = open.has(r.id);
        const long = (r.context || '').length > 160;
        return (
          <div key={r.id} className={`mod-row is-${r.status}`}>
            <div className="mod-main">
              <div className="mod-who">
                <span className="mod-name">{r.name || (r.handle ? `@${r.handle}` : 'Unknown')}</span>
                {r.handle && r.name && <span className="mod-handle">@{r.handle}</span>}
                {r.deleted && <span className="mod-tag is-muted">Account deleted</span>}
                {r.suspended && <span className="mod-tag is-bad">Suspended</span>}
                {repeat > 1 && <span className="mod-tag is-warn">{repeat} open reports</span>}
                {r.status !== 'open' && <span className="mod-tag is-muted">{r.status}</span>}
              </div>
              <div className="mod-meta">
                {r.reason || 'No reason given'}
                {r.where && ` · ${WHERE_LABEL[r.where] || r.where}`}
                {r.at && ` · ${when(r.at)}`}
                {r.reporter && ` · by @${r.reporter}`}
              </div>
              {r.context && (
                <div className={`mod-context${expanded || !long ? ' is-open' : ''}`}>{r.context}</div>
              )}
              {/* Outside the clamped box, or the clamp hides it too. */}
              {r.context && long && (
                <button type="button" className="mod-more" onClick={() => setOpen(s => {
                  const next = new Set(s);
                  if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                  return next;
                })}>{expanded ? 'Show less' : 'Show all'}</button>
              )}
              {r.note && r.status !== 'open' && <div className="mod-note">Note: {r.note}</div>}
            </div>
            {r.status === 'open' && (
              <div className="mod-acts">
                <button type="button" className="btn btn-sm" disabled={busyId === r.id} onClick={() => decide(r, 'dismiss')}>
                  Dismiss
                </button>
                <button type="button" className="btn btn-sm mod-act" disabled={busyId === r.id} onClick={() => decide(r, 'action')}>
                  Action
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
