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

function TrackersList({ trackers, logs, streaks, onDelete, onOpenModal }) {
  return (
    <div className="card trackers-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
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
          let challengeHtml = null;
          if (t.weeklyTarget && t.weeklyCoins) {
            const { count, target } = getWeekProgress(logs, t.id, t.weeklyTarget);
            const done = count >= target;
            const pct = Math.min(100, Math.round((count / target) * 100));
            challengeHtml = (
              <div style={{ marginTop: '6px', padding: '6px 8px', background: done ? 'rgba(200,151,10,.12)' : 'rgba(255,255,255,.5)', border: `1px solid ${done ? 'rgba(200,151,10,.3)' : 'var(--border-lt)'}`, borderRadius: '7px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: done ? 'var(--gold)' : 'var(--text-muted)', letterSpacing: '.5px', textTransform: 'uppercase' }}>{done ? '✓ ' : ''}{count}/{target}x this week</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', fontWeight: 700, color: 'var(--gold)' }}>⬡ {t.weeklyCoins}</span>
                </div>
                <div style={{ height: '4px', background: 'rgba(0,0,0,.08)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: done ? 'var(--gold)' : t.color, borderRadius: '2px', transition: 'width .3s' }}></div>
                </div>
              </div>
            );
          }
          return (
            <motion.div
              key={t.id}
              className="tracker-item"
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: index * 0.06, ease: 'easeOut' }}
            >
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="tracker-left">
                    <div className="tracker-dot" style={{ background: t.color }}></div>
                    <div>
                      <div className="tracker-name">{t.name}</div>
                      <div className="tracker-type">{t.type === 'boolean' ? '✓ / ✗' : 'Number' + (t.unit ? ' · ' + t.unit : '')}</div>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(t.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', borderRadius: '4px', padding: '2px 5px' }}
                  >✕</button>
                </div>
                {challengeHtml}
                {t.type === 'boolean' && (() => {
                  const s = streaks?.[t.id];
                  if (!s || !s.current) return null;
                  return (
                    <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--gold)', fontWeight: 700 }}>
                        🔥 {s.current} day streak
                      </span>
                      {s.best > s.current && (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--text-muted)' }}>
                          Best: {s.best}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
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
      <div className="track-layout">
        <TrackersList
          trackers={S.trackers}
          logs={S.logs}
          streaks={S.streaks || {}}
          onDelete={id => update(prev => ({ ...prev, trackers: prev.trackers.filter(t => t.id !== id) }))}
          onOpenModal={onOpenModal}
        />
        <CalendarView S={S} update={update} onShowCoinToast={onShowCoinToast} nutritionMonthData={nutritionMonthData} />
      </div>
      {/* Vitals history — line chart + recent entries for the daily
          vitals logged via the mobile hub widget. */}
      <VitalsHistoryCard S={S} />
      {userId && (
        <NutritionSection
          userId={userId}
          selectedDate={S.selectedLogDate || null}
          calYear={S.calYear}
          calMonth={S.calMonth}
          onShowCoinToast={onShowCoinToast}
          onMonthDataReady={setNutritionMonthData}
          onOpenModal={onOpenModal}
        />
      )}
    </section>
  );
}
