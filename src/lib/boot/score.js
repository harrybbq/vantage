/**
 * The boot score.
 *
 * One authored timeline in milliseconds, and one elapsed clock. Every
 * element derives its reveal from that clock, so the whole sequence is
 * described in one place and can be re-timed by changing a number here
 * rather than by chasing delays around a stylesheet.
 *
 * SPEED scales the clock, exactly as the mock-ups did: t advances at
 * `elapsed * SPEED`, so a speed below 1 makes the boot LONGER and above
 * it shorter. At 0.8 the desktop score's 3900ms (plus a 300ms tail) runs
 * for 5.25s of wall time, and the mobile one for 5.1s. Changing this one
 * number re-times the whole sequence; boot.css follows through CSS_K.
 *
 * The panel stagger is the one part that lives in CSS instead (boot.css
 * needs it for elements this module never sees), so the reciprocal is
 * exported as CSS_K and boot.css multiplies its delays by it. score.test
 * checks the two have not drifted apart.
 */

export const SPEED = 0.8;
/** 1 / SPEED — what boot.css multiplies its authored delays by. */
export const CSS_K = Number((1 / SPEED).toFixed(4));

/** Desktop score. Wall-clock duration = total / SPEED. */
export const DESKTOP = {
  bg: [140, 1900],
  grid: [260, 1300],
  sweep: [200, 2200],
  rail: [420, 1600],
  topbar: [700, 1600],
  console: [320, 3600],
  /* The window the dials wind up over — it starts with the first panel
     and finishes a beat before the score does, so the last needle to
     settle is the last thing that moves. */
  fill: [1150, 3600],
  tile: 560,          // how long one wallpaper tile takes to arrive
  tileFlicker: 460,
  cols: 8,
  rows: 5,
  total: 3900,
};

/** Mobile score — same shapes, retimed for a single column. */
export const MOBILE = {
  bg: [120, 1800],
  grid: [240, 1200],
  sweep: [180, 2000],
  rail: [640, 1600],   // the bottom tab bar
  topbar: [460, 1200],
  console: [300, 3500],
  fill: [1000, 3500],
  tile: 520,
  tileFlicker: 440,
  cols: 4,
  rows: 7,
  total: 3800,
};

export const scoreFor = kind => (kind === 'mobile' ? MOBILE : DESKTOP);

/** Wall-clock milliseconds a score runs for, tail included. */
export const durationOf = score => (score.total + 300) / SPEED;

export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = t => 1 - Math.pow(1 - t, 3);
export const seg = (t, [a, b]) => clamp01((t - a) / (b - a));

/**
 * A reveal window, plus an optional flicker burst while it runs.
 *
 * Past the window `done` is true and `anim` is 'none' — nothing keeps
 * painting once an element has arrived, which is what lets the whole
 * overlay be torn down cleanly at the end.
 */
export function reveal(t, win, flickerMs) {
  const p = seg(t, win);
  const done = p >= 1;
  return {
    p,
    done,
    opacity: done ? 1 : clamp01(p * 1.7),
    y: done ? 0 : lerp(12, 0, ease(p)),
    anim: !done && p > 0 && flickerMs ? `vb-flick ${flickerMs}ms steps(11) 1 both` : 'none',
  };
}

/**
 * The wallpaper assembles as a grid of cells, each showing its own slice
 * of the one image, arriving along a diagonal from the top-left. Returns
 * one entry per cell in row-major order.
 */
export function tiles(t, score) {
  const { cols, rows } = score;
  const span = score.bg[1] - score.bg[0] - score.tile;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const diag = (r + c) / (rows + cols - 2);
      const start = score.bg[0] + diag * span;
      const rv = reveal(t, [start, start + score.tile], score.tileFlicker);
      out.push({
        row: r,
        col: c,
        opacity: rv.opacity,
        scale: rv.done ? 1 : lerp(1.06, 1, ease(rv.p)),
        edge: rv.done ? 0 : 0.3 * (1 - rv.p),
        anim: rv.anim,
      });
    }
  }
  return out;
}

/** The stages the boot console reports, in order. */
export const STAGES = [
  'wallpaper · user background',
  'core · state hydrate',
  'ratings · ledger recompute',
  'widgets · canvas mount',
  'trackers · streaks',
  'coach · daily brief',
  'hub · online',
];

/**
 * How full every dial, ring, arc and bar should be drawn at time t.
 *
 * Smoothstep rather than the ease-out the rest of the score uses. An
 * ease-out sends a needle to nine-tenths in the first fifth of its
 * window and then creeps, which reads as "already full, now twitching".
 * Winding up wants the opposite shape: slow to break away, quickest
 * through the middle, settling gently onto the real reading.
 */
export function fillAt(t, score) {
  const p = seg(t, score.fill);
  return p * p * (3 - 2 * p);
}

export function consoleAt(t, score) {
  const p = seg(t, score.console);
  const idx = Math.min(STAGES.length - 1, Math.floor(p * STAGES.length));
  const done = t >= score.total;
  return {
    p,
    done,
    line: done ? 'hub online · boot complete' : STAGES[idx],
    pct: Math.round(p * 100),
  };
}
