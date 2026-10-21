/**
 * Console Settings.
 *
 * The tabs become one segmented control. Appearance is rebuilt (it is
 * where the look is chosen, so it has to speak console): the two themes
 * as "Paper" and "Dark OS", both free; the accent schemes with exactly
 * classic's gating (three free, six earned by prestige, six Pro, plus a
 * Pro custom colour — the rule is accentAccess() in lib/ratings/
 * prestigeRewards.js, shared with classic); the hub card style (a
 * prestige reward, console only); and the owner-only Design switch.
 *
 * Every other tab is the classic SettingsSection, mounted whole and driven
 * through its own `requestedTab` prop, with its header and tab strip
 * hidden and the rest restyled from outside (sweep.css token bridge).
 * That keeps one copy of: the account panel and photo, export, support,
 * delete account, consent, the friends privacy card, travel policy, macro
 * goals, the shop coin gate, wearable sync (WHOOP / Oura and whatever is
 * added to that panel later lands here unchanged), notifications,
 * subscription, honours, walkthrough, and the owner tools.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import SettingsSection, {
  SCHEMES, THEMES, applyTheme, applyScheme, schemeFromHex, resolveEffectiveTheme,
} from '../../../components/SettingsSection';
import { useSubscriptionContext } from '../../../context/SubscriptionContext';
import { accentAccess } from '../../../lib/ratings/prestigeRewards';
import { CardStylePicker } from '../hub/PrestigeRewards';
import { OWNER_SURFACES_IN_BUILD } from '../../../lib/native/ownerSurfaces';
import Icon from '../../../components/Icon';
import { Segmented } from '../ui';
import HonoursCase from './HonoursCase';

// Owner-only Design switch — the same gating SettingsSection uses
// (compiled out of native builds; renders nothing unless useIsOwner).
const DesignSwitch = OWNER_SURFACES_IN_BUILD ? lazy(() => import('../../DesignSwitch')) : null;

const TABS = [
  { value: 'account', label: 'Account' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'goals', label: 'Goals' },
  { value: 'tools', label: 'Tools' },
];
const TAB_IDS = TABS.map(t => t.value);

// Console names for the two themes. THEMES[].name stays as it is, so
// classic Settings still reads "Cream" (README §2).
const THEME_LABEL = { 'cream-pro': 'Paper', 'dark-os': 'Dark OS' };
const THEME_NOTE = { 'cream-pro': 'Light, neutral paper', 'dark-os': 'Warm near-black' };

/** Same rule as classic initialTab(): a WHOOP/Oura redirect lands on Tools. */
function firstTab(requested) {
  if (requested?.tab && TAB_IDS.includes(requested.tab)) return requested.tab;
  if (typeof window !== 'undefined' && /[?&](whoop|oura)=/.test(window.location.search)) return 'tools';
  return 'appearance';
}

function Appearance({ S, update, userId, hasPro }) {
  const currentTheme = resolveEffectiveTheme(S.theme || 'cream-pro');
  const currentScheme = S.colorScheme || 'green';

  function pickTheme(id) {
    if (!THEMES.some(t => t.id === id)) return;
    applyTheme(id);
    update(prev => ({ ...prev, theme: id }));
  }
  function pickScheme(scheme) {
    if (accentAccess(scheme, { visions: S.visions, prestige: S.prestige, hasPro, active: currentScheme === scheme.id }).locked) return;
    applyScheme(scheme);
    update(prev => ({ ...prev, colorScheme: scheme.id }));
  }
  function pickCustom(hex) {
    if (!hasPro) return;
    applyScheme(schemeFromHex(hex));
    update(prev => ({ ...prev, colorScheme: 'custom', customColor: hex }));
  }

  return (
    <div className="cx-sweep-stack">
      <section className="cx-panel cx-sweep-group">
        <header className="cx-sweep-group-head">
          <h2 className="cx-sweep-group-title">Theme</h2>
          <span className="cx-t13 cx-muted">Both free</span>
        </header>
        <div className="cx-sweep-themes" role="radiogroup" aria-label="Theme">
          {THEMES.map(t => {
            const on = currentTheme === t.id;
            return (
              <button key={t.id} type="button" role="radio" aria-checked={on} className={`cx-sweep-theme${on ? ' is-on' : ''}`} onClick={() => pickTheme(t.id)}>
                <span className={`cx-sweep-swatch is-${t.id}`} aria-hidden="true"><i /><i /></span>
                <span className="cx-sweep-theme-name">
                  {THEME_LABEL[t.id] || t.name}
                  {on && <Icon name="check" size={16} strokeWidth={2.25} />}
                </span>
                <span className="cx-t12 cx-muted">{THEME_NOTE[t.id] || t.tagline}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="cx-panel cx-sweep-group">
        <header className="cx-sweep-group-head">
          <h2 className="cx-sweep-group-title">Accent colour</h2>
          <span className="cx-t13 cx-muted">Used across the whole app</span>
        </header>
        <div className="cx-sweep-schemes" role="radiogroup" aria-label="Accent colour">
          {SCHEMES.map(scheme => {
            const on = currentScheme === scheme.id;
            // Classic's availability rule (accentAccess): prestige unlocks
            // the earned accents, an old honour or Pro keeps the original
            // three, Pro unlocks its six; the active one is never stranded.
            const access = accentAccess(scheme, { visions: S.visions, prestige: S.prestige, hasPro, active: on });
            const proLocked = access.locked && access.by === 'pro';
            const locked = access.locked;
            const hint = access.hint;
            return (
              <button
                key={scheme.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked}
                title={locked ? access.title : scheme.name}
                className={`cx-sweep-scheme${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
                onClick={() => pickScheme(scheme)}
              >
                <span className="cx-sweep-scheme-chip" style={{ background: scheme.em }} aria-hidden="true">
                  {on && <Icon name="check" size={14} strokeWidth={2.5} />}
                  {locked && <Icon name={proLocked ? 'lock' : 'sparkles'} size={12} strokeWidth={2} />}
                </span>
                <span className="cx-sweep-scheme-name">{scheme.name}</span>
                {locked && <span className="cx-sweep-scheme-hint">{hint}</span>}
              </button>
            );
          })}
        </div>
        <div className="cx-sweep-custom">
          <div className="cx-sweep-custom-text">
            <span className="cx-t15 cx-sweep-strong">Your own colour {!hasPro && <span className="cx-sweep-pro is-small">Pro</span>}</span>
            <span className="cx-t13 cx-muted">{hasPro ? 'Pick any colour; the app works out readable shades for both themes.' : 'Pro lets you pick any accent.'}</span>
          </div>
          <input
            type="color"
            className={`cx-sweep-color${currentScheme === 'custom' ? ' is-on' : ''}`}
            disabled={!hasPro}
            value={(currentScheme === 'custom' && S.customColor) || '#1a7a4a'}
            onChange={e => pickCustom(e.target.value)}
            aria-label="Custom accent colour"
          />
        </div>
        <p className="cx-t13 cx-muted">
          {hasPro
            ? 'Three accents are earned only by prestige: Moss, Lagoon and Ultramarine.'
            : 'Three accents are free and six are earned by prestige. Pro adds six more and a colour of your own.'}
        </p>
      </section>

      <section className="cx-panel cx-sweep-group">
        <header className="cx-sweep-group-head">
          <h2 className="cx-sweep-group-title">Hub card style</h2>
          <span className="cx-t13 cx-muted">Earned by prestige</span>
        </header>
        <CardStylePicker S={S} update={update} />
      </section>

      {DesignSwitch && (
        <div className="cx-sweep-scope cx-sweep-design">
          <Suspense fallback={null}>
            <DesignSwitch S={S} update={update} userId={userId} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

export default function ConsoleSettings({
  S, update, userId, userEmail, isOwner, navigate, onSignOut, onOpenLegal, onOpenPalette, onOpenShortcuts,
  requestedSettingsTab,
}) {
  // Tools → Honours opens the console trophy case, not the classic list.
  const [honours, setHonours] = useState(false);
  const { hasPro } = useSubscriptionContext();
  const [tab, setTab] = useState(() => firstTab(requestedSettingsTab));
  // What the classic section is asked to show: a fresh object per change,
  // because its effect keys on identity ({ tab, focus, n } like App's).
  const [ask, setAsk] = useState(() => ({ tab: tab === 'appearance' ? 'account' : tab, focus: requestedSettingsTab?.focus || null, n: Date.now() }));

  // Deep links from outside (avatar → Account, /support → Account + focus,
  // a wearable redirect → Tools).
  useEffect(() => {
    if (!requestedSettingsTab?.tab || !TAB_IDS.includes(requestedSettingsTab.tab)) return;
    setTab(requestedSettingsTab.tab);
    if (requestedSettingsTab.tab !== 'appearance') {
      setAsk({ tab: requestedSettingsTab.tab, focus: requestedSettingsTab.focus || null, n: Date.now() });
    }
  }, [requestedSettingsTab]);

  const choose = next => {
    setTab(next);
    if (next !== 'appearance') setAsk({ tab: next, focus: null, n: Date.now() });
  };
  const onOpenSchedule = useMemo(() => (isOwner ? () => navigate?.('upgrade') : null), [isOwner, navigate]);

  return (
    <section className="section active cx-page cx-sweep-page cx-sweep-settings">
      <Segmented label="Settings" options={TABS} value={tab} onChange={choose} className="cx-sweep-tabs is-scroll" />
      {tab === 'appearance' ? (
        <Appearance S={S} update={update} userId={userId} hasPro={hasPro} />
      ) : (
        <div className="cx-sweep-scope cx-sweep-classic-settings">
          <SettingsSection
            S={S}
            update={update}
            active
            userId={userId}
            userEmail={userEmail}
            onSignOut={onSignOut}
            requestedTab={ask}
            onOpenLegal={onOpenLegal}
            onOpenPalette={onOpenPalette}
            onOpenShortcuts={onOpenShortcuts}
            onOpenVisions={() => setHonours(true)}
            onOpenSchedule={onOpenSchedule}
          />
        </div>
      )}
      {honours && <HonoursCase S={S} onClose={() => setHonours(false)} />}
    </section>
  );
}
