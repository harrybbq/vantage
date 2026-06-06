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
import { useState, useRef, useEffect } from 'react';
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
  'habits': {
    label: 'Habits',
    eyebrow: 'STREAKS',
    icon: '◷',
  },
  'holidays': {
    label: 'Holidays',
    eyebrow: 'TRIPS',
    icon: '✈',
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

  // ── Gestures ──
  // Swipe left → reveal a red Delete button. Long-press → a small menu
  // (transparency toggle + delete), matching the desktop right-click
  // module menu. A single touchstart decides which: horizontal drag =
  // swipe, holding still = menu, vertical = native scroll.
  const REVEAL = 84;
  const [offset, setOffset] = useState(0);
  const [menu, setMenu] = useState(null); // { x, y } | null
  const startX = useRef(0);
  const startY = useRef(0);
  const startOff = useRef(0);
  const mode = useRef(null); // null | 'swipe' | 'scroll' | 'menu'
  const lpTimer = useRef(0);

  const transparent = !!widget.transparent;

  function clearLP() { clearTimeout(lpTimer.current); lpTimer.current = 0; }
  function setTransparent(val) {
    update(prev => ({
      ...prev,
      mobileWidgets: (prev.mobileWidgets || []).map(w => w.id === widget.id ? { ...w, transparent: val } : w),
    }));
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    startOff.current = offset;
    mode.current = null;
    clearLP();
    lpTimer.current = setTimeout(() => {
      mode.current = 'menu';
      setOffset(0);
      setMenu({ x: startX.current, y: startY.current });
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch { /* ignore */ } }
    }, 450);
  }
  function onTouchMove(e) {
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (mode.current === null) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { mode.current = 'swipe'; clearLP(); }
      else if (Math.abs(dy) > 8) { mode.current = 'scroll'; clearLP(); }
    }
    if (mode.current === 'swipe') {
      setOffset(Math.max(-REVEAL, Math.min(0, startOff.current + dx)));
    }
  }
  function onTouchEnd() {
    clearLP();
    if (mode.current === 'swipe') setOffset(o => (o < -REVEAL / 2 ? -REVEAL : 0));
    mode.current = null;
  }

  // Dismiss the long-press menu on any outside tap / scroll.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const id = setTimeout(() => {
      document.addEventListener('pointerdown', close);
      document.addEventListener('scroll', close, true);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const open = offset < 0;

  return (
    <>
      <div className="m-widget-swipe" style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}>
        {/* Red delete action — only mounted while swiping, so it never
            shows through a transparent widget when closed. */}
        {open && (
          <button
            type="button"
            className="m-widget-delete"
            onClick={() => onRemove(widget.id)}
            aria-label="Delete widget"
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: REVEAL,
              border: 'none', background: 'rgb(214,69,69)', color: '#fff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 5, fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: 1.2,
              textTransform: 'uppercase', fontWeight: 700, cursor: 'pointer',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
            </svg>
            Delete
          </button>
        )}

        {/* Foreground card */}
        <div
          className={`m-widget${transparent ? ' is-transparent' : ''}`}
          style={{
            transform: `translateX(${offset}px)`,
            transition: mode.current === 'swipe' ? 'none' : 'transform .2s ease',
            touchAction: 'pan-y',
            position: 'relative',
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          onClickCapture={e => { if (open) { e.preventDefault(); e.stopPropagation(); setOffset(0); } }}
        >
          <div className="m-widget-head">
            <span className="m-widget-icon m-widget-chip" style={chipStyle}>{meta.icon}</span>
            <span className="m-widget-eyebrow">// {meta.eyebrow}</span>
          </div>
          <div className="m-widget-body">
            {renderBody(widget, meta, S, update)}
          </div>
        </div>
      </div>

      {/* Long-press menu — transparency toggle + delete */}
      {menu && (
        <div
          className="hub-module-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 150) }}
          onPointerDown={e => e.stopPropagation()}
          role="menu"
        >
          <div className="hub-module-menu-head">{meta.label}</div>
          <button
            type="button"
            className="hub-module-menu-row"
            onClick={() => setTransparent(!transparent)}
            role="menuitemcheckbox"
            aria-checked={transparent}
          >
            <span className="hub-module-menu-label">Transparent background</span>
            <span className={`hub-switch${transparent ? ' is-on' : ''}`} aria-hidden="true">
              <span className="hub-switch-knob" />
            </span>
          </button>
          <button
            type="button"
            className="hub-module-menu-row"
            onClick={() => { setMenu(null); onRemove(widget.id); }}
          >
            <span className="hub-module-menu-label" style={{ color: 'rgb(214,69,69)' }}>Delete widget</span>
          </button>
        </div>
      )}
    </>
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
    case 'habits':      return <HabitsBody S={S} />;
    case 'holidays':    return <HolidaysBody S={S} />;
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

// ── Habits — longest-running first, with live streak timers ──
function fmtElapsed(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
// Progress toward the next un-reached milestone (or the last one once
// all are hit). Returns { pct, label }.
function habitProgress(h, elapsed) {
  const ms = (h.milestones || []).slice().sort((a, b) => a.duration - b.duration);
  if (!ms.length) return { pct: 0, label: null };
  const next = ms.find(m => m.duration > elapsed);
  const target = next ? next.duration : ms[ms.length - 1].duration;
  const pct = Math.max(0, Math.min(100, target ? (elapsed / target) * 100 : 100));
  return { pct, label: next ? next.label : 'All milestones hit' };
}
function HabitsBody({ S }) {
  // Tick once a second so the timers + bars stay live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const habits = (S.habits || [])
    .filter(h => h.startTime)
    .slice()
    .sort((a, b) => a.startTime - b.startTime) // oldest start = longest running
    .slice(0, 4);
  if (!habits.length) {
    return <div className="m-widget-empty">No habits yet — add one in Habits to see live streak timers here.</div>;
  }
  const now = Date.now();
  return (
    <ul className="m-widget-list m-widget-habits">
      {habits.map(h => {
        const elapsed = now - h.startTime;
        const { pct, label } = habitProgress(h, elapsed);
        return (
          <li key={h.id} className="m-widget-habit">
            <div className="m-widget-habit-top">
              <span className="m-widget-habit-name">{h.name}</span>
              <span className="m-widget-habit-time">{fmtElapsed(elapsed)}</span>
            </div>
            <div className="m-widget-habit-bar"><div className="m-widget-habit-fill" style={{ width: `${pct}%` }} /></div>
            {label && <div className="m-widget-habit-next">{label}</div>}
          </li>
        );
      })}
    </ul>
  );
}

// ── Holidays — closest upcoming trips first ──
function HolidaysBody({ S }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const trips = (S.holidays || [])
    .filter(h => h.status !== 'completed')
    .map(h => {
      let dep = null;
      if (h.from) { dep = new Date(h.from); dep.setHours(0, 0, 0, 0); }
      return { h, dep };
    })
    .filter(x => !x.dep || x.dep >= today) // upcoming or undated
    .sort((a, b) => {
      if (!a.dep) return 1;
      if (!b.dep) return -1;
      return a.dep - b.dep;
    })
    .slice(0, 4);
  if (!trips.length) {
    return <div className="m-widget-empty">No upcoming trips — plan one in Holidays.</div>;
  }
  return (
    <ul className="m-widget-list m-widget-trips">
      {trips.map(({ h, dep }) => {
        const days = dep ? Math.round((dep - today) / 86400000) : null;
        const label = days == null ? 'TBC'
          : days === 0 ? 'Today'
          : days === 1 ? 'Tomorrow'
          : `${days}d`;
        return (
          <li
            key={h.id}
            className={`m-widget-trip${h.imageUrl ? ' has-img' : ''}`}
            style={h.imageUrl ? { backgroundImage: `url(${h.imageUrl})` } : undefined}
          >
            <span className="m-widget-trip-name">{h.dest || 'Trip'}</span>
            <span className="m-widget-trip-when">{label}</span>
          </li>
        );
      })}
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
