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
import { getTodayStr } from '../../utils/helpers';
import { APP_PRESETS, getAppPreset } from '../../data/appPresets';
import { fetchAppPreview } from '../../lib/appPreview';
import { strikeState } from '../../lib/habits/strikes';

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
  // Vitals — manual daily log (weight / sleep / resting HR). Started
  // life as a HealthKit stub; reworked to manual entry so it works on
  // every platform today. When HealthKit lands it can auto-fill the
  // same S.vitalsLog store.
  'vitals': {
    label: 'Vitals',
    eyebrow: 'HEALTH',
    icon: '◐',
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

export default function MobileWidget({ widget, S, update, onRemove, navigate }) {
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
            {renderBody(widget, meta, S, update, navigate)}
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

function renderBody(widget, meta, S, update, navigate) {
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
    case 'habits':      return <HabitsBody S={S} navigate={navigate} />;
    case 'holidays':    return <HolidaysBody S={S} navigate={navigate} />;
    case 'github':      return <GithubBody S={S} meta={meta} />;
    case 'linkedin':    return <LinkedinBody S={S} meta={meta} />;
    case 'youtube':     return <YoutubeBody S={S} meta={meta} />;
    case 'vitals':      return <VitalsBody S={S} update={update} />;
    default:            return <div className="m-widget-stub-label">Unknown widget type.</div>;
  }
}

// ── Vitals — manual daily log ──
// Three tap-to-log tiles (weight / sleep / resting HR) writing to
// S.vitalsLog = { 'YYYY-MM-DD': { weight, sleep, rhr } }, plus a
// weight sparkline over the last 14 logged entries. A tile shows
// today's value; if today isn't logged yet it falls back to the most
// recent entry, dimmed, so the widget never reads as empty once
// you've logged anything.
const VITAL_FIELDS = [
  { key: 'weight', label: 'WEIGHT',  unit: 'kg',  step: '0.1', max: 400 },
  { key: 'sleep',  label: 'SLEEP',   unit: 'h',   step: '0.5', max: 24  },
  { key: 'rhr',    label: 'REST HR', unit: 'bpm', step: '1',   max: 250 },
];

function VitalsBody({ S, update }) {
  const today = getTodayStr();
  const log = S.vitalsLog || {};
  const dates = Object.keys(log).sort();
  const [editing, setEditing] = useState(null); // field key | null
  const [draft, setDraft] = useState('');

  function latest(key) {
    for (let i = dates.length - 1; i >= 0; i--) {
      const v = log[dates[i]]?.[key];
      if (v != null) return { v, date: dates[i] };
    }
    return null;
  }
  function open(field) {
    const cur = log[today]?.[field.key] ?? latest(field.key)?.v;
    setDraft(cur != null ? String(cur) : '');
    setEditing(field.key);
  }
  function save(field) {
    const num = parseFloat(draft);
    setEditing(null);
    if (!Number.isFinite(num) || num <= 0 || num > field.max) return;
    update(prev => ({
      ...prev,
      vitalsLog: {
        ...(prev.vitalsLog || {}),
        [today]: { ...((prev.vitalsLog || {})[today] || {}), [field.key]: num },
      },
    }));
  }

  // Weight trend — last 14 logged weights, oldest → newest.
  const weights = dates.map(d => log[d]?.weight).filter(v => v != null).slice(-14);
  const prevWeight = weights.length >= 2 ? weights[weights.length - 2] : null;
  const delta = prevWeight != null ? weights[weights.length - 1] - prevWeight : null;

  return (
    <div className="m-vitals">
      <div className="m-vitals-tiles">
        {VITAL_FIELDS.map(f => {
          const todayVal = log[today]?.[f.key];
          const fallback = todayVal == null ? latest(f.key) : null;
          const shown = todayVal ?? fallback?.v;
          return editing === f.key ? (
            <div key={f.key} className="m-vitals-tile is-editing">
              <input
                type="number"
                inputMode="decimal"
                step={f.step}
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(f); if (e.key === 'Escape') setEditing(null); }}
                onBlur={() => save(f)}
                className="m-vitals-input"
                aria-label={`${f.label} in ${f.unit}`}
              />
              <span className="m-vitals-label">{f.unit.toUpperCase()}</span>
            </div>
          ) : (
            <button key={f.key} type="button" className={`m-vitals-tile${todayVal == null && shown != null ? ' is-stale' : ''}`} onClick={() => open(f)}>
              <span className="m-vitals-val">
                {shown != null ? shown : '–'}
                {shown != null && <span className="m-vitals-unit">{f.unit}</span>}
              </span>
              <span className="m-vitals-label">{f.label}</span>
              {f.key === 'weight' && delta != null && todayVal != null && (
                <span className={`m-vitals-delta${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`}>
                  {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta).toFixed(1)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {weights.length >= 2 && <VitalsSparkline values={weights} />}
      <div className="m-vitals-hint">
        {log[today] ? 'Tap a tile to update today’s entry.' : 'Tap a tile to log today.'}
      </div>
    </div>
  );
}

function VitalsSparkline({ values }) {
  const W = 260, H = 34, PAD = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (v - min) / span) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="m-vitals-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--em)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
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
function HabitsBody({ S, navigate }) {
  const go = () => navigate && navigate('habits');
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
        const strikes = strikeState(h, now);
        const struckCls = strikes.state === 'struck' ? ' is-struck' : strikes.state === 'maxed' ? ' is-maxed' : '';
        return (
          <li key={h.id} className="m-widget-habit m-widget-clickable" onClick={go}>
            <div className="m-widget-habit-top">
              <span className="m-widget-habit-name">{h.name}</span>
              <span className={`m-widget-habit-time${struckCls}`}>{fmtElapsed(elapsed)}</span>
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
function HolidaysBody({ S, navigate }) {
  const go = () => navigate && navigate('holiday');
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
            className={`m-widget-trip m-widget-clickable${h.imageUrl ? ' has-img' : ''}`}
            style={h.imageUrl ? { backgroundImage: `url(${h.imageUrl})` } : undefined}
            onClick={go}
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

// App preset card. When preset.live === true and a URL is set, fetch
// a richer preview (og image + scraped title/description) via the
// shared appPreview cache. Falls back to the static brand card if
// nothing came back (offline / autofill function down / preset.live
// false).
function AppPresetBody({ preset }) {
  const host = preset.url ? preset.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!preset.live || !preset.url) { setPreview(null); return; }
    let cancelled = false;
    fetchAppPreview(preset.url).then(p => { if (!cancelled) setPreview(p || {}); });
    return () => { cancelled = true; };
  }, [preset.live, preset.url]);

  const hasImage = !!(preview && preview.imageUrl);
  const snippet  = (preview && (preview.notes || preview.name)) || preset.tagline;

  if (!preset.live) {
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

  return (
    <div className="m-widget-brand m-widget-brand-live">
      {hasImage && (
        <a href={preset.url} target="_blank" rel="noreferrer" className="m-widget-brand-hero">
          <img src={preview.imageUrl} alt="" loading="lazy"
            onError={e => { e.target.style.display = 'none'; }} />
        </a>
      )}
      <div className="m-widget-brand-head">
        <div className="m-widget-brand-title">{preset.name}</div>
        <div className="m-widget-brand-host">{host}</div>
      </div>
      {snippet && <div className="m-widget-brand-note">{snippet}</div>}
      <a
        className="m-widget-brand-open"
        href={preset.url}
        target="_blank"
        rel="noreferrer"
        style={preset.color ? { color: preset.color, borderColor: preset.color + '55' } : undefined}
      >Open ↗</a>
    </div>
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
