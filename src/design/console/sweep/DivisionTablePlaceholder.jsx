/**
 * PLACEHOLDER for HUB's shared division table.
 *
 * The console README (§7) has HUB build the division table once, as
 * src/design/console/hub/DivisionTable.jsx, for its League widget and
 * this page to share. It did not exist when SWEEP was built, so this
 * stands in for it behind ONE import in ConsoleLeaderboard.jsx:
 *
 *   import DivisionTable from './DivisionTablePlaceholder';
 *   // swap to: import DivisionTable from '../hub/DivisionTable';
 *
 * Contract (the classic groups/DivisionBoard props, so the swap is the
 * import line and nothing else — recorded in sweep/NOTES.md for HUB):
 *   data            useGroups().data — { divisions, standings, group, division, seats }
 *   division        the division number on screen
 *   onPickDivision  (num) => void — browse another division
 *
 * Presentational only: positions, zones and scores all arrive from the
 * server already decided (a ranking a client computes is one it can forge).
 */
import Icon from '../../../components/Icon';

function initials(name) {
  return (name || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function DivisionTable({ data, division, onPickDivision }) {
  const divisions = data?.divisions || [];
  const standings = data?.standings || [];
  const myDivision = data?.group?.division ?? null;
  const myGroupId = data?.group?.id ?? null;
  const shown = data?.division?.num ?? division;
  const nameOf = num => divisions.find(d => d.num === num)?.name || `Division ${num}`;
  const moved = standings[0]?.moved ?? 0;
  const seats = data?.seats;

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
          <div className="cx-sweep-div-legend cx-t12">
            <span className="is-up"><i aria-hidden="true" />Promotion</span>
            <span className="is-down"><i aria-hidden="true" />Relegation</span>
          </div>
        </header>

        {standings.length === 0 ? (
          <p className="cx-sweep-quiet">Nothing in {nameOf(shown)} yet. Divisions fill as groups are made.</p>
        ) : (
          <>
            <div className="cx-sweep-div-row is-head cx-t12 cx-muted" aria-hidden="true">
              <span>Pos</span><span>Group</span><span className="is-opt">Members</span><span className="is-opt">Top climber</span><span className="is-r">Week</span>
            </div>
            <ol className="cx-sweep-div-list">
              {standings.map(g => (
                <li key={g.id} className={`cx-sweep-div-row is-${g.zone}${g.id === myGroupId ? ' is-mine' : ''}`}>
                  <span className="cx-sweep-div-pos">
                    <span className="cx-num">{g.position}</span>
                    {g.zone === 'promoted' && <Icon name="arrow-up" size={12} strokeWidth={2} />}
                    {g.zone === 'relegated' && <Icon name="arrow-down" size={12} strokeWidth={2} />}
                  </span>
                  <span className="cx-sweep-div-name">
                    <span className="cx-sweep-crest" style={g.crestImage ? undefined : (g.crestColor ? { background: g.crestColor } : undefined)}>
                      {g.crestImage ? <img src={g.crestImage} alt="" /> : initials(g.name)}
                    </span>
                    <span className="cx-sweep-div-gname">{g.name}</span>
                    {g.id === myGroupId && <span className="cx-sweep-tag">You</span>}
                  </span>
                  <span className="is-opt cx-num cx-mid">{g.members}{seats ? `/${seats}` : ''}</span>
                  <span className="is-opt cx-mid cx-sweep-div-climber">
                    {g.topClimber ? <>{g.topClimber.name} <span className="cx-num">+{g.topClimber.climb}</span></> : '–'}
                  </span>
                  <span className="is-r cx-num cx-sweep-div-score">+{g.score}</span>
                </li>
              ))}
            </ol>
            <p className="cx-sweep-div-foot cx-t12 cx-muted">
              {moved > 0
                ? <>
                    {shown === 1 ? 'This is the top division. ' : <>Top <span className="cx-num">{moved}</span> go up to {nameOf(shown - 1)} on Monday. </>}
                    {shown === 10 ? 'This is the bottom division, so nobody goes down.' : <>Bottom <span className="cx-num">{moved}</span> go down to {nameOf(shown + 1)}.</>}
                    {' '}Everyone between stays.
                  </>
                : <>A division needs three groups before anyone moves up or down. The table still ranks.</>}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
