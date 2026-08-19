/**
 * The division table — the fifteen-or-so groups you are up against.
 *
 * Promotion and relegation are drawn, not explained: a coloured rail
 * down the edge of the rows in each zone, and an arrow beside the
 * position. You can see where the cut is without reading the footnote,
 * which is the point of a league table.
 *
 * The rail across the top browses the other nine divisions. Looking at
 * a division you are not in is read-only and says so — your own
 * position never comes from whichever table happens to be on screen.
 */
const AVATAR_COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];
function crestColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  return (name || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function DivisionBoard({ data, division, onPickDivision }) {
  const divisions = data?.divisions || [];
  const standings = data?.standings || [];
  const myDivision = data?.group?.division ?? null;
  const myGroupId = data?.group?.id ?? null;
  const shown = data?.division?.num ?? division;
  const nameOf = num => divisions.find(d => d.num === num)?.name || '—';
  /* How many move comes from the server with the standings, so the
     footnote cannot drift from what the settle actually does. */
  const moved = standings[0]?.moved ?? 0;

  return (
    <div className="grp-wrap">
      <div className="grp-divrail">
        {divisions.map(d => (
          <button
            key={d.num}
            type="button"
            className={`grp-divchip is-d${d.num}${d.num === shown ? ' is-active' : ''}${d.num === myDivision ? ' is-mine' : ''}`}
            onClick={() => onPickDivision(d.num)}
          >
            <span className="grp-divchip-num">Div {d.num}</span>
            <span className="grp-divchip-name"><i />{d.name}</span>
            {/* "Above you" means nothing until you are somewhere. Before
                that the rail is just the ten divisions. */}
            {myDivision != null && (
              <span className="grp-divchip-meta">
                {d.num === myDivision ? 'Your division' : d.num < myDivision ? 'Above you' : 'Below you'}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grp-card grp-table">
        <div className="grp-table-head">
          <div className={`grp-table-crest is-d${shown}`} aria-hidden="true">◈</div>
          <div>
            <div className="grp-table-name">{nameOf(shown)} Division</div>
            <div className="grp-table-sub">
              {standings.length} group{standings.length === 1 ? '' : 's'} · sum of member OVR growth since Monday
            </div>
          </div>
          <div className="grp-legend">
            <span className="is-up"><i />Promotion</span>
            <span className="is-down"><i />Relegation</span>
          </div>
        </div>

        {standings.length === 0 ? (
          <div className="grp-quiet grp-quiet-pad">
            Nothing in {nameOf(shown)} yet. Divisions fill as groups are made.
          </div>
        ) : (
          <>
            <div className="grp-grow grp-ghead">
              <div>Pos</div><div>Group</div><div>Members</div><div>Top climber</div>
              <div className="grp-num">Weekly</div>
            </div>
            {standings.map(g => (
              <div key={g.id}
                   className={`grp-grow is-${g.zone}${g.id === myGroupId ? ' is-mine' : ''}`}>
                <div className="grp-gpos">
                  <span>{g.position}</span>
                  {g.zone === 'promoted' && <em className="is-up">▲</em>}
                  {g.zone === 'relegated' && <em className="is-down">▼</em>}
                </div>
                <div className="grp-gname">
                  <span className="grp-gcrest" style={{ background: g.crestColor || crestColor(g.name) }}>
                    {initials(g.name)}
                  </span>
                  <span className="grp-gtitle">{g.name}</span>
                  {g.id === myGroupId && <span className="grp-tag">You</span>}
                </div>
                <div className="grp-gmembers">{g.members}/{data.seats}</div>
                <div className="grp-gclimber">
                  {g.topClimber ? `${g.topClimber.name} +${g.topClimber.climb}` : '—'}
                </div>
                <div className="grp-num grp-gscore">+{g.score}</div>
              </div>
            ))}
            <p className="grp-foot-note">
              {moved > 0
                ? <>Top {moved} promote{shown === 1 ? '' : <> to {nameOf(shown - 1)}</>} · bottom {moved} drop to{' '}
                   {shown === 10 ? 'nowhere — Iron is the floor' : nameOf(shown + 1)} · everyone between holds.</>
                : <>Nobody moves out of a division this small — it takes three groups before one can
                   go up and another down. The table still ranks.</>}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
