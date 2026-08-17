/**
 * MobileHubSection
 *
 * Purpose-built mobile hub layout. The desktop HubSection (cream) and
 * HubOsLayout (dark-os) are dense multi-column dashboards designed for
 * a 1280+ viewport — they do NOT fit on a phone. Rather than stuff
 * three columns into one and call it responsive, we render a tighter
 * single-column "operator console" view on mobile that picks the
 * essentials:
 *
 *   1. Greeting hero — date, time-of-day greeting, big clock
 *   2. Stats strip — coins / streak (level removed 2026-05-12; OVR
 *      lives in the Ledger card above and is the headline number now)
 *   3. Today's trackers — vertical list with at-a-glance done state
 *   4. AI Coach brief — focus / watch / micro-action (Pro), fetched
 *      here because nothing else on mobile ever did
 *
 * Styling follows the dark-os "operator console" aesthetic (mono caps,
 * `// HEADER` markers, em-green accents) since it reads better at
 * phone scale than the cream theme's looser typography. CSS vars come
 * from whichever theme is active so cream users still see their
 * colour palette underneath.
 */

import { useState, useEffect, useRef } from 'react';
import Icon from '../Icon';
import { getTodayStr } from '../../utils/helpers';
import { eventColour, todayAgenda } from '../../lib/calendar/events';
import { recalcStreaks } from '../../utils/streaks';
import MobileWidget from './MobileWidget';
import { isRetiredWidget } from '../../lib/widgets/retired';
import RatingsPanel from '../RatingsPanel';
import HubDrawer, { EDGE_PX, OPEN_THRESHOLD } from './HubDrawer';
import { useDailyBrief } from '../../hooks/useDailyBrief';

function pad2(n) { return String(n).padStart(2, '0'); }

function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function greeting(name) {
  const h = new Date().getHours();
  const n = name || 'You';
  if (h < 5)  return { part: 'Still up,',  name: n };
  if (h < 12) return { part: 'Morning,',   name: n };
  if (h < 17) return { part: 'Afternoon,', name: n };
  if (h < 21) return { part: 'Evening,',   name: n };
  return { part: 'Night,', name: n };
}

function dayOfYear(d = new Date()) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function fmtDate(d) {
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export default function MobileHubSection({ S, update, visionState, hasPro, navigate, onOpenModal, userId }) {
  const now = useClock();
  const [drawer, setDrawer] = useState(false);
  // Edge-swipe. Only a touch STARTING within EDGE_PX of the left edge is
  // a candidate — past that, widget cards own horizontal drags for their
  // delete reveal, and two gestures on the same axis is how you get a
  // hub where neither works reliably.
  const edge = useRef(null);
  function edgeStart(e) {
    const t = e.touches && e.touches[0];
    if (!t || t.clientX > EDGE_PX) { edge.current = null; return; }
    edge.current = { x: t.clientX, y: t.clientY };
  }
  function edgeMove(e) {
    const t = e.touches && e.touches[0];
    if (!t || !edge.current) return;
    const dx = t.clientX - edge.current.x;
    const dy = t.clientY - edge.current.y;
    // Vertical wins — an edge drag that is mostly scroll is a scroll.
    if (Math.abs(dy) > Math.abs(dx)) { edge.current = null; return; }
    if (dx > OPEN_THRESHOLD) { setDrawer(true); edge.current = null; }
  }
  const today = getTodayStr();
  const profileName = (S.profile?.name || '').trim();
  const g = greeting(profileName);
  const coins = S.coins || 0;
  const streak = S.currentStreak || 0;
  const pctToNext = Math.round((visionState?.pctToNext || 0) * 100);

  const trackers = S.trackers || [];
  const todayLogs = S.logs?.[today] || {};
  // `now` ticks every second, so an event crosses into `past` on its own.
  const agenda = todayAgenda(S, now);

  // Boolean toggle handler — mirrors the boolean branch of QuickLog's
  // handleChange (logs + streak recalc). Number trackers route to the
  // Track section instead of trying to render a stepper inline.
  function toggleBoolean(trackerId) {
    update(prev => {
      const newLogs = { ...prev.logs };
      const dayLog = { ...(newLogs[today] || {}) };
      const wasOn = !!dayLog[trackerId];
      if (wasOn) delete dayLog[trackerId];
      else dayLog[trackerId] = true;
      if (Object.keys(dayLog).length) newLogs[today] = dayLog;
      else delete newLogs[today];
      const newStreaks = recalcStreaks(newLogs, prev.trackers || [], prev.streaks || {});
      return { ...prev, logs: newLogs, streaks: newStreaks };
    });
  }

  // Trackers in the shape the drawer wants: done/value resolved here so
  // the drawer stays a view and the log shape lives in one place.
  const drawerTrackers = trackers.map(t => {
    const v = todayLogs[t.id];
    const isBool = t.type === 'boolean';
    return {
      ...t, isBool,
      value: typeof v === 'number' ? v : undefined,
      done: isBool ? !!v : (typeof v === 'number' && v > 0),
    };
  });

  // Undone trackers drive the dot on the avatar — the one thing from
  // the drawer worth surfacing on the hub, because it is the only item
  // in there that is an action rather than a number.
  const trackersLeft = drawerTrackers.filter(t => !t.done).length;

  // Coach brief.
  //
  // This used to read S.coachBrief and nothing else, on the reasoning
  // that "the desktop hub will fetch it for the day". Nothing on a
  // phone ever calls useDailyBrief — CoachBriefPanel is the only
  // caller and it renders in HubSection and HubOsLayout, both desktop
  // — so on a phone the key was never written and the drawer showed a
  // stand-in line every day, forever. Running the hook here is what
  // makes the section real: it serves the rules-based brief instantly
  // and upgrades to the LLM one when that returns. It no-ops entirely
  // for non-Pro, so the free tier still costs nothing.
  const { brief, loading: briefLoading, error: briefError } =
    useDailyBrief({ S, update, isPro: hasPro });

  return (
    <section className="section m-hub-wrap"
             onTouchStart={edgeStart} onTouchMove={edgeMove}>
    <div className="m-hub">
      {/* Greeting hero. The one thing that stays above the widgets —
          it is orientation, not data, and it costs half a screen of
          nothing to read it. The avatar opens the drawer, so the edge
          swipe is never the only way in. */}
      <section className="m-hub-hero">
        <div className="m-hub-hero-top">
          <button type="button" className="m-hub-av" onClick={() => setDrawer(true)}
                  aria-label="Open your day">
            {S.profile?.photo
              ? <img src={S.profile.photo} alt="" />
              : <span>{(profileName || 'You').slice(0, 1).toUpperCase()}</span>}
            {trackersLeft > 0 && <span className="m-hub-av-dot" aria-hidden="true" />}
          </button>
          <div className="m-hub-eyebrow">DAY {dayOfYear(now)} OF {now.getFullYear()}</div>
          <div className="m-hub-clock">
            <span className="m-hub-clock-h">{pad2(now.getHours())}</span>
            <span className="m-hub-clock-c">:</span>
            <span className="m-hub-clock-m">{pad2(now.getMinutes())}</span>
            <span className="m-hub-clock-s">{pad2(now.getSeconds())}</span>
          </div>
        </div>
        <div className="m-hub-greet">
          <span className="m-hub-greet-part">{g.part}{' '}</span>
          <span className="m-hub-greet-name">{g.name}.</span>
        </div>
        <div className="m-hub-date">{fmtDate(now)}</div>

        {/* Today's events, in the hero for the same reason as on the
            desktop hub: this block is already the "what is now" block,
            and a reminder that needs a widget added before it can remind
            you isn't one. Tapping goes to the calendar that owns them. */}
        {agenda.length > 0 && (
          <button type="button" className="m-hub-events" onClick={() => navigate('track')}
                  aria-label="Today's events — open the calendar">
            {agenda.slice(0, 3).map(ev => (
              <span key={ev.id} className={`m-hub-event${ev.past ? ' is-past' : ''}`}>
                <span className="m-hub-event-dot" style={{ background: eventColour(ev) }} />
                {ev.time && <span className="m-hub-event-at">{ev.time}</span>}
                <span className="m-hub-event-name">{ev.title}</span>
              </span>
            ))}
            {agenda.length > 3 && <span className="m-hub-events-meta">+{agenda.length - 3}</span>}
          </button>
        )}
      </section>

      {/* Widget stack. New widgets append below the last; hold one to
          reorder — dragging near the top or bottom edge scrolls the
          list so a card at the bottom can reach the top. */}
      {(S.mobileWidgets || []).map((w, i) => isRetiredWidget(w.type) ? null : (
        <MobileWidget
          key={w.id}
          widget={w}
          index={i}
          S={S}
          update={update}
          navigate={navigate}
          userId={userId}
          onReorder={(from, to) => update(prev => {
            const arr = [...(prev.mobileWidgets || [])];
            if (from < 0 || from >= arr.length || from === to) return prev;
            // `to` already counts only OTHER cards above the drop point,
            // so it's the insertion index in the post-removal array.
            const [moved] = arr.splice(from, 1);
            arr.splice(to, 0, moved);
            return { ...prev, mobileWidgets: arr };
          })}
          onRemove={id => update(prev => ({
            ...prev,
            mobileWidgets: (prev.mobileWidgets || []).filter(x => x.id !== id),
          }))}
        />
      ))}

      {/* First run. With the stats moved into the drawer a brand-new
          account would otherwise land on a greeting and nothing else,
          which reads as a broken page rather than an empty one. */}
      {!(S.mobileWidgets || []).length ? (
        <div className="m-hub-first">
          <div className="m-hub-first-icon"><Icon name="layout-grid" size={26} /></div>
          <div className="m-hub-first-h">Build your hub</div>
          <p className="m-hub-first-p">
            Add the things you want to see first thing — vitals, macros, savings, goals.
            Hold a widget to reorder it.
          </p>
          <button type="button" className="m-hub-first-btn"
                  onClick={() => onOpenModal?.('addMobileWidgetModal')}>
            <Icon name="plus" size={15} /> Add your first widget
          </button>
          <button type="button" className="m-hub-first-alt" onClick={() => setDrawer(true)}>
            Or see today&apos;s numbers
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="m-widget-add"
          onClick={() => onOpenModal?.('addMobileWidgetModal')}
          aria-label="Add a widget"
        >
          <span className="m-widget-add-icon"><Icon name="plus" size={16} /></span>
          <span className="m-widget-add-label">Add widget</span>
        </button>
      )}
    </div>

    <HubDrawer
      open={drawer}
      onClose={() => setDrawer(false)}
      S={S}
      update={update}
      trackers={drawerTrackers}
      onToggleTracker={t => (t.isBool ? toggleBoolean(t.id) : (setDrawer(false), navigate?.('track')))}
      onNavigate={navigate}
      brief={brief}
      briefLoading={briefLoading}
      briefError={briefError}
      onUpgrade={() => { setDrawer(false); onOpenModal?.('paywall:generic'); }}
      hasPro={hasPro}
    />
    </section>
  );
}

function StatCard({ value, label, accent, pct }) {
  return (
    <div className="m-stat">
      <div className="m-stat-value">{value}</div>
      <div className="m-stat-label">{label}</div>
      <div className="m-stat-bar">
        <div className="m-stat-bar-fill" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: accent }} />
      </div>
    </div>
  );
}
