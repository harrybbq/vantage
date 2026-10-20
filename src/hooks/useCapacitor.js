/**
 * useCapacitor
 *
 * Initialises all Capacitor native plugins when running inside a native
 * Android / iOS shell. Safe to call in a web browser — every import is
 * guarded by Capacitor.isNativePlatform() so no-ops on the web.
 *
 * Push permission policy:
 *   The OS push permission prompt is NOT triggered automatically here.
 *   We only attach push listeners (and register(), which mints the FCM
 *   token) if the user opted in on this device AND permission is still
 *   'granted' — see hasPushOptIn below.
 *   The first-time prompt is gated behind our own pre-prompt modal so
 *   the user understands what they're opting into BEFORE the iOS
 *   one-shot dialog fires (denied permission can't be re-asked
 *   programmatically — that conversion is locked in forever).
 *
 *   Use `requestPushPermission()` (exported below) from a button or
 *   pre-prompt to actually trigger the OS dialog when the moment is
 *   right (e.g. after first vision unlock, after first habit log).
 */
import { useEffect, useRef } from 'react';

// ── The user's own opt-in, per device ───────────────────────────────────
// OS permission alone is not consent: Android 12 and below grant
// notifications at install, so "permission is granted" would register
// the device and mint an FCM token on first launch for someone who never
// asked for push. The token (and the Firebase installation id behind it)
// is created only once the user has said yes in our pre-prompt —
// requestPushPermission() records that here. The manifest keeps
// Firebase's own auto-init off for the same reason (item 102).
// Device-local on purpose: it describes this device's registration and
// is not account data (nothing in S is read or written).
const PUSH_OPT_IN_KEY = 'vb4_push_opted_in';
export function hasPushOptIn() {
  try { return localStorage.getItem(PUSH_OPT_IN_KEY) === '1'; } catch { return false; }
}
function recordPushOptIn() {
  try { localStorage.setItem(PUSH_OPT_IN_KEY, '1'); } catch { /* private storage: asks again next launch */ }
}

// Lazy-load Capacitor so Vite can still bundle a pure-web build if needed.
let capCore = null;
async function getCap() {
  if (!capCore) capCore = await import('@capacitor/core');
  return capCore;
}

/**
 * Internal helper: register listeners + register() the device.
 * Idempotent — safe to call even if already registered, the plugin
 * dedupes the underlying APNs/FCM registration.
 */
async function attachPushListeners({ onPushToken, onPushMessage, listenersRef, cancelledRef }) {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  await PushNotifications.register();

  const t1 = await PushNotifications.addListener('registration', token => {
    onPushToken?.(token.value);
  });
  const t2 = await PushNotifications.addListener('registrationError', err => {
    console.error('Push registration error:', err.error);
  });
  const t3 = await PushNotifications.addListener('pushNotificationReceived', notification => {
    onPushMessage?.({ ...notification, foreground: true });
  });
  const t4 = await PushNotifications.addListener('pushNotificationActionPerformed', action => {
    onPushMessage?.({ ...action.notification, tapped: true });
  });

  if (!cancelledRef.current) {
    listenersRef.current.push(t1, t2, t3, t4);
  }
}

export function useCapacitor({ onPushToken, onPushMessage } = {}) {
  const listenersRef = useRef([]);
  const cancelledRef = useRef(false);
  // Stash the latest callbacks in refs so requestPushPermission() can
  // re-attach listeners without depending on stale closures.
  const callbacksRef = useRef({ onPushToken, onPushMessage });
  callbacksRef.current.onPushToken = onPushToken;
  callbacksRef.current.onPushMessage = onPushMessage;

  useEffect(() => {
    cancelledRef.current = false;

    async function init() {
      const { Capacitor } = await getCap();
      if (!Capacitor.isNativePlatform()) return;

      // ── Status Bar ───────────────────────────────────────────────────────
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setOverlaysWebView({ overlay: true });
      } catch (e) {
        console.warn('StatusBar:', e.message);
      }

      // ── Splash Screen ────────────────────────────────────────────────────
      try {
        const { SplashScreen } = await import('@capacitor/splash-screen');
        // Give React 400 ms to paint, then hide
        setTimeout(() => SplashScreen.hide({ fadeOutDuration: 300 }), 400);
      } catch (e) {
        console.warn('SplashScreen:', e.message);
      }

      // ── Push Notifications (passive — only if the user opted in) ────────
      // Do NOT call requestPermissions() here. That's gated behind our own
      // pre-prompt UI to protect first-time conversion. We only wire
      // listeners + register() when the user opted in on this device AND
      // the OS permission is still granted. register() is what mints the
      // FCM token, so it must never run for someone who didn't ask.
      try {
        const optedIn = hasPushOptIn();
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const { receive } = optedIn ? await PushNotifications.checkPermissions() : { receive: 'not-opted-in' };
        if (optedIn && receive === 'granted') {
          await attachPushListeners({
            onPushToken: v => callbacksRef.current.onPushToken?.(v),
            onPushMessage: v => callbacksRef.current.onPushMessage?.(v),
            listenersRef,
            cancelledRef,
          });
        }
      } catch (e) {
        console.warn('PushNotifications:', e.message);
      }

      // ── Android Back Button ──────────────────────────────────────────────
      try {
        const { App } = await import('@capacitor/app');

        const t5 = await App.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack) {
            window.history.back();
          } else {
            // Double-tap back to exit
            if (window._backPressedOnce) {
              App.exitApp();
            } else {
              window._backPressedOnce = true;
              setTimeout(() => { window._backPressedOnce = false; }, 2000);
            }
          }
        });

        if (!cancelledRef.current) listenersRef.current.push(t5);
      } catch (e) {
        console.warn('App (backButton):', e.message);
      }
    }

    init();

    return () => {
      cancelledRef.current = true;
      listenersRef.current.forEach(l => l.remove());
      listenersRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Trigger the OS push permission dialog and, if granted, register +
 * attach listeners using the most recently mounted callbacks.
 *
 * Returns one of:
 *   'unsupported' — not on a native platform
 *   'granted'     — user said yes, listeners attached
 *   'denied'      — user said no (cannot be re-asked on iOS)
 *   'error'       — plugin/registration failure
 *
 * The caller (NotificationsPanel button or auto pre-prompt flow) should
 * call this AFTER showing a value-prop explanation. Once the iOS prompt
 * has shown and been denied, there is no second chance via this API.
 */
export async function requestPushPermission({ onPushToken, onPushMessage } = {}) {
  try {
    const { Capacitor } = await getCap();
    if (!Capacitor.isNativePlatform()) return 'unsupported';

    const { PushNotifications } = await import('@capacitor/push-notifications');
    const current = await PushNotifications.checkPermissions();
    let receive = current.receive;

    if (receive === 'prompt' || receive === 'prompt-with-rationale') {
      const res = await PushNotifications.requestPermissions();
      receive = res.receive;
    }

    if (receive !== 'granted') return 'denied';

    // The user tapped Enable in our pre-prompt and the OS agreed: from
    // here on this device may register at launch (see hasPushOptIn).
    recordPushOptIn();
    await PushNotifications.register();
    if (onPushToken) {
      await PushNotifications.addListener('registration', token => onPushToken(token.value));
    }
    if (onPushMessage) {
      await PushNotifications.addListener('pushNotificationReceived', n => onPushMessage({ ...n, foreground: true }));
      await PushNotifications.addListener('pushNotificationActionPerformed', a => onPushMessage({ ...a.notification, tapped: true }));
    }
    return 'granted';
  } catch (e) {
    console.warn('requestPushPermission:', e.message);
    return 'error';
  }
}

/**
 * Probe current OS push permission state without prompting. Useful for
 * the NotificationsPanel status row ("● Enabled on this device").
 *
 * Returns: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'unsupported' | 'error'
 */
export async function getPushPermissionState() {
  try {
    const { Capacitor } = await getCap();
    if (!Capacitor.isNativePlatform()) return 'unsupported';
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { receive } = await PushNotifications.checkPermissions();
    // Granted by the OS but never opted in (Android 12 and below grant at
    // install): report it as not enabled, so the panel offers Enable and
    // the opt-in — not the install — is what turns push on.
    if (receive === 'granted' && !hasPushOptIn()) return 'prompt';
    return receive;
  } catch {
    return 'error';
  }
}

/**
 * Capacitor-aware haptic feedback.
 * Falls back to navigator.vibrate() on web/Android Chrome.
 */
export async function haptic(style = 'LIGHT') {
  try {
    const { Capacitor } = await getCap();
    if (Capacitor.isNativePlatform()) {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle[style] ?? ImpactStyle.Light });
      return;
    }
  } catch { /* fall through */ }
  // Web fallback
  const durations = { LIGHT: 4, MEDIUM: 8, HEAVY: 12 };
  navigator.vibrate?.(durations[style] ?? 4);
}
