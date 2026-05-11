/**
 * RatingsPanel — F5 Sprint 3 surface (Ledger design, 2026-05-12).
 *
 * Terminal-flavoured monospace card. Dense, narrow-sidebar friendly,
 * the most data-dense of the candidate designs. Renders:
 *
 *   [ OVR ] huge serif italic number /99       → TIER (coloured)
 *   01 ⌬ BRAIN    ··········■■■■···········  64
 *   02 ☰ FINANCE  ··········■■■■■···········  51
 *   03 ▲ FITNESS  ··········■■■■■■■■■········  72
 *   04 ◌ SOCIAL   ··········■····················  46
 *
 * Reads S.ratings (local cache, refreshed by useRatings on 1.5s
 * debounce). Friend-visible canonical truth lives on profiles.ratings
 * server-side — tampering with S.ratings only affects your own view.
 *
 * Tap any row → breakdown modal showing where the points came from.
 */
import { useState } from 'react';
import { categoryBreakdown } from '../lib/ratings/derive';

const CATEGORIES = [
  { id: 'brain',   label: 'Brain',   icon: '◉' },
  { id: 'finance', label: 'Finance', icon: '☰' },
  { id: 'fitness', label: 'Fitness', icon: '▲' },
  { id: 'social',  label: 'Social',  icon: '◌' },
];

/**
 * Three-tier scale to match the Ledger mockup's right-side label.
 * Boundaries: 1-39 Starting, 40-79 Mid, 80-99 Elite. Colours chosen
 * to read against both cream and dark backgrounds via CSS vars.
 */
function tier(score) {
  if (score >= 80) return { label: 'Elite',    color: 'var(--gold, #c8970a)',   key: 'elite' };
  if (score >= 40) return { label: 'Mid',      color: 'var(--em, #1a7a4a)',     key: 'mid' };
  return                  { label: 'Starting', color: 'var(--text-muted)',      key: 'starting' };
}

export default function RatingsPanel({ S, compact = false }) {
  const r = S?.ratings || {};
  const ovr = r.ovr || 1;
  const ovrTier = tier(ovr);
  const [activeBreakdown, setActiveBreakdown] = useState(null);

  return (
    <>
      <div className={`ratings-ledger${compact ? ' ratings-ledger-compact' : ''}`}>
        {/* Header bar — mono eyebrow + version label */}
        <div className="ratings-ledger-head">
          <span className="ratings-ledger-eyebrow">RATINGS · LEDGER</span>
          <span className="ratings-ledger-tag">F5 · S3</span>
        </div>

        {/* OVR hero — bracket label, big italic number, /99 suffix, tier */}
        <div className="ratings-ledger-ovr-row">
          <div className="ratings-ledger-ovr-block">
            <span className="ratings-ledger-ovr-label">[ OVR ]</span>
            <span className="ratings-ledger-ovr-value">{ovr}</span>
            <span className="ratings-ledger-ovr-suffix">/99</span>
          </div>
          <span className="ratings-ledger-ovr-tier" style={{ color: ovrTier.color }}>
            → {ovrTier.label.toUpperCase()}
          </span>
        </div>

        {/* Per-category rows */}
        <ul className="ratings-ledger-rows">
          {CATEGORIES.map((c, i) => {
            const score = r[c.id] || 1;
            const t = tier(score);
            const pct = Math.max(2, Math.min(100, score));
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="ratings-ledger-row"
                  onClick={() => setActiveBreakdown(c.id)}
                  aria-label={`${c.label} ${score} of 99 — tap for breakdown`}
                >
                  <span className="ratings-ledger-row-idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="ratings-ledger-row-icon">{c.icon}</span>
                  <span className="ratings-ledger-row-label">{c.label}</span>
                  <span className="ratings-ledger-row-track" aria-hidden="true">
                    <span
                      className={`ratings-ledger-row-fill ratings-ledger-row-fill-${t.key}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span
                    className="ratings-ledger-row-score"
                    style={{ color: t.color }}
                  >{score}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {activeBreakdown && (
        <BreakdownModal
          S={S}
          category={activeBreakdown}
          onClose={() => setActiveBreakdown(null)}
        />
      )}
    </>
  );
}

function BreakdownModal({ S, category, onClose }) {
  const meta = CATEGORIES.find(c => c.id === category) || { label: category, icon: '·' };
  const score = (S?.ratings || {})[category] || 1;
  const t = tier(score);
  const rows = categoryBreakdown(S, category);
  const totalPoints = rows.reduce((sum, r) => sum + (r.points || 0), 0);

  return (
    <div
      className="modal-overlay open"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20, color: t.color }}>{meta.icon}</span>
          {meta.label}
          <span style={{
            marginLeft: 'auto',
            fontFamily: 'var(--mono)',
            fontSize: 26,
            color: t.color,
            fontVariantNumeric: 'tabular-nums',
          }}>{score}<span style={{ fontSize: 14, color: 'var(--text-muted)' }}>/99</span></span>
        </h3>
        <p style={{
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)',
          margin: '0 0 14px', lineHeight: 1.65, letterSpacing: 0.4,
        }}>
          TIER · <span style={{ color: t.color }}>{t.label.toUpperCase()}</span> · {totalPoints.toFixed(1)} POINTS
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((row, i) => {
            const pct = totalPoints > 0 ? (row.points / totalPoints) * 100 : 0;
            return (
              <li key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--card, rgba(255,255,255,0.04))',
              }}>
                <span style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: 12.5 }}>{row.label}</span>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 11,
                  color: row.points > 0 ? 'var(--em)' : 'var(--text-muted)',
                  fontWeight: 700, minWidth: 50, textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {row.points.toFixed(1)} pt
                </span>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 10,
                  color: 'var(--text-muted)',
                  minWidth: 36, textAlign: 'right',
                }}>{pct.toFixed(0)}%</span>
              </li>
            );
          })}
        </ul>
        <p style={{
          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)',
          marginTop: 14, lineHeight: 1.65, letterSpacing: 0.4,
        }}>
          Friends see a server-recomputed copy of these ratings — editing your local data won't change what they see.
        </p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
