import { useEffect, useRef, useState } from 'react';
import Logo from './Logo';
import Icon from './Icon';
import { useWeather, weatherGlyph } from '../hooks/useWeather';
import { usePendingCount } from '../lib/friends/usePendingCount';
import { coinsTodayLabel } from '../lib/coins/daily';
import { ledgerRows } from '../lib/coins/ledger';

/**
 * Weather and where you are — one pill.
 *
 * It used to be the temperature alone, which is the least useful half of
 * it: 16° means something different in Manchester in September than it
 * does anywhere else, and a reading is only worth trusting if you can
 * see where it was taken.
 *
 * It carried a clock too, briefly. The Today panel already runs one, in
 * a size you can read across a room and with a seconds hand — so the
 * chip's was the same fact stated twice, the smaller one winning nothing
 * and costing a timer on every page of the app.
 *
 * Own solid styling so module transparency never hides it; desktop-only
 * via CSS.
 */
function WeatherChip({ enabled }) {
  const weather = useWeather(enabled);

  if (!enabled || !weather || weather.tempC == null) return null;
  const g = weatherGlyph(weather.code, weather.isDay);
  return (
    <span className="header-weather" title={`${g.label}${weather.city ? ' · ' + weather.city : ''}`}>
      <Icon name={g.icon} size={15} />
      <span className="header-weather-temp">{weather.tempC}°</span>
      {weather.city && <span className="header-weather-city">{weather.city}</span>}
    </span>
  );
}

/**
 * Friend requests waiting on you.
 *
 * Absent at zero rather than showing a nought: a permanent chip reading
 * "0" is a thing you learn to stop seeing, and the whole point of this
 * one is that it is unusual. Gold because it is the only chip in the bar
 * asking for something rather than reporting something.
 */
function RequestsChip({ userId, nudge, onOpen }) {
  const count = usePendingCount(userId, nudge);
  if (!count) return null;
  return (
    <button
      type="button"
      className="header-requests"
      onClick={onOpen}
      title={`${count} friend request${count === 1 ? '' : 's'} waiting`}
      aria-label={`${count} friend request${count === 1 ? '' : 's'} waiting`}
    >
      <Icon name="user-plus" size={14} />
      <span className="header-requests-n">{count > 9 ? '9+' : count}</span>
    </button>
  );
}

/**
 * The background controls, folded into one menu.
 *
 * They were two naked buttons in the chrome bar — pick an image, and a
 * red X to remove it — which is the whole of what you could do to a
 * backdrop. The two settings that actually make a photograph usable
 * behind text did not exist: how far to knock it back, and how far to
 * throw it out of focus. Both are per section, because the image is:
 * a dim that jumped when you changed page would be a bug.
 *
 * Closing: any pointer down outside the menu, or Escape. The trigger is
 * excluded from that so clicking it again toggles rather than closing
 * and immediately reopening.
 */
function BackgroundMenu({ hasBg, fx, onChangeBg, onRemoveBg, onFx }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dim = Math.round((fx && fx.dim) || 0);
  const blur = Math.round((fx && fx.blur) || 0);

  return (
    <div className="header-bg" ref={ref}>
      <button
        type="button"
        className={`header-bg-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title="Background"
      >
        <Icon name="image" size={14} />
        <Icon name="chevron-down" size={12} />
      </button>

      {open && (
        <div className="header-bg-menu" role="dialog" aria-label="Background">
          <div className="header-bg-label">Background</div>

          <div className="header-bg-row">
            <button type="button" className="header-bg-replace" onClick={() => { onChangeBg(); setOpen(false); }}>
              {hasBg ? 'Replace image' : 'Choose image'}
            </button>
            {hasBg && (
              <button
                type="button"
                className="header-bg-remove"
                onClick={() => { onRemoveBg(); setOpen(false); }}
                title="Remove background"
                aria-label="Remove background"
              ><Icon name="x" size={13} /></button>
            )}
          </div>

          {/* Both sliders apply to whatever is behind the page — the
              theme's own backdrop as much as an uploaded photo — so they
              are offered whether or not an image has been chosen. */}
          <div className="header-bg-fx">
            <div className="header-bg-fx-head"><span>Dim</span><b>{dim}%</b></div>
            <input
              type="range" min="0" max="80" step="1" value={dim}
              aria-label="Background dim"
              onChange={e => onFx({ dim: Number(e.target.value), blur })}
            />
          </div>
          <div className="header-bg-fx">
            <div className="header-bg-fx-head"><span>Blur</span><b>{blur}px</b></div>
            <input
              type="range" min="0" max="40" step="1" value={blur}
              aria-label="Background blur"
              onChange={e => onFx({ dim, blur: Number(e.target.value) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The wallet, opened where the wallet is.
 *
 * Clicking the coin chip used to throw a full-screen modal into the
 * middle of the page, dim everything behind it and wait to be dismissed
 * — for the question "how did I get to 2,480?", which is a glance. The
 * balance is in the top-right corner, so the answer belongs in the
 * top-right corner: the last few movements, each with a time and a
 * signed amount, directly under the number they explain.
 *
 * Six rows. The full ledger is still one button away and still the
 * modal, because reading a year of transactions IS a sit-down job and a
 * 280px menu is the wrong shape for it.
 *
 * Closing follows BackgroundMenu exactly — pointer down outside, or
 * Escape — so the two menus in the bar behave the same way.
 */
function WalletMenu({ coins, coinHistory, today, onOpenFull, onContextMenu }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Computed on open rather than on every header render: this reads a
  // list that can run to thousands of entries, and the header re-renders
  // on every section change, greeting tick and coin award.
  const rows = open ? ledgerRows(coinHistory, new Date(), 6) : [];

  return (
    <div className="header-wallet" ref={ref}>
      <button
        type="button"
        id="coinWallet"
        className={open ? 'is-open' : undefined}
        onClick={() => setOpen(o => !o)}
        onContextMenu={onContextMenu ? e => { e.preventDefault(); onContextMenu(); } : undefined}
        aria-expanded={open}
        title={today
          ? `Your coins — ${today} today. Click for recent activity`
          : 'Your coins — click for recent activity'}
      >
        <span className="cw-icon"><Icon name="coin" size={13} /></span>
        <div>
          <div className="cw-amount" id="coinAmount">{(coins || 0).toLocaleString('en-GB')}</div>
          <div className="cw-label">Coins</div>
        </div>
        {/* The balance is a fact about your whole history and so says
            nothing about today. This does. Absent on a flat day rather
            than reading "+0". */}
        {today && (
          <span className={`cw-today${today.startsWith('+') ? ' is-up' : ' is-down'}`}>{today}</span>
        )}
      </button>

      {open && (
        <div className="wallet-menu" role="dialog" aria-label="Wallet">
          <div className="wallet-menu-label">Wallet</div>
          <div className="wallet-menu-total">
            <b>{(coins || 0).toLocaleString('en-GB')}</b>
            <span>coins</span>
            {today && (
              <span className={`wallet-menu-today${today.startsWith('+') ? ' is-up' : ' is-down'}`}>{today} today</span>
            )}
          </div>

          {rows.length === 0
            ? <div className="wallet-menu-empty">Nothing yet — finish an achievement to earn your first coins.</div>
            : (
              <ul className="wallet-menu-list">
                {rows.map(r => (
                  <li key={r.key} className="wallet-row">
                    <span className="wallet-row-what">
                      <span className="wallet-row-kind">{r.kind}</span>
                      <span className="wallet-row-sep"> · </span>
                      <span className="wallet-row-label">{r.label}</span>
                    </span>
                    <span className="wallet-row-when">{r.when}</span>
                    <span className={`wallet-row-amt${r.up ? ' is-up' : ' is-down'}`}>{r.amountLabel}</span>
                  </li>
                ))}
              </ul>
            )}

          <button
            type="button"
            className="wallet-menu-all"
            onClick={() => { setOpen(false); onOpenFull(); }}
          >Full history</button>
        </div>
      )}
    </div>
  );
}

const SECTION_LABELS = {
  hub: 'Hub',
  achievements: 'Achievements',
  track: 'Track',
  shop: 'Shopping',
  holiday: 'Holiday',
  habits: 'Habits',
  settings: 'Settings',
};

function getDynamicGreeting(name) {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const n = name ? `, ${name}` : '';
  if (day === 1 && hour >= 5 && hour < 12) return `Monday grind${n} 💪`;
  if (day === 5) return `Happy Friday${n} ⚽`;
  if (day === 6) return `Happy Saturday${n} 🎉`;
  if (day === 0) return `Happy Sunday${n} ☕`;
  if (hour >= 5 && hour < 12) return `Good morning${n} 🌅`;
  if (hour >= 12 && hour < 17) return `Good afternoon${n} ☀️`;
  if (hour >= 17 && hour < 21) return `Good evening${n} 🌆`;
  return `Still up${n}? 🌙`;
}

export default function PageHeader({
  activeSection, coins, coinHistory, onOpenCoinHistory, profileName,
  onChangeBg, onRemoveBg, onCoinContextMenu, weatherEnabled = true,
  userId, requestNudge, onOpenRequests, bgFx, onBgFx,
}) {
  const greeting = getDynamicGreeting(profileName);
  const today = coinsTodayLabel(coinHistory);
  const labelRef = useRef(null);
  const prevSection = useRef(activeSection);

  useEffect(() => {
    if (prevSection.current === activeSection) return;
    prevSection.current = activeSection;
    const el = labelRef.current;
    if (!el) return;
    el.classList.add('fade-out');
    const t = setTimeout(() => el.classList.remove('fade-out'), 220);
    return () => clearTimeout(t);
  }, [activeSection]);

  return (
    <div id="pageHeader">
      <span id="pageHeader-title">
        <span className="header-title-full">Vantage</span>
        <span className="header-title-short" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <Logo size={16} strokeWidth={8} c2={null} />
        </span>
      </span>

      {activeSection === 'hub'
        ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
            <span ref={labelRef} id="pageHeader-section" key="greeting" style={{ fontSize: '13px', fontStyle: 'italic', opacity: 0.9 }}>{greeting}</span>
            <WeatherChip enabled={weatherEnabled} />
          </span>
        )
        : <span ref={labelRef} id="pageHeader-section" key="section">{SECTION_LABELS[activeSection] || ''}</span>
      }

      {/* Push everything right */}
      <div style={{ flex: 1 }} />

      {/* Command palette / shortcuts now live in Settings → Tools.
          The Ctrl+K / Cmd+K hotkey is still bound globally via
          useKeyboardShortcuts so power users keep their muscle memory. */}

      {/* No sign-out here. Desktop signs out from the side nav's bottom
          row; mobile from Profile → Sign out. A header button duplicated
          those (and an inline display style was overriding the
          mobile-only CSS, leaking it onto desktop). */}

      {/* Requests, then the canvas menu, then the wallet — left to right,
          asking / adjusting / reporting. */}
      <RequestsChip userId={userId} nudge={requestNudge} onOpen={onOpenRequests} />

      <BackgroundMenu
        hasBg={!!onRemoveBg}
        fx={bgFx}
        onChangeBg={onChangeBg}
        onRemoveBg={onRemoveBg}
        onFx={onBgFx}
      />


      <WalletMenu
        coins={coins}
        coinHistory={coinHistory}
        today={today}
        onOpenFull={onOpenCoinHistory}
        onContextMenu={onCoinContextMenu}
      />
    </div>
  );
}
