/**
 * The prime cards, as they appear in both Add Widget pickers.
 *
 * ── Why they look different from everything else in the picker ───────
 * A prime is not one more widget in the list — it replaces several of
 * them, and what it shows is chosen. A row of icon + label cannot say
 * either of those things, so each prime is shown as a live preview of
 * the card it will add, drawn from the user's own data, with the preset
 * that decides its starting blocks right under it. What you see in the
 * picker is what lands on the hub.
 *
 * ── Why a preset is picked here ──────────────────────────────────────
 * Adding a card and then immediately opening its editor to get the
 * blocks you wanted is two steps where one will do. The first preset is
 * pre-selected, so a user who does not care still adds in one tap.
 *
 * Primes are instanceable, so nothing here is ever "already added" —
 * the count is shown instead ("2 on your hub"), which is what makes a
 * second Savings card showing different blocks feel intended.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../Icon';
import { PRIMES, PRIME_IDS, primeOf, primeType } from '../../../lib/hub/primeBlocks';
import PrimeCard from './PrimeCard';
import { useDaySummary } from '../../../lib/diet/daySummary';

/* The preview is rendered at a real card size and scaled down, so it is
   the actual packer output rather than a drawing of it. */
const PREVIEW_W = 400;
const PREVIEW_H = 230;

const BLURB = {
  savings: 'Total, pots, runway, bills, accounts, where the month goes',
  trackers: 'Today’s ticks, streaks, weekly targets, a heatmap',
  achievements: 'Next unlock, coins, recent wins, the path ahead',
  holidays: 'Countdown, itinerary, budget, packing',
  habits: 'Streak timers with relapse, milestones, strikes',
  nutrition: 'Macro rings, net calories, calories burned, 14-day trend',
};

function Preview({ keyId, blocks, S, ext }) {
  const ref = useRef(null);
  const [k, setK] = useState(0.5);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setK(Math.min(1, (el.clientWidth || PREVIEW_W) / PREVIEW_W));
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="pp-preview" ref={ref} style={{ height: Math.round(PREVIEW_H * k) }} aria-hidden="true">
      <div className="pp-preview-inner" style={{ transform: `scale(${k})` }}>
        <PrimeCard
          widget={{ id: 'preview-' + keyId, type: primeType(keyId), blocks }}
          S={S}
          ext={ext}
          width={PREVIEW_W}
          height={PREVIEW_H}
        />
      </div>
    </div>
  );
}

function PrimeTile({ keyId, S, count, onAdd, compact, ext }) {
  const P = PRIMES[keyId];
  const [preset, setPreset] = useState(0);
  const blocks = P.presets[preset][1];
  return (
    <div
      className={`pp-tile${compact ? ' is-compact' : ''}`}
      style={{ '--pp-col': P.col }}
    >
      <Preview keyId={keyId} blocks={blocks} S={S} ext={ext} />
      <div className="pp-body">
        <div className="pp-title">
          <span className="pp-chip" aria-hidden="true"><Icon name={P.icon} size={14} /></span>
          <span className="pp-name">{P.name}</span>
          {count > 0 && <span className="pp-count">{count} on your hub</span>}
        </div>
        <p className="pp-blurb">{BLURB[keyId]}</p>
        <div className="pp-presets" role="radiogroup" aria-label={`${P.name} starting layout`}>
          {P.presets.map(([name], i) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={i === preset}
              className={`pp-preset${i === preset ? ' is-on' : ''}`}
              onClick={() => setPreset(i)}
            >{name}</button>
          ))}
        </div>
        <button
          type="button"
          className="pp-add"
          onClick={() => onAdd({ type: primeType(keyId), blocks: blocks.map(id => ({ id })) })}
        >
          <Icon name="plus" size={13} /> Add {P.name} card
        </button>
      </div>
    </div>
  );
}

/**
 * @param widgets  the hub's current widget list — for the per-prime count
 * @param onAdd    ({ type, blocks }) → void; the caller adds the id
 */
export default function PrimePicker({ S, widgets = [], onAdd, compact = false, userId = null }) {
  // The Nutrition preview shows today's real rings; shared cached fetch.
  const day = useDaySummary(userId);
  const counts = {};
  widgets.forEach(w => {
    const k = primeOf(w);
    if (k) counts[k] = (counts[k] || 0) + 1;
  });
  return (
    <section className="pp" aria-label="Prime cards">
      <header className="pp-head">
        <span className="pp-eyebrow">Prime cards</span>
        <span className="pp-sub">One card per section — you choose what’s on it and in what order.</span>
      </header>
      <div className={`pp-grid${compact ? ' is-compact' : ''}`}>
        {PRIME_IDS.map(k => (
          <PrimeTile key={k} keyId={k} S={S} count={counts[k] || 0} onAdd={onAdd} compact={compact}
                     ext={k === 'nutrition' ? day : null} />
        ))}
      </div>
    </section>
  );
}
