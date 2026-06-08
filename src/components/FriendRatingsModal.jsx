/**
 * FriendRatingsModal — read-only ratings card for a non-self user, shown
 * when a row on LeaderboardPanel is tapped.
 *
 * Privacy boundary (intentional): no source-of-points breakdown for other
 * users. We don't have their raw S, and we wouldn't show it if we did.
 * Only the four category numbers + per-category prestige tier.
 *
 * Explicitly does NOT import or call categoryBreakdown(S, cat) — that
 * function reads raw state, which we don't have here and shouldn't.
 */
import { ovrTier, categoryTier } from '../lib/ratings/tiers';

const COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}
function initials(name) {
  return (name || '?').replace(/^@/, '').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}
function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

const CATEGORIES = [
  { id: 'brain',   label: 'Brain',   icon: '◉' },
  { id: 'finance', label: 'Finance', icon: '☰' },
  { id: 'fitness', label: 'Fitness', icon: '▲' },
  { id: 'social',  label: 'Social',  icon: '◌' },
];

export default function FriendRatingsModal({ row, onClose }) {
  if (!row) return null;
  const prestige = ovrTier(row.ovr || 1);
  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          {row.avatarUrl
            ? <img src={row.avatarUrl} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
            : <div style={{
                width: 48, height: 48, borderRadius: '50%', background: avatarColor(row.username),
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--display)', fontStyle: 'italic', fontWeight: 700, fontSize: 18,
              }}>{initials(row.username)}</div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontStyle: 'italic', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>
              {row.username}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Updated {timeAgo(row.ratingsComputedAt)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className={`ovr-num ovr-tier-${prestige.key}`} style={{
              fontFamily: 'var(--serif, Georgia, serif)', fontStyle: 'italic', fontWeight: 700,
              fontSize: 42, lineHeight: 1, letterSpacing: -1,
            }}>{row.ovr}</div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.6, textTransform: 'uppercase',
              color: prestige.color, fontWeight: 700, marginTop: 4,
            }}>{prestige.label}</div>
          </div>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {CATEGORIES.map(c => {
            const score = row.categories?.[c.id] || 1;
            const t = categoryTier(score);
            return (
              <li key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 11px', borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--card, rgba(255,255,255,0.04))',
              }}>
                <span style={{ fontSize: 16, color: t.color }}>{c.icon}</span>
                <span style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>{c.label}</span>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase',
                  padding: '2px 7px', borderRadius: 4, color: t.color, fontWeight: 700,
                  background: `rgba(var(--em-rgb), 0.08)`, border: `1px solid ${t.color}55`,
                }}>{t.label}</span>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: t.color,
                  minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                }}>{score}</span>
              </li>
            );
          })}
        </ul>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
