/**
 * Prestige rewards, console design: the sheet the player strip opens,
 * and the hub card style picker (also shown in Settings › Appearance).
 *
 * Everything comes from lib/ratings/prestigeRewards.js (the same module
 * the classic view reads): the ladder, what is unlocked at S.prestige,
 * progress to the next prestige from S.ratings.ovr, the avatar frame.
 *
 * The one write is S.cardStyle, through withCardStyle (one additive key;
 * a locked or unknown style writes nothing).
 */
import Icon from '../../../components/Icon';
import { Sheet } from '../ui';
import { Avatar, Diamonds } from './DivisionTable';
import {
  REWARDS, STANDING_REWARD, KIND_LABEL, CARD_STYLES, PRESTIGE_ACCENTS,
  prestigeProgress, prestigeName, frameFor, resolveCardStyle, withCardStyle,
} from '../../../lib/ratings/prestigeRewards';
import { toRoman } from '../../../lib/ratings/prestige';

/** The original three accents' colours (SettingsSection SCHEMES), for swatches. */
const OLD_ACCENT_HEX = { purple: '#5a1a7a', orange: '#7a3a1a', pink: '#7a1a4a' };
const accentHex = id => OLD_ACCENT_HEX[id] || (PRESTIGE_ACCENTS.find(a => a.id === id) || {}).em || null;
const KIND_ICON = { accent: 'palette', card: 'layout-grid', frame: 'circle-user', badge: 'trophy' };

/** Hub card style chips. Locked styles show the prestige that unlocks them. */
export function CardStylePicker({ S, update }) {
  const current = resolveCardStyle(S);
  const p = Number(S?.prestige) || 0;
  return (
    <div className="cx-hub-cs" role="radiogroup" aria-label="Hub card style">
      {CARD_STYLES.map(c => {
        const locked = c.at > p;
        const on = current === c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={locked}
            className={`cx-hub-cs-opt${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
            title={locked ? `Unlocks at ${prestigeName(c.at)}` : c.desc}
            onClick={() => update(prev => withCardStyle(prev, c.id))}
          >
            <span className="cx-hub-cs-swatch" data-cx-card={c.id} aria-hidden="true" />
            <span className="cx-hub-cs-name">{c.name}</span>
            <span className="cx-hub-cs-hint">{locked ? prestigeName(c.at) : on ? 'In use' : 'Unlocked'}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A locked row: the numeral is already in the first column, so just a lock. */
function Locked({ at }) {
  return <span className="cx-muted" role="img" aria-label={`Unlocks at ${prestigeName(at)}`} title={`Unlocks at ${prestigeName(at)}`}><Icon name="lock" size={14} strokeWidth={1.75} /></span>;
}

function Preview({ r, S }) {
  if (r.kind === 'accent') return <span className="cx-hub-rw-swatch" style={{ background: accentHex(r.id) || 'var(--cx-s3)' }} aria-hidden="true" />;
  if (r.kind === 'card') return <span className="cx-hub-cs-swatch is-small" data-cx-card={r.id} aria-hidden="true" />;
  if (r.kind === 'frame') return <Avatar name={S?.profile?.name || 'You'} url={S?.profile?.photo || null} size={26} prestige={r.at} />;
  return <Diamonds n={r.at} />;
}

export default function PrestigeRewardsSheet({ S, update, onClose, onOpenRatings }) {
  const p = Number(S?.prestige) || 0;
  const ovr = S?.__slim ? null : (S?.ratings?.ovr ?? null);
  const pg = prestigeProgress(ovr, p);
  const frame = frameFor(p);
  const name = (S?.profile?.name || '').trim() || 'You';
  return (
    <Sheet title="Prestige rewards" onClose={onClose} width={520} testId="cx-prestige-rewards" className="cx-hub-rewards">
      <div className="cx-hub-rw">
        <section className="cx-hub-rw-now">
          <Avatar name={name} url={S?.profile?.photo || null} size={52} self prestige={p} />
          <div className="cx-hub-rw-now-t">
            <span className="cx-t17 cx-hub-rw-strong">{p ? prestigeName(p) : 'No prestige yet'}</span>
            <span className="cx-t13 cx-muted">
              {frame ? `${frame.bandLabel} band. ` : ''}
              {pg.ready
                ? 'OVR 99: you can prestige now, from your ratings.'
                : pg.next ? `${pg.toGo == null ? '–' : pg.toGo} OVR to ${pg.nextName}.` : 'Every prestige reached.'}
            </span>
            <span className="cx-hub-bar is-thick" aria-hidden="true"><i style={{ width: `${pg.pct}%` }} /></span>
          </div>
        </section>
        {pg.ready && onOpenRatings && (
          <button type="button" className="cx-btn cx-btn--primary cx-btn--block" onClick={onOpenRatings}>
            <Icon name="star" size={16} strokeWidth={1.75} /> Prestige from your ratings
          </button>
        )}
        <p className="cx-t13 cx-mid cx-hub-rw-lede">
          Reach OVR 99 and prestige to unlock the next reward. Your rating starts its climb again; everything else stays.
          Rewards are earned, so Pro does not include the prestige-only accents.
        </p>

        <ul className="cx-hub-rw-list">
          <li className={`cx-hub-rw-row${p ? ' is-on' : ''}`}>
            <span className="cx-hub-rw-at cx-num">I+</span>
            <span className="cx-hub-rw-pv"><Avatar name={name} url={S?.profile?.photo || null} size={26} prestige={Math.max(1, p)} /></span>
            <span className="cx-hub-rw-tx">
              <span className="cx-hub-rw-name">{STANDING_REWARD.name}</span>
              <span className="cx-hub-rw-desc">{STANDING_REWARD.desc}</span>
            </span>
            <span className="cx-hub-rw-st">{p ? <span className="cx-gold" aria-label="Unlocked">◆</span> : <Locked at={1} />}</span>
          </li>
          {REWARDS.map(r => {
            const on = r.at <= p;
            const next = pg.reward && pg.reward.id === r.id;
            return (
              <li key={r.id} className={`cx-hub-rw-row${on ? ' is-on' : ''}${next ? ' is-next' : ''}`}>
                <span className="cx-hub-rw-at cx-num">{toRoman(r.at)}</span>
                <span className="cx-hub-rw-pv"><Preview r={r} S={S} /></span>
                <span className="cx-hub-rw-tx">
                  <span className="cx-hub-rw-name">
                    <Icon name={KIND_ICON[r.kind]} size={14} strokeWidth={1.75} /> {r.name}
                    <span className="cx-hub-rw-kind">{KIND_LABEL[r.kind]}</span>
                  </span>
                  <span className="cx-hub-rw-desc">{r.desc}</span>
                </span>
                <span className="cx-hub-rw-st">
                  {on ? <span className="cx-gold" aria-label="Unlocked">◆</span> : next ? <span className="cx-accent">Next</span> : <Locked at={r.at} />}
                </span>
              </li>
            );
          })}
        </ul>

        <section className="cx-hub-rw-cs">
          <h3 className="cx-hub-rw-h">Hub card style</h3>
          <p className="cx-t13 cx-muted">Only you see it, on your hub.</p>
          <CardStylePicker S={S} update={update} />
        </section>
      </div>
    </Sheet>
  );
}
