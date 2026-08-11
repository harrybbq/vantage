/**
 * Operator-console hub layout.
 *
 * Used by BOTH themes and every tier since the free themes were retired
 * in 2026-08 — it is simply what the hub looks like now. Reuses the
 * existing HubSection widget canvas, QuickLog, AiCoachWidget and
 * CoachBriefPanel, arranged in a 3-zone grid with chrome-style panels.
 *
 * Each panel is a standalone component so future work can let users
 * toggle / re-arrange them — S.hubLayout will drive which render.
 */

import { useEffect, useRef, useState } from 'react';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import { storeSubscriptionsUrl } from '../lib/billing/manageSubscription';
import { motion } from 'framer-motion';
import AiCoachWidget from './AiCoachWidget';
import CoachBriefPanel from './CoachBriefPanel';
import QuickLog from './QuickLog';
import FriendsRail from './friends/FriendsRail';
import RatingsPanel from './RatingsPanel';
import { useHubModuleMenu, moduleIdFromLabel } from './HubModuleMenu';
import Icon from './Icon';
import { useOwnHandle } from '../hooks/useOwnHandle';

// ── Panel primitive ──────────────────────────────────────────────────────
// Each panel tags itself with data-hub-module so the right-click
// transparency menu can target it. See HubModuleMenu.
//
// The id defaults to a slug of the label, which is convenient right up
// until a panel is renamed: the id is the key S.moduleTransparency stores
// under, so "Session" → "Today" silently orphans the preference and the
// panel springs back to opaque. Pass `moduleId` to pin the key and the
// label becomes free to change. Renamed panels MUST keep their original
// id — it is a saved preference, not a derived value.
function OsPanel({ label, moduleId, right, children, bodyClass = '', innerPadding = true }) {
  return (
    <div className="os-panel" data-hub-module={moduleId || moduleIdFromLabel(label)} data-hub-module-label={label}>
      <div className="os-panel-label">
        <span className="os-panel-label-text">{label}</span>
        {right ? <span className="os-panel-label-right">{right}</span> : null}
      </div>
      <div className={`os-panel-body ${bodyClass}`} style={innerPadding ? undefined : { padding: 0 }}>
        {children}
      </div>
    </div>
  );
}

// ── Clock hook ────────────────────────────────────────────────────────────
function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** Sticky offset of the columns — keep in step with `top` in hub-dark.css. */
const COL_STICKY_TOP = 14;

/**
 * Flag the main row while its columns are actually pinned.
 *
 * A column has two lives. Before the page has scrolled past the top row
 * it is an ordinary block that happens to sit beside the canvas: it runs
 * its natural length, the page scrolls it like everything else, and it
 * needs no height cap. Once sticky takes over at `top: 14px` it becomes
 * a rail, and only then does it want the viewport-height cap and its own
 * scrollbar.
 *
 * Capping it in BOTH states was the mistake this replaces: the cap was
 * the space visible below the column's current top, which on a short
 * window is a few hundred pixels, so at the top of the page the rail
 * was a stub with a scrollbar next to a full-height canvas.
 *
 * The attribute also gates scroll containment, and that pairing is the
 * point: contained while pinned, so the rail's own scroll never chains
 * to the page and bounces; free while not, so a wheel over the rail can
 * still scroll the page far enough to pin it in the first place.
 *
 * It also publishes how much of the year-countdown footer is currently
 * over the bottom of the screen. The footer is the last thing on the
 * page, so near the end of a scroll it takes the bottom strip of the
 * viewport — and a rail that assumed the whole viewport height would
 * simply be painted over, which is what hid the foot of the Ratings
 * ledger. Shrinking the rail by exactly that intrusion parks it on top
 * of the footer instead. The value is 0 for the whole page until the
 * footer actually comes into view, so it never shortens a rail that had
 * the room.
 *
 * Both columns share a row, so one measurement drives both. rAF-throttled
 * and passive, and it only touches the DOM when a value actually changes.
 */
function useStickyColumnState(ref) {
  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    let raf = 0;
    let pinned = null;
    let inset = null;
    const measure = () => {
      raf = 0;
      const track = host.querySelector('.os-col');
      // Below 1100px the columns are full-width rows stacked under the
      // canvas, not rails beside it — never treat those as pinned.
      const isPinned = !!track
        && window.matchMedia('(min-width: 1100px)').matches
        && track.getBoundingClientRect().top <= COL_STICKY_TOP + 0.5;
      if (isPinned !== pinned) {
        pinned = isPinned;
        if (isPinned) host.setAttribute('data-os-pinned', '');
        else host.removeAttribute('data-os-pinned');
      }

      const footer = host.ownerDocument.getElementById('hubFooter');
      const rect = footer && footer.offsetParent !== null
        ? footer.getBoundingClientRect() : null;
      const over = rect && rect.height > 0
        ? Math.max(0, Math.round(window.innerHeight - rect.top)) : 0;
      if (over !== inset) {
        inset = over;
        host.style.setProperty('--os-col-bottom-inset', `${over}px`);
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}

function greeting(name) {
  const h = new Date().getHours();
  const n = name || 'You';
  if (h < 5)  return { part: 'Still up,',    name: n };
  if (h < 12) return { part: 'Good morning,', name: n };
  if (h < 17) return { part: 'Good afternoon,', name: n };
  if (h < 21) return { part: 'Good evening,', name: n };
  return { part: 'Night,', name: n };
}

function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

/**
 * Plan row at the foot of the Operator panel.
 *
 * Deliberately does NOT change the tier itself. `profiles.tier` is
 * server-owned (see supabase/profiles_column_lockdown.sql) — the client
 * literally cannot write it, which is what stops anyone granting
 * themselves Pro. So this routes to the two places that legitimately
 * change a plan: the paywall for buying, and the store's own
 * subscription screen for changing or cancelling one.
 *
 * Lifetime is a grant, never a purchase, so it shows as a terminal
 * state with nothing to manage.
 */
function OsPlanRow({ onUpgrade }) {
  const { tier, isPro, isLifetime, proPlan, proIsLive, loading } = useSubscriptionContext();
  if (loading) return null;

  const label = isLifetime ? 'Lifetime' : isPro ? `Pro${proPlan ? ' · ' + proPlan : ''}` : 'Free';
  const storeUrl = storeSubscriptionsUrl();

  return (
    <div className="os-plan-row">
      <span className="os-plan-label">Plan</span>
      <span className={`os-plan-tier os-plan-tier-${isLifetime ? 'lifetime' : isPro ? 'pro' : 'free'}`}>
        {label}
      </span>
      {isLifetime ? (
        // Nothing to manage — it never renews and can't lapse.
        <span className="os-plan-note">Granted · never expires</span>
      ) : isPro ? (
        <a className="os-plan-action" href={storeUrl} target="_blank" rel="noreferrer">Manage ↗</a>
      ) : proIsLive ? (
        <button type="button" className="os-plan-action is-cta" onClick={onUpgrade}>Upgrade</button>
      ) : (
        <span className="os-plan-note">Pro coming soon</span>
      )}
    </div>
  );
}

// ── Panel: Profile ────────────────────────────────────────────────────────
export function OsProfilePanel({ profile, handle, onSaveName, onSaveTagline, onUploadPhoto, onUpgrade }) {
  const tier = 'Focus'; // TODO: wire to a real status/DND toggle later
  return (
    <OsPanel label="Operator" right="Online" innerPadding={false}>
      <div className="os-profile">
        <div className="os-profile-photo" onClick={() => document.getElementById('osPhotoInput').click()}>
          {profile.photo
            ? <img src={profile.photo} alt="Profile" />
            : <div className="os-profile-photo-placeholder"><Icon name="image" size={20} strokeWidth={1.5} /></div>}
        </div>
        <input
          id="osPhotoInput"
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onUploadPhoto}
        />
        <div className="os-profile-info">
          <input
            className="os-profile-name"
            type="text"
            placeholder="Your name"
            defaultValue={profile.name}
            onChange={e => onSaveName(e.target.value)}
          />
          <input
            className="os-profile-tagline"
            type="text"
            placeholder="tagline…"
            defaultValue={profile.tagline}
            onChange={e => onSaveTagline(e.target.value)}
          />
          <div className="os-profile-status">
            <span className="os-status-badge">{tier}</span>
            {handle && <span className="os-profile-handle">@{handle}</span>}
          </div>
        </div>
      </div>
      <OsPlanRow onUpgrade={onUpgrade} />
    </OsPanel>
  );
}

// ── Panel: Today (greeting + clock + tracker nodes) ───────────────────────
// Labelled "Session" until 2026-08-11. The component keeps the old name
// because its transparency preference is still stored under `session`.
function trackerInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

export function OsSessionPanel({ name, trackers, logs }) {
  const time = useClock();
  const h = pad2(time.getHours());
  const m = pad2(time.getMinutes());
  const s = pad2(time.getSeconds());
  const { part, name: who } = greeting(name);
  const dateStr = time.toLocaleDateString('en-GB', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).toUpperCase();

  // Tracker completion nodes (moved here from the standalone Trackers
  // panel). Each node = one tracker; filled when completed today. A
  // boolean tracker is "hit" when logged truthy; a number tracker when
  // it reaches its goal. Read-only indicators — toggling still happens
  // in the QuickLog panel.
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();
  const nodes = (trackers || []).map(t => {
    const v = logs?.[today]?.[t.id];
    const hit = t.type === 'boolean'
      ? !!v
      : !!(t.goal && (Number(v) || 0) >= t.goal);
    return { t, hit };
  });
  const doneCount = nodes.filter(n => n.hit).length;

  return (
    <OsPanel label="Today" moduleId="session" right={`Day ${dayOfYear(time)} of ${time.getFullYear()}`} innerPadding={false}>
      <div className="os-session">
        <div className="os-session-main">
          <div className="os-session-greeting">
            {part} <em>{who}.</em>
          </div>
          <div className="os-session-date">{dateStr}</div>
          {nodes.length > 0 && (
            <div className="os-session-trackers" role="list" aria-label="Today's trackers">
              {nodes.map(({ t, hit }) => (
                <span
                  key={t.id}
                  className={`os-session-node${hit ? ' is-hit' : ''}`}
                  role="listitem"
                  title={`${t.name} · ${hit ? 'Done today' : 'Not yet'}`}
                >
                  {hit ? '✓' : trackerInitial(t.name)}
                </span>
              ))}
              <span className="os-session-trackers-meta">{doneCount}/{nodes.length}</span>
            </div>
          )}
        </div>
        <div className="os-session-clock">
          {h}<span className="os-session-clock-sep">:</span>{m}
          <span className="os-session-clock-secs">{s}</span>
        </div>
      </div>
    </OsPanel>
  );
}

// ── Panel: Ratings (F5 Sprint 3) ──────────────────────────────────────────
// The Ledger card IS the panel — its own border, eyebrow header
// ("RATINGS · LEDGER"), and per-row layout already match the OS
// chrome treatment. Wrapping it in an OsPanel duplicated the label
// and produced a visible double-layer (reported 2026-05-12).
//
// Rendering RatingsPanel directly means it sits in the grid as a
// peer of other OsPanels. The compact variant matches the column
// width without overflow.
export function OsRatingsPanel({ S, update }) {
  return <RatingsPanel S={S} update={update} compact />;
}

// ── Panel: Quick Actions ──────────────────────────────────────────────────
export function OsActionsPanel({ onAddWidget, onSnapFill, onNavigateSettings, snapOn, onToggleSnap }) {
  return (
    <OsPanel label="Actions" innerPadding={false}>
      <div className="os-actions">
        <motion.button className="os-action-btn primary" onClick={onAddWidget}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Icon name="plus" size={14} /> Add widget
        </motion.button>
        {onSnapFill && (
          <motion.button className="os-action-btn" onClick={onSnapFill}
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Icon name="layout-dashboard" size={13} /> Snap to fill
          </motion.button>
        )}
        {onToggleSnap && (
          <motion.button className={`os-action-btn os-action-toggle${snapOn ? ' is-on' : ''}`} onClick={onToggleSnap}
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} aria-pressed={snapOn}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="move" size={13} /> Snap drag</span>
            <span className={`os-toggle-pip${snapOn ? ' is-on' : ''}`}>{snapOn ? 'ON' : 'OFF'}</span>
          </motion.button>
        )}
        <motion.button className="os-action-btn" onClick={onNavigateSettings}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Icon name="settings" size={13} /> Settings
        </motion.button>
      </div>
    </OsPanel>
  );
}

// ── Panel: Trackers Mini ──────────────────────────────────────────────────
// Not rendered by the OS layout today. If it is ever brought back, note
// that the quick-log panel now carries the "Trackers" label — two panels
// with the same label would also derive the same data-hub-module id and
// so share one transparency preference. Give this one an explicit
// moduleId before rendering it.
export function OsTrackersPanel({ trackers, logs }) {
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  })();

  const rows = (trackers || []).slice(0, 5).map(t => {
    const v = logs?.[today]?.[t.id];
    if (t.type === 'boolean') {
      return { t, hit: !!v, label: v ? '✓ Done' : '—' };
    }
    const n = Number(v) || 0;
    return { t, hit: t.goal && n >= t.goal, label: `${n}${t.unit || ''}` };
  });

  return (
    <OsPanel label="Trackers" right={rows.length ? 'Today' : ''}>
      <div className="os-trackers-mini">
        {rows.length === 0 ? (
          <div className="os-habits-empty">No trackers set up yet.</div>
        ) : rows.map(({ t, hit, label }) => (
          <div key={t.id} className="os-tracker-row">
            <span className="os-tracker-name">{t.name}</span>
            <span className={`os-tracker-pill ${hit ? 'hit' : ''}`}>{label}</span>
          </div>
        ))}
      </div>
    </OsPanel>
  );
}

// ── Panel: Widgets Canvas (reuses imperative canvas from HubSection) ──────
// The actual imperative rendering is mounted by the parent via a ref. We
// just provide the panel shell and let the parent stuff the canvas into it.
export const OsWidgetsPanel = ({ canvasRef }) => (
  <div className="os-panel os-widgets" data-hub-module="widgets" data-hub-module-label="Widgets">
    <div className="os-panel-label">
      <span className="os-panel-label-text">Widgets</span>
      <span className="os-panel-label-right">Canvas</span>
    </div>
    <div id="widgetCanvas" className="os-widgets-body hub-links-col" ref={canvasRef}></div>
  </div>
);

// ── Panel: QuickLog wrapper ───────────────────────────────────────────────
export function OsQuickLogPanel({ S, update, onNavigateTrack, onShowCoinToast }) {
  return (
    <OsPanel label="Trackers" moduleId="nutrition-log" innerPadding={false}>
      <div className="os-panel-body os-quicklog-body">
        <QuickLog S={S} update={update} onNavigateTrack={onNavigateTrack} onShowCoinToast={onShowCoinToast} />
      </div>
    </OsPanel>
  );
}

// ── Panel: AI Coach wrapper ───────────────────────────────────────────────
export function OsCoachPanel({ S, update, onOpenWaitlist, onCoachAct, userId }) {
  return (
    <OsPanel label="AI Coach" right="Brief" innerPadding={false}>
      <div className="os-panel-body os-coach-body">
        <AiCoachWidget S={S} update={update} onOpenWaitlist={onOpenWaitlist} onCoachAct={onCoachAct} />
        <CoachBriefPanel S={S} update={update} onCoachAct={onCoachAct} userId={userId} />
      </div>
    </OsPanel>
  );
}

// ── Panel: Cardio (kcal burned, MET-based) ────────────────────────────────
// Optional Pro add-on. Wire via S.hubPanels.cardio === true.
// Formula:  kcal = MET × weight_kg × hours
// MET values from the 2011 Compendium of Physical Activities (Ainsworth).
// These are good enough for a self-tracker — not a medical calc.
const CARDIO_ACTIVITIES = [
  { id: 'walk-slow',   name: 'Walking · 2.5 mph',          met: 3.0  },
  { id: 'walk-brisk',  name: 'Walking · 4 mph (brisk)',    met: 5.0  },
  { id: 'run-jog',     name: 'Jogging · 5 mph',            met: 8.3  },
  { id: 'run-6',       name: 'Running · 6 mph',            met: 9.8  },
  { id: 'run-7',       name: 'Running · 7 mph',            met: 11.0 },
  { id: 'run-8',       name: 'Running · 8 mph',            met: 11.8 },
  { id: 'cycle-light', name: 'Cycling · leisure',          met: 4.0  },
  { id: 'cycle-mod',   name: 'Cycling · moderate',         met: 8.0  },
  { id: 'cycle-vig',   name: 'Cycling · vigorous',         met: 10.0 },
  { id: 'swim',        name: 'Swimming · moderate',        met: 8.3  },
  { id: 'row',         name: 'Rowing · moderate',          met: 7.0  },
  { id: 'elliptical',  name: 'Elliptical · moderate',      met: 5.0  },
  { id: 'hiit',        name: 'HIIT',                        met: 10.0 },
  { id: 'weights',     name: 'Weight training · vigorous', met: 6.0  },
  { id: 'yoga',        name: 'Yoga · hatha',                met: 2.5  },
  { id: 'jump-rope',   name: 'Jump rope · moderate',        met: 11.8 },
];

function calcKcal(metOrCustom, weightKg, minutes) {
  if (!weightKg || !minutes) return 0;
  const hours = minutes / 60;
  return Math.round(metOrCustom * weightKg * hours);
}

export function OsCardioPanel({ profile = {}, onSaveWeight, onLogBurn }) {
  const [activityId, setActivityId] = useState('run-6');
  const [minutes, setMinutes] = useState(30);
  const [justLogged, setJustLogged] = useState(false);
  const [weightDraft, setWeightDraft] = useState(profile.weightKg || '');

  const activity = CARDIO_ACTIVITIES.find(a => a.id === activityId) || CARDIO_ACTIVITIES[0];
  const weightKg = Number(profile.weightKg) || 0;
  const kcal = calcKcal(activity.met, weightKg, Number(minutes) || 0);

  function handleWeightBlur() {
    const w = Number(weightDraft);
    if (!Number.isFinite(w) || w <= 0) return;
    onSaveWeight(w);
  }

  function handleLog() {
    if (!kcal) return;
    onLogBurn({
      id: `burn-${Date.now()}`,
      activityId: activity.id,
      activityName: activity.name,
      met: activity.met,
      minutes: Number(minutes),
      weightKg,
      kcal,
      ts: Date.now(),
    });
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 1800);
  }

  const needsWeight = !weightKg;

  return (
    <OsPanel label="Cardio" right={kcal ? `${kcal} kcal` : 'Calc'} innerPadding={false}>
      <div className="os-cardio">
        {/* Weight row */}
        <div className="os-cardio-row">
          <label className="os-cardio-label">Weight</label>
          <div className="os-cardio-weight">
            <input
              type="number"
              className="os-cardio-input"
              inputMode="decimal"
              min="20"
              max="300"
              step="0.1"
              placeholder="e.g. 78"
              value={weightDraft}
              onChange={e => setWeightDraft(e.target.value)}
              onBlur={handleWeightBlur}
            />
            <span className="os-cardio-unit">kg</span>
          </div>
        </div>

        {/* Activity row */}
        <div className="os-cardio-row">
          <label className="os-cardio-label">Activity</label>
          <select
            className="os-cardio-select"
            value={activityId}
            onChange={e => setActivityId(e.target.value)}
          >
            {CARDIO_ACTIVITIES.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* Duration row */}
        <div className="os-cardio-row">
          <label className="os-cardio-label">Duration</label>
          <div className="os-cardio-weight">
            <input
              type="number"
              className="os-cardio-input"
              inputMode="numeric"
              min="1"
              max="600"
              step="1"
              value={minutes}
              onChange={e => setMinutes(e.target.value)}
            />
            <span className="os-cardio-unit">min</span>
          </div>
        </div>

        {/* Result + Log button */}
        <div className="os-cardio-result">
          <div className="os-cardio-kcal">
            <span className="os-cardio-kcal-val">{kcal.toLocaleString()}</span>
            <span className="os-cardio-kcal-unit">kcal</span>
          </div>
          <div className="os-cardio-sub">
            {needsWeight
              ? 'Enter weight to calculate'
              : `MET ${activity.met} · ${minutes || 0} min · ${weightKg} kg`}
          </div>
          <button
            className="os-cardio-log-btn"
            onClick={handleLog}
            disabled={!kcal || justLogged}
          >
            {justLogged ? <span style={{display:'inline-flex',alignItems:'center',gap:5}}><Icon name="check" size={13} /> Logged</span> : <span style={{display:'inline-flex',alignItems:'center',gap:5}}><Icon name="plus" size={13} /> Log burn</span>}
          </button>
        </div>
      </div>
    </OsPanel>
  );
}

// ── Main OS layout ────────────────────────────────────────────────────────
export default function HubOsLayout({
  S, update, canvasRef,
  onAddWidget, onSnapFill, onNavigateSettings, onNavigateTrack,
  onShowCoinToast, onOpenWaitlist, onCoachAct,
  onUploadPhoto, onToggleSnap,
  userId, onUpgrade,
}) {
  const profile = S.profile || {};
  const ownHandle = useOwnHandle(userId);
  const mainRef = useRef(null);
  useStickyColumnState(mainRef);

  // Right-click any panel → toggle its background transparency.
  const moduleMenu = useHubModuleMenu({
    S, update,
    syncKey: `${S.links?.length || 0}`,
  });

  return (
    <div className="hub-os" ref={moduleMenu.rootRef} onContextMenu={moduleMenu.onContextMenu}>
      {/* ── TOP ROW ── */}
      <div className="hub-os-top">
        <OsProfilePanel
          profile={profile}
          handle={ownHandle}
          onSaveName={name => update(prev => ({ ...prev, profile: { ...prev.profile, name } }))}
          onSaveTagline={tagline => update(prev => ({ ...prev, profile: { ...prev.profile, tagline } }))}
          onUploadPhoto={onUploadPhoto}
          onUpgrade={onUpgrade}
        />
        <OsSessionPanel name={profile.name} trackers={S.trackers} logs={S.logs} />
        {/* The ratings ledger sits here now, where a Vitals panel used to
            repeat numbers the rest of the UI already carries: coins live
            in the chrome bar and OVR is the donut's whole point. Moving
            it up also shortens the left rail, which is the column that
            has to fit the screen. */}
        <OsRatingsPanel S={S} update={update} compact />
      </div>

      {/* ── MAIN ROW ── */}
      <div className="hub-os-main" ref={mainRef}>
        {/* Left col: actions + friends rail.
            The outer div spans the full row height; the inner one is what
            sticks. See hub-dark.css — sticking the outer box means it is
            clamped by its own short height and gets shoved off-screen at
            the bottom of the page. */}
        <div className="os-col">
          <div className="os-col-inner">
            <OsActionsPanel
              onAddWidget={onAddWidget}
              onSnapFill={onSnapFill}
              onNavigateSettings={onNavigateSettings}
              snapOn={!!S.hubSnap}
              onToggleSnap={onToggleSnap}
            />
            {/* Friends rail sits above the (tall) Ratings ledger so incoming
                friend requests — which render at the top of the rail — are
                visible without scrolling the column past the ledger. Same
                component as the cream hub, retinted via dark-os overrides
                on the .fc-* classes in hub-dark.css. */}
            <FriendsRail userId={userId} onUpgrade={onUpgrade} />
          </div>
        </div>

        {/* Middle: imperative widgets canvas */}
        <OsWidgetsPanel canvasRef={canvasRef} />

        {/* Right col: quicklog, ai coach, optional cardio */}
        <div className="os-col">
          <div className="os-col-inner">
            <OsQuickLogPanel S={S} update={update}
              onNavigateTrack={onNavigateTrack}
              onShowCoinToast={onShowCoinToast} />
            {S.hubPanels?.cardio && (
              <OsCardioPanel
                profile={S.profile || {}}
                onSaveWeight={w => update(prev => ({ ...prev, profile: { ...prev.profile, weightKg: w } }))}
                onLogBurn={entry => update(prev => ({
                  ...prev,
                  cardioLogs: [...(prev.cardioLogs || []), entry].slice(-200),
                }))}
              />
            )}
            <OsCoachPanel S={S} update={update}
              onOpenWaitlist={onOpenWaitlist}
              onCoachAct={onCoachAct}
              userId={userId} />
          </div>
        </div>
      </div>

      {/* ── BOTTOM ROW ── */}
      {moduleMenu.menuNode}
    </div>
  );
}
