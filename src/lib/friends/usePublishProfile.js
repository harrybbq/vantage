import { useEffect, useRef } from 'react';
import { upsertOwnPublicStats, updateOwnProfile } from './queries';
import { habitElapsed } from '../habits/progress.js';
import { privacyOn } from './privacy.js';
import { publicNameProblem } from '../moderation/nameFilter.js';
import { photoHash, requestAvatarScreen } from './avatarScreen.js';

/**
 * Debounced sync of the user's public-facing data:
 *   - profiles.{display_name, level, last_active_at}
 *   - public_stats.{level, current_streak, streak_habit, heatmap_days,
 *                   recent_wins}
 *
 * Runs whenever S changes, debounced 4 s so a flurry of edits (e.g.
 * the user logs five trackers in a row) writes once at the end.
 *
 * Why duplicate `level` in profiles?
 *   profiles is read by strangers in handle search and by friends in
 *   the friend list. Surfacing level there avoids having to also
 *   read public_stats (which is friend-only) for every search hit.
 *
 * Why a hook?
 *   Same reason as useVisions — the alternative is wiring a sync
 *   into every callsite that touches state, which forgets at least
 *   once and leaves the friend card wrong.
 */

const DAY_MS = 86_400_000;
const AVATAR_TARGET_PX = 96; // square; friend list renders at 28-32px so 96 is sharp on retina
// After a screening call gives no verdict (offline, not deployed, over
// the daily cap), don't ask about the same photo again for a while —
// S changes constantly and each publish would otherwise re-ask.
const SCREEN_RETRY_MS = 10 * 60_000;

function ymd(d) { return d.toISOString().slice(0, 10); }

/**
 * Resize the user's photo (a data URL, typically large) to a small
 * JPEG suitable for storing in profiles.avatar_url. Targets ~6-12 KB
 * so a 10-friend rail doesn't pull megabytes per refresh.
 *
 * Returns a Promise<string|null>. Null if no photo or if the browser
 * can't render the source (e.g. malformed data URL).
 */
async function resizeAvatar(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = AVATAR_TARGET_PX;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // Centre-crop to a square then scale into the target.
        const srcMin = Math.min(img.width, img.height);
        const sx = (img.width  - srcMin) / 2;
        const sy = (img.height - srcMin) / 2;
        ctx.drawImage(img, sx, sy, srcMin, srcMin, 0, 0, size, size);
        // 0.72 quality keeps photos legible without bloating storage.
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Build the heatmap_days array friends will see — last 91 days,
 *  same shape as friendsMock so the renderer doesn't change. We
 *  lean on `S.logs` as the source of truth and assign intensity
 *  by the count of distinct trackers logged on each day. */
function buildHeatmap(S) {
  const logs = S.logs || {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 90; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const k = ymd(d);
    const day = logs[k] || {};
    const truthy = Object.values(day).filter(v => v && v !== 0).length;
    let intensity;
    if (truthy === 0)      intensity = 0;
    else if (truthy === 1) intensity = 1;
    else if (truthy <= 3)  intensity = 2;
    else                   intensity = 3;
    days.push({ ymd: k, intensity });
  }
  return days;
}

/** Currently-active habit streak: the habit with the most
 *  uninterrupted days clean. Returns { days, name } or null. */
function currentStreak(S) {
  const now = Date.now();
  let best = { days: 0, name: null };
  for (const h of S.habits || []) {
    if (!h.startTime) continue;
    const days = Math.floor(habitElapsed(h, now) / DAY_MS);
    if (days > best.days) best = { days, name: h.name };
  }
  return best.days > 0 ? best : null;
}

/** Up to 3 most recently completed user achievements. */
function recentWins(S) {
  return (S.achievements || [])
    .filter(a => a.completed && a.completedAt)
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, 3)
    .map(a => ({ icon: a.icon || '✨', name: a.name }));
}

// `hydrated` / `loadError` come from useVisionBoardState. Until the
// cloud copy has arrived, S is the local backup or the factory seed —
// publishing that would push a stale or empty card (name blank, level
// 1, no streak) over the real one for every friend to see.
export function usePublishProfile(userId, S, hasPro, visionState, { hydrated = false, loadError = null, update = null } = {}) {
  // Skip publish entirely if the user has no profile (paywall_schema
  // creates one on first login but we don't want to tightly couple).
  // The first successful run sets `triedRef.current = true` so we
  // don't keep retrying on every render after a failure (most
  // commonly: migrations not yet applied).
  const triedRef = useRef(false);
  const lastPayloadRef = useRef('');
  const timerRef = useRef(null);
  // `update` records screening verdicts in S.avatarScreen. Held in a ref
  // so a new function identity doesn't re-run the publish effect.
  const updateRef = useRef(update);
  updateRef.current = update;
  const screenRetryRef = useRef({ hash: null, until: 0 });

  useEffect(() => {
    if (!userId || !S) return;
    if (!hydrated || loadError) return;
    // The visions hook returns a fallback shape when state hasn't
    // loaded yet; skip until we have a real level.
    const level = visionState?.level || 1;

    // Privacy toggles — per-field opt-out on what friends see. When a
    // toggle is off we publish a zeroed-out value so the friend card
    // simply has nothing to render for that field. Server-side schema
    // is unchanged; toggling off CLEARS the previous value on the
    // next debounced publish.
    const priv = S.privacy || {};
    // Streak is opt-IN (see privacy.js) — it publishes the habit name.
    const streak = privacyOn(priv, 'shareStreak') ? currentStreak(S) : null;
    // A name the public-text filter refuses is published as no name
    // (Settings › Account says why). S.profile.name itself is untouched.
    const ownName = (S.profile?.name || '').trim();
    const payload = {
      // profiles slice
      // 40 chars: the profiles_display_name_len check (audit SQL).
      display_name: ownName && !publicNameProblem(ownName) ? ownName.slice(0, 40) : null,
      level,
      // last_active_at gates on sharePresence — see also the heartbeat
      // effect below which won't ping if presence is opted out.
      last_active_at: priv.sharePresence !== false ? new Date().toISOString() : null,
      // public_stats slice
      current_streak: streak?.days || 0,
      streak_habit:   streak?.name || null,
      heatmap_days:   priv.shareHeatmap !== false ? buildHeatmap(S) : [],
      recent_wins:    priv.shareWins    !== false ? recentWins(S)   : [],
    };

    // Avatar — gates on shareAvatar AND the user actually having a
    // photo set. The raw photo data URL is in S.profile.photo
    // (large; not yet resized). We resize ONLY when the source has
    // changed since the last publish. The signature is length + tail:
    // the first bytes of a data URL are the JPEG header, identical for
    // every photo from the same encoder, so a head slice never changed.
    const photoSrc = priv.shareAvatar !== false ? (S.profile?.photo || null) : null;
    const photoSig = photoSrc ? `${photoSrc.length}:${photoSrc.slice(-64)}` : '';
    const lastScreen = S.avatarScreen || null;

    // Skip the network round-trip if the meaningful slice hasn't
    // changed — only `last_active_at` would differ on a no-op tick.
    // We compare a stable JSON form excluding last_active_at.
    const sig = JSON.stringify({
      d: payload.display_name, l: payload.level,
      s: payload.current_streak, sh: payload.streak_habit,
      h: payload.heatmap_days.map(x => x.intensity).join(''),
      w: payload.recent_wins.map(x => x.name).join('|'),
      a: photoSig,
    });
    if (sig === lastPayloadRef.current && triedRef.current) return;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        // Resize avatar lazily inside the timer so the heavy canvas
        // work happens after the debounce settles, not on every
        // render. Null when shareAvatar is off, there's no photo, or
        // the photo hasn't passed screening.
        const resized = photoSrc ? await resizeAvatar(photoSrc) : null;
        const avatarUrl = resized ? await screenedAvatar(photoSrc, resized, lastScreen) : null;

        // Two rows in parallel — they're independent and the
        // friends rail tolerates either failing without the other.
        await Promise.all([
          updateOwnProfile(userId, {
            display_name: payload.display_name,
            level: payload.level,
            last_active_at: payload.last_active_at,
            avatar_url: avatarUrl,
          }),
          // Only publish stats if the user has a handle — without
          // one they're not visible to anyone, so there's nothing to
          // publish for. Saves writes for users who haven't claimed.
          // (Profile row update is still valuable for last_active_at.)
          // We'll re-publish when the handle is claimed via a
          // refresh trigger from HandleClaimModal.
          upsertOwnPublicStats(userId, {
            level: payload.level,
            current_streak: payload.current_streak,
            streak_habit: payload.streak_habit,
            heatmap_days: payload.heatmap_days,
            recent_wins: payload.recent_wins,
          }),
        ]);
        lastPayloadRef.current = sig;
        triedRef.current = true;
      } catch {
        // Most likely cause: migrations not applied yet, or the
        // user is offline. Silently absorb — the rail will surface
        // its own load error if anything is actually broken.
        triedRef.current = true;
      }
    }, 4000);

    return () => clearTimeout(timerRef.current);
  }, [userId, S, hasPro, visionState, hydrated, loadError]);

  /**
   * The avatar strangers will see, or null. Fails CLOSED: no verdict
   * (no key, offline, function not deployed) publishes no avatar, and
   * the photo stays on this device exactly as it was. Only definitive
   * verdicts are remembered, additively, in S.avatarScreen.
   */
  async function screenedAvatar(photoSrc, resized, lastScreen) {
    const hash = await photoHash(photoSrc);
    if (!hash) return null;
    if (lastScreen?.hash === hash) return lastScreen.ok ? resized : null;
    const retry = screenRetryRef.current;
    if (retry.hash === hash && Date.now() < retry.until) return null;

    const ok = await requestAvatarScreen(resized);
    if (ok === null) {
      screenRetryRef.current = { hash, until: Date.now() + SCREEN_RETRY_MS };
      return null;
    }
    updateRef.current?.(prev => ({ ...prev, avatarScreen: { hash, ok, at: new Date().toISOString() } }));
    return ok ? resized : null;
  }

  // ── Presence heartbeat ─────────────────────────────────────────
  // The debounced publish above only fires when state CHANGES. If
  // a user opens the app and just looks at it without editing —
  // their last_active_at goes stale and friends see them as offline.
  //
  // Fix: a separate 60s interval that pings last_active_at while
  // the tab is visible. Three tab-visible passes (3 minutes total)
  // is the offline threshold the friends rail uses, so a real-life
  // "I left the tab open" friend stays online; an actual close +
  // walk-away goes offline within 3 minutes.
  //
  // We don't ping when the tab is hidden — there's no point pumping
  // network requests for a backgrounded app, and visibility change
  // re-fires this immediately on focus return so the gap is
  // ~unnoticeable.
  // Note: presence heartbeat below ALSO checks S.privacy.sharePresence
  // so opting out fully stops the heartbeat (not just the debounced
  // publish). Without this guard the user's online dot would still
  // tick every 60s even after they turned presence off.
  useEffect(() => {
    if (!userId) return;
    if (S?.privacy?.sharePresence === false) return;
    let intervalId = null;

    async function ping() {
      // Skip if we know the previous publish failed for "schema not
      // applied" reasons — those errors don't auto-recover and
      // pinging just spams the console.
      try {
        await updateOwnProfile(userId, { last_active_at: new Date().toISOString() });
      } catch {
        // silent — same rationale as the debounced publish
      }
    }

    function start() {
      if (intervalId) return;
      ping(); // immediate ping on focus
      intervalId = setInterval(ping, 60_000);
    }
    function stop() {
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') start();
      else stop();
    }

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  // Re-bind when sharePresence flips so toggling off stops the heartbeat
  // immediately rather than waiting for unmount.
  }, [userId, S?.privacy?.sharePresence]);
}
