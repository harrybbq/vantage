/**
 * Notifications preferences card (Settings → Tools tab).
 *
 * Each category toggle gates whether a particular `kind` of push
 * fires. Values live in `S.notifications`; the push delivery
 * pipeline reads them server-side via the user_data row.
 *
 * Until APNs/FCM keys are uploaded and a server-side push
 * dispatcher exists, these toggles do nothing observable. That's
 * deliberate — shipping the prefs UI now means users can configure
 * before the first push ever fires, instead of being surprised by
 * a notification they didn't opt into.
 */

import { useState } from 'react';
import NotificationPermissionPrompt, { PushPermissionStatusRow } from './NotificationPermissionPrompt';
import SettingsGroup from './settings/SettingsGroup';

const CATEGORIES = [
  {
    id: 'visionUnlock',
    label: 'Vision unlocks',
    desc: 'When you cross a milestone (Week One, Century, etc).',
  },
  {
    id: 'friendRequest',
    label: 'Friend requests',
    desc: 'When someone asks to add you.',
  },
  {
    id: 'streakWarning',
    label: 'Streak at risk',
    desc: 'A nudge when your active streak hasn\'t logged today.',
  },
  {
    id: 'coachNudge',
    label: 'AI Coach nudges',
    desc: 'Pattern-based suggestions from your coach (Pro).',
  },
];

export default function NotificationsPanel({ S, update }) {
  const prefs = S.notifications || {};
  const [permPromptOpen, setPermPromptOpen] = useState(false);
  // Bump on close so the status row re-reads OS permission state
  const [permTick, setPermTick] = useState(0);

  function toggle(id) {
    update(prev => ({
      ...prev,
      notifications: {
        ...(prev.notifications || {}),
        [id]: !prev.notifications?.[id],
      },
    }));
  }

  function setQuietHours(field, value) {
    update(prev => ({
      ...prev,
      notifications: {
        ...(prev.notifications || {}),
        quietHours: {
          ...(prev.notifications?.quietHours || { start: '', end: '' }),
          [field]: value,
        },
      },
    }));
  }

  function setDailyReminder(value) {
    update(prev => ({
      ...prev,
      notifications: {
        ...(prev.notifications || {}),
        dailyReminderAt: value || null,
      },
    }));
  }

  const quiet = prefs.quietHours || { start: '', end: '' };

  return (
    <SettingsGroup
      title="Notifications"
      desc="Choose what we ping you about. Notifications only fire on the native app — web users see in-app toasts only. Quiet hours and the daily reminder require the iOS or Android build."
    >

      {/* Device permission status */}
      <PushPermissionStatusRow
        key={permTick}
        onAsk={() => setPermPromptOpen(true)}
      />

      <NotificationPermissionPrompt
        open={permPromptOpen}
        onClose={() => { setPermPromptOpen(false); setPermTick(t => t + 1); }}
      />

      {/* Category toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
        {CATEGORIES.map(cat => {
          const on = prefs[cat.id] !== false; // default ON if undefined
          return (
            <label
              key={cat.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '12px 14px', borderRadius: '10px',
                border: on ? '2px solid var(--em)' : '2px solid var(--border)',
                background: on ? 'rgba(var(--em-rgb),0.08)' : 'var(--card, rgba(255,255,255,0.04))',
                cursor: 'pointer', transition: 'all .18s',
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(cat.id)}
                style={{ width: '18px', height: '18px', accentColor: 'var(--em)', cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                  {cat.label}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px', marginTop: '2px' }}>
                  {cat.desc}
                </div>
              </div>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '1.4px',
                textTransform: 'uppercase', color: on ? 'var(--em)' : 'var(--text-muted)',
              }}>
                {on ? 'On' : 'Off'}
              </span>
            </label>
          );
        })}
      </div>

      {/* Quiet hours */}
      <div style={{
        padding: '14px', borderRadius: '10px',
        border: '1px solid var(--border)',
        background: 'var(--card, rgba(255,255,255,0.04))',
        marginBottom: '12px',
      }}>
        <div style={{ fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
          Quiet hours
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
          No notifications fire in this window. Leave both blank to disable.
        </div>
        {/* A `time` input sizes itself to its widest rendering (~137px in
            Chrome), so two of them plus the "to" ran ~20px past the edge
            of a 390px phone. They shrink and wrap now. */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="time"
            value={quiet.start}
            onChange={e => setQuietHours('start', e.target.value)}
            aria-label="Quiet hours start"
            style={{
              background: 'var(--bg-base, rgba(255,255,255,0.6))',
              border: '1px solid var(--border)',
              borderRadius: '7px',
              padding: '7px 10px',
              fontFamily: 'var(--mono)', fontSize: '12px',
              color: 'var(--text)',
              colorScheme: 'inherit',
              flex: '1 1 110px', minWidth: 0, maxWidth: 150,
            }}
          />
          <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-muted)' }}>to</span>
          <input
            type="time"
            value={quiet.end}
            onChange={e => setQuietHours('end', e.target.value)}
            aria-label="Quiet hours end"
            style={{
              background: 'var(--bg-base, rgba(255,255,255,0.6))',
              border: '1px solid var(--border)',
              borderRadius: '7px',
              padding: '7px 10px',
              fontFamily: 'var(--mono)', fontSize: '12px',
              color: 'var(--text)',
              colorScheme: 'inherit',
              flex: '1 1 110px', minWidth: 0, maxWidth: 150,
            }}
          />
        </div>
      </div>

      {/* Daily reminder */}
      <div style={{
        padding: '14px', borderRadius: '10px',
        border: '1px solid var(--border)',
        background: 'var(--card, rgba(255,255,255,0.04))',
      }}>
        <div style={{ fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
          Daily log reminder
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>
          Optional ping at this time if you haven't logged today. Leave blank to disable.
        </div>
        <input
          type="time"
          value={prefs.dailyReminderAt || ''}
          onChange={e => setDailyReminder(e.target.value)}
          aria-label="Daily reminder time"
          style={{
            background: 'var(--bg-base, rgba(255,255,255,0.6))',
            border: '1px solid var(--border)',
            borderRadius: '7px',
            padding: '7px 10px',
            fontFamily: 'var(--mono)', fontSize: '12px',
            color: 'var(--text)',
            colorScheme: 'inherit',
          }}
        />
      </div>
    </SettingsGroup>
  );
}
