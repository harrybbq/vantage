/**
 * The Division tab of the console leaderboard: the division rail, a
 * panel header, and HUB's shared DivisionTable with promotion and
 * relegation rails.
 *
 * Same props as classic groups/DivisionBoard, so ConsoleLeaderboard can
 * feed it straight from useGroups:
 *   data            useGroups().data — { divisions, standings, group, division, seats }
 *   division        the division number on screen
 *   onPickDivision  (num) => void — browse another division
 *
 * This file is only the adapter. Standings arrive from the groups
 * function with position, zone and score already decided (a ranking a
 * client computes is one it can forge), and are mapped onto
 * DivisionTable's row contract (hub/DivisionTable.jsx):
 *   position → pos · zone 'promoted' | 'relegated' → 'up' | 'down'
 *   members and top climber → the second line · score → the value column
 * The score is a week's OVR growth, not a rating, so it is drawn as
 * "+N" without tier-band colour (valueBand false).
 */
import DivisionTable from '../hub/DivisionTable';

const ZONE = { promoted: 'up', relegated: 'down' };

export function standingRows(standings, { myGroupId = null, seats = null } = {}) {
  return (standings || []).map(g => {
    const members = g.members != null ? `${g.members}${seats ? `/${seats}` : ''} members` : null;
    const climber = g.topClimber ? `${g.topClimber.name} +${g.topClimber.climb}` : null;
    return {
      id: g.id,
      pos: g.position,
      name: g.name,
      avatarUrl: g.crestImage || null,
      avatarColor: g.crestImage ? null : (g.crestColor || null),
      isSelf: myGroupId != null && g.id === myGroupId,
      zone: ZONE[g.zone] || null,
      ovr: g.score,
      sub: [members, climber].filter(Boolean).join(' · ') || null,
    };
  });
}

export default function DivisionBoard({ data, division, onPickDivision }) {
  const divisions = data?.divisions || [];
  const standings = data?.standings || [];
  const myDivision = data?.group?.division ?? null;
  const myGroupId = data?.group?.id ?? null;
  const shown = data?.division?.num ?? division;
  const nameOf = num => divisions.find(d => d.num === num)?.name || `Division ${num}`;
  const moved = standings[0]?.moved ?? 0;
  const rows = standingRows(standings, { myGroupId, seats: data?.seats });
  const legend = moved > 0
    ? {
        up: shown === 1 ? null : `Top ${moved} go up to ${nameOf(shown - 1)}`,
        down: shown === 10 ? null : `Bottom ${moved} go down to ${nameOf(shown + 1)}`,
      }
    : null;

  return (
    <div className="cx-sweep-div">
      {divisions.length > 0 && (
        <div className="cx-sweep-div-rail" role="group" aria-label="Divisions">
          {divisions.map(d => (
            <button
              key={d.num}
              type="button"
              className={`cx-chip${d.num === myDivision ? ' is-mine' : ''}`}
              aria-pressed={d.num === shown}
              onClick={() => onPickDivision?.(d.num)}
            >
              <span className="cx-num">{d.num}</span>
              <span>{d.name}</span>
            </button>
          ))}
        </div>
      )}

      <section className="cx-panel cx-sweep-div-table">
        <header className="cx-sweep-div-head">
          <div className="cx-sweep-div-titles">
            <h2 className="cx-t17">{nameOf(shown)}</h2>
            <p className="cx-t12 cx-muted">
              <span className="cx-num">{standings.length}</span> group{standings.length === 1 ? '' : 's'}, ranked by how much
              their members' OVR grew since Monday
              {myDivision != null && shown !== myDivision ? '. Not your division, so this is read-only' : ''}
            </p>
          </div>
        </header>

        {standings.length === 0 ? (
          <p className="cx-sweep-quiet">Nothing in {nameOf(shown)} yet. Divisions fill as groups are made.</p>
        ) : (
          <div className="cx-sweep-div-body">
            <DivisionTable
              rows={rows}
              label={`${nameOf(shown)} division`}
              nameLabel="Group"
              weeklyLabel={false}
              valueLabel="Week"
              valueBand={false}
              formatValue={v => `+${v}`}
              legend={legend}
            />
            <p className="cx-sweep-div-foot cx-t12 cx-muted">
              {moved > 0
                ? <>
                    {shown === 1 ? 'This is the top division, so nobody goes higher. ' : ''}
                    {shown === 10 ? 'This is the bottom division, so nobody goes down. ' : ''}
                    Moves happen on Monday. Everyone between the rails stays.
                  </>
                : <>A division needs three groups before anyone moves up or down. The table still ranks.</>}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
