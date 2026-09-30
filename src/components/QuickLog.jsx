import { useState, useRef } from 'react';
import Icon from './Icon';
import { motion, AnimatePresence } from 'framer-motion';
import { getTodayStr, getWeekKey, countWeekLogs, trackerWeeklyCoins } from '../utils/helpers';
import { recalcStreaks } from '../utils/streaks';
import { fireGoal, fireStreak7, fireStreak30 } from '../utils/confetti';
import { haptic } from '../hooks/useCapacitor';
import { markManual, sourceById } from '../lib/trackers/autoLog';
import { trackerDone, trackerProgress, trackerStep, dailyGoalOf, targetFromName, fmtTrackerValue } from '../lib/trackers/done';

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
        ><span style={{display:'inline-flex',alignItems:'center',gap:4}}><Icon name="check" size={11} /> saved</span></motion.span>
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
function TrackerCard({ tracker, value, streak, onChange, onSetTarget }) {
  const [savedVisible, setSavedVisible] = useState(false);
  const savedTimer = useRef(null);
  const [editing, setEditing] = useState(false);

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

  // Held +/− repeats from a timer that keeps the callback it started
  // with, so stepping from `value` repeated one stale number. The ref
  // carries the latest value between repeats instead.
  const live = useRef(value);
  live.current = value;
  const step = trackerStep(tracker, sourceById(tracker.auto?.source)?.step);
  function handleStep(dir) {
    const cur = typeof live.current === 'number' ? live.current : 0;
    // Snap to the step grid so 6,120 + 500 lands on 6,500, not 6,620.
    const next = Math.max(0, dir > 0 ? Math.floor(cur / step + 1e-9) * step + step : Math.ceil(cur / step - 1e-9) * step - step);
    const rounded = Math.round(next * 100) / 100;
    live.current = rounded;
    haptic('LIGHT');
    onChange(tracker.id, rounded);
    flashSaved();
  }

  const incProps = useLongPress(() => handleStep(1));
  const decProps = useLongPress(() => handleStep(-1));

  const trackerColor = tracker.color || 'var(--em)';
  if (tracker.type === 'boolean') {
    const checked = value === true;
    return (
      <button
        type="button"
        className={`quick-log-row${checked ? ' is-done' : ''}`}
        onClick={handleBoolToggle}
      >
        <CheckMark done={checked} colour={trackerColor} />
        <span className="quick-log-row-name">{tracker.name}</span>
        <FlameBadge streak={streak} />
        <span className={`quick-log-row-pill${checked ? ' is-done' : ''}`}>
          {checked ? <span style={{display:'inline-flex',alignItems:'center',gap:4}}><Icon name="check" size={11} /> Done</span> : '–'}
        </span>
        <SavedBadge visible={savedVisible} />
      </button>
    );
  }

  // Number trackers are a row, not a button: the editor below holds
  // inputs, and an input inside a <button> can't be typed in (Firefox).
  const numVal = typeof value === 'number' ? value : 0;
  const goal = dailyGoalOf(tracker);
  const done = trackerDone(tracker, numVal);
  const pct = trackerProgress(tracker, numVal);
  const unit = tracker.unit ? ` ${tracker.unit}` : '';
  // Under a target the unit only fits when it's short ("/180 g");
  // "/10k steps" squeezed the name to one letter in the hub rail.
  const shortUnit = tracker.unit && tracker.unit.length <= 3 ? unit : '';
  return (
    <div
      className={`quick-log-row is-num${done ? ' is-done' : ''}${editing ? ' is-editing' : ''}`}
      title={goal ? `${fmtTrackerValue(numVal)} of ${fmtTrackerValue(goal)}${unit} today` : undefined}
    >
      <CheckMark done={done} pct={pct} colour={trackerColor} />
      <span className="quick-log-row-name">{tracker.name}</span>
      <FlameBadge streak={streak} />
      <span className="quick-log-row-stepper">
        <button type="button" className="step-btn" {...decProps} aria-label={`Decrease by ${fmtTrackerValue(step)}`}><Icon name="minus" size={14} /></button>
        <button
          type="button"
          className={`step-val${goal ? '' : ' no-target'}`}
          onClick={() => setEditing(e => !e)}
          aria-expanded={editing}
          aria-label={`${tracker.name}: ${fmtTrackerValue(numVal)}${goal ? ` of ${fmtTrackerValue(goal)}` : ''}${unit} — type an amount or set a daily target`}
        >
          <span className="step-num">{fmtTrackerValue(numVal, true)}</span>
          <span className="step-unit">{goal ? `of ${fmtTrackerValue(goal, true)}${shortUnit}` : '+ target'}</span>
        </button>
        <button type="button" className="step-btn" {...incProps} aria-label={`Increase by ${fmtTrackerValue(step)}`}><Icon name="plus" size={14} /></button>
      </span>
      <span className="quick-log-row-saved"><SavedBadge visible={savedVisible && !editing} /></span>
      {editing && (
        <NumberEditor
          tracker={tracker}
          value={numVal}
          onCancel={() => setEditing(false)}
          onSave={(v, g) => {
            // Target first: the value's weekly coin check then counts
            // the day against the new rule, not the old one.
            if (g !== goal) onSetTarget(tracker.id, g);
            if (v !== numVal) onChange(tracker.id, v);
            setEditing(false);
            flashSaved();
          }}
        />
      )}
    </div>
  );
}

// The circle on the left: a tick when done; for a number tracker with
// a daily target, a ring filling towards it until then.
function CheckMark({ done, pct = 0, colour }) {
  const R = 9, C = 2 * Math.PI * R;
  return (
    <span
      className="quick-log-row-check"
      style={done ? { background: colour, borderColor: colour } : undefined}
      aria-hidden="true"
    >
      {done ? (
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : pct > 0 && (
        <svg className="quick-log-row-ring" viewBox="0 0 22 22">
          <circle cx="11" cy="11" r={R} fill="none" stroke={colour} strokeWidth="2"
            strokeDasharray={`${(pct * C).toFixed(1)} ${C.toFixed(1)}`}
            strokeLinecap="round" transform="rotate(-90 11 11)" />
        </svg>
      )}
    </span>
  );
}

// Type today's amount and the daily target. The target is what makes a
// short day a missed one; the tracker's name offers a starting guess
// ("10k steps" → 10,000) but nothing is set until Save.
function NumberEditor({ tracker, value, onSave, onCancel }) {
  const goal = dailyGoalOf(tracker);
  const guess = goal == null ? targetFromName(tracker.name) : null;
  const [v, setV] = useState(value ? String(value) : '');
  const [g, setG] = useState(goal != null ? String(goal) : guess != null ? String(guess) : '');
  const num = s => {
    const n = parseFloat(String(s).replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  };
  function submit(e) {
    e.preventDefault();
    onSave(num(v), num(g) || null);
  }
  const unit = tracker.unit || '';
  return (
    <form className="quick-log-edit" onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}>
      <label className="quick-log-edit-field">
        <span>Today{unit ? ` · ${unit}` : ''}</span>
        <span className="quick-log-edit-input">
          <input type="text" inputMode="decimal" autoFocus value={v} placeholder="0"
            onChange={e => setV(e.target.value)} onFocus={e => e.target.select()} />
        </span>
      </label>
      <label className="quick-log-edit-field">
        <span>Daily target</span>
        <span className="quick-log-edit-input">
          <input type="text" inputMode="decimal" value={g} placeholder="none"
            onChange={e => setG(e.target.value)} />
        </span>
      </label>
      <p className="quick-log-edit-note">
        {num(g)
          ? `Ticks at ${fmtTrackerValue(num(g))}${unit ? ` ${unit}` : ''}; less is a missed day.`
          : 'No target: any amount ticks the day.'}
        {guess != null && goal == null && num(g) === guess ? ' Suggested from the name.' : ''}
      </p>
      <div className="quick-log-edit-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm">Save</button>
      </div>
    </form>
  );
}

// ── Streak broken banner ──────────────────────────────────────────────────
function StreakBrokenBanner({ broken, onDismiss }) {
  if (!broken.length) return null;
  return (
    <div className="streak-broken-banner">
      {broken.map(b => (
        <div key={b.trackerId} className="streak-broken-row">
          <span style={{display:'inline-flex',alignItems:'center',gap:6}}><Icon name="triangle-alert" size={13} /> <span>Your <strong>{b.trackerName}</strong> streak ended at {b.oldStreak} days. Start a new one today.</span></span>
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

      // 1b. The cell is the user's now — no rule refills it, and the
      // Track page stops crediting a device for a tick they made.
      next = markManual(next, today, [trackerId]);

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
        // Capped at read time (trackerWeeklyCoins) — a value stored before
        // the 50-coin cap, or edited into state, can't pay more.
        const reward = trackerWeeklyCoins(t);
        if (!t.weeklyTarget || !reward) return;
        const weekKey = getWeekKey(today);
        const awardKey = 'awarded_' + t.id + '_' + weekKey;
        const count = countWeekLogs(newLogs, t.id, today, t);
        const alreadyAwarded = !!next[awardKey];

        if (count >= t.weeklyTarget && !alreadyAwarded) {
          const coins = (next.coins || 0) + reward;
          const coinHistory = [
            { type: 'earn', label: t.name + ' weekly goal (' + t.weeklyTarget + 'x)', amount: reward, ts: Date.now() },
            ...(next.coinHistory || []),
          ];
          onShowCoinToast('+' + reward + ' ⬡ — ' + t.name + ' weekly goal!', true);
          fireGoal();
          next = { ...next, [awardKey]: true, coins, coinHistory };
        } else if (count < t.weeklyTarget && alreadyAwarded) {
          const coins = Math.max(0, (next.coins || 0) - reward);
          const coinHistory = [
            { type: 'refund', label: t.name + ' weekly goal reversed', amount: -reward, ts: Date.now() },
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

  // A daily target is a new key on the tracker; nothing else on it moves.
  function setTarget(trackerId, dailyGoal) {
    update(prev => ({
      ...prev,
      trackers: (prev.trackers || []).map(t => (t.id === trackerId ? { ...t, dailyGoal: dailyGoal || null } : t)),
    }));
  }

  const trackers = S.trackers || [];

  return (
    <div className="quick-log-section">
      {/* The date used to sit here. It is already the headline of the
          Today module directly above, and two of the same date on one
          screen is one of them being noise. The eyebrow goes with it —
          without a date under it, "TODAY" labelled nothing. */}

      <StreakBrokenBanner broken={brokenStreaks} onDismiss={dismissBroken} />

      {trackers.length === 0 ? (
        <div className="quick-log-empty">
          <span>No trackers set up — add one in the Track section</span>
          <motion.button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: '10px' }}
            onClick={onNavigateTrack}
            whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
          ><span style={{display:'inline-flex',alignItems:'center',gap:5}}>Go to Track <Icon name="arrow-right" size={13} /></span></motion.button>
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
              onSetTarget={setTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}
