/**
 * Honours — the trophy case. Console's answer to VisionsModal.
 *
 * Same data as the classic catalogue (VISIONS + S.visions, read only):
 * every honour, earned ones first, newest first; locked ones by weight
 * (`xp`, a ratings weight that is never shown) so the nearest is next. What changes is the drawing:
 *   - a grid of tiles, not a list of rows
 *   - a Lucide glyph per honour instead of its emoji (emoji stay out
 *     of chrome; the honour definitions keep theirs for classic)
 *   - gold ◆ marks an earned honour; a category dot says which rating
 *     it feeds
 *   - one gold progress bar for the case as a whole
 *
 * Reachable from the Achievements page's Honours button, which is the
 * fix for playtest defect #1 (the catalogue only opened from Settings).
 */
import { useMemo } from 'react';
import { VISIONS } from '../../../lib/visions/definitions';
import Icon from '../../../components/Icon';
import { Sheet } from '../ui';

const CAT_LABEL = { brain: 'Brain', finance: 'Finance', fitness: 'Fitness', social: 'Social' };
const CAT_GLYPH = { brain: 'book-open', finance: 'trending-up', fitness: 'dumbbell', social: 'users' };

/** A Lucide glyph for an honour, from what it measures. Pure. */
export function honourGlyph(v) {
  const id = v?.id || '';
  if (id.startsWith('streak-')) return 'flame';
  if (id.startsWith('log-')) return 'calendar-days';
  if (id === 'tracker-perfect-week') return 'square-check-big';
  if (id.startsWith('ach-')) return 'star';
  if (id.startsWith('habits-')) return 'repeat';
  if (id.startsWith('savings-')) return 'piggy-bank';
  if (id.startsWith('coins-')) return 'coin';
  if (id.startsWith('vitals-')) return 'activity';
  if (id.startsWith('macros-')) return 'utensils';
  if (id.startsWith('holiday-')) return 'plane';
  if (id.startsWith('check-')) return 'target';
  return CAT_GLYPH[v?.category] || 'sparkles';
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
}

export default function HonoursCase({ S, onClose }) {
  const visions = S?.visions;
  const unlocked = useMemo(() => visions || {}, [visions]);
  const rows = useMemo(() => VISIONS.slice().sort((a, b) => {
    const ua = unlocked[a.id]?.unlockedAt, ub = unlocked[b.id]?.unlockedAt;
    if (ua && !ub) return -1;
    if (ub && !ua) return 1;
    if (ua && ub) return new Date(ub).getTime() - new Date(ua).getTime();
    return (a.xp || 0) - (b.xp || 0);
  }), [unlocked]);
  // Count only ids that are still defined, so a retired honour in someone's
  // state can't read as "23 of 22".
  const earned = VISIONS.filter(v => unlocked[v.id]).length;
  const total = VISIONS.length;

  return (
    <Sheet title="Honours" onClose={onClose} width={560} testId="cx-honours" className="cx-sweep-honours-sheet">
      <div className="cx-sweep-honours">
        <div className="cx-sweep-honours-sum">
          <p className="cx-t13 cx-mid">
            <span className="cx-num cx-gold">{earned}</span> of <span className="cx-num">{total}</span> earned.
            {' '}Each one is checked against what you've logged and feeds your ratings.
          </p>
          <div className="cx-sweep-bar is-gold" aria-hidden="true"><i style={{ width: `${total ? (earned / total) * 100 : 0}%` }} /></div>
        </div>
        <ul className="cx-sweep-case">
          {rows.map(v => {
            const stamp = unlocked[v.id];
            const on = !!stamp;
            return (
              <li key={v.id} className={`cx-sweep-tile${on ? ' is-on' : ''}`}>
                <div className="cx-sweep-tile-top">
                  <span className="cx-sweep-tile-glyph" aria-hidden="true"><Icon name={honourGlyph(v)} size={18} strokeWidth={1.75} /></span>
                  {on
                    ? <span className="cx-sweep-tile-mark cx-gold" aria-label="Earned">◆</span>
                    : <span className="cx-sweep-tile-mark cx-muted" aria-label="Not yet earned">◇</span>}
                </div>
                <div className="cx-sweep-tile-title">{v.title}</div>
                <div className="cx-sweep-tile-desc">{v.desc}</div>
                <div className="cx-sweep-tile-foot">
                  {v.category && <span className={`cx-sweep-dot is-${v.category}`} aria-hidden="true" />}
                  <span>{v.category ? CAT_LABEL[v.category] : 'All round'}</span>
                  {on && <span className="cx-sweep-tile-date">{fmtDate(stamp.unlockedAt)}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
