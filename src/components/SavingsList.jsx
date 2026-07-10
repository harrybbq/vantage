/**
 * SavingsList — F4 Sprint 2, redesigned F4 Sprint 3.
 *
 * Each goal renders as a wide horizontal card:
 *   [ photo ]  goal name + target date           pct  ⋯
 *              ─────── progress bar ───────
 *              £current        £monthly chip      £target
 *
 * The photo is optional — without one we render an emoji-on-gradient
 * placeholder that picks up the theme's `--em` accent (so it adapts
 * across cream / dark × free / Pro). The monthly chip is derived from
 * (target - current) / months-until-target-date; hidden if the user
 * hasn't set a target date or the goal is already complete.
 *
 * Contributions: still tracked, but tucked behind a quiet "Show
 * contributions" toggle so the new card stays clean. Keeps the data
 * present without dominating the design.
 *
 * Privacy hard rule (unchanged): this component is the ONLY place that
 * renders £ amounts. Coach snapshot, public_stats, friends UI see
 * savings as count + names only.
 */
import { useState } from 'react';
import SavingsProjections from './SavingsProjections';

function formatGBP(n) {
  if (typeof n !== 'number') return '£0';
  const sign = n < 0 ? '-' : '';
  return sign + '£' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatGBPCompact(n) {
  // Tighter form used for the small monthly chip — no decimals over £999.
  if (typeof n !== 'number') return '£0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1000) return sign + '£' + abs.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  return sign + '£' + abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTargetDate(iso) {
  if (!iso) return '';
  // Stored as YYYY-MM-DD; render as DD/MM/YYYY to match the reference.
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function formatContribDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

/**
 * Months between now and an ISO date (YYYY-MM-DD). Floor at 1 so a
 * goal whose target date is past doesn't produce a divide-by-zero or
 * an unrealistically huge monthly figure.
 */
function monthsUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const months =
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth()) +
    // Fractional month from the day-of-month, so "30 days out" feels
    // like ~1 month instead of jumping between 0 and 1 at midnight.
    (target.getDate() - now.getDate()) / 30;
  return Math.max(1, months);
}

function GoalCard({ goal, achievement, contribMonthly = 0, onAddContribution, onEdit }) {
  const [showContribs, setShowContribs] = useState(false);
  const target = goal.target || 0;
  const current = goal.current || 0;
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const done = current >= target && target > 0;
  const months = monthsUntil(goal.targetDate);
  const remaining = Math.max(0, target - current);
  const monthly = months && !done ? remaining / months : null;
  const contribs = goal.contributions || [];
  // Months-till-achieved from a linked Projections pot contribution.
  const monthsToGoal = contribMonthly > 0 && remaining > 0 && !done
    ? Math.ceil(remaining / contribMonthly)
    : null;

  return (
    <div className={`savings-card${done ? ' is-done' : ''}`}>
      {/* Photo / emoji-gradient placeholder */}
      <div
        className="savings-card-photo"
        style={goal.image ? { backgroundImage: `url(${goal.image})` } : undefined}
        aria-hidden="true"
      >
        {!goal.image && (
          <span className="savings-card-photo-emoji">{goal.icon || '💰'}</span>
        )}
      </div>

      <div className="savings-card-body">
        <div className="savings-card-top">
          <div className="savings-card-title-block">
            <div className="savings-card-name-row">
              {goal.image && <span className="savings-card-inline-icon">{goal.icon || '💰'}</span>}
              <span className="savings-card-name">{goal.name}</span>
            </div>
            {goal.targetDate && (
              <div className="savings-card-date">{formatTargetDate(goal.targetDate)}</div>
            )}
            {achievement && (
              <span className="savings-card-link" title="Linked achievement — completes when this goal hits target">
                ✦ {achievement.name}
              </span>
            )}
          </div>
          <button
            type="button"
            className="savings-card-pct-btn"
            onClick={() => onEdit(goal.id)}
            aria-label="Edit goal"
            title="Edit goal"
          >
            <span className="savings-card-pct">{pct.toFixed(2)}%</span>
            <span className="savings-card-arrow" aria-hidden="true">→</span>
          </button>
        </div>

        <div className="savings-card-bar">
          <div
            className="savings-card-bar-fill"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>

        <div className="savings-card-bottom">
          <span className="savings-card-current">{formatGBP(current)}</span>
          {monthly != null ? (
            <div className="savings-card-monthly" title="Suggested monthly contribution to hit target on time">
              <span className="savings-card-monthly-amount">{formatGBPCompact(monthly)}</span>
              <span className="savings-card-monthly-label">Monthly</span>
            </div>
          ) : (
            <button
              type="button"
              className="savings-card-contribute"
              onClick={() => onAddContribution(goal.id)}
            >+ Add</button>
          )}
          <span className="savings-card-target-amount">{formatGBP(target)}</span>
        </div>

        {monthsToGoal != null && (
          <div className="savings-card-eta" title="Estimated from the monthly amount you route into this pot in Projections">
            <span className="savings-card-eta-months">≈ {monthsToGoal} {monthsToGoal === 1 ? 'month' : 'months'} to go</span>
            <span className="savings-card-eta-rate">at {formatGBPCompact(contribMonthly)}/mo</span>
          </div>
        )}

        <div className="savings-card-footer">
          {monthly != null && (
            <button
              type="button"
              className="savings-card-quickadd"
              onClick={() => onAddContribution(goal.id)}
            >+ Add contribution</button>
          )}
          <button
            type="button"
            className="savings-card-toggle"
            onClick={() => setShowContribs(s => !s)}
            disabled={contribs.length === 0}
          >
            {contribs.length === 0
              ? 'No contributions yet'
              : showContribs
                ? 'Hide contributions'
                : `Show ${contribs.length} contribution${contribs.length === 1 ? '' : 's'}`}
          </button>
        </div>

        {showContribs && contribs.length > 0 && (
          <ul className="savings-card-contribs">
            {contribs.map(c => (
              <li key={c.id}>
                <span className={`savings-contrib-amount${c.amount < 0 ? ' is-neg' : ''}`}>
                  {c.amount > 0 ? '+' : ''}{formatGBP(c.amount)}
                </span>
                {c.note && <span className="savings-contrib-note"> — {c.note}</span>}
                <span className="savings-contrib-date">{formatContribDate(c.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Monthly amount routed into each pot via linked Projections expenses.
function potContributions(projection) {
  const map = {};
  for (const it of (projection?.items || [])) {
    if (!it.goalId) continue; // expenses AND routed income both feed pots
    const v = parseFloat(it.amount) || 0;
    const monthly = it.freq === 'year' ? v / 12 : it.freq === 'week' ? v * 52 / 12 : v;
    map[it.goalId] = (map[it.goalId] || 0) + monthly;
  }
  return map;
}

export default function SavingsList({ S, update, onOpenModal }) {
  const goals = S.savings || [];
  const achievements = S.achievements || [];
  const potMonthly = potContributions(S.projection);

  if (goals.length === 0) {
    return (
      <>
        <div className="savings-empty">
          <div className="savings-empty-icon">💰</div>
          <div className="savings-empty-title">No savings goals yet</div>
          <p className="savings-empty-body">
            Track named goals (First Home, Wedding, Emergency Fund). Add a photo,
            set a target date, and link it to an achievement to auto-complete it
            when you hit target.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onOpenModal('addSavingsGoalModal')}
          >+ New Goal</button>
        </div>
        {update && <SavingsProjections S={S} update={update} />}
      </>
    );
  }

  // Active first, then completed at the bottom
  const sorted = [...goals].sort((a, b) => {
    const aDone = (a.current || 0) >= (a.target || 0) && (a.target || 0) > 0 ? 1 : 0;
    const bDone = (b.current || 0) >= (b.target || 0) && (b.target || 0) > 0 ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  return (
    <div className="savings-wrap">
      <div className="savings-toolbar">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onOpenModal('addSavingsGoalModal')}
        >+ New Goal</button>
      </div>
      <div className="savings-grid">
        {sorted.map(goal => {
          const achievement = goal.achievementId
            ? achievements.find(a => a.id === goal.achievementId)
            : null;
          return (
            <GoalCard
              key={goal.id}
              goal={goal}
              achievement={achievement}
              contribMonthly={potMonthly[goal.id] || 0}
              onAddContribution={id => onOpenModal('addContributionModal:' + id)}
              onEdit={id => onOpenModal('editSavingsGoalModal:' + id)}
            />
          );
        })}
      </div>
      {update && <SavingsProjections S={S} update={update} />}
    </div>
  );
}
