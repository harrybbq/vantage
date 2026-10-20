/**
 * DivisionTable — the league table, console design (Direction C's table
 * in Direction A's type). Shared: the hub's League widget renders it, and
 * SWEEP's leaderboard page imports it READ-ONLY.
 *
 * ── Props (the contract; add keys, never rename) ─────────────────────
 *   rows       [{ id, pos, name, avatarUrl?, prestige?, cats?, weekly?, ovr?,
 *                 isSelf?, zone?, sub? }]
 *                pos      1-based position (drawn as given)
 *                prestige number of prestige climbs; ◆ per climb up to 3, then ◆N
 *                cats     { brain, finance, fitness, social } — 0-99 each, or null
 *                weekly   signed number (▲n / ▼n / –); null = no data yet (–)
 *                ovr      0-99, or null (drawn as –, never painted bronze)
 *                zone     'up' | 'down' | null — draws the promotion /
 *                         relegation rail on the position cell. Leave it null
 *                         when the data has no such mechanic: a rail must
 *                         only ever mean something the server will do.
 *                sub      optional second line under the name (e.g. members)
 *   showCats   bool — the four category columns (desktop / wide only)
 *   limit      max rows drawn (the "you" row is always kept in view)
 *   legend     { up: 'Promotion: top 2', down: 'Relegation: bottom 2' } or null.
 *              Shown only when at least one row has a zone.
 *   note       node at the right of the footer (e.g. "2 OVR behind Tom")
 *   onRow      (row) => void — makes rows buttons
 *   label      accessible name of the table
 *   valueLabel header of the right-most column (default 'Ovr')
 *   weeklyLabel header of the weekly column (default 'Wk'); false hides it
 *   nameLabel  header of the name column (default 'Player'; 'Group' for divisions)
 *   valueBand  colour the right-most value by its tier band (default true).
 *              false for a value that is not a rating (a group's weekly score)
 *   formatValue (v) => node for the right-most value (default: the number)
 *   rows[].avatarColor  optional ground for the initials avatar (a group crest)
 *
 * Every rating number (category cells, OVR) is coloured by its tier band
 * (lib/ratings/bands.js). Styles: hub.css, `.cx-dt*`.
 */
import { bandClass } from '../../../lib/ratings/bands';

const CATS = [['brain', 'Brn', 'Brain'], ['finance', 'Fin', 'Finance'], ['fitness', 'Fit', 'Fitness'], ['social', 'Soc', 'Social']];

export function initialsOf(name) {
  const s = String(name || '?').replace(/^@/, '').trim();
  const parts = s.split(/[\s_.-]+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Diamonds({ n }) {
  const p = Number(n) || 0;
  if (p < 1) return null;
  return (
    <span className="cx-dt-pr" title={`Prestige ${p}`} aria-label={`Prestige ${p}`}>
      {p <= 3 ? '◆'.repeat(p) : `◆${p}`}
    </span>
  );
}

export function Avatar({ name, url, size = 24, self = false, online = false, color = null }) {
  const ground = color && !url ? { background: color, color: '#FFFFFF' } : null;
  return (
    <span className={`cx-av${self ? ' is-self' : ''}`} style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)), ...ground }} aria-hidden="true">
      {url ? <img src={url} alt="" /> : initialsOf(name)}
      {online && <i className="cx-av-on" />}
    </span>
  );
}

function Weekly({ v }) {
  if (v == null || !Number.isFinite(Number(v)) || Number(v) === 0) return <span className="cx-muted">–</span>;
  const n = Number(v);
  return n > 0
    ? <span className="cx-dt-up" aria-label={`up ${n} this week`}>▲{n}</span>
    : <span className="cx-dt-down" aria-label={`down ${Math.abs(n)} this week`}>▼{Math.abs(n)}</span>;
}

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

export default function DivisionTable({
  rows = [], showCats = false, limit = 0, legend = null, note = null, onRow = null,
  label = 'League table', valueLabel = 'Ovr', weeklyLabel = 'Wk', valueBand = true, formatValue = null, nameLabel = 'Player',
}) {
  let shown = rows;
  if (limit > 0 && rows.length > limit) {
    shown = rows.slice(0, limit);
    const me = rows.find(r => r.isSelf);
    if (me && !shown.includes(me)) shown = [...rows.slice(0, limit - 1), me];
  }
  const zoned = rows.some(r => r.zone === 'up' || r.zone === 'down');
  return (
    <div className="cx-dt-wrap">
      <table className={`cx-dt${showCats ? ' has-cats' : ''}`} aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="cx-dt-pos"><span className="cx-sr">Position</span></th>
            <th scope="col" className="cx-dt-l">{nameLabel}</th>
            {showCats && CATS.map(([k, ab, full]) => <th key={k} scope="col" title={full}><abbr title={full}>{ab}</abbr></th>)}
            {weeklyLabel !== false && <th scope="col" title="This week">{weeklyLabel}</th>}
            <th scope="col">{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(r => {
            const ovr = num(r.ovr);
            const cls = [r.zone === 'up' ? 'z-up' : r.zone === 'down' ? 'z-dn' : '', r.isSelf ? 'is-me' : '', onRow ? 'is-link' : ''].filter(Boolean).join(' ');
            return (
              <tr key={r.id ?? r.pos} className={cls || undefined}
                  onClick={onRow ? () => onRow(r) : undefined}>
                <td className="cx-dt-pos cx-num">{r.pos}</td>
                <td className="cx-dt-name">
                  {onRow ? (
                    <button type="button" className="cx-dt-who" onClick={e => { e.stopPropagation(); onRow(r); }}>
                      <Avatar name={r.name} url={r.avatarUrl} self={r.isSelf} color={r.avatarColor} />
                      <span className="cx-dt-nm">{r.name}{r.sub && <small className="cx-dt-sub">{r.sub}</small>}</span>
                      <Diamonds n={r.prestige} />
                    </button>
                  ) : (
                    <span className="cx-dt-who">
                      <Avatar name={r.name} url={r.avatarUrl} self={r.isSelf} color={r.avatarColor} />
                      <span className="cx-dt-nm">{r.name}{r.sub && <small className="cx-dt-sub">{r.sub}</small>}</span>
                      <Diamonds n={r.prestige} />
                    </span>
                  )}
                </td>
                {showCats && CATS.map(([k]) => {
                  const v = num(r.cats && r.cats[k]);
                  return <td key={k} className={`cx-dt-att cx-num ${bandClass(v)}`}>{v == null ? '–' : v}</td>;
                })}
                {weeklyLabel !== false && <td className="cx-dt-wk cx-num"><Weekly v={r.weekly} /></td>}
                <td className={`cx-dt-ovr cx-num ${valueBand ? bandClass(ovr) : ''}`}>{ovr == null ? '–' : formatValue ? formatValue(ovr) : ovr}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(zoned && legend) || note ? (
        <div className="cx-dt-foot">
          {zoned && legend && legend.up && <span><i className="cx-dt-rail is-up" />{legend.up}</span>}
          {zoned && legend && legend.down && <span><i className="cx-dt-rail is-down" />{legend.down}</span>}
          {note && <span className="cx-dt-note">{note}</span>}
        </div>
      ) : null}
    </div>
  );
}
