import { useState } from 'react';
import { motion } from 'framer-motion';
import { getWeekKey, countWeekLogs, getTodayStr } from '../utils/helpers';
import { fireGoal, fireStreak7, fireStreak30 } from '../utils/confetti';
import { recalcStreaks } from '../utils/streaks';
import SectionHelp from './SectionHelp';
import NutritionSection from './NutritionSection';
import VitalsHistoryCard from './VitalsHistoryCard';

function getWeekProgress(logs, trackerId, weeklyTarget) {
  const dateStr = getTodayStr();
  const count = countWeekLogs(logs, trackerId, dateStr);
  return { count, target: weeklyTarget };
}

/**
 * TrackersList — compact rows (2026-07 redesign). Each tracker is one
 * ~56px row: a progress-ring button on the left (fills with weekly
 * progress, tap = log today), name + colour dot, then a right-aligned
 * mono column with the weekly fraction and streak/coin meta. Replaces
 * the old ~330px cards with the fat grey week pill.
 *
 * Ring tap semantics mirror the hub QuickLog: boolean trackers toggle
 * today's log; number trackers increment today by 1 (long math still
 * lives in the calendar day editor). Streaks recalc on every change.
 */
function TrackerRing({ tracker, count, target, doneToday, onClick }) {
  const R = 13, C = 2 * Math.PI * R;
  const pct = target ? Math.min(1, count / target) : (doneToday ? 1 : 0);
  const weekDone = target > 0 && count >= target;
  const stroke = weekDone ? 'var(--gold)' : (tracker.color || 'var(--em)');
  return (
    <button
      type="button"
      className={`tracker-ring${doneToday ? ' is-done' : ''}`}
      onClick={onClick}
      aria-label={`${tracker.name}: ${doneToday ? 'logged today — tap to undo' : 'tap to log today'}`}
      title={doneToday ? 'Logged today — tap to undo' : 'Log today'}
    >
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        <circle cx="17" cy="17" r={R} fill="none" stroke="var(--border)" strokeWidth="3" />
        {pct > 0 && (
          <circle cx="17" cy="17" r={R} fill="none" stroke={stroke} strokeWidth="3"
            strokeDasharray={`${(pct * C).toFixed(1)} ${C.toFixed(1)}`}
            strokeLinecap="round" transform="rotate(-90 17 17)" />
        )}
      </svg>
      <span className="tracker-ring-center">{doneToday ? '✓' : ''}</span>
    </button>
  );
}

function TrackersList({ trackers, logs, streaks, onDelete, onOpenModal, update }) {
  const today = getTodayStr();
  const todayLogs = logs?.[today] || {};

  // Log today from the ring — boolean toggles, number increments by 1.
  // Mirrors the hub QuickLog boolean branch (logs + streak recalc, no
  // direct coin writes — weekly-challenge coins pay out through the
  // same flow they always have).
  function logToday(t) {
    update(prev => {
      const newLogs = { ...prev.logs };
      const dayLog = { ...(newLogs[today] || {}) };
      if (t.type === 'boolean') {
        if (dayLog[t.id]) delete dayLog[t.id];
        else dayLog[t.id] = true;
      } else {
        dayLog[t.id] = (typeof dayLog[t.id] === 'number' ? dayLog[t.id] : 0) + 1;
      }
      if (Object.keys(dayLog).length) newLogs[today] = dayLog;
      else delete newLogs[today];
      const newStreaks = recalcStreaks(newLogs, prev.trackers || [], prev.streaks || {});
      return { ...prev, logs: newLogs, streaks: newStreaks };
    });
  }

  return (
    <div className="card trackers-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <h3 style={{ margin: 0 }}>Trackers</h3>
        <motion.button className="btn btn-primary btn-sm" onClick={() => onOpenModal('addTrackerModal')}
          whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.93 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}>+</motion.button>
      </div>
      <div id="trackersList">
        {!trackers.length && (
          <div className="section-empty">
            <div className="section-empty-icon">📊</div>
            <div className="section-empty-title">No trackers yet</div>
            <div className="section-empty-body">Track habits, workouts, water — anything you want to build consistency around.</div>
            <button className="btn btn-primary btn-sm section-empty-cta" onClick={() => onOpenModal('addTrackerModal')}>Add first tracker</button>
          </div>
        )}
        {trackers.map((t, index) => {
          const hasChallenge = !!(t.weeklyTarget && t.weeklyCoins);
          const { count, target } = hasChallenge
            ? getWeekProgress(logs, t.id, t.weeklyTarget)
            : { count: 0, target: 0 };
          const weekDone = hasChallenge && count >= target;
          const v = todayLogs[t.id];
          const doneToday = t.type === 'boolean' ? !!v : (typeof v === 'number' && v > 0);
          const s = t.type === 'boolean' ? streaks?.[t.id] : null;
          return (
            <motion.div
              key={t.id}
              className="tracker-row"
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: index * 0.05, ease: 'easeOut' }}
            >
              <TrackerRing tracker={t} count={count} target={target} doneToday={doneToday} onClick={() => logToday(t)} />
              <div className="tracker-row-main">
                <div className="tracker-row-name">
                  <span className="tracker-dot" style={{ background: t.color }}></span>
                  <span className="tracker-row-label">{t.name}</span>
                  {t.type !== 'boolean' && typeof v === 'number' && v > 0 && (
                    <span className="tracker-row-todayval">{v}{t.unit ? ` ${t.unit}` : ''} today</span>
                  )}
                </div>
              </div>
              <div className="tracker-row-right">
                {hasChallenge ? (
                  <div className={`tracker-row-frac${weekDone ? ' is-done' : ''}`}>
                    {weekDone ? '✓ ' : ''}{count}<span>/{target} wk</span>
                  </div>
                ) : (
                  <div className="tracker-row-frac"><span>{t.type === 'boolean' ? 'daily' : (t.unit || 'number')}</span></div>
                )}
                <div className="tracker-row-meta">
                  {s?.current > 0 && <span className="tracker-row-fire">🔥{s.current}</span>}
                  {s?.best > (s?.current || 0) && <span> best {s.best}</span>}
                  {hasChallenge && <span className="tracker-row-coins"> ⬡{t.weeklyCoins}</span>}
                </div>
              </div>
              <button
                className="tracker-row-del"
                onClick={e => { e.stopPropagation(); onDelete(t.id); }}
                aria-label={`Delete ${t.name}`}
              >✕</button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarView({ S, update, onShowCoinToast, nutritionMonthData }) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const { calYear, calMonth, trackers, logs, multiSelectMode, multiSelectedDays } = S;

  function changeMonth(d) {
    update(prev => {
      let m = prev.calMonth + d;
      let y = prev.calYear;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      return { ...prev, calMonth: m, calYear: y };
    });
  }

  function toggleMultiSelect() {
    update(prev => ({
      ...prev,
      multiSelectMode: !prev.multiSelectMode,
      multiSelectedDays: [],
    }));
  }

  function cancelMultiSelect() {
    update(prev => ({ ...prev, multiSelectMode: false, multiSelectedDays: [], selectedLogDate: null }));
  }

  function clearSelectedDays() {
    if (!multiSelectedDays.length) { alert('Select at least one day.'); return; }
    if (!window.confirm(`Remove all markers from ${multiSelectedDays.length} selected day${multiSelectedDays.length !== 1 ? 's' : ''}?`)) return;
    update(prev => {
      const newLogs = { ...prev.logs };
      (prev.multiSelectedDays || []).forEach(key => { delete newLogs[key]; });
      return { ...prev, logs: newLogs, multiSelectMode: false, multiSelectedDays: [] };
    });
  }

  function handleDayClick(key) {
    if (multiSelectMode) {
      update(prev => ({
        ...prev,
        multiSelectedDays: prev.multiSelectedDays.includes(key)
          ? prev.multiSelectedDays.filter(k => k !== key)
          : [...prev.multiSelectedDays, key],
      }));
    } else {
      update(prev => ({ ...prev, selectedLogDate: key }));
      // Scroll log panel into view after React re-renders
      setTimeout(() => {
        const panel = document.querySelector('.log-panel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }

  // Build calendar grid
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const dim = new Date(calYear, calMonth + 1, 0).getDate();
  const offset = (firstDay + 6) % 7;
  const today = new Date();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push({ empty: true, key: 'e' + i });
  for (let day = 1; day <= dim; day++) {
    const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayLogs = logs[key] || {};
    const isToday = today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === day;
    const isSelected = multiSelectedDays.includes(key);
    const tids = Object.keys(dayLogs);
    cells.push({ day, key, dayLogs, isToday, isSelected, tids });
  }

  const selectedKey = S.selectedLogDate;
  const selectedDay = selectedKey ? parseInt(selectedKey.split('-')[2]) : null;
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function saveLog() {
    const key = selectedKey;
    if (!key) return;
    const logData = {};
    trackers.forEach(t => {
      const el = document.getElementById('log-' + t.id);
      if (!el) return;
      if (t.type === 'boolean') { if (el.checked) logData[t.id] = true; }
      else { const v = parseFloat(el.value); if (!isNaN(v) && v !== 0) logData[t.id] = v; }
    });

    // Merge log save + weekly coin check into ONE atomic update to avoid
    // stale-state races across multiple setS calls.
    update(prev => {
      // 1. Save the log entry
      const newLogs = { ...prev.logs };
      if (Object.keys(logData).length) newLogs[key] = logData;
      else delete newLogs[key];

      let next = { ...prev, logs: newLogs };

      // 2. Recalculate streaks
      const newStreaks = recalcStreaks(newLogs, prev.trackers || [], prev.streaks || {});
      next = { ...next, streaks: newStreaks };

      // 3. Weekly challenge — symmetric award/refund so toggling a log
      // can't farm coins (mirrors QuickLog; see the anti-scam note there).
      trackers.forEach(t => {
        if (!t.weeklyTarget || !t.weeklyCoins) return;
        const weekKey = getWeekKey(key);
        const awardKey = 'awarded_' + t.id + '_' + weekKey;
        const count = countWeekLogs(newLogs, t.id, key);
        const alreadyAwarded = !!next[awardKey];

        if (count >= t.weeklyTarget && !alreadyAwarded) {
          const coins = (next.coins || 0) + t.weeklyCoins;
          const coinHistory = [
            { type: 'earn', label: t.name + ' weekly goal (' + t.weeklyTarget + 'x)', amount: t.weeklyCoins, ts: Date.now() },
            ...(next.coinHistory || []),
          ];
          onShowCoinToast('+' + t.weeklyCoins + ' ⬡ — ' + t.name + ' weekly goal!', true);
          fireGoal();
          next = { ...next, [awardKey]: true, coins, coinHistory };
        } else if (count < t.weeklyTarget && alreadyAwarded) {
          const coins = Math.max(0, (next.coins || 0) - t.weeklyCoins);
          const coinHistory = [
            { type: 'refund', label: t.name + ' weekly goal reversed', amount: -t.weeklyCoins, ts: Date.now() },
            ...(next.coinHistory || []),
          ];
          const reversed = { ...next, coins, coinHistory };
          delete reversed[awardKey];
          next = reversed;
        }
      });

      // 4. Streak milestones (only for today's log)
      const today = getTodayStr();
      if (key === today) {
        trackers.forEach(t => {
          if (t.type !== 'boolean') return;
          const updatedStreak = newStreaks[t.id]?.current;
          if (updatedStreak === 7) {
            fireStreak7();
            onShowCoinToast(`🔥 7 day streak on ${t.name}!`, true);
          } else if (updatedStreak === 30) {
            fireStreak30();
            onShowCoinToast(`🔥 30 day streak — incredible consistency!`, true);
          }
        });
      }

      return next;
    });

    const btn = document.querySelector('.log-save-btn');
    if (btn) { btn.textContent = '✓ Saved'; btn.style.background = 'var(--em-light)'; setTimeout(() => { btn.textContent = 'Save'; btn.style.background = 'var(--em)'; }, 1400); }
  }

  function clearDay() {
    if (!selectedKey) return;
    if (!window.confirm('Remove all markers for this day?')) return;
    update(prev => {
      const newLogs = { ...prev.logs };
      delete newLogs[selectedKey];
      return { ...prev, logs: newLogs, selectedLogDate: null };
    });
  }

  return (
    <div className="card" style={{ padding: '22px' }}>
      <div className="cal-header">
        <div className="cal-month-title">{months[calMonth]} {calYear}</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className={`multi-toggle-btn${multiSelectMode ? ' active' : ''}`}
            onClick={toggleMultiSelect}
          >{multiSelectMode ? '☑ Multi-select' : '☐ Multi-select'}</button>
          <div className="cal-nav">
            <button className="cal-nav-btn" onClick={() => changeMonth(-1)}>‹</button>
            <button className="cal-nav-btn" onClick={() => changeMonth(1)}>›</button>
          </div>
        </div>
      </div>

      {multiSelectMode && (
        <div id="multiSelectBar" style={{ display: 'block' }}>
          <div className="cal-multiselect-bar">
            <span>{multiSelectedDays.length} day{multiSelectedDays.length !== 1 ? 's' : ''} selected</span>
            <div className="ms-actions">
              <button className="ms-btn ms-btn-apply" onClick={() => {
                if (!multiSelectedDays.length) { alert('Select at least one day.'); return; }
                update(prev => ({ ...prev, _multiLogOpen: true }));
              }}>Apply to Selected</button>
              <button className="ms-btn" onClick={clearSelectedDays} style={{ background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)' }}>Clear Days</button>
              <button className="ms-btn ms-btn-cancel" onClick={cancelMultiSelect}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="cal-days-header">
        {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => <div key={d} className="cal-day-label">{d}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map(cell => {
          if (cell.empty) return <div key={cell.key} className="cal-cell empty"></div>;
          const firstTid = cell.tids[0];
          const firstTracker = firstTid ? trackers.find(t => t.id === firstTid) : null;
          return (
            <div
              key={cell.key}
              className={`cal-cell${cell.isToday ? ' today' : ''}${cell.tids.length ? ' has-logs' : ''}${cell.isSelected ? ' selected' : ''}`}
              onClick={() => handleDayClick(cell.key)}
            >
              {firstTracker && <div className="cal-cell-fill" style={{ background: firstTracker.color }}></div>}
              <div className="cal-date">{cell.day}</div>
              {(cell.tids.length > 0 || (nutritionMonthData && nutritionMonthData[cell.key])) && (
                <div className="cal-dots">
                  {cell.tids.map(tid => {
                    const tr = trackers.find(t => t.id === tid);
                    return tr ? <div key={tid} className="cal-dot" style={{ background: tr.color }}></div> : null;
                  })}
                  {nutritionMonthData && nutritionMonthData[cell.key] && (
                    <div
                      className="cal-dot"
                      style={{ background: '#1a7a4a', boxShadow: '0 0 0 1px rgba(26,122,74,.3)' }}
                      title={`${Math.round(nutritionMonthData[cell.key].calories || 0)} kcal logged`}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        {trackers.map(t => (
          <div key={t.id} className="legend-item">
            <div className="legend-dot" style={{ background: t.color }}></div>
            {t.name}
          </div>
        ))}
        {Object.keys(nutritionMonthData || {}).length > 0 && (
          <div className="legend-item">
            <div className="legend-dot" style={{ background: '#1a7a4a', boxShadow: '0 0 0 1px rgba(26,122,74,.3)' }}></div>
            Nutrition
          </div>
        )}
      </div>

      {selectedKey && !multiSelectMode && (
        <div className="log-panel" style={{ display: 'block' }}>
          <div className="log-panel-header">{selectedDay} {shortMonths[calMonth]} {calYear}</div>
          <div id="logEntriesForm">
            {!trackers.length && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-muted)' }}>Add trackers first.</div>
            )}
            {trackers.map(t => {
              const dayLogs = logs[selectedKey] || {};
              return (
                <div key={t.id} className="log-entry-row">
                  <label className="log-entry-label">
                    <div className="log-dot" style={{ background: t.color }}></div>
                    {t.name}
                  </label>
                  {t.type === 'boolean'
                    ? <input type="checkbox" className="log-checkbox" id={`log-${t.id}`} defaultChecked={dayLogs[t.id] === true} />
                    : <input type="number" className="log-number-input" id={`log-${t.id}`} defaultValue={dayLogs[t.id] !== undefined ? dayLogs[t.id] : ''} placeholder={t.unit || '0'} />
                  }
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="log-save-btn" onClick={saveLog}>Save</button>
            <button
              onClick={clearDay}
              style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--mono)' }}
              title="Remove all markers for this day"
            >🗑 Clear Day</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TrackSection({ S, update, active, onOpenModal, onShowCoinToast, userId }) {
  const [nutritionMonthData, setNutritionMonthData] = useState({});

  return (
    <section id="track" className={`section${active ? ' active' : ''}`}>
      <motion.div
        style={{ marginBottom: '20px' }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="eyebrow">Daily Habits</div>
        <div className="sec-title">Track <SectionHelp text="Log daily habits and numbers against weekly targets. Click any day on the calendar to log, or multi-select to batch-log multiple days at once." /></div>
      </motion.div>
      {/* Desktop: trackers strip on top, then a 3-column dashboard
          (Calendar · Vitals & Macros · Daily Macros). Collapses to a
          single stacked column on narrow/mobile via CSS. */}
      <div className="track-dash">
        <TrackersList
          trackers={S.trackers}
          logs={S.logs}
          streaks={S.streaks || {}}
          onDelete={id => update(prev => ({ ...prev, trackers: prev.trackers.filter(t => t.id !== id) }))}
          onOpenModal={onOpenModal}
          update={update}
        />
        <div className="track-cols">
          <div className="track-col">
            <CalendarView S={S} update={update} onShowCoinToast={onShowCoinToast} nutritionMonthData={nutritionMonthData} />
          </div>
          <div className="track-col">
            {/* Vitals + macro-% history chart. */}
            <VitalsHistoryCard S={S} update={update} />
          </div>
          <div className="track-col">
            {userId
              ? <NutritionSection
                  userId={userId}
                  S={S}
                  update={update}
                  selectedDate={S.selectedLogDate || null}
                  calYear={S.calYear}
                  calMonth={S.calMonth}
                  onShowCoinToast={onShowCoinToast}
                  onMonthDataReady={setNutritionMonthData}
                  onOpenModal={onOpenModal}
                />
              : <div className="card" style={{ padding: '22px' }}><div className="settings-empty">Sign in to log nutrition.</div></div>}
          </div>
        </div>
      </div>
    </section>
  );
}
