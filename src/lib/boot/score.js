/**
 * The boot score.
 *
 * One authored timeline in milliseconds, and one elapsed clock. Every
 * element derives its reveal from that clock, so the whole sequence is
 * described in one place and can be re-timed by changing a number here
 * rather than by chasing delays around a stylesheet.
 *
 * SPEED scales the clock, exactly as the mock-ups did: t advances at
 * `elapsed * SPEED`, so a speed below 1 makes the boot longer. At 0.75
 * the desktop score's 3150ms runs for 4.2s of wall time.
 *
 * The panel stagger is the one part that lives in CSS instead (boot.css
 * needs it for elements this module never sees), so the reciprocal is
 * exported as CSS_K and boot.css multiplies its delays by it. score.test
 * checks the two have not drifted apart.
 */

export const SPEED = 0.75;
/** 1 / SPEED — what boot.css multiplies its authored delays by. */
export const CSS_K = Number((1 / SPEED).toFixed(4));

/** Desktop score. Wall-clock duration = total / SPEED. */
export const DESKTOP = {
  bg: [120, 1220],
  grid: [240, 980],
  sweep: [180, 1680],
  rail: [380, 1180],
  topbar: [560, 1000],
  console: [300, 2900],
  tile: 340,          // how long one wallpaper tile takes to arrive
  tileFlicker: 300,
  cols: 8,
  rows: 5,
  total: 3150,
};

/** Mobile score — same shapes, retimed for a single column. */
export const MOBILE = {
  bg: [100, 1120],
  grid: [220, 900],
  sweep: [160, 1560],
  rail: [600, 1200],   // the bottom tab bar
  topbar: [420, 900],
  console: [280, 2800],
  tile: 320,
  tileFlicker: 280,
  cols: 4,
  rows: 7,
  total: 3050,
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
