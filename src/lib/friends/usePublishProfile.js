import { useEffect, useRef } from 'react';
import { upsertOwnPublicStats, updateOwnProfile } from './queries';
import { habitElapsed } from '../habits/progress.js';
import { privacyOn } from './privacy.js';
import { publicNameProblem } from '../moderation/nameFilter.js';
import { photoHash } from './avatarScreen.js';
import { writePublicProfile } from './profileWrites.js';
import { loadOwnProfile } from './profileReads.js';
import { shareableView } from '../wearables/strip.js';
import { streakForFriends, planAvatar, planDirectPatch, PRESENCE_INTERVAL_MS, PRESENCE_REPING_MS } from './publishPlan.js';

/**
 * Debounced sync of the user's public-facing data:
 *   - profiles.{display_name, avatar_url} — through profile-update, the
 *     server-side name filter + avatar screening (item 84)
 *   - profiles.{level, last_active_at} — direct, only when changed
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
 *  by the count of distinct trackers logged on each day.
 *
 *  Ticks an auto-fill rule made from a WHOOP/Oura reading are left out
 *  (item 124, owner decision D1): friends see what you logged, not what
 *  your band did. */
function buildHeatmap(S) {
  const logs = shareableView(S).logs || {};
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
  // What the server holds, so only real changes are written (item 92:
  // fewer profile UPDATEs; item 84: fewer profile-update calls). Seeded
  // from the own-row read on the first publish of a session.
  const sentRef = useRef({ userId: null, server: null, level: undefined, presence: undefined, refusedName: undefined, pubBackoffUntil: 0 });
  // Last presence write (heartbeat or piggy-backed), shared by both effects.
  const lastPingRef = useRef({ userId: null, at: 0 });

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
    // Streak is opt-IN (see privacy.js) — it publishes the habit name,
    // which friends read, so it goes through the public-text filter.
    const streak = streakForFriends(privacyOn(priv, 'shareStreak') ? currentStreak(S) : null);
    const presenceOff = priv.sharePresence === false;
    // A name the public-text filter refuses is published as no name
    // (Settings › Account says why). S.profile.name itself is untouched.
    const ownName = (S.profile?.name || '').trim();
    const payload = {
      // profiles slice
      // 40 chars: the profiles_display_name_len check (audit SQL).
      display_name: ownName && !publicNameProblem(ownName) ? ownName.slice(0, 40) : null,
      level,
      // public_stats slice
      current_streak: streak.days,
      streak_habit:   streak.name,
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
    // changed. Presence is the heartbeat's job, not this one's.
    const sig = JSON.stringify({
      d: payload.display_name, l: payload.level,
      s: payload.current_streak, sh: payload.streak_habit,
      h: payload.heatmap_days.map(x => x.intensity).join(''),
      w: payload.recent_wins.map(x => x.name).join('|'),
      a: photoSig, p: presenceOff,
    });
    if (sig === lastPayloadRef.current && triedRef.current) return;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      let sent = sentRef.current;
      if (sent.userId !== userId) {
        sent = sentRef.current = { userId, server: null, level: undefined, presence: undefined, refusedName: undefined, pubBackoffUntil: 0 };
      }
      if (!sent.server) {
        try {
          const own = await loadOwnProfile(userId);
          sent.server = { display_name: own?.display_name ?? null, avatar_url: own?.avatar_url ?? null };
          if (sent.level === undefined && own) sent.level = own.level;
          if (sent.presence === undefined && own) sent.presence = own.last_active_at ? 'on' : 'off';
        } catch { /* unknown: send, the server skips no-ops */ }
      }

      // Three independent writes; the friends rail tolerates any one
      // failing without the others.
      const jobs = [publishPublicText(sent), publishDirect(sent), publishStats()];
      const results = await Promise.allSettled(jobs);
      if (results.every(r => r.status === 'fulfilled')) lastPayloadRef.current = sig;
      // Most likely cause of a failure: migrations not applied yet, or
      // the user is offline. Silently absorb — the rail will surface
      // its own load error if anything is actually broken.
      triedRef.current = true;
    }, 4000);

    /** display_name / avatar_url → profile-update (item 84), changes only. */
    async function publishPublicText(sent) {
      if (Date.now() < sent.pubBackoffUntil) return;
      const server = sent.server; // null = unknown
      const pub = {};
      if ((!server || payload.display_name !== server.display_name) && payload.display_name !== sent.refusedName) {
        pub.display_name = payload.display_name;
      }
      const hash = photoSrc ? await photoHash(photoSrc) : null;
      const plan = planAvatar({
        photoSrc, hash, screen: lastScreen, retry: screenRetryRef.current,
        serverAvatar: server ? server.avatar_url : undefined,
      });
      if (plan.action === 'clear') pub.avatar_url = null;
      else if (plan.action === 'send') {
        // The heavy canvas work happens only here, after the debounce.
        const resized = await resizeAvatar(photoSrc);
        if (!resized) { if (!server || server.avatar_url !== null) pub.avatar_url = null; }
        else if (!server || resized !== server.avatar_url) pub.avatar_url = resized;
      }
      if (Object.keys(pub).length === 0) return;

      try {
        const out = await writePublicProfile(userId, pub);
        if (out?.profile) sent.server = { display_name: out.profile.display_name ?? null, avatar_url: out.profile.avatar_url ?? null };
        if (hash && 'avatar_url' in pub && pub.avatar_url) recordVerdict(hash, out?.avatar);
      } catch (e) {
        if (e?.status === 400 && e.field === 'display_name') sent.refusedName = pub.display_name;
        else if (e?.status === 400 && e.field === 'avatar_url' && hash) recordVerdict(hash, 'rejected');
        else if (e?.status === 429 || e?.status === 503) sent.pubBackoffUntil = Date.now() + SCREEN_RETRY_MS;
        throw e;
      }
    }

    /** level / presence-off → a direct UPDATE, only when it changed. */
    async function publishDirect(sent) {
      const lp = lastPingRef.current;
      const patch = planDirectPatch({
        level: payload.level, sentLevel: sent.level,
        presenceOff, sentPresence: sent.presence,
        lastPingAt: lp.userId === userId ? lp.at : 0,
      });
      if (Object.keys(patch).length === 0) return;
      await updateOwnProfile(userId, patch);
      if ('level' in patch) sent.level = patch.level;
      if ('last_active_at' in patch) {
        sent.presence = patch.last_active_at ? 'on' : 'off';
        if (patch.last_active_at) lastPingRef.current = { userId, at: Date.now() };
      }
    }

    /** public_stats — the friend card's streak, heatmap and wins
     *  (friends-only by RLS). */
    function publishStats() {
      return upsertOwnPublicStats(userId, {
        level: payload.level,
        current_streak: payload.current_streak,
        streak_habit: payload.streak_habit,
        heatmap_days: payload.heatmap_days,
        recent_wins: payload.recent_wins,
      });
    }

    /**
     * Remember a definitive screening verdict, additively, in
     * S.avatarScreen ({ hash, ok, at }) — keyed by the SOURCE photo, so the
     * same photo is not re-sent from this device or another. An undecided
     * answer (no key, over the cap, timeout) backs off for a while instead.
     * The server is what decides; this only saves repeat calls.
     */
    function recordVerdict(hash, verdict) {
      if (verdict === 'approved' || verdict === 'unchanged') {
        if (S?.avatarScreen?.hash === hash && S.avatarScreen.ok === true) return;
        updateRef.current?.(prev => ({ ...prev, avatarScreen: { hash, ok: true, at: new Date().toISOString() } }));
      } else if (verdict === 'rejected') {
        updateRef.current?.(prev => ({ ...prev, avatarScreen: { hash, ok: false, at: new Date().toISOString() } }));
      } else {
        screenRetryRef.current = { hash, until: Date.now() + SCREEN_RETRY_MS };
      }
    }

    return () => clearTimeout(timerRef.current);
  }, [userId, S, hasPro, visionState, hydrated, loadError]);

  // ── Presence heartbeat (item 92) ───────────────────────────────
  // The debounced publish above only fires when state CHANGES. If a
  // user opens the app and just looks at it, last_active_at would go
  // stale and friends would see them offline.
  //
  // A ping on sign-in / when the app becomes visible (unless one went
  // out in the last PRESENCE_REPING_MS), then every PRESENCE_INTERVAL_MS
  // (5 min — was 60 s, i.e. a profiles UPDATE a minute per open app)
  // while visible. Nothing while hidden. The friends rail's online
  // threshold (ONLINE_THRESHOLD_MS, queries.js) is two intervals plus
  // slack, so one missed ping doesn't flip a friend offline.
  //
  // Opting out of presence (S.privacy.sharePresence) stops the
  // heartbeat entirely; the publish above clears the stored value once.
  useEffect(() => {
    if (!userId) return;
    if (S?.privacy?.sharePresence === false) return;
    let intervalId = null;

    async function ping(force) {
      const now = Date.now();
      const last = lastPingRef.current;
      if (!force && last.userId === userId && now - last.at < PRESENCE_REPING_MS) return;
      lastPingRef.current = { userId, at: now };
      try {
        await updateOwnProfile(userId, { last_active_at: new Date(now).toISOString() });
        if (sentRef.current.userId === userId) sentRef.current.presence = 'on';
      } catch {
        // silent — same rationale as the debounced publish
      }
    }

    function start() {
      if (intervalId) return;
      ping(false); // on sign-in / return, unless a ping just went out
      intervalId = setInterval(() => ping(true), PRESENCE_INTERVAL_MS);
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
