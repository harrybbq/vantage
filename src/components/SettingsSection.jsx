import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { adjustColour } from '../utils/helpers';
import MacroGoalsPanel from './MacroGoalsPanel';
import NotificationsPanel from './NotificationsPanel';
import SubscriptionPanel from './SubscriptionPanel';
import { AppleHealthImport, WearableSync } from './VitalsHistoryCard';
import AccountPanel from './settings/AccountPanel';
import DataExportCard from './settings/DataExportCard';
import SettingsGroup from './settings/SettingsGroup';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import { getOwnProfile, updateOwnProfile } from '../lib/friends/queries';
import { VISIONS_BY_ID } from '../lib/visions/definitions';
import Icon from './Icon';
import TravelPolicyCard from './holiday/TravelPolicyCard';
import { authFetch } from '../lib/authFetch';

// Small helper: inline icon + label for the Tools/Data action buttons.
const IconLabel = ({ name, children, size = 15 }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name={name} size={size} />{children}</span>
);


// Pastel app-gradient derived from a dark accent by lightening it.
function pastelGrad(em) {
  return `linear-gradient(145deg,${adjustColour(em, 150)} 0%,${adjustColour(em, 110)} 40%,${adjustColour(em, 70)} 70%,${adjustColour(em, 40)} 100%)`;
}

// Build a full scheme object from a single accent hex. Used by the
// Pro custom-colour picker. em is treated as the darkest tone; mid /
// light / grad are derived by lightening.
export function schemeFromHex(hex) {
  return {
    id: 'custom',
    name: 'Custom',
    custom: true,
    em: hex,
    mid: adjustColour(hex, 28),
    light: adjustColour(hex, 64),
    grad: pastelGrad(hex),
  };
}

// Availability tiers:
//   • no flag        → free for everyone (green / blue / slate)
//   • unlockVision   → earned free by achieving that vision (or Pro)
//   • pro: true      → Pro only
// Plus the custom-colour picker (Pro only).
export const SCHEMES = [
  { id: 'green',  name: 'Forest Green', em: '#1a7a4a', mid: '#2a9e62', light: '#4dc485', grad: 'linear-gradient(145deg,#f0f7f3 0%,#d8eee5 40%,#b0d9c5 70%,#7ec8a8 100%)' },
  { id: 'blue',   name: 'Ocean Blue',   em: '#1a4a7a', mid: '#2a629e', light: '#4d9ec4', grad: 'linear-gradient(145deg,#f0f3f7 0%,#d8e5ee 40%,#b0c5d9 70%,#7ea8c8 100%)' },
  { id: 'slate',  name: 'Slate',        em: '#1a3a5a', mid: '#2a5a8e', light: '#4d8ab0', grad: 'linear-gradient(145deg,#f0f2f7 0%,#d8dfe8 40%,#b0bece 70%,#7ea0be 100%)' },
  // ── Earned accents — unlocked by achieving a vision (free) ──
  { id: 'purple', name: 'Purple',       em: '#5a1a7a', mid: '#7a2a9e', light: '#a44dc4', grad: 'linear-gradient(145deg,#f4f0f7 0%,#e5d8ee 40%,#d0b0d9 70%,#b87ec8 100%)', unlockVision: 'ach-3' },
  { id: 'orange', name: 'Sunset',       em: '#7a3a1a', mid: '#9e5a2a', light: '#c47a4d', grad: 'linear-gradient(145deg,#f7f3f0 0%,#eee0d8 40%,#d9c0b0 70%,#c8977e 100%)', unlockVision: 'streak-7' },
  { id: 'pink',   name: 'Rose',         em: '#7a1a4a', mid: '#9e2a62', light: '#c44d85', grad: 'linear-gradient(145deg,#f7f0f3 0%,#eed8e5 40%,#d9b0c5 70%,#c87ea8 100%)', unlockVision: 'log-7' },
  // ── Pro accents ──
  { id: 'teal',    name: 'Teal',    em: '#0f5e5a', mid: '#1a8c84', light: '#4dc4ba', grad: pastelGrad('#0f5e5a'), pro: true },
  { id: 'crimson', name: 'Crimson', em: '#7a1a1a', mid: '#9e2a2a', light: '#c44d4d', grad: pastelGrad('#7a1a1a'), pro: true },
  { id: 'indigo',  name: 'Indigo',  em: '#2a1a7a', mid: '#3f2a9e', light: '#6d4dc4', grad: pastelGrad('#2a1a7a'), pro: true },
  { id: 'amber',   name: 'Amber',   em: '#7a5a1a', mid: '#9e7a2a', light: '#c4a04d', grad: pastelGrad('#7a5a1a'), pro: true },
  { id: 'magenta', name: 'Magenta', em: '#7a1a6a', mid: '#9e2a8a', light: '#c44db0', grad: pastelGrad('#7a1a6a'), pro: true },
  { id: 'steel',   name: 'Steel',   em: '#33414f', mid: '#4f6478', light: '#8a9caf', grad: pastelGrad('#33414f'), pro: true },
];

/**
 * Which theme ids use the operator-console hub layout.
 *
 * This condition was written out by hand in three places and one of
 * them — the settings card that toggles the optional panels — listed
 * only 'dark-os'. So a Cream Pro user got the layout that READS
 * S.hubPanels with no UI anywhere to set it: the panels were
 * permanently whatever they happened to be. Keeping the list in one
 * place is the actual fix; correcting that one call site would just
 * leave the next one to get it wrong.
 */
export const OS_LAYOUT_THEMES = ['dark-os', 'cream-pro'];
export const isOsLayoutTheme = themeId => OS_LAYOUT_THEMES.includes(themeId);

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

// The user's live accent hex (custom picker or the active scheme's em).
export function currentAccentHex(S) {
  if (S?.colorScheme === 'custom' && S?.customColor) return S.customColor;
  const sc = SCHEMES.find(s => s.id === (S?.colorScheme || 'green'));
  return sc?.em || '#1a7a4a';
}

// ── Theme modes (4 themes — light/dark axis × free/Pro tier) ─────────────
// Free users get cream + dark (basic). Pro users get cream-pro +
// dark-os (existing operator console). All four are real themes,
// not gates on the same theme — Pro users get a real visual upgrade
// in BOTH light AND dark modes.
/**
 * The two themes, both free.
 *
 * There used to be four: a plain cream and a plain dark for free users,
 * with these two behind Pro. Charging for the good-looking one meant
 * every new account met the weaker version of the app first, which is a
 * strange thing to do when you are trying to be liked. Pro now earns its
 * money on limits, customisation and the wider widget set — the things
 * someone wants MORE of once they already like it.
 *
 * The ids keep their `-pro` suffix on purpose: they are what is saved in
 * S.theme, and renaming them would orphan every existing preference for
 * no gain. Only the labels changed.
 */
export const THEMES = [
  {
    id: 'cream-pro', name: 'Cream', tagline: 'Warm parchment · refined accents',
    mode: 'light', pro: false,
    swatch: 'linear-gradient(145deg,#f9f6f0 0%,#ede4d4 45%,#cdb88c 100%)',
  },
  {
    id: 'dark-os', name: 'Dark OS', tagline: 'Operator console',
    mode: 'dark', pro: false,
    swatch: 'linear-gradient(145deg,#1f1f1c 0%,#131311 55%,#0a0a09 100%)',
  },
];

/** Retired ids → where a saved preference lands now, by mode. */
const LEGACY_THEMES = { cream: 'cream-pro', dark: 'dark-os' };

/**
 * Where a saved theme id actually lands.
 *
 * No longer depends on the tier — both themes are free, so this is now
 * purely about retired ids. A saved `dark` goes to `dark-os` and a saved
 * `cream` to `cream-pro`, matching mode so nobody who chose dark gets a
 * face full of cream on next load. Anything unrecognised falls to the
 * light one rather than throwing.
 */
export function resolveEffectiveTheme(saved) {
  if (THEMES.some(x => x.id === saved)) return saved;
  return LEGACY_THEMES[saved] || 'cream-pro';
}

/**
 * Apply the theme attribute to <html>.
 *
 * Called on boot from main.jsx and whenever the theme is toggled. Both
 * themes now set data-theme="<id>" — there is no longer an
 * attribute-less default, because the bare-cream theme it stood for is
 * gone.
 *
 * Also sets data-hub-os="1", which both remaining themes want:
 * hub-dark.css keys its layout on that attribute so Cream inherits the
 * operator-console structure without picking up Dark OS's palette.
 */
export function applyTheme(theme) {
  const effective = resolveEffectiveTheme(theme || 'cream-pro');
  const r = document.documentElement;
  r.setAttribute('data-theme', effective);
  if (isOsLayoutTheme(effective)) r.setAttribute('data-hub-os', '1');
  else r.removeAttribute('data-hub-os');
  return effective;
}

export function applyScheme(scheme) {
  const r = document.documentElement;
  const rgb = hexToRgb(scheme.em);
  r.style.setProperty('--em', scheme.em);
  r.style.setProperty('--em-mid', scheme.mid);
  r.style.setProperty('--em-light', scheme.light);
  r.style.setProperty('--em-rgb', rgb);
  r.style.setProperty('--em-pale', `rgba(${rgb}, 0.16)`);
  r.style.setProperty('--em-ghost', `rgba(${rgb}, 0.06)`);
  r.style.setProperty('--accent-line', `rgba(${rgb}, 0.32)`);
  r.style.setProperty('--accent-line-soft', `rgba(${rgb}, 0.16)`);
  r.style.setProperty('--accent-line-mid', `rgba(${rgb}, 0.48)`);
  r.style.setProperty('--accent-glow',
    `0 1px 0 rgba(255,255,255,.55) inset, 0 1px 0 rgba(${rgb},.04), 0 6px 22px rgba(${rgb},.07)`);
  r.style.setProperty('--accent-glow-hi',
    `0 1px 0 rgba(255,255,255,.6) inset, 0 14px 36px rgba(${rgb},.13)`);
  r.style.setProperty('--grad', scheme.grad);
}

/**
 * Self-contained card for the Friends privacy toggle. Reads + writes
 * the user's `profiles.is_searchable` directly via the friends
 * queries module, so SettingsSection doesn't need to thread profile
 * state through. Silently no-ops if the social schema isn't
 * present (the read just fails and the card hides itself).
 */
// Per-field profile-card privacy toggles. Live in S.privacy (no
// schema migration); usePublishProfile reads them and zeroes-out
// hidden fields on the next debounced publish.
const SHARE_TOGGLES = [
  { id: 'shareAvatar',   label: 'Profile photo',         desc: 'Your uploaded photo. Off shows your @handle initial instead.' },
  { id: 'shareStreak',   label: 'Active habit streak',  desc: 'Days clean + habit name (e.g. "12d Alcohol").' },
  { id: 'shareHeatmap',  label: '91-day activity heatmap', desc: 'Coloured grid of days you logged anything.' },
  { id: 'shareWins',     label: 'Recent achievement wins', desc: 'Last 3 completed achievements with their icons.' },
  { id: 'sharePresence', label: 'Online status',         desc: 'Green dot when you\'re active in the last 3 minutes.' },
];

function FriendsPrivacyCard({ userId, S, update }) {
  const { hasPro } = useSubscriptionContext();
  const [searchable, setSearchable] = useState(null);
  const [leaderboardOptin, setLeaderboardOptin] = useState(null);
  const [nameColorOn, setNameColorOn] = useState(false);
  const [handle, setHandle] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [available, setAvailable] = useState(null); // null = checking; false = schema missing
  const accent = currentAccentHex(S);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        // getOwnProfile selects a fixed column set that may not include
        // leaderboard_optin (added later) — read it directly to avoid
        // editing the friends query module.
        const p = await getOwnProfile(userId);
        if (cancelled) return;
        setSearchable(p?.is_searchable ?? true);
        setHandle(p?.handle || null);
        const optRes = await supabase.from('profiles')
          .select('leaderboard_optin').eq('id', userId).maybeSingle();
        if (!cancelled) setLeaderboardOptin(optRes.data?.leaderboard_optin ?? true);
        // leaderboard_color is a separate, best-effort read so a missing
        // column (migration not applied) doesn't break the card.
        const colRes = await supabase.from('profiles')
          .select('leaderboard_color').eq('id', userId).maybeSingle();
        if (!cancelled) setNameColorOn(!!colRes.data?.leaderboard_color);
        setAvailable(true);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Keep the published colour in sync with the live accent while the
  // toggle is on (so changing your scheme recolours your name too).
  useEffect(() => {
    if (!nameColorOn || !userId) return;
    updateOwnProfile(userId, { leaderboard_color: accent }).catch(() => {});
  }, [nameColorOn, accent, userId]);

  async function handleToggleNameColor() {
    const next = !nameColorOn;
    setNameColorOn(next); // optimistic; the effect above publishes when on
    setError(null);
    try {
      if (!next) await updateOwnProfile(userId, { leaderboard_color: null });
    } catch (e) {
      setNameColorOn(!next);
      setError(e.message || 'Could not update name colour.');
    }
  }

  async function handleToggleLeaderboard() {
    const next = !leaderboardOptin;
    setLeaderboardOptin(next); // optimistic
    setError(null);
    try {
      await updateOwnProfile(userId, { leaderboard_optin: next });
    } catch (e) {
      setLeaderboardOptin(!next); // revert
      setError(e.message || 'Could not update leaderboard setting.');
    }
  }

  if (available === false) return null; // schema not present → hide entirely
  if (available === null) return null;   // still loading on first paint

  async function handleToggle() {
    const next = !searchable;
    setSearchable(next); // optimistic
    setSaving(true);
    setError(null);
    try {
      await updateOwnProfile(userId, { is_searchable: next });
    } catch (e) {
      setSearchable(!next); // revert
      setError(e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsGroup
      title="Friends"
      desc="Friends added to your list always see your activity. This setting only controls whether strangers can find you by handle search."
    >
      <label
        style={{
          display: 'flex', alignItems: 'center', gap: '14px',
          padding: '12px 14px', borderRadius: '10px',
          border: searchable ? '2px solid var(--em)' : '2px solid var(--border)',
          background: searchable ? 'rgba(var(--em-rgb),0.08)' : 'var(--card, rgba(255,255,255,0.04))',
          cursor: handle ? 'pointer' : 'not-allowed', transition: 'all .18s',
          opacity: handle ? 1 : 0.55,
        }}
        title={handle ? '' : 'Claim a handle first to be searchable.'}
      >
        <input
          type="checkbox"
          checked={!!searchable}
          disabled={!handle || saving}
          onChange={handleToggle}
          style={{ width: '18px', height: '18px', accentColor: 'var(--em)', cursor: handle ? 'pointer' : 'not-allowed' }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            Show me in handle search
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: '2px' }}>
            {handle
              ? `Other users can send you a friend request via @${handle}.`
              : 'Open the Friends rail on the hub to claim a handle first.'}
          </div>
        </div>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '1.4px',
          textTransform: 'uppercase', color: searchable ? 'var(--em)' : 'var(--text-muted)',
        }}>
          {searchable ? 'On' : 'Off'}
        </span>
      </label>

      {/* Global leaderboard opt-in. Defaults true. Off → caller is
          excluded from global queries entirely (friends scope unaffected,
          friendship is the consent). */}
      <label
        style={{
          marginTop: '10px',
          display: 'flex', alignItems: 'center', gap: '14px',
          padding: '12px 14px', borderRadius: '10px',
          border: leaderboardOptin ? '2px solid var(--em)' : '2px solid var(--border)',
          background: leaderboardOptin ? 'rgba(var(--em-rgb),0.08)' : 'var(--card, rgba(255,255,255,0.04))',
          cursor: 'pointer', transition: 'all .18s',
        }}
      >
        <input
          type="checkbox"
          checked={!!leaderboardOptin}
          onChange={handleToggleLeaderboard}
          style={{ width: '18px', height: '18px', accentColor: 'var(--em)', cursor: 'pointer' }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            Show me on the global leaderboard
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: '2px' }}>
            When off, you're hidden from the global board. Friends can still see your ratings.
          </div>
        </div>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '1.4px',
          textTransform: 'uppercase', color: leaderboardOptin ? 'var(--em)' : 'var(--text-muted)',
        }}>
          {leaderboardOptin ? 'On' : 'Off'}
        </span>
      </label>

      {/* Shopping Trending opt-in. Lives in S.privacy (no migration);
          friends-trending reads state->privacy->shareTrending and skips
          you when off. Defaults on — friendship is the consent, matching
          the rest of the friends model — but this lets you keep your
          wishlist out of friends' Trending board. */}
      {(() => {
        const trendingOn = S?.privacy?.shareTrending !== false;
        return (
          <label
            style={{
              marginTop: '10px',
              display: 'flex', alignItems: 'center', gap: '14px',
              padding: '12px 14px', borderRadius: '10px',
              border: trendingOn ? '2px solid var(--em)' : '2px solid var(--border)',
              background: trendingOn ? 'rgba(var(--em-rgb),0.08)' : 'var(--card, rgba(255,255,255,0.04))',
              cursor: 'pointer', transition: 'all .18s',
            }}
          >
            <input
              type="checkbox"
              checked={trendingOn}
              onChange={() => update(prev => ({
                ...prev,
                privacy: { ...(prev.privacy || {}), shareTrending: !trendingOn },
              }))}
              style={{ width: '18px', height: '18px', accentColor: 'var(--em)', cursor: 'pointer' }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                Share my wishlist in friends' Trending
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: '2px' }}>
                When on, items you're saving for can appear (anonymously, as a count) in your friends' Trending tab on Shopping. Off keeps your wishlist out of it entirely.
              </div>
            </div>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '1.4px',
              textTransform: 'uppercase', color: trendingOn ? 'var(--em)' : 'var(--text-muted)',
            }}>
              {trendingOn ? 'On' : 'Off'}
            </span>
          </label>
        );
      })()}

      {/* Pro: colour your name on the leaderboard with your accent, so
          you stand out without having to make your display name match. */}
      <label
        style={{
          marginTop: '10px',
          display: 'flex', alignItems: 'center', gap: '14px',
          padding: '12px 14px', borderRadius: '10px',
          border: (nameColorOn && hasPro) ? `2px solid ${accent}` : '2px solid var(--border)',
          background: (nameColorOn && hasPro) ? `rgba(${hexToRgb(accent)},0.08)` : 'var(--card, rgba(255,255,255,0.04))',
          cursor: hasPro ? 'pointer' : 'not-allowed', transition: 'all .18s',
          opacity: hasPro ? 1 : 0.6,
        }}
        title={hasPro ? '' : 'Upgrade to Pro to colour your leaderboard name.'}
      >
        <input
          type="checkbox"
          checked={!!nameColorOn && hasPro}
          disabled={!hasPro}
          onChange={handleToggleNameColor}
          style={{ width: '18px', height: '18px', accentColor: accent, cursor: hasPro ? 'pointer' : 'not-allowed' }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            Colour my leaderboard name
            <span style={{
              fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '1.4px', textTransform: 'uppercase',
              padding: '2px 6px', borderRadius: '3px',
              background: hasPro ? 'rgba(var(--em-rgb),0.14)' : 'rgba(200,151,10,0.12)',
              color: hasPro ? 'var(--em)' : 'var(--gold)',
              border: `1px solid ${hasPro ? 'rgba(var(--em-rgb),0.28)' : 'rgba(200,151,10,0.28)'}`,
            }}>{hasPro ? 'Pro' : '🔒 Pro'}</span>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: '2px' }}>
            Your name shows in <span style={{ color: accent, fontWeight: 700 }}>your accent colour</span> on the leaderboard.
          </div>
        </div>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '1.4px',
          textTransform: 'uppercase', color: (nameColorOn && hasPro) ? accent : 'var(--text-muted)',
        }}>
          {(nameColorOn && hasPro) ? 'On' : 'Off'}
        </span>
      </label>

      {error && (
        <div style={{ marginTop: 10, color: '#c43232', fontSize: 12, fontFamily: 'var(--mono)' }}>
          {error}
        </div>
      )}

      {/* Per-field profile-card toggles. Defaults all ON (existing
          behavior). Toggling OFF clears the field on the next 4s
          debounced publish — friends will see the empty value the
          next time they refresh the rail. */}
      <div style={{
        marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)',
      }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '1.4px',
          textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8,
        }}>What friends see on your profile card</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SHARE_TOGGLES.map(t => {
            const on = S?.privacy?.[t.id] !== false;
            return (
              <label key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 8,
                border: on ? '2px solid var(--em)' : '2px solid var(--border)',
                background: on ? 'rgba(var(--em-rgb),0.06)' : 'var(--card, rgba(255,255,255,0.04))',
                cursor: 'pointer', transition: 'all .18s',
              }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => update(prev => ({
                    ...prev,
                    privacy: { ...(prev.privacy || {}), [t.id]: !on },
                  }))}
                  style={{ width: 16, height: 16, accentColor: 'var(--em)', cursor: 'pointer' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                    {t.label}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.4, marginTop: 2 }}>
                    {t.desc}
                  </div>
                </div>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.2,
                  textTransform: 'uppercase', color: on ? 'var(--em)' : 'var(--text-muted)',
                }}>{on ? 'On' : 'Off'}</span>
              </label>
            );
          })}
        </div>
      </div>
    </SettingsGroup>
  );
}

// Tab definition — single source of truth so the nav and the
// content switcher stay in sync. Order = display order.
const SETTINGS_TABS = [
  // Account is first because it is the one tab reached by name from
  // outside Settings — tapping your own photo lands here.
  { id: 'account',    label: 'Account'    },
  { id: 'appearance', label: 'Appearance' },
  { id: 'privacy',    label: 'Privacy'    },
  { id: 'goals',      label: 'Goals'      },
  { id: 'tools',      label: 'Tools'      },
  { id: 'data',       label: 'Data'       },
];

/**
 * Which tab to open on.
 *
 * Normally Appearance. But the WHOOP and Oura connect flows send the
 * browser back to the app root with `?whoop=connected`, and the panels
 * that consume that parameter now live under Tools — a tab whose content
 * is not mounted until it is selected. Landing on Appearance would leave
 * the redirect unread and the account looking unconnected. App.jsx sends
 * the same test to the section router so the user lands here at all.
 */
function initialTab() {
  if (typeof window === 'undefined') return 'appearance';
  return /[?&](whoop|oura)=/.test(window.location.search) ? 'tools' : 'appearance';
}

export default function SettingsSection({ S, update, active, userId, userEmail, onSignOut, requestedTab, onOpenLegal, onOpenPalette, onOpenShortcuts, onOpenVisions, onOpenSchedule }) {
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);

  // Deep-link into a tab. App.jsx bumps `requestedTab` when something
  // outside Settings routes here by name — tapping your avatar asks for
  // 'account'. It carries a nonce rather than being a bare tab id so
  // asking for the same tab twice still moves you back to it, and so a
  // request never re-fires when this component happens to re-render.
  useEffect(() => {
    if (!requestedTab?.tab) return;
    if (!SETTINGS_TABS.some(t => t.id === requestedTab.tab)) return;
    setActiveTab(requestedTab.tab);
  }, [requestedTab]);
  const currentScheme = S.colorScheme || 'green';
  // Resolved, not raw — someone still carrying a retired `cream`/`dark`
  // should see the card they actually landed on marked active.
  const currentTheme = resolveEffectiveTheme(S.theme || 'cream-pro');
  const { hasPro } = useSubscriptionContext();

  function handleThemeChange(themeId) {
    if (!THEMES.some(x => x.id === themeId)) return;
    applyTheme(themeId);
    update(prev => ({ ...prev, theme: themeId }));
  }

  function handleSchemeChange(scheme) {
    if (scheme.pro && !hasPro) return; // Pro accent — gated
    applyScheme(scheme);
    update(prev => ({ ...prev, colorScheme: scheme.id }));
  }

  function handleCustomColor(hex) {
    if (!hasPro) return; // custom colour is Pro-only
    const scheme = schemeFromHex(hex);
    applyScheme(scheme);
    update(prev => ({ ...prev, colorScheme: 'custom', customColor: hex }));
  }

  async function handleDeleteAccount() {
    if (!window.confirm('This will permanently delete your account and everything in it. This cannot be undone.')) return;
    if (!window.confirm('Are you absolutely sure? Press OK to confirm deletion.')) return;
    setDeleting(true);
    try {
      // Goes through a server function because deleting the ACCOUNT (not
      // merely its data) needs the service role. The old flow removed
      // the user_data row and signed out, which left auth.users,
      // profiles, friendships and push_tokens behind — the account still
      // existed, which fails App Store 5.1.1(v) and is an incomplete
      // erasure under UK GDPR. Deleting the auth user cascades the rest.
      const res = await authFetch('/.netlify/functions/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || 'Deletion failed.');
      // Only sign out once the server confirms — otherwise the user is
      // logged out believing they're deleted when they aren't.
      await supabase.auth.signOut();
    } catch (e) {
      alert('Error: ' + (e.message || 'Something went wrong.'));
      setDeleting(false);
    }
  }

  return (
    <section id="settings" className={`section${active ? ' active' : ''}`}>
      <motion.div
        style={{ marginBottom: '20px' }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="eyebrow">Preferences</div>
        <div className="sec-title">Settings</div>
      </motion.div>

      {/* Tab navigation — flick between categories without endless
          scrolling. Active state persists per-session in component
          state; we don't write it to S because tab choice is more
          ephemeral than the data we sync to cloud. */}
      <div className="settings-tabs" role="tablist" aria-label="Settings categories">
        {SETTINGS_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            id={`settings-tab-${tab.id}`}
            className={`settings-tab${activeTab === tab.id ? ' settings-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={`settings-panel-${activeTab}`}
        className="settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeTab}`}
      >

        {/* ─── ACCOUNT TAB ───
            Photo, name, tagline, email, password, sign out. Was the
            mobile-only Profile route until it folded in here. */}
        {activeTab === 'account' && (
          <AccountPanel
            S={S}
            update={update}
            userId={userId}
            userEmail={userEmail}
            onSignOut={onSignOut}
          />
        )}

        {/* ─── APPEARANCE TAB ─── */}
        {activeTab === 'appearance' && (
        <>
        <SettingsGroup
          title="Colour scheme"
          desc="An accent colour applied across the whole app. ✦ accents unlock by achieving visions; 🔒 accents are Pro."
        >
          <div className="scheme-grid">
            {SCHEMES.map(scheme => {
              const isActive = currentScheme === scheme.id;
              // Availability: Pro users get everything; vision-locked
              // accents unlock when the vision is achieved; the active
              // scheme is always allowed (never strand an existing pick).
              const visionMet = scheme.unlockVision && !!(S.visions || {})[scheme.unlockVision];
              const proLocked = scheme.pro && !hasPro;
              const visionLocked = scheme.unlockVision && !visionMet && !hasPro;
              const locked = (proLocked || visionLocked) && !isActive;
              const lockHint = proLocked
                ? 'Upgrade to Pro to unlock this accent'
                : visionLocked
                  ? `Unlock by achieving: ${VISIONS_BY_ID[scheme.unlockVision]?.title || 'a vision'}`
                  : '';
              return (
                <button
                  key={scheme.id}
                  onClick={() => handleSchemeChange(scheme)}
                  disabled={locked}
                  title={lockHint}
                  style={{
                    position: 'relative',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                    padding: '14px 10px', borderRadius: '12px',
                    cursor: locked ? 'not-allowed' : 'pointer',
                    border: isActive ? `2px solid ${scheme.mid}` : '2px solid var(--border)',
                    background: isActive ? `rgba(${hexToRgb(scheme.em)},0.10)` : 'var(--card)',
                    opacity: locked ? 0.55 : 1,
                    transition: 'all .18s',
                  }}
                >
                  {locked && (
                    <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 10, color: 'var(--gold)' }}
                      title={lockHint}>{visionLocked ? '✦' : '🔒'}</span>
                  )}
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: `linear-gradient(135deg,${scheme.em} 0%,${scheme.mid} 55%,${scheme.light} 100%)`,
                    boxShadow: isActive ? `0 4px 14px ${scheme.em}66` : 'none',
                    transition: 'box-shadow .18s',
                  }} />
                  <span style={{
                    fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '0.5px',
                    color: isActive ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: isActive ? 700 : 400,
                  }}>
                    {scheme.name}
                  </span>
                  {isActive && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: scheme.mid, letterSpacing: '1px', textTransform: 'uppercase' }}>
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom colour (Pro) — pick any accent with a colour wheel. */}
          <div style={{
            marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                Custom colour
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '1.4px',
                  textTransform: 'uppercase', padding: '2px 6px', borderRadius: '3px',
                  background: hasPro ? 'rgba(var(--em-rgb),0.14)' : 'rgba(200,151,10,0.12)',
                  color: hasPro ? 'var(--em)' : 'var(--gold)',
                  border: `1px solid ${hasPro ? 'rgba(var(--em-rgb),0.28)' : 'rgba(200,151,10,0.28)'}`,
                }}>{hasPro ? 'Pro' : '🔒 Pro'}</span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: 4 }}>
                {hasPro ? 'Pick any accent — the app derives matching tones.' : 'Upgrade to choose any accent colour.'}
              </div>
            </div>
            <input
              type="color"
              disabled={!hasPro}
              value={(currentScheme === 'custom' && S.customColor) || '#1a7a4a'}
              onChange={e => handleCustomColor(e.target.value)}
              title={hasPro ? 'Choose a custom accent' : 'Upgrade to Pro'}
              style={{
                width: 48, height: 36, padding: 0, border: '2px solid var(--border)',
                borderRadius: 10, background: 'none',
                cursor: hasPro ? 'pointer' : 'not-allowed', opacity: hasPro ? 1 : 0.5,
                ...(currentScheme === 'custom' ? { borderColor: 'var(--em)' } : {}),
              }}
            />
          </div>
        </SettingsGroup>

        {/* Theme mode. The blurb here still described Cream Pro and Dark
            OS as Pro variants of two free themes that no longer exist —
            it was written before the free pair was retired. */}
        <SettingsGroup
          title="Theme"
          desc="Both themes are free — pick whichever you'd rather look at."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
            {THEMES.map(t => {
              const isActive = currentTheme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleThemeChange(t.id)}
                  style={{
                    position: 'relative', textAlign: 'left',
                    padding: '14px 14px 16px', borderRadius: '12px',
                    cursor: 'pointer',
                    border: isActive ? '2px solid var(--em)' : '2px solid var(--border)',
                    background: isActive ? 'rgba(var(--em-rgb),0.08)' : 'var(--card, rgba(255,255,255,0.04))',
                    transition: 'all .18s',
                    display: 'flex', flexDirection: 'column', gap: '10px',
                  }}
                >
                  <div style={{
                    height: '48px', borderRadius: '8px',
                    background: t.swatch,
                    border: '1px solid var(--border)',
                  }} />
                  <div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      fontFamily: 'var(--sans)', fontSize: '14px', fontWeight: 600,
                      color: 'var(--text)',
                    }}>
                      {t.name}
                      {isActive && (
                        <span style={{
                          fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '1.4px',
                          textTransform: 'uppercase', color: 'var(--em)', marginLeft: 'auto',
                        }}>
                          Active
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: '10px',
                      color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: '4px',
                    }}>
                      {t.tagline}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {!hasPro && (
            <p className="settings-group-note">
              Pro adds the accent colours above, lifts the limits, and opens the rest of the widgets.
            </p>
          )}
        </SettingsGroup>

        {/* The "Control panel add-ons" group stood here — one checkbox,
            for the hub's cardio calculator, under a heading that promised
            a family of them. It was removed 2026-08-11. `S.hubPanels` is
            deliberately left alone: HubOsLayout still reads
            S.hubPanels.cardio, so anyone who had the calculator on keeps
            it. Nothing was written to state to make this change. */}

        </>
        )}

        {/* ─── PRIVACY TAB ─── */}
        {activeTab === 'privacy' && (
        <>
        {/* Friends privacy */}
        {userId
          ? <FriendsPrivacyCard userId={userId} S={S} update={update} />
          : <div className="settings-empty">Sign in to manage privacy.</div>}
        {/* Travel policy — private country clearance lists used by the
            Holiday map overlay and trip-card warnings. */}
        <TravelPolicyCard S={S} update={update} />
        </>
        )}

        {/* ─── DATA TAB ─── */}
        {activeTab === 'data' && (
        <>
        {/* A "Connected accounts" group opened this tab — an Open Banking
            foundation that never got a backend, so it advertised a
            "SOON" bank connection that could only ever answer "not
            switched on yet". Removed 2026-08-11: subscriptions and
            savings are manual entry, and the settings page should not
            promise otherwise. */}
        {/* Data & Privacy — encrypted export, see DataExportCard. */}
        <DataExportCard S={S} onOpenLegal={onOpenLegal} />

        {/* Danger Zone — lives inside the Data tab so destructive
            actions are co-located with export. Without the card border
            it used to sit behind, the red heading and the red button
            carry the warning. */}
        <SettingsGroup
          tone="danger"
          title="Danger zone"
          desc="Permanently deletes all boards, trackers, achievements, and settings. Your login email is retained for re-registration."
        >
          <button
            onClick={handleDeleteAccount}
            disabled={deleting}
            style={{
              background: 'rgba(220,38,38,0.10)', border: '1px solid rgba(220,38,38,0.35)',
              borderRadius: '10px', color: '#f87171', padding: '10px 18px',
              fontSize: '13px', fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--sans)', opacity: deleting ? 0.6 : 1, transition: 'all .18s',
            }}
          >
            {deleting ? 'Deleting…' : <IconLabel name="trash-2">Delete All Data</IconLabel>}
          </button>
        </SettingsGroup>

        </>
        )}

        {/* ─── GOALS TAB ─── */}
        {activeTab === 'goals' && (
        <>
        {/* Nutrition Goals */}
        {userId
          ? <MacroGoalsPanel userId={userId} />
          : <div className="settings-empty">Sign in to set your nutrition goals.</div>}

        {/* Coin gate on the shopping list. Lives at the top level of S
            as a new key (no migration); absent means ON, so every
            existing account keeps the behaviour it has today. */}
        {(() => {
          const requireCoins = S?.shopRequireCoins !== false;
          return (
            <SettingsGroup
              title="Shopping coins"
              desc="Controls whether your coin balance can stop you unlocking an item on the shopping list."
            >
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '12px 14px', borderRadius: '10px',
                  border: requireCoins ? '2px solid var(--em)' : '2px solid var(--border)',
                  background: requireCoins ? 'rgba(var(--em-rgb),0.08)' : 'var(--card, rgba(255,255,255,0.04))',
                  cursor: 'pointer', transition: 'all .18s',
                }}
              >
                <input
                  type="checkbox"
                  checked={requireCoins}
                  onChange={() => update(prev => ({ ...prev, shopRequireCoins: !requireCoins }))}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--em)', cursor: 'pointer' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                    Require enough coins to buy
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: '2px' }}>
                    On, an item you can't afford stays locked. Off, you can unlock anything and the list works as a plain wishlist — coins are still spent and still refunded if you un-buy, so your balance can go negative.
                  </div>
                </div>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '1.4px',
                  textTransform: 'uppercase', color: requireCoins ? 'var(--em)' : 'var(--text-muted)',
                }}>
                  {requireCoins ? 'On' : 'Off'}
                </span>
              </label>
            </SettingsGroup>
          );
        })()}
        </>
        )}

        {/* ─── TOOLS TAB ─── */}
        {activeTab === 'tools' && (
        <>
        {/* Tools — command palette + keyboard shortcuts. Used to live
            as a button in the page header but moved here to keep the
            chrome quieter. The Cmd+K / Ctrl+K hotkey still works. */}
        {(onOpenPalette || onOpenShortcuts) && (
          <SettingsGroup
            title="Navigation"
            desc="Quick navigation and keyboard reference. Cmd+K (or Ctrl+K) opens the command palette from anywhere."
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {onOpenPalette && (
                <button
                  type="button"
                  onClick={onOpenPalette}
                  style={{
                    background: 'rgba(255,255,255,.07)', border: '1px solid var(--border)',
                    borderRadius: '10px', color: 'var(--text)', padding: '10px 16px',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'var(--sans, var(--body))',
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    transition: 'all .18s',
                  }}
                >
                  <span aria-hidden="true" style={{display:'inline-flex'}}><Icon name="search" size={16} /></span>
                  Command palette
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.6, marginLeft: '4px' }}>
                    ⌃K
                  </span>
                </button>
              )}
              {onOpenShortcuts && (
                <button
                  type="button"
                  onClick={onOpenShortcuts}
                  style={{
                    background: 'rgba(255,255,255,.07)', border: '1px solid var(--border)',
                    borderRadius: '10px', color: 'var(--text)', padding: '10px 16px',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'var(--sans, var(--body))',
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    transition: 'all .18s',
                  }}
                >
                  <span aria-hidden="true" style={{display:'inline-flex'}}><Icon name="keyboard" size={16} /></span>
                  Keyboard shortcuts
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.6, marginLeft: '4px' }}>
                    ?
                  </span>
                </button>
              )}
            </div>
          </SettingsGroup>
        )}

        {/* Health & sync — every route vitals can arrive by, in one
            place. WHOOP and Oura moved here from the Vitals & Macros
            card on Track, which opened with two rows of connect/sync
            buttons above the history you came to read. Apple Health was
            already here and stays owner-only; the wearables are open to
            any account, each linking its own device. */}
        <SettingsGroup
          title="Health & sync"
          desc="Connect a wearable and its vitals flow into your Vitals & Macros history — sleep, resting HR, HRV, recovery and daily burn. Nothing you've logged by hand is ever replaced."
        >
          <WearableSync S={S} update={update} />
          {typeof window !== 'undefined' && window.__vantageOwner && (
            <>
              <p className="settings-group-note">
                Apple Health: import an export file, or turn on live daily sync via an iOS Shortcut.
              </p>
              <AppleHealthImport S={S} update={update} />
            </>
          )}
        </SettingsGroup>

        {/* Notifications — preferences card. The push delivery
            pipeline reads these to gate which kinds of pushes fire.
            Until APNs/FCM keys land + a server dispatcher exists,
            toggling here is a no-op observable, but the prefs
            persist so users can configure ahead of first push. */}
        <NotificationsPanel S={S} update={update} />

        {/* Subscription — current plan, restore + manage links.
            Restore is required by Apple's review guidelines; manage
            link deep-links to the platform-native subs UI. */}
        <SubscriptionPanel />

        {/* Visions catalogue — milestones the user can chase. */}
        <SettingsGroup
          title="Visions"
          desc="See every system milestone and which ones you've unlocked. Each feeds your category ratings."
        >
          <button
            type="button"
            className="tut-replay-btn"
            onClick={onOpenVisions}
          >
            <span aria-hidden="true" style={{display:'inline-flex',marginRight:6}}><Icon name="sparkles" size={15} /></span>Open visions catalogue
          </button>
        </SettingsGroup>

        {/* Upgrade — owner-only. App.jsx passes onOpenSchedule as null
            for everyone else, so the card simply never renders for
            non-owner accounts (same gating pattern as
            onCoinContextMenu admin powers). */}
        {onOpenSchedule && (
          <SettingsGroup
            title="Upgrade"
            desc="Owner-only: shift rotation and training calendar, the macro plan, and career tracking."
          >
            <button
              type="button"
              className="tut-replay-btn"
              onClick={onOpenSchedule}
            >
              <span aria-hidden="true" style={{display:'inline-flex',marginRight:6}}><Icon name="trending-up" size={15} /></span>Open Upgrade
            </button>
          </SettingsGroup>
        )}

        {/* Walkthrough / tour */}
        <SettingsGroup
          title="Walkthrough"
          desc="Replay the intro tour — useful if you want a refresher or you skipped it the first time."
        >
          <button
            type="button"
            className="tut-replay-btn"
            onClick={() => update(prev => ({ ...prev, tutorialCompleted: false }))}
          >
            <span aria-hidden="true" style={{display:'inline-flex',marginRight:6}}><Icon name="rotate-ccw" size={15} /></span>Replay tutorial
          </button>
        </SettingsGroup>
        </>
        )}

      </div>
    </section>
  );
}
