/**
 * Upgrade's home menu — what the section opens on. The big "Upgrade"
 * title with today's line under it, then one card per section (Career,
 * Diet, Rotation, Security, Books), all on one solid sheet so nothing sits on
 * the page's background photo. Tapping a card opens that section.
 *
 * Every card reads from useHomeLines (home/useHomeLines.js), which owns
 * the data: a headline figure + its caption, one supporting sentence, a
 * state (ok / attention / critical / unknown / neutral), when the data
 * is from, and — for cards that fetch — an error and a retry. This file
 * is markup only; nothing here fetches or writes anything.
 *
 * Card anatomy: icon · name · state tag (dot + word, never colour
 * alone) / figure + caption / sentence / footer "Updated 2 m ago" and a
 * chevron. On a failed fetch the footer carries the error and a Retry
 * that re-fetches WITHOUT opening the section: the card is a container
 * whose main area is the open-button (stretched over the whole card) and
 * Retry is a sibling button stacked above it.
 *
 * Loading: nothing for the first 300 ms, then skeleton bars sized like
 * the final figure and sentence, so the card never changes size.
 *
 * Motion (the character, kept on purpose): cards sit at a slight tilt on
 * staggered tops, float in, bob twice, then settle; hover lifts a few px.
 * All of it is off under prefers-reduced-motion, and the one-column phone
 * layout drops the tilt and stagger.
 */
import { useEffect, useState } from 'react';
import Icon from '../Icon';
import { useHomeLines } from './home/useHomeLines';
import { ago, exactTime, rotationLine } from '../../lib/upgrade/homeLines';

export const SECTIONS = [
  { id: 'career', name: 'Career', icon: 'briefcase', tone: 'gold' },
  { id: 'diet', name: 'Diet', icon: 'utensils', tone: 'em' },
  { id: 'rotation', name: 'Rotation', icon: 'refresh-cw', tone: 'ink' },
  { id: 'security', name: 'Security', icon: 'shield', tone: 'em' },
  { id: 'books', name: 'Books', icon: 'book-open', tone: 'gold' },
];

/** Tab ids that used to exist, mapped forward (history entries, deep links). */
export const SECTION_ALIASES = { review: 'security' };
export const resolveSection = id => SECTION_ALIASES[id] || id;

// Lives with the other card shaping now; re-exported for existing importers.
export { rotationLine };

/** The word that always travels with a state dot. Neutral has no dot. */
const STATE_WORD = { ok: 'OK', attention: 'Attention', critical: 'Critical', unknown: 'Unknown' };

/** Ticks so "Updated 2 m ago" stays true while the menu is open. */
function useNow(every = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** True once `on` has held for `ms` — the skeleton's 300 ms grace. */
function useAfter(on, ms) {
  const [since, setSince] = useState(null);
  useEffect(() => {
    if (!on) { setSince(null); return undefined; }
    const t = setTimeout(() => setSince(Date.now()), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && since != null;
}

function StateDot({ state }) {
  if (!STATE_WORD[state]) return null;
  return <i className={`uh-dot is-${state}`} aria-hidden="true" />;
}

function Fresh({ updatedAt, now }) {
  if (updatedAt == null) return <span className="uh-fresh" title="Worked out from your data just now">Live</span>;
  const a = ago(updatedAt, now);
  return (
    <span className="uh-fresh" title={exactTime(updatedAt)}>
      {a === 'now' ? 'Updated just now' : `Updated ${a} ago`}
    </span>
  );
}

function HomeCard({ section: s, card, index, now, onOpen }) {
  const c = card || { loading: true, state: 'neutral' };
  const loading = !!c.loading;
  const skel = useAfter(loading, 300);
  const word = STATE_WORD[c.state] || null;
  const failed = !loading && !!c.error;
  const open = e => onOpen(s.id, e.currentTarget.closest('.uh-card').getBoundingClientRect());
  const label = loading
    ? `Open ${s.name}. Loading.`
    : ['Open ' + s.name, [c.figure, c.figureLabel].filter(Boolean).join(' '), c.text, failed ? c.error : null, word ? `Status ${word.toLowerCase()}` : null]
        .filter(Boolean).join('. ');

  return (
    <div role="listitem" className={`uh-slot is-${index}`} style={{ '--i': index }}>
      <i className="uh-floor" aria-hidden="true" />
      <div className="uh-bob">
        <div className={`uh-card tone-${s.tone} is-${c.state || 'neutral'}${loading ? ' is-loading' : ''}${skel ? ' is-skel' : ''}`}
             aria-busy={loading ? 'true' : undefined}>
          <button type="button" className="uh-card-main" aria-label={label}
                  onClick={open}>
            <span className="uh-icon" aria-hidden="true"><Icon name={s.icon} size={20} strokeWidth={1.9} /></span>
            <span className="uh-head">
              <span className="uh-name">{s.name}</span>
              {!loading && word && (
                <span className={`uh-tag is-${c.state}`}><StateDot state={c.state} /><span className="uh-tag-word">{word}</span></span>
              )}
            </span>
            <span className="uh-fig">
              {loading ? (
                <><span className="uh-bar uh-bar-fig" /><span className="uh-bar uh-bar-cap" /></>
              ) : (
                <>
                  <span className="uh-figure">{c.figure || '—'}</span>
                  {(c.figureLabel || !c.figure) && <span className="uh-figlabel">{c.figureLabel || 'no reading'}</span>}
                </>
              )}
            </span>
            <span className="uh-text" title={!loading && c.text ? c.text : undefined}>
              {loading
                ? <><span className="uh-bar uh-bar-line" /><span className="uh-bar uh-bar-line is-short" /></>
                : (c.text || (failed ? 'Unknown until it answers again.' : ''))}
            </span>
          </button>
          {/* Mouse-only extra hit area (the main button is the keyboard path). */}
          <div className="uh-foot" onClick={open}>
            {loading ? <span className="uh-bar uh-bar-foot" />
              : failed ? (
                <>
                  <span className="uh-err"><Icon name="octagon-alert" size={14} strokeWidth={2} /><span>{c.error}</span></span>
                  {c.retry && (
                    <button type="button" className="uh-retry" aria-label={`Retry ${s.name}`}
                            onClick={e => { e.stopPropagation(); c.retry(); }}>
                      <Icon name="rotate-cw" size={13} strokeWidth={2} /> Retry
                    </button>
                  )}
                </>
              ) : <Fresh updatedAt={c.updatedAt} now={now} />}
            <span className="uh-chev" aria-hidden="true"><Icon name="chevron-right" size={16} strokeWidth={2} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UpgradeHome({ S, userId, onOpen }) {
  const { hero, cards } = useHomeLines(S, userId);
  const now = useNow();
  const heroWord = STATE_WORD[hero && hero.state];

  return (
    <div className="uh">
      <header className="uh-hero">
        <span className="uh-eyebrow">Owner · Vantage</span>
        <h2 className="uh-title">Upgrade</h2>
        <p className="uh-sub">
          <StateDot state={hero && hero.state} />
          {heroWord && <span className="sr-only">Status {heroWord.toLowerCase()}. </span>}
          <span>{hero && hero.sub}</span>
        </p>
      </header>
      <div className="uh-grid" role="list">
        {SECTIONS.map((s, i) => (
          <HomeCard key={s.id} section={s} card={cards && cards[s.id]} index={i} now={now} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
