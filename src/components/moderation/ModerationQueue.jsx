/**
 * The report queue: what people reported, and the owner's decision on
 * each (Apple 1.2 — "a mechanism to report… and timely responses").
 *
 * Renders in Upgrade → Security → Moderation, which is owner-gated in
 * the UI only. The gate that matters is on the server:
 * /.netlify/functions/moderation (and security-console, for bans)
 * verify the JWT and the owner's email before they answer. Nothing here
 * reads `reports` directly — RLS gives clients no read on it, correctly.
 *
 * Decisions, each confirmed inline (press, then confirm — with an
 * optional note kept with the report):
 *   Dismiss  — nothing wrong; the report closes.
 *   Suspend  — the report was right; the account is hidden from the
 *              leaderboard, search, trending and group boards
 *              server-side. Reversible from the suspended list.
 *   Ban      — suspend AND an auth-level ban (they cannot sign in).
 *              Goes through security-console's user.ban; reversible.
 *
 * Until the function is deployed (or its SQL run) the endpoint answers
 * 501/404, and the panel says "not installed" rather than looking empty
 * or broken — see lib/moderation/queue.js.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../Icon';
import { authFetch } from '../../lib/authFetch';
import { readQueueResponse, openCounts, sortQueue } from '../../lib/moderation/queue';
import { postAction } from '../../lib/security/api';

const ENDPOINT = '/.netlify/functions/moderation';

const WHERE_LABEL = {
  leaderboard: 'Leaderboard',
  group: 'Group board',
  messages: 'Messages',
  'friend-card': 'Friend card',
};

const VERB = {
  dismiss: { label: 'Dismiss', confirm: 'Confirm dismiss', note: 'Why (optional)' },
  suspend: { label: 'Suspend', confirm: 'Confirm suspend', note: 'What was wrong (kept with the report)' },
  ban: {
    label: 'Ban sign-in', confirm: 'Confirm ban', note: 'Why (kept with the report)',
    // Supabase's ban blocks sign-in and token refresh but does not end
    // a live session: an issued access token works until it expires.
    sub: 'Existing session may last up to an hour; they’re hidden everywhere immediately.',
  },
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

async function postModeration(body) {
  const res = await authFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readQueueResponse(res.status, await res.text());
}

/**
 * @param {{ className?: string, onChanged?: () => void }} props
 *   className — extra classes on the wrapper (the console's card).
 *   onChanged — called after any decision, so a parent can refresh
 *               counts or its suspended list.
 */
export default function ModerationQueue({ className = '', onChanged } = {}) {
  const [state, setState] = useState('loading');   // loading | ok | not-installed | forbidden | error
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState(() => new Set()); // expanded contexts
  const [pending, setPending] = useState(null);      // { id, verb, note }

  const load = useCallback(async (p = 0) => {
    setError(null);
    try {
      const res = await authFetch(`${ENDPOINT}${p ? `?page=${p}` : ''}`);
      const out = readQueueResponse(res.status, await res.text());
      setState(out.state);
      setReports(list => (p ? [...list, ...out.reports.filter(r => !list.some(x => x.id === r.id))] : out.reports));
      setTotal(out.total ?? null);
      setPage(p);
      if (out.error) setError(out.error);
    } catch {
      setState('error');
      setError("Couldn't reach the server.");
    }
  }, []);

  useEffect(() => { load(0); }, [load]);

  async function decide(r, verb, note) {
    setBusyId(r.id);
    setError(null);
    const clean = (note || '').trim();
    try {
      if (verb === 'ban') {
        const ban = await postAction({ action: 'user.ban', userId: r.reportedId, on: true, note: clean || undefined });
        if (!ban.ok) throw new Error(ban.error);
      }
      const out = await postModeration(verb === 'dismiss'
        ? { id: r.id, action: 'dismiss', note: clean || undefined }
        : { id: r.id, action: 'action', suspend: verb === 'suspend', note: clean || (verb === 'ban' ? 'Banned' : undefined) });
      if (out.state === 'not-installed') { setState('not-installed'); return; }
      if (out.state !== 'ok') throw new Error(out.error || 'Could not record that.');
      const status = verb === 'dismiss' ? 'dismissed' : 'actioned';
      const hits = verb === 'suspend' || verb === 'ban';
      setReports(list => list.map(x => {
        if (x.id === r.id) return { ...x, status, note: clean || x.note };
        if (hits && x.reportedId && x.reportedId === r.reportedId) return { ...x, suspended: true, banned: x.banned || verb === 'ban' };
        return x;
      }));
      setPending(null);
      if (onChanged) onChanged();
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
  const more = total != null && reports.length < total;
  // `total` is the open count when the page loaded; decisions since then
  // closed some of the loaded rows.
  const openTotal = total != null ? Math.max(openN, total - (reports.length - openN)) : openN;

  if (state === 'not-installed') {
    return (
      <div className={`upg-review mod-queue ${className}`}>
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
    <div className={`upg-review mod-queue ${className}`}>
      <div className="upg-review-head">
        <div>
          <div className="upg-review-title">
            Reports{state === 'ok' ? ` · ${openTotal} open` : ''}
          </div>
          <p className="upg-review-sub">
            What people reported from friend cards, messages, the leaderboard and group boards.
            Aim to decide within 24 hours. Suspending hides the account everywhere public; banning
            also stops it signing in. Both can be lifted.
          </p>
        </div>
        <div className="mod-head-acts">
          <label className="mod-closed-toggle">
            <input type="checkbox" checked={showClosed} onChange={() => setShowClosed(v => !v)} />
            Show closed
          </label>
          <button type="button" className="btn btn-sm" onClick={() => load(0)}>
            <Icon name="rotate-ccw" size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="upg-review-error" role="alert">{error}</div>}
      {state === 'loading' && <p className="upg-review-empty">Loading…</p>}
      {state === 'ok' && shown.length === 0 && !error && (
        <p className="upg-review-empty">{showClosed ? 'No reports yet.' : 'Nothing open. That is the normal state.'}</p>
      )}

      {shown.map(r => {
        const repeat = r.reportedId ? counts.get(r.reportedId) || 0 : 0;
        const expanded = open.has(r.id);
        const msgs = r.messages || [];
        const long = (r.context || '').length > 160 || msgs.length > 0;
        const ask = pending && pending.id === r.id ? pending : null;
        return (
          <div key={r.id} className={`mod-row is-${r.status}${repeat > 1 ? ' is-repeat' : ''}`}>
            <div className="mod-main">
              <div className="mod-who">
                <span className="mod-name">{r.name || (r.handle ? `@${r.handle}` : 'Unknown')}</span>
                {r.handle && r.name && <span className="mod-handle">@{r.handle}</span>}
                {r.deleted && <span className="mod-tag is-muted">Account deleted</span>}
                {r.banned && <span className="mod-tag is-bad">Banned</span>}
                {r.suspended && !r.banned && <span className="mod-tag is-bad">Suspended</span>}
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
                <div className={`mod-context${expanded || (r.context || '').length <= 160 ? ' is-open' : ''}`}>{r.context}</div>
              )}
              {expanded && msgs.length > 0 && (
                <ol className="mod-msgs" aria-label="Messages between the two, oldest first">
                  {msgs.map((m, i) => (
                    <li key={i} className={`is-${m.from}`}>
                      <b>{m.from === 'reported' ? (r.handle ? `@${r.handle}` : 'Reported') : (r.reporter ? `@${r.reporter}` : 'Reporter')}</b>
                      <span>{m.body}</span>
                    </li>
                  ))}
                </ol>
              )}
              {/* Outside the clamped box, or the clamp hides it too. */}
              {long && (
                <button type="button" className="mod-more" onClick={() => setOpen(s => {
                  const next = new Set(s);
                  if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                  return next;
                })}>{expanded ? 'Show less' : msgs.length ? `Show evidence · ${msgs.length} message${msgs.length === 1 ? '' : 's'}` : 'Show all'}</button>
              )}
              {r.note && r.status !== 'open' && <div className="mod-note">Note: {r.note}</div>}
              {ask && (
                <div className={`mod-ask is-${ask.verb}`}>
                  <input
                    type="text" maxLength={500} value={ask.note} placeholder={VERB[ask.verb].note}
                    aria-label={VERB[ask.verb].note}
                    onChange={e => setPending({ ...ask, note: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') decide(r, ask.verb, ask.note); if (e.key === 'Escape') setPending(null); }}
                  />
                  <button type="button" className={`btn btn-sm mod-confirm is-${ask.verb}`} disabled={busyId === r.id}
                          onClick={() => decide(r, ask.verb, ask.note)}>
                    {busyId === r.id ? 'Working…' : VERB[ask.verb].confirm}
                  </button>
                  <button type="button" className="btn btn-sm mod-cancel" onClick={() => setPending(null)}>Cancel</button>
                  {VERB[ask.verb].sub && <span className="mod-ask-sub">{VERB[ask.verb].sub}</span>}
                </div>
              )}
            </div>
            {r.status === 'open' && !ask && (
              <div className="mod-acts">
                <button type="button" className="btn btn-sm" disabled={busyId === r.id}
                        onClick={() => setPending({ id: r.id, verb: 'dismiss', note: '' })}>
                  Dismiss
                </button>
                {!r.deleted && !r.suspended && (
                  <button type="button" className="btn btn-sm mod-act" disabled={busyId === r.id}
                          onClick={() => setPending({ id: r.id, verb: 'suspend', note: '' })}>
                    Suspend
                  </button>
                )}
                {!r.deleted && !r.banned && (
                  <button type="button" className="btn btn-sm mod-act is-ban" disabled={busyId === r.id}
                          onClick={() => setPending({ id: r.id, verb: 'ban', note: '' })}>
                    {VERB.ban.label}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {more && (
        <button type="button" className="btn btn-sm mod-more-page" onClick={() => load(page + 1)}>
          Load more · {reports.length} of {total}
        </button>
      )}
    </div>
  );
}
