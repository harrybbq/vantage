/**
 * VisionsModal — catalogue of all visions with completion state.
 *
 * Visions are system-defined (src/lib/visions/definitions.js) — users
 * can't create or edit them. They unlock when their `check(S)` first
 * passes and stamp into `S.visions[id] = { unlockedAt }`.
 *
 * This modal renders every defined vision: unlocked ones show timestamp,
 * locked ones grey out (but the title/desc/icon stay visible so the
 * user knows what to chase). Sorted unlocked-first.
 */
import { VISIONS } from '../lib/visions/definitions';
import { backdropClose } from '../utils/backdropClose';

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

export default function VisionsModal({ open, S, onClose }) {
  if (!open) return null;
  const unlocked = S?.visions || {};

  // Sort: unlocked first (newest unlock at top), then locked by ascending xp.
  const rows = VISIONS.slice().sort((a, b) => {
    const ua = unlocked[a.id]?.unlockedAt;
    const ub = unlocked[b.id]?.unlockedAt;
    if (ua && !ub) return -1;
    if (ub && !ua) return 1;
    if (ua && ub) return new Date(ub).getTime() - new Date(ua).getTime();
    return (a.xp || 0) - (b.xp || 0);
  });

  const unlockedCount = Object.keys(unlocked).length;
  const total = VISIONS.length;

  return (
    <div className="modal-overlay open" {...backdropClose(() => onClose())}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 12, marginBottom: 4,
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.6,
              textTransform: 'uppercase', color: 'var(--em)', fontWeight: 700,
            }}>// VISIONS</div>
            <h3 style={{ margin: '2px 0 0' }}>What you've earned</h3>
          </div>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)',
            letterSpacing: .6, whiteSpace: 'nowrap',
          }}>
            {unlockedCount}/{total} unlocked
          </div>
        </div>

        <p style={{
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)',
          margin: '8px 0 14px', lineHeight: 1.55,
        }}>
          System-defined milestones — you can't fake them. Each one feeds your category ratings.
        </p>

        <ul style={{
          listStyle: 'none', margin: 0, padding: 0,
          display: 'flex', flexDirection: 'column', gap: 6,
          maxHeight: '60vh', overflowY: 'auto',
        }}>
          {rows.map(v => {
            const stamp = unlocked[v.id];
            const isOn = !!stamp;
            return (
              <li key={v.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 12px', borderRadius: 9,
                border: '1px solid ' + (isOn ? 'rgba(var(--em-rgb), .35)' : 'var(--border)'),
                background: isOn ? 'rgba(var(--em-rgb), .06)' : 'transparent',
                opacity: isOn ? 1 : 0.55,
              }}>
                <span style={{ fontSize: 22, lineHeight: 1, width: 28, textAlign: 'center', flexShrink: 0 }}>
                  {v.icon || '✦'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--sans)', fontSize: 13.5, fontWeight: 600,
                    color: 'var(--text)',
                  }}>{v.title}</div>
                  <div style={{
                    fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-muted)',
                    marginTop: 2, lineHeight: 1.5,
                  }}>{v.desc}</div>
                  {isOn && (
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1,
                      textTransform: 'uppercase', color: 'var(--em)',
                      marginTop: 4, fontWeight: 700,
                    }}>
                      ✓ Unlocked {fmtDate(stamp.unlockedAt)}
                    </div>
                  )}
                </div>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: .8,
                  color: isOn ? 'var(--em)' : 'var(--text-muted)', fontWeight: 700,
                  flexShrink: 0,
                }}>+{v.xp} XP</span>
              </li>
            );
          })}
        </ul>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
