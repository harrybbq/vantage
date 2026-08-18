/**
 * The Groups half of the leaderboard: My Group and Division.
 *
 * Holds the one data fetch both views share and the actions that write.
 * Everything below it is presentational — the score, the position and
 * the zone all arrive from the server already decided, for the same
 * reason the individual board does: a ranking a client can compute is a
 * ranking a client can forge.
 */
import { useState } from 'react';
import { useGroups } from '../../hooks/useGroups';
import GroupBoard from './GroupBoard';
import DivisionBoard from './DivisionBoard';
import GroupSetup from './GroupSetup';

export default function GroupsTab({ view }) {
  const [division, setDivision] = useState(null);
  const g = useGroups(division);
  const { data, loading, error } = g;
  const [busy, setBusy] = useState(false);

  async function act(fn) {
    setBusy(true);
    try { await fn(); }
    catch (e) { window.alert(e.message || 'That did not work.'); }
    setBusy(false);
  }

  if (loading && !data) return <div className="grp-quiet grp-quiet-pad">Loading…</div>;

  if (data && data.setup === false) {
    return (
      <div className="grp-quiet grp-quiet-pad">
        <strong>Groups are not switched on yet.</strong>
        <div style={{ marginTop: 6 }}>
          Run <code>supabase/groups_schema.sql</code> in the Supabase SQL editor and this page
          fills in. The individual board works either way.
        </div>
      </div>
    );
  }

  if (error) return <div className="grp-error">{error}</div>;
  if (!data) return null;

  // No group yet: the Division tab is still worth looking at, so only
  // the My Group view is replaced by the setup panels.
  if (!data.group && view === 'group') {
    return (
      <GroupSetup
        seats={data.seats}
        onCreate={(name, crest) => g.createGroup(name, crest)}
        onJoin={code => g.joinGroup(code)}
      />
    );
  }

  if (view === 'division') {
    return (
      <DivisionBoard
        data={data}
        division={division ?? data.group?.division ?? 10}
        onPickDivision={setDivision}
      />
    );
  }

  return (
    <GroupBoard
      data={data}
      busy={busy}
      onLeave={() => act(() => g.leaveGroup())}
      onRename={name => act(() => g.renameGroup(name))}
      onRotateCode={() => g.rotateCode()}
      onKick={id => act(() => g.kickMember(id))}
    />
  );
}
