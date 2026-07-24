import { useState, useRef } from 'react';
import Icon from './Icon';
import { motion, AnimatePresence } from 'framer-motion';
import { getTodayStr, getWeekKey, countWeekLogs } from '../utils/helpers';
import { recalcStreaks } from '../utils/streaks';
import { fireGoal, fireStreak7, fireStreak30 } from '../utils/confetti';
import { haptic } from '../hooks/useCapacitor';

// ── Long-press hook for number steppers ──────────────────────────────────
function useLongPress(callback, delay = 120) {
  const timer = useRef(null);
  const interval = useRef(null);
  function start() {
    callback();
    timer.current = setTimeout(() => {
      interval.current = setInterval(callback, delay);
    }, 500);
  }
  function stop() {
    clearTimeout(timer.current);
    clearInterval(interval.current);
  }
  return {
    onMouseDown: start, onMouseUp: stop, onMouseLeave: stop,
    onTouchStart: e => { e.preventDefault(); start(); },
    onTouchEnd: stop,
  };
}

// ── Auto-save indicator ───────────────────────────────────────────────────
function SavedBadge({ visible }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.span
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--em)',
            letterSpacing: '.5px', marginLeft: '6px',
          }}
        >✓ saved</motion.span>
      )}
    </AnimatePresence>
  );
}

// ── Flame badge ───────────────────────────────────────────────────────────
function FlameBadge({ streak }) {
  if (!streak || streak < 2) return null;
  const bright = streak >= 7;
  const pulse = streak >= 30;
  return (
    <span
      className={`streak-flame-badge${bright ? ' bright' : ''}${pulse ? ' pulse' : ''}`}
      title={`${streak} day streak`}
    >
      🔥 {streak}
    </span>
  );
}

// ── Single tracker row ────────────────────────────────────────────────────
//
// Style note (2026-05-03): Switched from a stacked card with a circular
// ✓/✗ toggle to a clean horizontal row matching the mobile hub. The
// old "✗ in a circle" for unchecked state read as broken / redundant —
// the row treatment is calmer and the inactive state is just the empty
// circle, no glyph. Number trackers keep their stepper but stripped of
// the card chrome.
function TrackerCard({ tracker, value, streak, onChange }) {
  const [savedVisible, setSavedVisible] = useState(false);
  const savedTimer = useRef(null);

  function flashSaved() {
    setSavedVisible(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedVisible(false), 1400);
  }

  function handleBoolToggle() {
    haptic('MEDIUM');
    onChange(tracker.id, !value);
    flashSaved();
  }

  function handleStep(delta) {
    const next = Math.max(0, (typeof value === 'number' ? value : 0) + delta);
    haptic('LIGHT');
    onChange(tracker.id, next);
    flashSaved();
  }

  const incProps = useLongPress(() => handleStep(1));
  const decProps = useLongPress(() => handleStep(-1));

  const isBool = tracker.type === 'boolean';
  const checked = isBool && value === true;
  const numVal = isBool ? null : (typeof value === 'number' ? value : 0);
  const numActive = !isBool && numVal > 0;
  const trackerColor = tracker.color || 'var(--em)';

  return (
    <button
      type="button"
      className={`quick-log-row${(checked || numActive) ? ' is-done' : ''}`}
      onClick={isBool ? handleBoolToggle : undefined}
      // Number trackers: row click is a no-op so the user can use the
      // explicit -/+ buttons. Cleaner than guessing intent.
    >
      <span
        className="quick-log-row-check"
        style={(checked || numActive) ? { background: trackerColor, borderColor: trackerColor } : undefined}
        aria-hidden="true"
      >
        {(checked || numActive) && (
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="quick-log-row-name">{tracker.name}</span>
      <FlameBadge streak={streak} />
      {isBool ? (
        <span className={`quick-log-row-pill${checked ? ' is-done' : ''}`}>
          {checked ? <>&#10003; Done</> : '–'}
        </span>
      ) : (
        <span
          className="quick-log-row-stepper"
          // Stop the parent button click from firing when stepping
          onClick={e => e.stopPropagation()}
        >
          <button type="button" className="step-btn" {...decProps} aria-label="Decrease"><Icon name="minus" size={14} /></button>
          <span className="step-val">
            <span className="step-num">{numVal}</span>
            {tracker.unit && <span className="step-unit">{tracker.unit}</span>}
          </span>
          <button type="button" className="step-btn" {...incProps} aria-label="Increase"><Icon name="plus" size={14} /></button>
        </span>
      )}
      <SavedBadge visible={savedVisible} />
    </button>
  );
}

// ── Streak broken banner ──────────────────────────────────────────────────
function StreakBrokenBanner({ broken, onDismiss }) {
  if (!broken.length) return null;
  return (
    <div className="streak-broken-banner">
      {broken.map(b => (
        <div key={b.trackerId} className="streak-broken-row">
          <span>⚠ Your <strong>{b.trackerName}</strong> streak ended at {b.oldStreak} days. Start a new one today.</span>
          <button onClick={() => onDismiss(b.trackerId)} className="streak-broken-dismiss" aria-label="Dismiss"><Icon name="x" size={13} /></button>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function QuickLog({ S, update, onNavigateTrack, onShowCoinToast }) {
  const today = getTodayStr();
  const todayLogs = S.logs?.[today] || {};
  const [dismissed, setDismissed] = useState(() => {
    try {
      const raw = localStorage.getItem('vb4_streak_dismissed');
      const parsed = JSON.parse(raw || '{}');
      // Reset if stored date is not today
      if (parsed._date !== today) return {};
      return parsed;
    } catch { return {}; }
  });

  const streaks = S.streaks || {};

  // Check for broken streaks (streak > 2, last_logged_date !== today or yesterday)
  const yesterday = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })();

  const brokenStreaks = (S.trackers || [])
    .filter(t => t.type === 'boolean')
    .map(t => {
      const s = streaks[t.id];
      if (!s) return null;
      const { current, lastDate } = s;
      if (!current || current < 3) return null;
      if (lastDate === today || lastDate === yesterday) return null;
      const daysSinceLast = lastDate
        ? Math.floor((new Date(today) - new Date(lastDate)) / 86400000)
        : 999;
      if (daysSinceLast > 2) return null; // Too old — don't show
      if (dismissed[t.id]) return null;
      return { trackerId: t.id, trackerName: t.name, oldStreak: current };
    })
    .filter(Boolean);

  function dismissBroken(trackerId) {
    const next = { ...dismissed, [trackerId]: true, _date: today };
    setDismissed(next);
    localStorage.setItem('vb4_streak_dismissed', JSON.stringify(next));
  }

  function handleChange(trackerId, newVal) {
    const tracker = (S.trackers || []).find(t => t.id === trackerId);
    if (!tracker) return;

    update(prev => {
      // 1. Update log entry
      const newLogs = { ...prev.logs };
      const dayLog = { ...(newLogs[today] || {}) };
      if (newVal === false || newVal === 0) delete dayLog[trackerId];
      else dayLog[trackerId] = newVal;
      if (Object.keys(dayLog).length) newLogs[today] = dayLog;
      else delete newLogs[today];

      let next = { ...prev, logs: newLogs };

      // 2. Recalculate streaks
      const newStreaks = recalcStreaks(newLogs, prev.trackers || [], prev.streaks || {});
      next = { ...next, streaks: newStreaks };

      // 3. Weekly coin challenge — symmetric award/refund.
      //
      // Anti-scam (2026-06): the award used to be one-way — once you hit
      // the weekly target you kept the coins even if you immediately
      // unticked. That let a user tick to claim, then untick to "not do
      // it" and keep the reward. Now crossing back below the target
      // reverses the award and re-opens the key, so any tick/untick pair
      // nets exactly zero. Coins are only ever held while the weekly goal
      // is genuinely met.
      (prev.trackers || []).forEach(t => {
        if (!t.weeklyTarget || !t.weeklyCoins) return;
        const weekKey = getWeekKey(today);
        const awardKey = 'awarded_' + t.id + '_' + weekKey;
        const count = countWeekLogs(newLogs, t.id, today);
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

      // 4. Streak milestone toasts/confetti
      if (tracker.type === 'boolean' && newVal === true) {
        const updatedStreak = newStreaks[trackerId]?.current;
        if (updatedStreak === 7) {
          fireStreak7();
          onShowCoinToast(`🔥 7 day streak on ${tracker.name}!`, true);
        } else if (updatedStreak === 30) {
          fireStreak30();
          onShowCoinToast(`🔥 30 day streak — incredible consistency!`, true);
        }
      }

      return next;
    });
  }

  const trackers = S.trackers || [];
  const dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="quick-log-section">
      <div className="quick-log-header">
        <div>
          <div className="eyebrow" style={{ marginBottom: '2px' }}>TODAY</div>
          <div className="quick-log-date">{dateLabel}</div>
        </div>
      </div>

      <StreakBrokenBanner broken={brokenStreaks} onDismiss={dismissBroken} />

      {trackers.length === 0 ? (
        <div className="quick-log-empty">
          <span>No trackers set up — add one in the Track section</span>
          <motion.button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: '10px' }}
            onClick={onNavigateTrack}
            whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
          >Go to Track →</motion.button>
        </div>
      ) : (
        <div className="quick-log-rows">
          {trackers.map(t => (
            <TrackerCard
              key={t.id}
              tracker={t}
              value={todayLogs[t.id] !== undefined ? todayLogs[t.id] : (t.type === 'boolean' ? false : 0)}
              streak={streaks[t.id]?.current || 0}
              onChange={handleChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
