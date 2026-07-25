import { useEffect, useRef } from 'react';

/**
 * HabitRunner — the runner lane above a habit's horizontal progress bar
 * (desktop Habits page only).
 *
 * A stick figure travels the streak as a course: walk → brisk walk →
 * jog → run, then obstacles escalate (rocks → low walls → high walls +
 * clotheslines) while the pace holds. The course IS the progress
 * indicator.
 *
 * Motion model:
 *   - Stage params (speed/cadence/stride/gait) interpolate CONTINUOUSLY
 *     with days-clean; within obstacle stages the same fraction
 *     densifies the course ("day 4/7" multiplier).
 *   - `gait` (0=walk, 1=run) drives knee fold, arm swing, elbow bend,
 *     bounce and lean together, so posture and pace never disagree.
 *   - Obstacle moves are ANCHORED: the acting obstacle's live position
 *     feeds the pose each frame, and a 2-segment IK solver plants hands
 *     on wall tops / feet on wall faces, so vaults and climbs actually
 *     touch what they clear.
 *   - Endless habits that have cleared every milestone don't stop to
 *     celebrate — the figure keeps running in gold with a spark trail.
 *
 * Rendering: one shared rAF drives every lane; a lane stops when
 * offscreen or the tab is hidden. prefers-reduced-motion freezes a
 * static stance with no obstacles/particles — the bar underneath always
 * carries the value, so nothing is conveyed by motion alone.
 */

// ── Stage ladder ────────────────────────────────────────────────────
// `cadence` is rad/s of stride phase; one cycle = 2 steps, so
// steps/sec = cadence / π. Walk ≈ 1.7/s, run ≈ 2.9/s (~175 spm).
const RUN = { speed: 78, cadence: 9.2, amp: 0.85, gait: 1 };
const STAGES = [
  { at: 0,  label: 'Walking',      speed: 22, cadence: 5.4, amp: 0.38, gait: 0,    kinds: [] },
  { at: 1,  label: 'Brisk walk',   speed: 34, cadence: 6.4, amp: 0.52, gait: 0.3,  kinds: [] },
  { at: 4,  label: 'Jogging',      speed: 55, cadence: 7.8, amp: 0.68, gait: 0.65, kinds: [] },
  { at: 7,  label: 'Running',      ...RUN, kinds: ['rock'] },
  { at: 14, label: 'Vaulting',     ...RUN, kinds: ['rock', 'wallLow'] },
  { at: 30, label: 'Full parkour', ...RUN, kinds: ['rock', 'wallLow', 'wallHigh', 'line'] },
];

export function stageForDays(days) {
  let s = STAGES[0];
  for (const st of STAGES) if (days >= st.at) s = st;
  return s;
}

const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = v => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = t => t * t * (3 - 2 * t);
/** Progress of t through the window [a,b], smoothed. */
const phase = (t, a, b) => smooth(clamp01((t - a) / (b - a)));

/** Continuous motion parameters for a streak length. `frac` is progress
 *  through the CURRENT stage toward the next — it blends motion toward
 *  the next stage's values and densifies the course within a stage. */
export function paramsForDays(days) {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (days >= STAGES[k].at) i = k;
  const cur = STAGES[i];
  const next = STAGES[i + 1] || null;
  const frac = next
    ? clamp01((days - cur.at) / (next.at - cur.at))
    : clamp01((days - cur.at) / 30);
  const to = next || cur;
  return {
    label: cur.label,
    kinds: cur.kinds,
    frac,
    speed:   lerp(cur.speed,   to.speed,   frac),
    cadence: lerp(cur.cadence, to.cadence, frac),
    amp:     lerp(cur.amp,     to.amp,     frac),
    gait:    lerp(cur.gait,    to.gait,    frac),
  };
}

// Obstacle geometry + the move each demands. `lead` is seconds-of-travel
// before contact at which the move starts, so the arc lands on the thing.
// Leads are tuned so the obstacle sits within ARM'S REACH for the whole
// contact phase — a hand can't plant on something 30px away.
const KINDS = {
  rock:     { w: 10, h: 7,  action: 'jump',  dur: 0.62, lead: 0.30 },
  wallLow:  { w: 11, h: 13, action: 'vault', dur: 0.80, lead: 0.28 },
  wallHigh: { w: 9,  h: 27, action: 'climb', dur: 1.15, lead: 0.27 },
  line:     { w: 22, h: 24, action: 'duck',  dur: 0.55, lead: 0.22 },
};
const AERIAL = new Set(['jump', 'vault', 'climb']);

// ── Shared ticker ───────────────────────────────────────────────────
// One rAF for the page; stride phase / scroll / particles are PER-LANE.
const TICKER = { lanes: new Set(), raf: 0, last: 0 };

function startTicker() {
  if (TICKER.raf) return;
  TICKER.last = performance.now();
  const frame = now => {
    const dt = Math.min(0.05, (now - TICKER.last) / 1000);
    TICKER.last = now;
    for (const lane of TICKER.lanes) {
      if (lane.visible) lane.step(dt, now);
    }
    TICKER.raf = requestAnimationFrame(frame);
  };
  TICKER.raf = requestAnimationFrame(frame);
}
function stopTicker() {
  if (!TICKER.raf) return;
  cancelAnimationFrame(TICKER.raf);
  TICKER.raf = 0;
}

// ── Figure ──────────────────────────────────────────────────────────
// FK limb: angles from straight-down, positive = forward (+x).
//
// Elbows and knees hinge in OPPOSITE directions, and mixing them up is
// the classic stick-figure tell. Callers never pass a raw second angle —
// they go through the leg()/arm() helpers below, which apply:
//   knee:  shin    = thigh − flex   (heel folds back toward the seat)
//   elbow: forearm = upper  + flex  (hand folds forward across the body)
// Knee flexion peaks during recovery, never on the forward reach.
function limb(ctx, oy, a1, a2, l1, l2, groundY) {
  const kx = Math.sin(a1) * l1, ky = Math.cos(a1) * l1;
  let fx = kx + Math.sin(a2) * l2, fy = oy + ky + Math.cos(a2) * l2;
  if (groundY != null && fy > groundY) fy = groundY;
  ctx.beginPath();
  ctx.moveTo(0, oy);
  ctx.lineTo(kx, oy + ky);
  ctx.lineTo(fx, fy);
  ctx.stroke();
}

// IK limb: origin → joint → target, joint side chosen by `bend` (±1).
// This is what lets a hand PLANT on a wall top and stay there while the
// wall scrolls past — the contact point is world-anchored.
function ikLimb(ctx, ox, oy, tx, ty, l1, l2, bend) {
  let dx = tx - ox, dy = ty - oy;
  let d = Math.hypot(dx, dy) || 0.001;
  const maxD = l1 + l2 - 0.4;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; tx = ox + dx; ty = oy + dy; }
  const cos = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const ang = Math.atan2(dy, dx) + bend * Math.acos(cos);
  const jx = ox + Math.cos(ang) * l1, jy = oy + Math.sin(ang) * l1;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(jx, jy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
}

const L1 = 7.5, L2 = 6.5, A1 = 6.5, A2 = 5.5;

function drawRunner(ctx, x, groundY, colour, pose) {
  const { mode, p, t: tRaw, amp = 0.85, gait = 1, land = 0, shadow, ob } = pose;
  const t = clamp01(tRaw);
  let yOff = 0, crouch = 0, rot = 0, lean = 0, pitch = null;

  // ── vertical path per move ──
  if (mode === 'jump') {
    const u = clamp01((t - 0.2) / 0.6);
    const airborne = t >= 0.2 && t <= 0.8;
    const arc = airborne ? Math.sin(Math.PI * u) : 0;
    yOff = -25 * arc;
    crouch = t < 0.2
      ? 4 * smooth(t / 0.2)                                // load the spring
      : 4 * phase(t, 0.82, 1) * (1 - phase(t, 0.95, 1));   // absorb the landing
    lean = 1.5 * arc;
  }
  if (mode === 'vault') {
    // The hips only need to clear the wall — the legs do the clearing by
    // tucking. Flying high above it would put the wall out of arm's reach
    // and there'd be nothing to plant a hand on.
    const wallH = ob ? ob.h : KINDS.wallLow.h;
    yOff = -Math.max(3, wallH - 8) * Math.sin(Math.PI * phase(t, 0.12, 0.92));
    if (t < 0.12) crouch = 3 * smooth(t / 0.12);
    if (t > 0.9)  crouch = 4 * phase(t, 0.9, 1);
    pitch = 0.85 * Math.sin(Math.PI * phase(t, 0.06, 0.95)); // chest over the wall
  }
  if (mode === 'climb') {
    // Rise only until the hips top out just above the wall — that's where
    // a mantle actually puts you, and it keeps the grip within reach.
    const top = -Math.max(6, (ob ? ob.h : KINDS.wallHigh.h) - 14);
    if (t < 0.3)       yOff = 0;                                   // reach + grab
    else if (t < 0.62) yOff = top * phase(t, 0.3, 0.62);            // pull + walk up
    else if (t < 0.82) yOff = top;                                  // mantle over
    else               yOff = top * (1 - phase(t, 0.82, 1));        // drop far side
    if (t > 0.82) crouch = 4.5 * phase(t, 0.88, 1);
    pitch = 0.45 * Math.sin(Math.PI * clamp01(t / 0.86));           // chest to the wall
  }
  if (mode === 'duck') {
    crouch = 10 * Math.sin(Math.PI * t);
    lean = 6 * Math.sin(Math.PI * t);
  }
  if (mode === 'stumble') {
    rot = 0.7 * smooth(t);
    crouch = 5 * smooth(t);
    lean = 3 * smooth(t);
  }
  if (mode === 'celebrate') yOff = -3.5 * Math.max(0, Math.sin(p * 0.55));
  crouch += land * 3.5;

  if (mode === 'run') {
    const bob = lerp(-0.35 * (1 - Math.cos(2 * p)) / 2, -1.6 * Math.abs(Math.sin(p)), gait);
    yOff += bob;
    lean = lerp(0, 2.0, gait);
  }

  // Ground shadow — anchors the figure; detaches and shrinks when airborne.
  if (shadow) {
    const air = clamp01(-yOff / 30);
    ctx.save();
    ctx.fillStyle = shadow;
    ctx.globalAlpha = 0.22 * (1 - air * 0.7);
    ctx.beginPath();
    ctx.ellipse(x + lean * 0.5, groundY - 0.5, 8 * (1 - air * 0.45), 1.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const hipY = groundY - 14 + yOff + crouch;
  // Torso as a real rigid segment: it PITCHES about the hip rather than
  // just sliding the shoulder sideways, which is what lets the chest get
  // out over a wall so the hand can reach its top.
  const torso = Math.max(4.5, 9 - crouch * 0.35);
  const pitchAng = pitch != null ? pitch : Math.atan2(lean, torso);
  const sinP = Math.sin(pitchAng), cosP = Math.cos(pitchAng);
  const shX = sinP * torso;
  const shoulderY = hipY - cosP * torso;

  ctx.save();
  ctx.translate(x, 0);
  if (rot) { ctx.translate(0, hipY); ctx.rotate(rot); ctx.translate(0, -hipY); }
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // head + neck continue along the torso line
  ctx.beginPath();
  ctx.arc(shX + sinP * 5.6, shoulderY - cosP * 5.6, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(shX + sinP * 2, shoulderY - cosP * 2);
  ctx.lineTo(0, hipY);
  ctx.stroke();

  // Both take (segment angle, JOINT FLEXION) — never a raw second angle,
  // so an elbow can't accidentally be given a knee's hinge direction.
  const arm = (upper, flex) => {
    ctx.save();
    ctx.translate(shX, 0);
    limb(ctx, shoulderY, upper, upper + flex, A1, A2);
    ctx.restore();
  };
  const leg = (thigh, flex, gnd) => limb(ctx, hipY, thigh, thigh - flex, L1, L2, gnd);

  // Anchored contact points, in figure-local coords. `rel` is where the
  // obstacle is RIGHT NOW relative to the runner — it drifts left through
  // the move, which is what sells the pass-over. A hand only commits to
  // the wall when the wall is genuinely within arm's reach.
  const ARM_REACH = A1 + A2 - 0.8;
  const rel = ob ? ob.rel : 0;
  const wallTopY = ob ? groundY - ob.h : 0;
  const handTy = wallTopY - 1;
  const canPlant = ob != null && rel > -14 && rel < 22 &&
    Math.hypot(rel - shX, handTy - shoulderY) < ARM_REACH;

  if (mode === 'jump') {
    if (t < 0.2) {
      // loading: both legs flexed under, arms swung back
      leg( 0.35, 1.0, groundY);
      leg(-0.25, 0.8, groundY);
      arm(-0.9, 0.45);
      arm(-0.7, 0.45);
    } else if (t < 0.8) {
      // airborne: tuck peaks mid-flight, then the lead leg reaches for
      // the landing while the trail leg stays folded
      const u = (t - 0.2) / 0.6;
      const tuck = Math.sin(Math.PI * u);
      const reach = phase(u, 0.55, 1);
      leg(lerp(0.9, 0.45, reach), lerp(0.6, 1.5, tuck) * (1 - reach * 0.8));
      leg(-0.5, lerp(0.5, 1.8, tuck));
      // arms: drive up on takeoff, spread for balance
      arm(lerp(-1.6, 0.6, u), lerp(0.6, 0.35, u));
      arm(lerp(0.8, -0.9, u), lerp(0.5, 0.4, u));
    } else {
      // landing: legs forward under the body, arms settling
      leg(0.4, 0.5, groundY);
      leg(0.1, 0.3, groundY);
      arm( 0.5, 0.35);
      arm(-0.4, 0.35);
    }
  } else if (mode === 'vault') {
    // Speed vault: the near hand plants on the wall top (IK to the live
    // wall position) and takes the weight while both legs tuck through
    // over the wall, then release into the landing.
    const swing = phase(t, 0.12, 0.9);
    const tuck = Math.sin(Math.PI * swing);
    const thigh = lerp(0.55, 1.1, swing) + 0.35 * tuck;
    const flex = lerp(0.9, 1.0, swing) + 1.5 * tuck;
    const gnd = (t < 0.12 || t > 0.93) ? groundY : null;
    leg(thigh, flex, gnd);
    leg(thigh - 0.4, flex * 0.82, gnd);
    if (canPlant) ikLimb(ctx, shX, shoulderY, rel, handTy, A1, A2, +1);
    else arm(lerp(0.5, -0.6, swing), 0.4);
    arm(lerp(-1.1, -2.0, swing), 0.5); // free arm flung up-back
  } else if (mode === 'climb') {
    // Wall climb: reach, grip the top with both hands (anchored), walk
    // the feet up the face, mantle onto the top, drop the far side.
    if (t < 0.08) {
      arm(2.35, 0.3);  // both arms thrown up-FORWARD at the wall top
      arm(2.1,  0.3);
    } else if (canPlant && t < 0.86) {
      ikLimb(ctx, shX, shoulderY, rel - 2, handTy, A1, A2, +1);
      ikLimb(ctx, shX, shoulderY, rel + 2, handTy, A1, A2, -1);
    } else {
      arm( 0.4, 0.35);
      arm(-0.4, 0.35);
    }
    if (t < 0.62) {
      // feet stepping up the wall face as the body pulls up
      const upA = phase(t, 0.26, 0.62), upB = phase(t, 0.36, 0.62);
      const fx = clamp(rel - 4.5, -13, 13);
      ikLimb(ctx, 0, hipY, fx,       lerp(groundY - 3, wallTopY + 9, upA), L1, L2, -1);
      ikLimb(ctx, 0, hipY, fx + 1.8, lerp(groundY,     wallTopY + 4, upB), L1, L2, -1);
    } else if (t < 0.82) {
      // mantle: feet come up onto the top, knees folded
      const fx = clamp(rel + 2, -13, 13);
      ikLimb(ctx, 0, hipY, fx,     handTy, L1, L2, -1);
      ikLimb(ctx, 0, hipY, fx - 3, handTy, L1, L2, -1);
    } else {
      // dropping: legs under for the landing
      leg( 0.3, 0.4, groundY);
      leg(-0.1, 0.3, groundY);
    }
  } else if (mode === 'duck') {
    // slide under: front leg spears forward flat, back leg folds deep,
    // near arm sweeps the line overhead, far arm trails for balance
    const u = Math.sin(Math.PI * t);
    leg(lerp(0.8, 1.35, u), lerp(0.9, 0.25, u), groundY);
    leg(-0.6, lerp(0.9, 1.6, u), groundY);
    arm(lerp(0.9, 1.5, u), 0.3);
    arm(-1.1 - 0.4 * u, 0.45);
  } else if (mode === 'celebrate') {
    arm(-2.5, 0.45);
    arm( 2.5,  0.45);
    leg(-0.32, 0, groundY);
    leg( 0.32,  0.12, groundY);
  } else if (mode === 'stumble') {
    arm(-1.9, 0.55);
    arm( 1.2,  0.7);
    leg(-0.95, 0.6, groundY);
    leg( 0.7,  -0.65, groundY);   // front leg thrown out, knee locked
  } else {
    // run / idle — gait blends every joint together
    const ph = mode === 'run' ? p : 0.9;
    const flexAmt = lerp(0.42, 1.35, gait);
    const armAmp  = lerp(0.20, 0.62, gait);
    // Arms hang almost straight at a walk and carry near 90° at a run.
    const elbow   = lerp(0.12, 1.05, gait);
    for (const off of [0, Math.PI]) {
      const th = amp * Math.sin(ph + off);
      leg(th, flexAmt * (1 + Math.cos(ph + off)) / 2, groundY);
    }
    for (const off of [0, Math.PI]) {
      arm(-armAmp * Math.sin(ph + off), elbow);
    }
  }
  ctx.restore();
}

// Obstacles draw in danger red so the course reads at a glance.
function drawObstacle(ctx, o, groundY, red) {
  const k = KINDS[o.kind];
  ctx.save();
  ctx.strokeStyle = red;
  ctx.fillStyle = red;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  if (o.kind === 'rock') {
    ctx.beginPath();
    ctx.moveTo(o.x - k.w / 2, groundY);
    ctx.lineTo(o.x - k.w * 0.22, groundY - k.h);
    ctx.lineTo(o.x + k.w * 0.28, groundY - k.h * 0.72);
    ctx.lineTo(o.x + k.w / 2, groundY);
    ctx.closePath();
    ctx.globalAlpha = 0.22; ctx.fill();
    ctx.globalAlpha = 1;    ctx.stroke();
  } else if (o.kind === 'line') {
    ctx.beginPath();
    ctx.moveTo(o.x - k.w / 2, groundY - k.h);
    ctx.lineTo(o.x + k.w / 2, groundY - k.h);
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(o.x + k.w / 2, groundY - k.h);
    ctx.lineTo(o.x + k.w / 2, groundY);
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.22;
    ctx.fillRect(o.x - k.w / 2, groundY - k.h, k.w, k.h);
    ctx.globalAlpha = 1;
    ctx.strokeRect(o.x - k.w / 2, groundY - k.h, k.w, k.h);
  }
  ctx.restore();
}

// ── Component ───────────────────────────────────────────────────────
export default function HabitRunner({ progress, days, colour, done, endless = false, stumbleKey }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({
    obstacles: [], action: null, spawnGap: 170,
    stumbleStart: 0, phase: 0, scroll: 0,
    particles: [], stepCount: 0, land: 0, trailAcc: 0,
  });
  const propsRef = useRef({ progress, days, colour, done, endless });
  propsRef.current = { progress, days, colour, done, endless };

  // A relapse restarts the streak (startTime changes) — the figure trips.
  // The first run is mount, not a relapse, so it doesn't tumble on load.
  const seenStumbleKey = useRef(null);
  useEffect(() => {
    if (seenStumbleKey.current !== null && stumbleKey) {
      stateRef.current.stumbleStart = performance.now();
      stateRef.current.obstacles = [];
      stateRef.current.action = null;
    }
    seenStumbleKey.current = stumbleKey ?? 0;
  }, [stumbleKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let w = 0, h = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let palette = null;
    const readPalette = () => {
      const s = getComputedStyle(document.documentElement);
      const theme = document.documentElement.getAttribute('data-theme') || '';
      const dark = theme.includes('dark') ||
        (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
      palette = {
        line: s.getPropertyValue('--border').trim() || '#ddd',
        gold: s.getPropertyValue('--gold').trim() || '#c8970a',
        red:  dark ? '#e2685c' : '#c0392b',
        ink:  s.getPropertyValue('--text-muted').trim() || '#8a8175',
      };
    };
    readPalette();
    const mo = new MutationObserver(readPalette);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });

    const spawnParticles = (st, x, y, n, colour, up) => {
      for (let i = 0; i < n; i++) {
        st.particles.push({
          x: x + (Math.random() - 0.5) * 4,
          y,
          vx: (Math.random() - 0.5) * (up ? 26 : 18) - (up ? 0 : 10),
          vy: up ? -(14 + Math.random() * 26) : -(4 + Math.random() * 8),
          life: 0.45 + Math.random() * 0.25,
          age: 0,
          colour,
        });
      }
    };

    const lane = {
      visible: true,
      step(dt, now) {
        const st = stateRef.current;
        const { progress: pr, days: dy, colour: col, done: dn, endless: el } = propsRef.current;
        const prm = paramsForDays(dy);
        const still = reduced.matches;

        // Endless + done: never stop — golden run with a spark trail.
        const goldenRun = dn && el;
        const running = !dn || goldenRun;

        const stumbleT = st.stumbleStart ? (now - st.stumbleStart) / 700 : 2;
        const stumbling = stumbleT < 1;

        // While a hand/foot is committed to an obstacle the world has to
        // slow with it, otherwise the wall scrolls out from under the grip
        // mid-move. A climb nearly stalls (he's clinging to it) then
        // catches back up as he drops off the far side.
        const worldMul = (() => {
          const a = st.action;
          if (!a) return 1;
          const at = clamp01(a.t);
          if (a.mode === 'climb') {
            if (at < 0.12) return 1;
            if (at < 0.72) return 0.08;
            return lerp(0.08, 1.7, phase(at, 0.72, 1));
          }
          if (a.mode === 'vault') return at > 0.08 && at < 0.88 ? 0.6 : 1;
          return 1;
        })();

        if (!still && !stumbling) {
          // Phase keeps ticking even for a finished non-endless habit —
          // it drives the celebration hop.
          st.phase += dt * (running ? prm.cadence : 3.4);
          if (running) st.scroll = (st.scroll + prm.speed * worldMul * dt) % 12;
        }
        // A finished endless habit sits at 100%, but pinning the figure to
        // the very edge leaves no runway to see obstacles coming — hold it
        // back far enough that the course still reads.
        const maxX = goldenRun ? w - 52 : w - 10;
        const runnerX = Math.max(10, Math.min(maxX, pr * w));

        // ── obstacles (spawn gap shrinks with the stage fraction) ──
        if (!still && prm.kinds.length && running && !stumbling) {
          for (const o of st.obstacles) o.x -= prm.speed * worldMul * dt;
          st.obstacles = st.obstacles.filter(o => o.x > -40);
          const lastOb = st.obstacles[st.obstacles.length - 1];
          if (!lastOb || lastOb.x < w - st.spawnGap) {
            const kind = prm.kinds[Math.floor(Math.random() * prm.kinds.length)];
            st.obstacles.push({ kind, x: w + 24, acted: false });
            const density = 1 - 0.35 * prm.frac;
            st.spawnGap = (130 + Math.random() * 130) * density;
          }
          if (!st.action) {
            for (const o of st.obstacles) {
              if (o.acted) continue;
              const k = KINDS[o.kind];
              const d = o.x - runnerX;
              if (d <= prm.speed * k.lead && d > -14) {
                o.acted = true;
                st.action = { mode: k.action, t: 0, dur: k.dur, ob: o };
                break;
              }
            }
          }
        } else if (still) {
          st.obstacles = [];
        }

        if (st.action) {
          st.action.t += dt / st.action.dur;
          if (st.action.t >= 1) {
            if (!still) {
              spawnParticles(st, runnerX, h - 3, 5, palette.gold, true);
              if (AERIAL.has(st.action.mode)) st.land = 1;
            }
            st.action = null;
          }
        }
        st.land = Math.max(0, st.land - dt * 6);

        // Footfall dust at running gaits.
        if (!still && running && !stumbling && !st.action && prm.gait > 0.45) {
          const stepIdx = Math.floor(st.phase / Math.PI);
          if (stepIdx !== st.stepCount) {
            st.stepCount = stepIdx;
            spawnParticles(st, runnerX - 4, h - 2, 2, palette.ink, false);
          }
        }

        // Golden trail — steady gold sparks streaming off the run.
        if (!still && goldenRun && !stumbling) {
          st.trailAcc += dt;
          if (st.trailAcc > 0.07) {
            st.trailAcc = 0;
            st.particles.push({
              x: runnerX - 6 - Math.random() * 4,
              y: h - 6 - Math.random() * 14,
              vx: -(24 + Math.random() * 20),
              vy: -(2 + Math.random() * 10),
              life: 0.5 + Math.random() * 0.3,
              age: 0,
              colour: palette.gold,
            });
          }
        }

        // ── particles ──
        for (const q of st.particles) {
          q.age += dt;
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.vy += (q.colour === palette.gold && goldenRun ? 30 : 90) * dt;
        }
        st.particles = st.particles.filter(q => q.age < q.life);

        // ── draw ──
        const groundY = h - 1;
        ctx.clearRect(0, 0, w, h);

        const mode = stumbling ? 'stumble'
          : (dn && !el) ? 'celebrate'
          : st.action ? st.action.mode
          : still ? 'idle'
          : 'run';

        if (!still && running && !stumbling) {
          ctx.save();
          ctx.strokeStyle = palette.line;
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1.4;
          ctx.lineCap = 'round';
          for (let d = -12; d < w; d += 12) {
            const dx = d - st.scroll;
            if (dx < runnerX - 48 || dx > runnerX + 34) continue;
            ctx.beginPath();
            ctx.moveTo(dx, groundY - 1.5);
            ctx.lineTo(dx + 5, groundY - 1.5);
            ctx.stroke();
          }
          ctx.restore();
        }

        for (const o of st.obstacles) drawObstacle(ctx, o, groundY, palette.red);

        for (const q of st.particles) {
          const a = 1 - q.age / q.life;
          ctx.save();
          ctx.fillStyle = q.colour;
          ctx.globalAlpha = 0.7 * a;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 1.1 + 0.6 * a, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Live obstacle anchor for the current move — rel drifts left
        // through the action, so hands track the wall as it passes.
        const ob = st.action?.ob
          ? { rel: st.action.ob.x - runnerX, h: KINDS[st.action.ob.kind].h }
          : null;

        drawRunner(ctx, runnerX, groundY, dn ? palette.gold : col, {
          mode,
          p: st.phase,
          t: mode === 'stumble' ? clamp01(stumbleT) : (st.action ? Math.min(1, st.action.t) : 0),
          amp: prm.amp,
          gait: goldenRun ? 1 : prm.gait,
          land: st.land,
          shadow: still ? null : palette.ink,
          ob,
        });
      },
    };

    const io = new IntersectionObserver(es => { lane.visible = es[0].isIntersecting; }, { threshold: 0 });
    io.observe(canvas);

    TICKER.lanes.add(lane);
    startTicker();
    const onVis = () => { document.hidden ? stopTicker() : startTicker(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      TICKER.lanes.delete(lane);
      if (!TICKER.lanes.size) stopTicker();
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect(); io.disconnect(); mo.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="habit-lane-canvas" aria-hidden="true" />;
}
