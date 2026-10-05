/**
 * Moderation — people reported by people ("ban requests"), who is
 * currently suspended or banned, and group pictures the screen couldn't
 * decide. The report queue and the crest queue are the existing
 * components, reused; this panel adds the suspended list (with Lift)
 * and the counts that tie them together. Reports waiting over a day are
 * marked; a stale-reports alert opens the queue oldest first.
 */
import { useMemo, useState } from 'react';
import { usePanel } from './usePanel';
import { useFocusTarget } from './useFocusTarget';
import { Updated, CardHead, ConfirmButton, Calm, Gate } from './parts';
import ModerationQueue from '../../moderation/ModerationQueue';
import CrestQueue from './CrestQueue';
import { postAction } from '../../../lib/security/api';
import { ago, stamp, fmtInt, num } from '../../../lib/security/format';

function Suspended({ list, onLift, busyId }) {
  if (!list.length) return <Calm>Nobody is suspended.</Calm>;
  return (
    <ul className="sec-users">
      {list.map(u => (
        <li key={u.id} className="sec-user">
          <span className="sec-user-who">
            <b>{u.display_name || (u.handle ? `@${u.handle}` : 'Unknown')}</b>
            {u.handle && u.display_name && <em>@{u.handle}</em>}
          </span>
          <span className="sec-user-meta">
            <span className={`sec-tag ${u.banned ? 'is-bad' : 'is-warn'}`}>{u.banned ? 'Banned' : 'Suspended'}</span>
            <span title={stamp(u.suspended_at)}>{ago(u.suspended_at)}</span>
          </span>
          <ConfirmButton label="Lift" confirmLabel={u.banned ? 'Lift ban' : 'Lift suspension'} tone="quiet"
                         disabled={busyId === u.id} onConfirm={() => onLift(u)} />
        </li>
      ))}
    </ul>
  );
}

export default function ModerationPanel({ focus }) {
  const md = usePanel('moderation');
  // A stale-reports alert lands here: the queue switches to oldest first
  // and the first report waiting over a day is highlighted.
  const staleView = !!(focus && focus.key === 'stale');
  useFocusTarget(focus, !!(md.res && md.res.state === 'ok'));
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);
  const [lifted, setLifted] = useState(() => new Set());

  const data = md.res && md.res.state === 'ok' ? md.res.data : null;
  const suspended = useMemo(() => (data && Array.isArray(data.suspended) ? data.suspended : [])
    .filter(u => u && u.id && !lifted.has(u.id))
    .map(u => ({ ...u, banned: !!(u.banned || u.banned_at || u.banned_until) })), [data, lifted]);
  const crests = num(data && data.crests && data.crests.count);
  const openReports = data && Array.isArray(data.reports) ? data.reports.length : null;

  async function lift(u) {
    setBusyId(u.id); setErr(null);
    const out = await postAction(u.banned
      ? { action: 'user.ban', userId: u.id, on: false }
      : { action: 'user.suspend', userId: u.id, on: false });
    setBusyId(null);
    if (!out.ok) { setErr(out.error); return; }
    setLifted(s => new Set(s).add(u.id));
    md.reload();
  }

  return (
    <div className="sec-pane">
      <div className="sec-bar">
        <span className="sec-eyebrow">
          // {openReports != null ? `${fmtInt(openReports)} open reports · ` : ''}{fmtInt(suspended.length)} suspended{crests != null ? ` · ${fmtInt(crests)} pictures waiting` : ''}
        </span>
        <Updated at={md.updatedAt} loading={md.loading} onRefresh={md.reload} error={md.res && md.res.staleError} />
      </div>

      <ModerationQueue className="sec-card" onChanged={md.reload} oldestFirst={staleView} staleHours={24} />

      <section className="sec-card" data-sec-focus="suspended">
        <CardHead eyebrow="// reversible" title={`Suspended & banned${suspended.length ? ` · ${suspended.length}` : ''}`} />
        <p className="sec-p">Hidden from every public board. Banned accounts also can&apos;t sign in. Lifting restores both.</p>
        {err && <div className="sec-note is-bad">{err}</div>}
        {!md.res || md.res.state !== 'ok'
          ? <Gate res={md.res}>{() => null}</Gate>
          : <Suspended list={suspended} onLift={lift} busyId={busyId} />}
      </section>

      <CrestQueue className="sec-card" onChanged={md.reload} />
    </div>
  );
}
