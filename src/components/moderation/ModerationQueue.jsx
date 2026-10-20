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
 *   Resolve  — the report was right and you've dealt with it (e.g. reset
 *              their name) without suspending; the report closes.
 *   Suspend  — the report was right; the account is hidden from the
 *              leaderboard, search, trending and group boards, and can't
 *              send messages, reactions or friend requests (RLS,
 *              safety_2026_10b.sql). Reversible from the suspended list.
 *   Ban      — suspend AND an auth-level ban (they cannot sign in).
 *              Goes through security-console's user.ban; reversible.
 *   Reset    — clear their published display name / handle / picture
 *              (the Terms promise this). Audited and sticky: the app
 *              can't publish the same value again. Doesn't close the
 *              report — Resolve or Suspend after.
 *
 * Closing a report tells the reporter the outcome in-app; suspension and
 * resets tell the reported user — never who reported, and never for a
 * child-safety report (no tip-off). Urgent reasons (a child's safety,
 * threats, self-harm) sort to the top and carry a Priority tag.
 *
 * Until the function is deployed (or its SQL run) the endpoint answers
 * 501/404, and the panel says "not installed" rather than looking empty
 * or broken — see lib/moderation/queue.js.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../Icon';
import { authFetch } from '../../lib/authFetch';
import { readQueueResponse, openCounts, sortQueue, isStale } from '../../lib/moderation/queue';
import { postAction } from '../../lib/security/api';

const ENDPOINT = '/.netlify/functions/moderation';

const WHERE_LABEL = {
  leaderboard: 'Leaderboard',
  group: 'Group board',
  messages: 'Messages',
  'friend-card': 'Friend card',
  'friend-request': 'Friend request',
};

const RESET_FIELDS = [
  { id: 'display_name', label: 'Display name', has: r => r.hasName },
  { id: 'handle', label: 'Handle', has: r => r.hasHandle },
  { id: 'avatar', label: 'Picture', has: r => !!r.avatar },
];

const VERB = {
  dismiss: { label: 'Dismiss', confirm: 'Confirm dismiss', note: 'Why (optional)' },
  resolve: { label: 'Resolve', confirm: 'Confirm resolve', note: 'What you did (kept with the report)' },
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
 *   oldestFirst — longest-waiting first (asks the function for
 *               ?order=oldest, so the oldest are on the first page).
 *   staleHours — mark open reports older than this ("Waiting 3 days");
 *               the first gets data-sec-focus="stale" for the Security
 *               console's "go to source".
 */
export default function ModerationQueue({ className = '', onChanged, oldestFirst = false, staleHours = null } = {}) {
  const [state, setState] = useState('loading');   // loading | ok | not-installed | forbidden | error
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState(() => new Set()); // expanded contexts
  const [pending, setPending] = useState(null);      // { id, verb, note }
  const [resetAsk, setResetAsk] = useState(null);    // { id, fields: string[], note }

  const load = useCallback(async (p = 0) => {
    setError(null);
    try {
      const q = new URLSearchParams();
      if (p) q.set('page', String(p));
      if (oldestFirst) q.set('order', 'oldest');
      const qs = q.toString();
      const res = await authFetch(`${ENDPOINT}${qs ? `?${qs}` : ''}`);
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
  }, [oldestFirst]);

  useEffect(() => { load(0); }, [load]);

  async function decide(r, verb, note) {
    setBusyId(r.id);
    setError(null);
    const clean = (note || '').trim();
    try {
      if (verb === 'ban') {
        // A child-safety report never tells the reported person (no tip-off).
        const ban = await postAction({
          action: 'user.ban', userId: r.reportedId, on: true, note: clean || undefined,
          ...(r.reasonId === 'child' ? { notify: false } : {}),
        });
        if (!ban.ok) throw new Error(ban.error);
      }
      const out = await postModeration(verb === 'dismiss'
        ? { id: r.id, action: 'dismiss', note: clean || undefined }
        : { id: r.id, action: 'action', suspend: verb === 'suspend', note: clean || (verb === 'ban' ? 'Banned' : undefined) });
      if (out.state === 'not-installed') { setState('not-installed'); return; }
      if (out.state !== 'ok') throw new Error(out.error || 'Could not record that.');
      const status = verb === 'dismiss' ? 'dismissed' : 'actioned';
      const hits = verb === 'suspend' || verb === 'ban';
      const told = out.body && out.body.reporterTold ? 'Reporter told the outcome in-app.' : null;
      setReports(list => list.map(x => {
        if (x.id === r.id) return { ...x, status, note: clean || x.note, told: told || x.told };
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

  async function reset(r, ask) {
    if (!ask.fields.length) return;
    setBusyId(r.id);
    setError(null);
    try {
      const out = await postModeration({
        action: 'reset', userId: r.reportedId, fields: ask.fields, reportId: r.id,
        note: ask.note.trim() || undefined,
      });
      if (out.state !== 'ok') throw new Error(out.error || 'Could not reset that.');
      const done = (out.body && out.body.reset) || [];
      const words = done.map(f => (RESET_FIELDS.find(x => x.id === f) || {}).label || f).join(', ');
      const line = done.length ? `Reset: ${words}${out.body.told ? ' · they were told' : ''}.` : (out.body.message || 'Nothing to reset.');
      setReports(list => list.map(x => (x.reportedId && x.reportedId === r.reportedId ? {
        ...x,
        hasName: done.includes('display_name') ? false : x.hasName,
        hasHandle: done.includes('handle') ? false : x.hasHandle,
        avatar: done.includes('avatar') ? null : x.avatar,
        resetNote: line,
        resetWarn: out.body.warning || null,
      } : x)));
      setResetAsk(null);
      if (onChanged) onChanged();
    } catch (e) {
      setError(e?.message || 'Could not reset that.');
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => openCounts(reports), [reports]);
  const shown = useMemo(
    () => sortQueue(reports, { oldestFirst }).filter(r => showClosed || r.status === 'open'),
    [reports, showClosed, oldestFirst],
  );
  const now = Date.now();
  let staleMarked = false;
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
    <div className={`upg-review mod-queue ${className}`} data-sec-focus="reports"
         data-sec-focus-group={staleHours && state === 'ok' ? 'stale' : undefined}>
      <div className="upg-review-head">
        <div>
          <div className="upg-review-title">
            Reports{state === 'ok' ? ` · ${openTotal} open` : ''}
          </div>
          <p className="upg-review-sub">
            What people reported from friend cards, messages, requests, the leaderboard and group
            boards. Aim to decide within 24 hours — Priority ones (a child&apos;s safety, threats,
            self-harm) first. Suspending hides the account everywhere public and pauses its
            messages; banning also stops it signing in. Both can be lifted. The reporter is told
            the outcome; the reported person is told about a suspension or reset, never by whom.
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
        const rAsk = resetAsk && resetAsk.id === r.id ? resetAsk : null;
        const resettable = RESET_FIELDS.filter(f => f.has(r));
        const stale = staleHours ? isStale(r, staleHours, now) : false;
        const firstStale = stale && !staleMarked;
        if (firstStale) staleMarked = true;
        const waitH = stale ? Math.floor((now - Date.parse(r.at)) / 3600000) : 0;
        return (
          <div key={r.id} className={`mod-row is-${r.status}${repeat > 1 ? ' is-repeat' : ''}${stale ? ' is-stale' : ''}`}
               data-sec-focus={firstStale ? 'stale' : undefined}>
            <div className="mod-main">
              <div className="mod-who">
                <span className="mod-name">{r.name || (r.handle ? `@${r.handle}` : 'Unknown')}</span>
                {r.handle && r.name && <span className="mod-handle">@{r.handle}</span>}
                {r.deleted && <span className="mod-tag is-muted">Account deleted</span>}
                {r.banned && <span className="mod-tag is-bad">Banned</span>}
                {r.suspended && !r.banned && <span className="mod-tag is-bad">Suspended</span>}
                {r.urgent && r.status === 'open' && <span className="mod-tag is-bad">Priority</span>}
                {repeat > 1 && <span className="mod-tag is-warn">{repeat} open reports</span>}
                {r.status !== 'open' && <span className="mod-tag is-muted">{r.status}</span>}
                {stale && <span className="mod-tag is-warn">Waiting {waitH < 48 ? `${waitH} h` : `${Math.floor(waitH / 24)} days`}</span>}
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
              {r.told && <div className="mod-note">{r.told}</div>}
              {r.resetNote && <div className="mod-note">{r.resetNote}</div>}
              {r.resetWarn && <div className="mod-note is-warn">{r.resetWarn}</div>}
              {r.reasonId === 'child' && r.status === 'open' && (
                <div className="mod-note is-warn">
                  Child safety: don&apos;t open, save or forward any image. The reported person won&apos;t be
                  told about action on this report. Follow the NCA / CEOP steps in docs/ABUSE_HANDLING.md.
                </div>
              )}
              {rAsk && (
                <div className="mod-ask is-reset">
                  <div className="mod-reset-fields" role="group" aria-label="What to reset">
                    {resettable.map(f => (
                      <label key={f.id} className="mod-reset-field">
                        <input
                          type="checkbox" checked={rAsk.fields.includes(f.id)}
                          onChange={() => setResetAsk({
                            ...rAsk,
                            fields: rAsk.fields.includes(f.id) ? rAsk.fields.filter(x => x !== f.id) : [...rAsk.fields, f.id],
                          })}
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                  <input
                    type="text" maxLength={500} value={rAsk.note} placeholder="What was wrong (audit note)"
                    aria-label="Reset note"
                    onChange={e => setResetAsk({ ...rAsk, note: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Escape') setResetAsk(null); }}
                  />
                  <button type="button" className="btn btn-sm mod-confirm is-reset"
                          disabled={busyId === r.id || !rAsk.fields.length}
                          onClick={() => reset(r, rAsk)}>
                    {busyId === r.id ? 'Working…' : 'Confirm reset'}
                  </button>
                  <button type="button" className="btn btn-sm mod-cancel" onClick={() => setResetAsk(null)}>Cancel</button>
                  <span className="mod-ask-sub">Clears what others see; their own copy in the app is untouched.</span>
                </div>
              )}
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
            {r.status === 'open' && !ask && !rAsk && (
              <div className="mod-acts">
                <button type="button" className="btn btn-sm" disabled={busyId === r.id}
                        onClick={() => setPending({ id: r.id, verb: 'dismiss', note: '' })}>
                  Dismiss
                </button>
                <button type="button" className="btn btn-sm" disabled={busyId === r.id}
                        onClick={() => setPending({ id: r.id, verb: 'resolve', note: '' })}>
                  Resolve
                </button>
                {!r.deleted && resettable.length > 0 && (
                  <button type="button" className="btn btn-sm" disabled={busyId === r.id}
                          onClick={() => { setPending(null); setResetAsk({ id: r.id, fields: [], note: '' }); }}>
                    Reset…
                  </button>
                )}
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
