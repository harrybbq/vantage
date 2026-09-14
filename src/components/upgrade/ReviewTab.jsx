/**
 * The moderation queue: group pictures waiting on a person.
 *
 * Screening on upload is a first pass and it is wrong in both
 * directions — a crest refused for a cartoon skull, a photograph nobody
 * should be hosting waved through. This is where that gets overturned,
 * and the decision made here is the one that stands: the screening never
 * runs again on a picture a person has looked at.
 *
 * ── The gate is on the server ────────────────────────────────────────
 * This tab renders inside UpgradeSection, which is owner-gated by
 * VITE_OWNER_EMAIL. That is a UI gate and nothing more. The `groups`
 * function checks the email the AUTH SERVER returns before it will
 * answer `crestQueue` or `crestDecide` at all, and answers a non-owner
 * exactly as it answers a bad token. The leaderboard forgery is the
 * standing reminder of why the two have to be separate things.
 *
 * ── Why the queue is normally empty ──────────────────────────────────
 * Anything the screening cleared or refused outright never arrives here
 * — only what it could not decide, and what it could not reach (no API
 * key, a timeout). An empty queue is the healthy state, so it says so
 * rather than looking broken.
 */
import { useCallback, useEffect, useState } from 'react';
import Icon from '../Icon';
import { crestQueue, decideCrest } from '../../lib/groups/api';

export default function ReviewTab() {
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [setup, setSetup] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await crestQueue();
      setSetup(body.setup !== false);
      setQueue(body.queue || []);
    } catch (e) {
      setError(e?.message || 'Could not load the queue.');
      setQueue([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(g, verdict) {
    // The reason travels back to the group's leader, so it is asked for
    // rather than left blank — "not approved" with no why is the thing
    // that generates the message asking why.
    let note = null;
    if (verdict === 'rejected') {
      note = window.prompt(`Why is ${g.name}'s picture not approved?\n\nThis is shown to the group's leader.`, g.note || '');
      if (note === null) return;
    }
    setBusyId(g.id);
    try {
      await decideCrest(g.id, verdict, note || undefined);
      setQueue(q => (q || []).filter(x => x.id !== g.id));
    } catch (e) {
      setError(e?.message || 'Could not record that.');
    } finally {
      setBusyId(null);
    }
  }

  if (!setup) {
    return (
      <div className="upg-review">
        <p className="upg-review-empty">
          Group pictures are not switched on yet — run <code>supabase/group_crest_schema.sql</code> in
          the Supabase SQL editor.
        </p>
      </div>
    );
  }

  return (
    <div className="upg-review">
      <div className="upg-review-head">
        <div>
          <div className="upg-review-title">Group pictures awaiting review</div>
          <p className="upg-review-sub">
            Only pictures the automatic screen could not decide — or could not reach — arrive here.
            Until one is approved, the group&apos;s own members are the only people who can see it.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={load}>
          <Icon name="rotate-ccw" size={13} /> Refresh
        </button>
      </div>

      {error && <div className="upg-review-error">{error}</div>}

      {queue === null && <p className="upg-review-empty">Loading…</p>}

      {queue !== null && queue.length === 0 && !error && (
        <p className="upg-review-empty">Nothing waiting. That is the normal state.</p>
      )}

      {(queue || []).map(g => (
        <div key={g.id} className="upg-review-row">
          {g.image
            ? <img className="upg-review-img" src={g.image} alt={`${g.name} group picture`} />
            : <div className="upg-review-img" />}
          <div className="upg-review-meta">
            <div className="upg-review-name">{g.name}</div>
            <div className="upg-review-when">
              Division {g.division}
              {g.uploadedAt ? ` · uploaded ${new Date(g.uploadedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
            </div>
            {g.note && <div className="upg-review-note">Screen said: {g.note}</div>}
          </div>
          <div className="upg-review-acts">
            <button
              type="button" className="btn btn-sm" disabled={busyId === g.id}
              onClick={() => decide(g, 'approved')}
            >Approve</button>
            <button
              type="button" className="btn btn-sm upg-review-no" disabled={busyId === g.id}
              onClick={() => decide(g, 'rejected')}
            >Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}
