/**
 * Pre-prompt for the OS push permission dialog.
 *
 * iOS only shows the system permission prompt ONCE. If the user taps
 * "Don't Allow" we lose the ability to ask programmatically forever —
 * they have to dig into Settings → Notifications → AppName to flip it.
 * That's a permanent conversion loss.
 *
 * So: we show our own value-prop modal first. The user opts in here,
 * THEN we trigger the OS prompt. If they opt out here, we don't fire
 * the OS prompt at all — they can re-open this from the Notifications
 * panel later when they're more convinced.
 *
 * Triggering policy:
 *   - Auto: shown once after the user's first vision unlock (a real
 *     celebratable moment — "want a ping when this happens again?").
 *   - Manual: "Enable on this device" button in the Notifications panel.
 *
 * Auto-trigger is gated on localStorage('vb4_push_pre_asked') so it
 * never fires twice. Manual button always works.
 */
import { useEffect, useState } from 'react';
import Icon from './Icon';
import { motion, AnimatePresence } from 'framer-motion';
import { requestPushPermission, getPushPermissionState } from '../hooks/useCapacitor';

const ASKED_KEY = 'vb4_push_pre_asked';

export function markPushPrePromptAsked() {
  try { localStorage.setItem(ASKED_KEY, '1'); } catch {}
}

export function hasAskedPushPrePrompt() {
  try { return localStorage.getItem(ASKED_KEY) === '1'; } catch { return false; }
}

export default function NotificationPermissionPrompt({
  open,
  onClose,
  onPushToken,
  onPushMessage,
  // Optional headline override — auto trigger after a vision unlock
  // can pass a contextual hook ("Saw your first vision unlock just now…")
  headline,
  body,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      // Mark asked the moment the user sees the modal — even if they
      // dismiss without choosing, we've used our shot at a soft prompt.
      markPushPrePromptAsked();
    }
  }, [open]);

  async function handleEnable() {
    setBusy(true);
    setError(null);
    const result = await requestPushPermission({ onPushToken, onPushMessage });
    setBusy(false);
    if (result === 'granted') {
      onClose?.('granted');
    } else if (result === 'unsupported') {
      setError("Push notifications need the iOS or Android build — they don't fire on the web.");
    } else if (result === 'denied') {
      setError("Permission was declined. You can re-enable it in your phone's Settings → Notifications.");
    } else {
      setError("Something went wrong. Try again from Settings → Notifications.");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => !busy && onClose?.('dismissed')}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '16px',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22 }}
            onClick={e => e.stopPropagation()}
            className="card"
            style={{
              maxWidth: '420px', width: '100%',
              padding: '24px',
              borderRadius: '14px',
              background: 'var(--card, #fff)',
            }}
          >
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center', color: 'var(--em)' }}><Icon name="bell" size={30} strokeWidth={1.6} /></div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>
              {headline || 'Want a ping when something good happens?'}
            </h3>
            <p style={{
              fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-muted)',
              lineHeight: '1.65', margin: '0 0 18px',
            }}>
              {body || (
                <>
                  We'll only ping you for things you opt into in Settings —
                  vision unlocks, friend requests, a streak that's about to
                  break. No marketing. No sign-up nudges.
                  <br /><br />
                  Quiet hours are honored. You can turn any of this off at any time.
                </>
              )}
            </p>

            {error && (
              <div style={{
                padding: '10px 12px', borderRadius: '8px',
                background: 'rgba(220, 60, 60, 0.08)',
                border: '1px solid rgba(220, 60, 60, 0.25)',
                color: 'var(--text)',
                fontFamily: 'var(--mono)', fontSize: '11px',
                lineHeight: '1.6',
                marginBottom: '14px',
              }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => onClose?.('dismissed')}
                disabled={busy}
                className="btn btn-ghost"
                style={{
                  padding: '9px 14px', borderRadius: '8px',
                  background: 'transparent', border: '1px solid var(--border)',
                  fontFamily: 'var(--mono)', fontSize: '11px',
                  letterSpacing: '1px', textTransform: 'uppercase',
                  cursor: busy ? 'wait' : 'pointer',
                  color: 'var(--text-muted)',
                }}
              >
                Not now
              </button>
              <button
                onClick={handleEnable}
                disabled={busy}
                className="btn btn-primary"
                style={{
                  padding: '9px 16px', borderRadius: '8px',
                  background: 'var(--em)', border: 'none',
                  color: 'var(--em-on, #fff)',
                  fontFamily: 'var(--mono)', fontSize: '11px',
                  letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 700,
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                {busy ? 'Asking…' : 'Enable'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Tiny status pill for the NotificationsPanel — shows whether the OS
 * has granted permission on this device, and exposes an "Enable" CTA
 * when it hasn't.
 */
export function PushPermissionStatusRow({ onAsk }) {
  const [state, setState] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    getPushPermissionState().then(s => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') return null;

  const isWeb = state === 'unsupported';
  const isOn = state === 'granted';
  const dotColor = isOn ? 'var(--em)' : 'var(--text-muted)';
  const label = isWeb
    ? 'Web only — push needs the iOS/Android build'
    : isOn
      ? 'Enabled on this device'
      : state === 'denied'
        ? 'Disabled — re-enable in your phone\'s Settings'
        : 'Not yet enabled on this device';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 12px', borderRadius: '8px',
      border: '1px solid var(--border)',
      background: 'var(--card, rgba(255,255,255,0.04))',
      marginBottom: '14px',
    }}>
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%',
        background: dotColor, flexShrink: 0,
      }} />
      <span style={{
        flex: 1,
        fontFamily: 'var(--mono)', fontSize: '11px',
        color: 'var(--text)', letterSpacing: '0.4px',
      }}>{label}</span>
      {!isWeb && !isOn && state !== 'denied' && (
        <button
          onClick={onAsk}
          style={{
            padding: '5px 10px', borderRadius: '6px',
            background: 'var(--em)', border: 'none',
            color: 'var(--em-on, #fff)',
            fontFamily: 'var(--mono)', fontSize: '10px',
            letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 700,
            cursor: 'pointer',
          }}
        >Enable</button>
      )}
    </div>
  );
}
