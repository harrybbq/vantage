/**
 * The boot sequence — the app assembling itself when it first opens.
 *
 * Everything here is drawn ON TOP of the app that already exists. This
 * component adds no layout: two fixed, pointer-events:none layers and a
 * console pill, all of which unmount the moment the score ends. The
 * staggered arrival of the hub's own panels is a class on <html> (see
 * boot.css) rather than anything rendered here, so no existing markup
 * had to move to make room for it.
 *
 * Two layers, because they belong on opposite sides of the UI:
 *   · the wallpaper tiles sit UNDER the app, rendered as a sibling of
 *     App's own background layer so they share its paint order;
 *   · the grid, scanlines, sweep and console sit OVER it, portalled to
 *     <body> so no ancestor's transform or stacking context can catch
 *     them.
 */
import { createPortal } from 'react-dom';
import { useBootSequence } from '../hooks/useBootSequence';
import { tiles, consoleAt, seg } from '../lib/boot/score.js';

export default function BootSequence({ kind, background }) {
  const { t, running, score } = useBootSequence(kind);
  if (!running) return null;

  const cells = tiles(t, score);
  const con = consoleAt(t, score);
  const gridP = seg(t, score.grid);
  const inSweep = t > score.sweep[0] && t < score.sweep[1];

  /* Whatever the user has set for this section is what assembles. With
     no background of their own the theme's own backdrop tiles instead,
     so the effect reads the same on a fresh account — and either way the
     slices line up with what is painted underneath, so the last tile
     landing is not a visible swap. */
  /* Quoted, because an unquoted url() ends at the first ")" — a stored
     background whose name carries a bracket or a space would otherwise
     resolve to no image at all, and the wall would assemble in blank. */
  const layer = background
    ? {
        backgroundImage: `url("${String(background).replace(/"/g, '%22')}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { background: 'var(--grad, var(--bg-base, #0c0c0b))' };

  return (
    <>
      <div className="vb-boot-wall" aria-hidden="true"
           style={{ '--vb-cols': score.cols, '--vb-rows': score.rows }}>
        {cells.map(c => (
          <div key={`${c.row}-${c.col}`} className="vb-boot-cell"
               style={{ opacity: c.opacity, animation: c.anim }}>
            {/* The inner pane is a full viewport of the same image, shifted
                so this cell shows its own slice. Sizing it to the viewport
                rather than to the cell is what keeps `cover` identical to
                the real background underneath. */}
            <div className="vb-boot-pane"
                 style={{
                   ...layer,
                   transform: `translate(${-c.col * (100 / score.cols)}vw, ${-c.row * (100 / score.rows)}vh) scale(${c.scale})`,
                 }} />
            <div className="vb-boot-edge" style={{ opacity: c.edge }} />
          </div>
        ))}
      </div>

      {createPortal(
        <div className="vb-boot-crt" aria-hidden="true">
          <div className="vb-boot-grid" style={{ opacity: gridP }} />
          <div className="vb-boot-scan" style={{ opacity: 0.6 - 0.3 * gridP }} />
          {inSweep && <div className="vb-boot-sweep" />}

          {/* The console is the only part with words in it. It names the
              stage rather than counting a fake percentage at the user:
              the percentage is the score's real progress. */}
          <div className="vb-boot-console" style={{ opacity: seg(t, [score.console[0] - 150, score.console[0] + 250]) }}>
            <span className={`vb-boot-lamp${con.done ? ' is-done' : ''}`} />
            <span className="vb-boot-stage">{con.line}</span>
            <span className="vb-boot-bar"><i style={{ width: `${con.pct}%` }} /></span>
            <span className="vb-boot-pct">{con.pct}%</span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
