/**
 * RatingsPanel — F5 Sprint 3 surface (Ledger design, 2026-05-12),
 * extended in Sprint 5 with self-checks for all four categories.
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
 * Tap any row → breakdown modal. Each modal carries a "Take the
 * check" CTA wired to that category's self-check component, gated
 * by the shared 30-day cooldown.
 */
import { useState } from 'react';
import { categoryBreakdown } from '../lib/ratings/derive';
import { ovrTier } from '../lib/ratings/tiers';
import { isCooldownActive, daysUntilRetake } from './SelfCheck';
import BrainCheck   from './BrainCheck';
import FinanceCheck from './FinanceCheck';
import FitnessCheck from './FitnessCheck';
import SocialCheck  from './SocialCheck';

const CATEGORIES = [
  { id: 'brain',   label: 'Brain',   icon: '◉' },
  { id: 'finance', label: 'Finance', icon: '☰' },
  { id: 'fitness', label: 'Fitness', icon: '▲' },
  { id: 'social',  label: 'Social',  icon: '◌' },
];

// Per-category self-check metadata. `stateKey` is where the score
// object lives on the user's state; `Component` is the wrapper that
// supplies its question bank to the generic SelfCheck engine.
const SELF_CHECKS = {
  brain: {
    stateKey: 'brainScore',
    Component: BrainCheck,
    ctaTitle: 'Brain rating self-check',
    blurb: '16 short reasoning questions · 12-min cap · contributes ~6–18 points.',
  },
  finance: {
    stateKey: 'financeScore',
    Component: FinanceCheck,
    ctaTitle: 'Finance literacy self-check',
    blurb: '16 short money-literacy questions · 12-min cap · contributes ~6–18 points.',
  },
  fitness: {
    stateKey: 'fitnessScore',
    Component: FitnessCheck,
    ctaTitle: 'Fitness knowledge self-check',
    blurb: '16 short exercise-science questions · 12-min cap · contributes ~6–18 points.',
  },
  social: {
    stateKey: 'socialScore',
    Component: SocialCheck,
    ctaTitle: 'Social skills self-check',
    blurb: '16 short interpersonal-skills questions · 12-min cap · contributes ~6–18 points.',
  },
};

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

export default function RatingsPanel({ S, update, compact = false }) {
  const r = S?.ratings || {};
  const ovr = r.ovr || 1;
  // Prestige band drives the headline glow + the OVR-row tier label.
  // (Per-category rows below still use the 3-tier Starting/Mid/Elite
  // `tier()` scale — a different axis.)
  const prestige = ovrTier(ovr);
  const [activeBreakdown, setActiveBreakdown] = useState(null);
  const [activeCheck, setActiveCheck] = useState(null);

  const ActiveCheckCmp = activeCheck ? SELF_CHECKS[activeCheck]?.Component : null;

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
            <span className={`ratings-ledger-ovr-value ovr-num ovr-tier-${prestige.key}`}>{ovr}</span>
            <span className="ratings-ledger-ovr-suffix">/99</span>
          </div>
          <span className="ratings-ledger-ovr-tier" style={{ color: prestige.color }}>
            → {prestige.label.toUpperCase()}
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
          onTakeCheck={() => {
            const next = activeBreakdown;
            setActiveBreakdown(null);
            setActiveCheck(next);
          }}
        />
      )}

      {ActiveCheckCmp && update && (
        <ActiveCheckCmp
          S={S}
          update={update}
          onClose={() => setActiveCheck(null)}
        />
      )}
    </>
  );
}

function BreakdownModal({ S, category, onClose, onTakeCheck }) {
  const meta = CATEGORIES.find(c => c.id === category) || { label: category, icon: '·' };
  const score = (S?.ratings || {})[category] || 1;
  const t = tier(score);
  const rows = categoryBreakdown(S, category);
  const totalPoints = rows.reduce((sum, r) => sum + (r.points || 0), 0);

  const checkCfg = SELF_CHECKS[category];
  const lastResult = checkCfg ? S?.[checkCfg.stateKey] : null;
  const cooldownActive = isCooldownActive(lastResult);
  const cooldownDaysLeft = daysUntilRetake(lastResult);

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

        {checkCfg && onTakeCheck && (
          <div style={{
            marginTop: 12, padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(var(--em-rgb), 0.08)',
            border: '1px solid rgba(var(--em-rgb), 0.32)',
          }}>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.2,
              textTransform: 'uppercase', color: 'var(--em)', fontWeight: 700,
              marginBottom: 4,
            }}>{checkCfg.ctaTitle}</div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)',
              lineHeight: 1.55, marginBottom: 10,
            }}>
              {cooldownActive
                ? `Already taken — re-takeable in ${cooldownDaysLeft} day${cooldownDaysLeft === 1 ? '' : 's'}.`
                : checkCfg.blurb}
            </div>
            <button
              type="button"
              onClick={onTakeCheck}
              disabled={cooldownActive}
              style={{
                padding: '7px 12px', borderRadius: 6,
                background: cooldownActive ? 'transparent' : 'var(--em)',
                color: cooldownActive ? 'var(--text-muted)' : 'var(--em-on, #fff)',
                border: cooldownActive ? '1px solid var(--border)' : '1px solid var(--em)',
                fontFamily: 'var(--mono)', fontSize: 10,
                letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700,
                cursor: cooldownActive ? 'not-allowed' : 'pointer',
              }}
            >
              {lastResult?.result
                ? (cooldownActive ? `Locked · last result ${lastResult.result}` : `Retake (last: ${lastResult.result})`)
                : 'Take the check'}
            </button>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
