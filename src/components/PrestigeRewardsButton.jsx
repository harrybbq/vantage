/**
 * Prestige rewards, classic design: a small button for the Ratings panel
 * and the modal it opens — what you have unlocked and what is next.
 *
 * Same data as the console sheet (hub/PrestigeRewards.jsx), all from
 * lib/ratings/prestigeRewards.js. Read-only: classic has no hub card
 * styles (its hub has no equivalent of the console's widget frames), so
 * those rows are listed as console-only and nothing here writes state.
 *
 * Self-contained so the Ratings panel only needs one line to mount it.
 * Renders nothing under the console design, where the player strip is
 * the entry point (and opens the console sheet instead).
 */
import { useState } from 'react';
import Overlay from './ui/Overlay';
import Icon from './Icon';
import PrestigeBadge from './PrestigeBadge';
import PrestigeFrame from './PrestigeFrame';
import { backdropClose } from '../utils/backdropClose';
import { useDesign } from '../hooks/useDesign';
import { toRoman } from '../lib/ratings/prestige';
import {
  REWARDS, STANDING_REWARD, KIND_LABEL, PRESTIGE_ACCENTS, prestigeProgress, prestigeName,
} from '../lib/ratings/prestigeRewards';

const OLD_ACCENT_HEX = { purple: '#5a1a7a', orange: '#7a3a1a', pink: '#7a1a4a' };
const accentHex = id => OLD_ACCENT_HEX[id] || (PRESTIGE_ACCENTS.find(a => a.id === id) || {}).em || null;
const mono = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-floor)' };

function Row({ at, on, next, swatch, title, kind, desc, children }) {
  return (
    <li style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 9,
      border: '1px solid ' + (next ? 'rgba(var(--em-rgb), .45)' : on ? 'rgba(var(--em-rgb), .30)' : 'var(--border)'),
      background: on ? 'rgba(var(--em-rgb), .06)' : 'transparent',
    }}>
      <span style={{ ...mono, width: 26, textAlign: 'center', flexShrink: 0, fontWeight: 700, color: on ? 'var(--em-text)' : 'var(--text-muted)' }}>{at}</span>
      <span style={{ width: 32, display: 'flex', justifyContent: 'center', flexShrink: 0, opacity: on ? 1 : 0.55 }}>
        {swatch}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
          {title} <span style={{ ...mono, fontWeight: 400, color: 'var(--text-muted)' }}>{kind}</span>
        </div>
        <div style={{ ...mono, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
      </div>
      <span style={{ ...mono, flexShrink: 0, fontWeight: 700, color: on || next ? 'var(--em-text)' : 'var(--text-muted)' }}>{children}</span>
    </li>
  );
}

function RewardsModal({ S, onClose }) {
  const p = Number(S?.prestige) || 0;
  const ovr = S?.__slim ? null : (S?.ratings?.ovr ?? null);
  const pg = prestigeProgress(ovr, p);
  const initials = ((S?.profile?.name || 'You').trim()[0] || 'Y').toUpperCase();
  const avatar = size => (S?.profile?.photo
    ? <img src={S.profile.photo} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
    : <span style={{ width: size, height: size, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--em)', color: '#fff', fontWeight: 700, fontSize: Math.round(size * 0.42) }}>{initials}</span>);
  return (
    <Overlay>
      <div className="modal-overlay open" {...backdropClose(onClose)}>
        <div className="modal" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-label="Prestige rewards">
          <div style={{ ...mono, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--em-text)', fontWeight: 700 }}>// PRESTIGE</div>
          <h3 style={{ margin: '2px 0 10px' }}>Prestige rewards</h3>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '4px 0 12px' }}>
            <PrestigeFrame prestige={p}>{avatar(48)}</PrestigeFrame>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontWeight: 600, color: 'var(--text)' }}>
                {p ? prestigeName(p) : 'No prestige yet'} {p > 0 && <PrestigeBadge prestige={p} size="sm" />}
              </div>
              <div style={{ ...mono, color: 'var(--text-muted)', marginTop: 4 }}>
                {pg.ready ? 'OVR 99: prestige up from your ratings.' : pg.next ? `${pg.toGo == null ? '–' : pg.toGo} OVR to ${pg.nextName}` : 'Every prestige reached.'}
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', marginTop: 6, overflow: 'hidden' }} aria-hidden="true">
                <div style={{ width: `${pg.pct}%`, height: '100%', background: 'var(--em)' }} />
              </div>
            </div>
          </div>

          <p style={{ ...mono, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55 }}>
            Reach OVR 99 and prestige to unlock the next reward. Your rating climbs again from the floor; nothing else is wiped. Rewards are earned, so Pro does not include the prestige-only accents.
          </p>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '52vh', overflowY: 'auto' }}>
            <Row at="I+" on={p > 0} title={STANDING_REWARD.name} kind="" desc={STANDING_REWARD.desc}
                 swatch={<PrestigeFrame prestige={Math.max(1, p)}>{avatar(24)}</PrestigeFrame>}>
              {p > 0 ? '✓' : 'P1'}
            </Row>
            {REWARDS.map(r => {
              const on = r.at <= p;
              const next = pg.reward && pg.reward.id === r.id;
              const swatch = r.kind === 'accent'
                ? <span style={{ width: 22, height: 22, borderRadius: 6, background: accentHex(r.id) || 'var(--border)', display: 'block' }} />
                : r.kind === 'frame'
                  ? <PrestigeFrame prestige={r.at}>{avatar(24)}</PrestigeFrame>
                  : r.kind === 'badge'
                    ? <PrestigeBadge prestige={r.at} size="sm" />
                    : <Icon name="layout-grid" size={18} />;
              return (
                <Row key={r.id} at={toRoman(r.at)} on={on} next={next} swatch={swatch} title={r.name}
                     kind={r.kind === 'card' ? `${KIND_LABEL.card} · new design only` : KIND_LABEL[r.kind]} desc={r.desc}>
                  {on ? '✓' : next ? 'Next' : `P${r.at}`}
                </Row>
              );
            })}
          </ul>

          <div className="modal-actions">
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

export default function PrestigeRewardsButton({ S }) {
  const { isConsole } = useDesign();
  const [open, setOpen] = useState(false);
  if (isConsole) return null;
  const p = prestigeProgress(S?.__slim ? null : S?.ratings?.ovr, S?.prestige);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm ratings-rewards-btn"
        onClick={() => setOpen(true)}
        style={{ width: '100%', justifyContent: 'center', ...mono, letterSpacing: 0.6 }}
        title={p.reward ? `Next: ${p.reward.name} at ${prestigeName(p.reward.at)}` : undefined}
        aria-label="Prestige rewards: what you have unlocked and what is next"
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="trophy" size={13} /> Prestige rewards
        </span>
      </button>
      {open && <RewardsModal S={S} onClose={() => setOpen(false)} />}
    </>
  );
}
