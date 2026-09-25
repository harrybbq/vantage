/**
 * What a linked tracker has counted so far, drawn on the achievement.
 * Shared by the desktop board and the phone's path player so the two
 * can never say different things about the same goal.
 *
 * When the goal is met it says so and asks for the ★ — completion stays
 * one tap, which is what pays the coins (see lib/achievements/trackerLink).
 */
export default function LinkProgress({ prog, compact = false, claim = 'tap ★ to claim it' }) {
  if (!prog) return null;
  const count = prog.mode === 'weekly'
    ? `${prog.done}/${prog.target} ${prog.target === 1 ? 'week' : 'weeks'}`
    : `${prog.done}/${prog.target}`;
  return (
    <div className={`ach-linkp${prog.met ? ' is-met' : ''}${prog.missing ? ' is-missing' : ''}${compact ? ' is-compact' : ''}`}>
      <div className="ach-linkp-top">
        <span className="ach-linkp-line">{prog.line}</span>
        {!prog.missing && <span className="ach-linkp-count">{count}</span>}
      </div>
      {!prog.missing && (
        <div className="ach-linkp-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.pct}
             aria-label={`${prog.tracker}: ${count}`}>
          <div className="ach-linkp-fill" style={{ width: `${prog.pct}%` }} />
        </div>
      )}
      {prog.met && <div className="ach-linkp-met">Goal met — {claim}</div>}
    </div>
  );
}
