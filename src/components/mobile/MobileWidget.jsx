/**
 * MobileWidget — single widget card rendered below AI Coach on the
 * mobile hub. Type determines content. All widgets share the same
 * outer chrome (em-tinted border, mono eyebrow, optional × remove).
 *
 * Each type either works today (notepad / recent-wins / coin-history)
 * or surfaces a "Coming soon" CTA explaining what's needed to wire
 * the real data (HealthKit entitlement, Gmail OAuth, etc).
 *
 * Adding a new widget type:
 *   1. Add entry in WIDGET_META below
 *   2. Add a case in renderBody()
 *   3. Add an option in AddMobileWidgetModal's picker
 */
import { useState } from 'react';
import { APP_PRESETS, getAppPreset } from '../../data/appPresets';

// App presets (FloorplanStudio / TubeLube / …) become mobile widget
// types too — generated from the shared config so adding an app in one
// place lights it up on both surfaces. A preset with no URL carries a
// `requires` hint and renders as a "deploy first" stub.
const APP_WIDGET_META = Object.fromEntries(
  APP_PRESETS.map(p => [p.id, {
    label: p.name,
    eyebrow: p.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
    icon: p.icon,
    accent: p.color,
    ...(p.url ? {} : { requires: p.requires }),
  }])
);

const BASE_WIDGET_META = {
  'notepad': {
    label: 'Notepad',
    eyebrow: 'NOTES',
    icon: '✎',
  },
  'recent-wins': {
    label: 'Recent Wins',
    eyebrow: 'WINS',
    icon: '★',
  },
  'coin-history': {
    label: 'Coin Activity',
    eyebrow: 'COINS',
    icon: '⬡',
  },
  // F4 Sprint 4 — mobile parity for the desktop hub widgets.
  // These are read-only summaries of what the user has configured on
  // desktop (S.links, S.ghCache, S.ytWidgets). No new API calls fire
  // from mobile so they can't introduce a fresh failure mode.
  'github': {
    label: 'GitHub',
    eyebrow: 'GITHUB',
    icon: '◉',
    accent: '#1c1a17',
  },
  'linkedin': {
    label: 'LinkedIn',
    eyebrow: 'LINK',
    icon: 'in',
    accent: '#4d9ec4',
  },
  'youtube': {
    label: 'YouTube',
    eyebrow: 'YOUTUBE',
    icon: '▶',
    accent: '#cf5b52',
  },
  'vitals': {
    label: 'Vitals',
    eyebrow: 'HEALTH',
    icon: '◐',
    requires: 'HealthKit entitlement (Apple Dev account) — coming with F4 Sprint 1',
  },
  'calories': {
    label: 'Calories Burned',
    eyebrow: 'CALORIES',
    icon: '◔',
    requires: 'HealthKit + active-energy permission — coming with F4 Sprint 1',
  },
  'mail': {
    label: 'Recent Mail',
    eyebrow: 'INBOX',
    icon: '✉',
    requires: 'Gmail / Outlook OAuth — deferred (separate vertical)',
  },
};

// App presets slot in alongside the built-in widget types.
const WIDGET_META = { ...BASE_WIDGET_META, ...APP_WIDGET_META };

export default function MobileWidget({ widget, S, update, onRemove }) {
  const meta = WIDGET_META[widget.type] || { label: widget.type, eyebrow: '?', icon: '·' };

  // Brand-tinted icon chip when the type carries an `accent` (the new
  // GitHub / LinkedIn / YouTube widgets). Falls back to the default
  // em-accent for the original three.
  const chipStyle = meta.accent ? {
    color: meta.accent,
    background: meta.accent + '1a',
    borderColor: meta.accent + '55',
  } : undefined;

  return (
    <div className="m-widget">
      <div className="m-widget-head">
        <span className="m-widget-icon m-widget-chip" style={chipStyle}>{meta.icon}</span>
        <span className="m-widget-eyebrow">// {meta.eyebrow}</span>
        <button
          type="button"
          className="m-widget-remove"
          onClick={() => onRemove(widget.id)}
          aria-label="Remove widget"
          title="Remove"
        >×</button>
      </div>
      <div className="m-widget-body">
        {renderBody(widget, meta, S, update)}
      </div>
    </div>
  );
}

function renderBody(widget, meta, S, update) {
  if (meta.requires) {
    return (
      <div className="m-widget-stub">
        <div className="m-widget-stub-label">Coming soon</div>
        <div className="m-widget-stub-detail">{meta.requires}</div>
      </div>
    );
  }
  // App presets (FloorplanStudio / TubeLube / …) — render a static
  // brand card straight from the shared config. No state, no fetch.
  const preset = getAppPreset(widget.type);
  if (preset) return <AppPresetBody preset={preset} />;
  switch (widget.type) {
    case 'notepad':     return <NotepadBody S={S} update={update} />;
    case 'recent-wins': return <RecentWinsBody S={S} />;
    case 'coin-history':return <CoinHistoryBody S={S} />;
    case 'github':      return <GithubBody S={S} meta={meta} />;
    case 'linkedin':    return <LinkedinBody S={S} meta={meta} />;
    case 'youtube':     return <YoutubeBody S={S} meta={meta} />;
    default:            return <div className="m-widget-stub-label">Unknown widget type.</div>;
  }
}

// ── Notepad ──
function NotepadBody({ S, update }) {
  const [draft, setDraft] = useState(S.notepadText || '');
  function handleChange(e) {
    const value = e.target.value;
    setDraft(value);
    update(prev => ({ ...prev, notepadText: value }));
  }
  return (
    <textarea
      className="m-widget-notepad"
      value={draft}
      onChange={handleChange}
      placeholder="Quick notes…"
      rows={5}
    />
  );
}

// ── Recent wins (last 3 completed achievements) ──
function RecentWinsBody({ S }) {
  const wins = (S.achievements || [])
    .filter(a => a.completed)
    .slice(-3)
    .reverse();
  if (!wins.length) {
    return <div className="m-widget-empty">No completed achievements yet — tap the ★ on any node to mark complete.</div>;
  }
  return (
    <ul className="m-widget-list">
      {wins.map(a => (
        <li key={a.id} className="m-widget-list-row">
          <span className="m-widget-list-icon">{a.icon || '✨'}</span>
          <span className="m-widget-list-name">{a.name}</span>
          {a.coins > 0 && <span className="m-widget-list-meta">+{a.coins} ⬡</span>}
        </li>
      ))}
    </ul>
  );
}

// ── Coin history (last 5 entries) ──
function CoinHistoryBody({ S }) {
  const history = (S.coinHistory || []).slice(0, 5);
  const balance = S.coins || 0;
  if (!history.length) {
    return (
      <div className="m-widget-coins">
        <div className="m-widget-coins-balance">{balance}</div>
        <div className="m-widget-coins-label">Total coins · no activity yet</div>
      </div>
    );
  }
  return (
    <div>
      <div className="m-widget-coins-balance" style={{ marginBottom: 8 }}>{balance}</div>
      <ul className="m-widget-list">
        {history.map((h, i) => (
          <li key={i} className="m-widget-list-row">
            <span className={`m-widget-list-amount ${h.amount > 0 ? 'pos' : 'neg'}`}>
              {h.amount > 0 ? '+' : ''}{h.amount}
            </span>
            <span className="m-widget-list-name">{h.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Brand-link widgets (mobile parity for desktop hub) ──
//
// Each one reads from existing state — we don't fetch on mobile, just
// surface what's already cached/configured on the desktop hub. That
// keeps the mobile widgets zero-failure (nothing new to go wrong).
// Setup happens on desktop; mobile mirrors it for at-a-glance use.

function BrandCard({ title, host, openHref, accent, info }) {
  return (
    <div className="m-widget-brand">
      <div className="m-widget-brand-head">
        <div className="m-widget-brand-title">{title}</div>
        <div className="m-widget-brand-host">{host}</div>
      </div>
      {info && <div className="m-widget-brand-info">{info}</div>}
      {openHref && (
        <a
          className="m-widget-brand-open"
          href={openHref}
          target="_blank"
          rel="noreferrer"
          style={accent ? { color: accent, borderColor: accent + '55' } : undefined}
        >Open ↗</a>
      )}
    </div>
  );
}

// Static brand card for a user app preset (FloorplanStudio etc).
function AppPresetBody({ preset }) {
  const host = preset.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <BrandCard
      title={preset.name}
      host={host}
      openHref={preset.url}
      accent={preset.color}
      info={preset.tagline ? <div className="m-widget-brand-note">{preset.tagline}</div> : null}
    />
  );
}

function GithubBody({ S, meta }) {
  // First link with a ghUser; falls back to a setup hint.
  const ghLink = (S.links || []).find(l => l.ghUser);
  if (!ghLink) {
    return (
      <div className="m-widget-empty">
        Add a GitHub link on the desktop hub to surface stats here.
      </div>
    );
  }
  const cached = (S.ghCache || {})[ghLink.ghUser];
  return (
    <BrandCard
      title="GitHub"
      host={`github.com/${ghLink.ghUser}`}
      openHref={ghLink.url}
      accent={meta.accent}
      info={cached?.user ? (
        <div className="m-widget-stat-row">
          <div className="m-widget-stat"><div className="m-widget-stat-val">{cached.user.public_repos}</div><div className="m-widget-stat-lbl">Repos</div></div>
          <div className="m-widget-stat"><div className="m-widget-stat-val">{cached.user.followers}</div><div className="m-widget-stat-lbl">Followers</div></div>
          <div className="m-widget-stat"><div className="m-widget-stat-val">{cached.user.following}</div><div className="m-widget-stat-lbl">Following</div></div>
        </div>
      ) : (
        <div className="m-widget-empty">No stats cached yet — open the desktop hub once to populate.</div>
      )}
    />
  );
}

function LinkedinBody({ S, meta }) {
  // First link whose host contains "linkedin"; setup hint otherwise.
  const link = (S.links || []).find(l => /linkedin\.com/i.test(l.url || ''));
  if (!link) {
    return (
      <div className="m-widget-empty">
        Add a LinkedIn link on the desktop hub to surface it here.
      </div>
    );
  }
  const host = link.url.replace(/^https?:\/\//, '').split('/').slice(0, 2).join('/');
  return (
    <BrandCard
      title={link.name || 'LinkedIn'}
      host={host}
      openHref={link.url}
      accent={meta.accent}
      info={link.notes ? <div className="m-widget-brand-note">{link.notes}</div> : null}
    />
  );
}

function YoutubeBody({ S, meta }) {
  const yt = (S.ytWidgets || [])[0];
  if (!yt) {
    return (
      <div className="m-widget-empty">
        Add a YouTube widget on the desktop hub to surface subscriptions here.
      </div>
    );
  }
  const channelCount = (yt.channels || []).length;
  return (
    <BrandCard
      title="Subscriptions"
      host={`${channelCount} channel${channelCount === 1 ? '' : 's'} tracked`}
      openHref="https://www.youtube.com/feed/subscriptions"
      accent={meta.accent}
      info={channelCount > 0 ? (
        <div className="m-widget-brand-note">
          {(yt.channels || []).slice(0, 4).map(ch => '@' + String(ch).replace(/^@/, '')).join(' · ')}
          {channelCount > 4 && ` · +${channelCount - 4}`}
        </div>
      ) : null}
    />
  );
}

export { WIDGET_META };
