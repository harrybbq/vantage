/**
 * One boot per app open — and the tap that hurries it along.
 *
 * ── The bug this exists to end ───────────────────────────────────────
 * The boot played, stopped about two seconds in, played again from the
 * top and finished. Two seconds is not a coincidence: it is the delay on
 * the service worker's automatic reload (main.jsx), which fires whenever
 * a new version activates — i.e. on the first open after every deploy.
 *
 * That reload was already known about, and the defence was a one-shot
 * marker in sessionStorage: the page about to reload set it, and the
 * page that came back consumed it and skipped its boot. The flaw is that
 * nothing says WHICH page consumes it. The marker is written when the
 * worker activates, which is usually before the app has finished
 * loading — so the page that set it reached its own boot decision first,
 * ate its own marker, and the reloaded page found nothing and played in
 * full. Whether it worked at all came down to a race between the service
 * worker and the cloud state load.
 *
 * A marker cannot fix this, because the thing being tracked is not "was
 * a reload requested" but "has this app open already had its boot". So
 * that is what is stored: the instant the run began, in sessionStorage,
 * which survives a reload and dies with the tab. A reload lands back
 * inside a run that is already going and RESUMES it; one that lands
 * after it has finished gets nothing. Either way the user sees the boot
 * exactly once, and it no longer matters who reloads or when.
 *
 * ── The tap ─────────────────────────────────────────────────────────
 * A boot is a nice thing to watch once and an obstacle every time after.
 * One tap multiplies the clock by BOOST from that instant on — it is not
 * a cut to the end, because the dials winding up are the part worth
 * seeing and a hard cut throws them away. From halfway, a tap lands the
 * whole thing in about half a second.
 *
 * Pure: takes storage and a clock, returns plain data. No React, no DOM.
 */

/** How much faster the clock runs after a tap. */
export const BOOST = 5;

/** sessionStorage key. Survives reload, dies with the tab. */
export const RUN_KEY = 'vb_boot_run';

/**
 * A run is `{ at, boostAt }` — the wall-clock instant it began, and the
 * instant it was hurried along, if it was.
 */
export const newRun = now => ({ at: now, boostAt: null });

/**
 * Score time elapsed, in authored ms.
 *
 * Before the tap the clock runs at `speed`; after it, at `speed * BOOST`.
 * Two segments, so the part already watched keeps its real duration and
 * only what is left is compressed.
 */
export function elapsedAt(run, now, speed) {
  if (!run) return 0;
  const boostAt = run.boostAt;
  if (!boostAt || boostAt > now) return Math.max(0, (now - run.at) * speed);
  return Math.max(0, (boostAt - run.at) * speed + (now - boostAt) * speed * BOOST);
}

/** Wall-clock ms left before `total` score-ms have elapsed. */
export function remainingWall(run, now, speed, total) {
  const left = total - elapsedAt(run, now, speed);
  if (left <= 0) return 0;
  // `<=`, not `<`: at the instant of the tap the boost is already in
  // effect, and the two functions have to agree about that or the timer
  // scheduled from here outlives the clock it is meant to track.
  const rate = speed * (run && run.boostAt && run.boostAt <= now ? BOOST : 1);
  return left / rate;
}

/** Has this run's time run out? */
export const isSpent = (run, now, speed, total) => elapsedAt(run, now, speed) >= total;

/**
 * Hurry a run along. Returns it unchanged if it has already been
 * hurried — a second tap is not four times faster, which would make the
 * end of the sequence depend on how fast someone can tap.
 */
export function boosted(run, now) {
  if (!run || run.boostAt) return run;
  return { ...run, boostAt: now };
}

/* ── Storage ─────────────────────────────────────────────────────────
   Every read is defensive. sessionStorage throws outright in some
   private-browsing modes, and what comes back is whatever was there —
   a half-written string, a value from a much older build. A boot that
   cannot be decided is a boot that plays; a crash is not. */

export function readRun(storage) {
  try {
    const raw = storage && storage.getItem(RUN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    const boostAt = typeof v.boostAt === 'number' && Number.isFinite(v.boostAt) ? v.boostAt : null;
    return { at: v.at, boostAt };
  } catch {
    return null;
  }
}

export function writeRun(storage, run) {
  try {
    if (storage) storage.setItem(RUN_KEY, JSON.stringify(run));
  } catch { /* private mode: the run lives in module scope for this page */ }
}

export function clearRun(storage) {
  try {
    if (storage) storage.removeItem(RUN_KEY);
  } catch { /* nothing to do */ }
}

/**
 * Decide this page load's run: resume one already in flight, or start a
 * fresh one, or refuse.
 *
 * `allowed` is the caller's veto — reduced motion, mainly. A refusal is
 * still RECORDED as a spent run, so a reload a moment later does not
 * get a second opinion and boot.
 *
 * A stored run from the future, or from absurdly far in the past, is
 * treated as no run at all: clocks move (a device sleeping through a
 * daylight-saving change, a user setting the time), and the failure
 * mode of trusting one is a boot that never ends.
 */
export function decide(storage, now, { speed, total, allowed = true }) {
  if (!allowed) {
    const spent = { at: now - total / speed - 1, boostAt: null };
    writeRun(storage, spent);
    return { run: null, reason: 'not-allowed' };
  }

  const stored = readRun(storage);
  if (stored) {
    const age = now - stored.at;
    const sane = age >= 0 && age < 24 * 60 * 60 * 1000;
    if (sane) {
      if (isSpent(stored, now, speed, total)) return { run: null, reason: 'already-played' };
      return { run: stored, reason: 'resumed' };
    }
  }

  const run = newRun(now);
  writeRun(storage, run);
  return { run, reason: 'started' };
}
