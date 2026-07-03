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
 *   4. AI Coach brief — single line teaser (Pro)
 *
 * Styling follows the dark-os "operator console" aesthetic (mono caps,
 * `// HEADER` markers, em-green accents) since it reads better at
 * phone scale than the cream theme's looser typography. CSS vars come
 * from whichever theme is active so cream users still see their
 * colour palette underneath.
 */

import { useState, useEffect } from 'react';
import { getTodayStr } from '../../utils/helpers';
import { recalcStreaks } from '../../utils/streaks';
import MobileWidget from './MobileWidget';
import RatingsPanel from '../RatingsPanel';

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

export default function MobileHubSection({ S, update, visionState, hasPro, navigate, onOpenModal }) {
  const now = useClock();
  const today = getTodayStr();
  const profileName = (S.profile?.name || '').trim();
  const g = greeting(profileName);
  const coins = S.coins || 0;
  const streak = S.currentStreak || 0;
  const pctToNext = Math.round((visionState?.pctToNext || 0) * 100);

  const trackers = S.trackers || [];
  const todayLogs = S.logs?.[today] || {};

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

  // Coach brief — read whatever's already cached. We don't kick off
  // useDailyBrief here because the desktop hub will fetch it for the
  // day; on mobile we just surface the result. If it's not there yet,
  // a stand-in line invites the user to open the Coach panel.
  const brief = S.coachBrief;
  const briefIsToday = brief?.date === today;
  const briefLine = briefIsToday
    ? (brief?.focus || brief?.micro || brief?.watch)
    : null;

  return (
    <section className="section m-hub-wrap">
    <div className="m-hub">
      {/* Greeting hero ─────────────────────────────────────────── */}
      <section className="m-hub-hero">
        <div className="m-hub-eyebrow">DAY {dayOfYear(now)} OF {now.getFullYear()}</div>
        <div className="m-hub-greet-row">
          <div className="m-hub-greet">
            <span className="m-hub-greet-part">{g.part}{' '}</span>
            <span className="m-hub-greet-name">{g.name}.</span>
          </div>
          <div className="m-hub-clock">
            <span className="m-hub-clock-h">{pad2(now.getHours())}</span>
            <span className="m-hub-clock-c">:</span>
            <span className="m-hub-clock-m">{pad2(now.getMinutes())}</span>
            <span className="m-hub-clock-s">{pad2(now.getSeconds())}</span>
          </div>
        </div>
        <div className="m-hub-date">{fmtDate(now)}</div>
      </section>

      {/* Ratings panel (F5 Sprint 3) — OVR + 4 categories ──────── */}
      <RatingsPanel S={S} update={update} />

      {/* Stats strip — coins + streak. Level was removed when OVR
          became the headline number (RatingsPanel above shows OVR
          + 4 categories). Two-column grid reads cleaner than a
          single orphaned card. */}
      <section className="m-hub-stats m-hub-stats-2col">
        <StatCard
          value={coins}
          label="COINS"
          accent="var(--coin, #d4a017)"
          pct={Math.min(100, (coins % 500) / 5)}
        />
        <StatCard
          value={streak}
          label="STREAK"
          accent="var(--em)"
          pct={Math.min(100, streak * 3.3)}
        />
      </section>

      {/* Today's trackers ──────────────────────────────────────── */}
      <section className="m-hub-section">
        <div className="m-hub-section-header">// TODAY'S TRACKERS</div>
        {trackers.length === 0 && (
          <div className="m-hub-empty">
            No trackers yet. Tap <strong>Track</strong> below to add one.
          </div>
        )}
        <div className="m-hub-trackers">
          {trackers.map(t => {
            const v = todayLogs[t.id];
            const isBool = t.type === 'boolean';
            const done = isBool ? !!v : (typeof v === 'number' && v > 0);
            return (
              <button
                key={t.id}
                className={`m-tracker-row${done ? ' is-done' : ''}`}
                onClick={() => isBool ? toggleBoolean(t.id) : navigate?.('track')}
              >
                <span
                  className="m-tracker-check"
                  style={done ? { background: t.color || 'var(--em)', borderColor: t.color || 'var(--em)' } : undefined}
                  aria-hidden="true"
                >
                  {done && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </span>
                <span className="m-tracker-name">{t.name}</span>
                <span className={`m-tracker-pill${done ? ' is-done' : ''}`}>
                  {done
                    ? <>&#10003; Done</>
                    : (isBool ? '–' : (t.unit ? `0 ${t.unit}` : '–'))}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* AI Coach brief ────────────────────────────────────────── */}
      <section className="m-hub-section">
        <div className="m-hub-section-header">// AI COACH</div>
        <div className="m-hub-coach">
          <div className="m-hub-coach-eyebrow">
            AT COACH {hasPro && <span className="m-hub-coach-badge">PRO</span>}
          </div>
          <div className="m-hub-coach-body">
            {briefLine || (hasPro
              ? "Today's brief hasn't loaded yet. Tap to open the Coach panel."
              : "Pro unlocks daily briefs from your AI coach — patterns, focus areas, micro-actions.")}
          </div>
        </div>
      </section>

      {/* Widget stack — vertical list of user-added widgets, each
          removable via the × in its head. New widgets append below
          the last. + button below opens the picker modal. */}
      {(S.mobileWidgets || []).map(w => (
        <MobileWidget
          key={w.id}
          widget={w}
          S={S}
          update={update}
          navigate={navigate}
          onRemove={id => update(prev => ({
            ...prev,
            mobileWidgets: (prev.mobileWidgets || []).filter(x => x.id !== id),
          }))}
        />
      ))}

      <button
        type="button"
        className="m-widget-add"
        onClick={() => onOpenModal?.('addMobileWidgetModal')}
        aria-label="Add a widget below AI Coach"
      >
        <span className="m-widget-add-icon">＋</span>
        <span className="m-widget-add-label">Add widget</span>
      </button>
    </div>
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
