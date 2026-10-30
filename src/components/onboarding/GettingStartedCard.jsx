/**
 * Getting started — the hub card that keeps the onboarding going after
 * the overlay ("pick what it's for, then do the first thing", owner, Oct
 * 2026). One row per pick's first thing; each ticks itself off when the
 * state says it happened (lib/onboarding/onboarding.js gettingStarted).
 *
 * One component, two looks:
 *   variant="classic"  ob-gs-* classes, ./GettingStartedCard.css (OS-panel
 *                      language: mono eyebrow, hairlines, accent border)
 *   variant="console"  cx-panel + cx-gs-* classes, design/console/hub.css
 * `phone` sizes the controls for touch (44 px targets).
 *
 * Renders nothing unless gettingStarted(S, ctx).visible — so an account
 * that onboarded before this existed (no S.onboarding.picks) never sees
 * it, and it goes once every item is done or it is hidden.
 *
 * Writes: "Hide" only, through hideGettingStarted (S.onboarding.hidden,
 * additive). "Do it" writes nothing and navigates nowhere: it asks App
 * through the onboarding bus, and App runs the pick's first thing.
 *
 * `friends` is the friend count where the host already has it (the
 * console hub's useFriendsHub, the classic rail). Unknown → leave it out;
 * the Friends item also counts once the invite link is shared.
 */
import { useMemo } from 'react';
import Icon from '../Icon';
import { gettingStarted, hideGettingStarted } from '../../lib/onboarding/onboarding';
import { requestOnboardingDo } from '../../lib/onboarding/bus';
import './GettingStartedCard.css';

export default function GettingStartedCard({ S, update, friends, variant = 'classic', phone = false, className = '' }) {
  const ctx = typeof friends === 'number' ? { friends } : {};
  const g = useMemo(() => gettingStarted(S, ctx),
    // gettingStarted reads S.onboarding plus the stores each first thing
    // checks; S is replaced on every write, so S + the count is the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [S, ctx.friends]);
  if (!g.visible) return null;

  const p = variant === 'console' ? 'cx-gs' : 'ob-gs';
  const sr = variant === 'console' ? 'cx-sr' : 'sr-only';
  const pct = g.total ? Math.round((g.doneCount / g.total) * 100) : 0;
  const root = [variant === 'console' ? 'cx-panel' : '', p, phone ? 'is-phone' : '', className].filter(Boolean).join(' ');

  return (
    <section className={root} aria-labelledby={`${p}-title`} data-testid="getting-started">
      <header className={`${p}-head`}>
        <h2 className={`${p}-t`} id={`${p}-title`}>Getting started</h2>
        <span className={`${p}-count`}>{g.doneCount} of {g.total}</span>
      </header>
      <div className={`${p}-bar`} role="progressbar" aria-label="Getting started progress"
           aria-valuemin={0} aria-valuemax={g.total} aria-valuenow={g.doneCount}
           aria-valuetext={`${g.doneCount} of ${g.total} done`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <ul className={`${p}-list`}>
        {g.items.map(it => (
          <li key={it.id} className={`${p}-row${it.done ? ' is-done' : ''}`} data-gs-item={it.id}>
            <span className={`${p}-mark`} aria-hidden="true">
              {it.done && <Icon name="check" size={12} strokeWidth={2.5} />}
            </span>
            <span className={`${p}-label`}>
              {it.label}
              {it.done && <span className={sr}> (done)</span>}
            </span>
            {it.done ? (
              <span className={`${p}-pick`}>{it.pick}</span>
            ) : (
              <button type="button" className={`${p}-do`} title={it.cta}
                      aria-label={`Do it: ${it.label}`}
                      onClick={() => requestOnboardingDo(it.id)}>
                Do it
              </button>
            )}
          </li>
        ))}
      </ul>
      <footer className={`${p}-foot`}>
        <span className={`${p}-note`}>Stays here until each one is done.</span>
        <button type="button" className={`${p}-hide`} onClick={() => update(prev => hideGettingStarted(prev))}>
          Hide
        </button>
      </footer>
    </section>
  );
}
