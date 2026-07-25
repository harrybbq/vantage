import { useEffect, useRef } from 'react';

/**
 * HabitRunner — the runner lane that sits above a habit's horizontal
 * progress bar (desktop Habits page only).
 *
 * A stick figure travels the streak as a course. The longer the streak,
 * the harder it works: walk → brisk walk → jog → run, then obstacles —
 * rocks, low walls, high walls, clotheslines — escalate while the pace
 * holds. The course IS the progress indicator.
 *
 * Motion model:
 *   - Stage parameters (speed / cadence / stride / gait) interpolate
 *     CONTINUOUSLY with days-clean, not in steps: day 4-of-7 moves like
 *     "57% of the way to running", so every day visibly upgrades the
 *     figure. Within the obstacle stages the same fraction densifies the
 *     course instead (spawn gap shrinks as the next stage approaches).
 *   - `gait` (0 = walk, 1 = run) drives the whole body together — knee
 *     fold, arm swing, elbow bend, bounce, lean — so posture and pace
 *     can never disagree.
 *
 * Quality layer: ground shadow that detaches when airborne, footfall
 * dust at running gaits, spark bursts on cleared obstacles, landing
 * absorb after aerial moves, a tumbling stumble on relapse, eased
 * action curves.
 *
 * Rendering: one shared rAF drives every lane; a lane stops drawing
 * when offscreen or the tab is hidden. prefers-reduced-motion freezes a
 * static stance and disables obstacles/particles — the bar underneath
 * always carries the real value, so nothing is conveyed by motion alone.
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
const smooth = t => t * t * (3 - 2 * t); // smoothstep ease

/** Continuous motion parameters for a given streak length. `frac` is the
 *  progress through the CURRENT stage toward the next — the "day 4/7"
 *  multiplier: it blends speed/cadence/stride/gait toward the next
 *  stage's values, and densifies the obstacle course within a stage. */
export function paramsForDays(days) {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (days >= STAGES[k].at) i = k;
  const cur = STAGES[i];
  const next = STAGES[i + 1] || null;
  const frac = next
    ? clamp01((days - cur.at) / (next.at - cur.at))
    : clamp01((days - cur.at) / 30); // past the last stage: intensity keeps creeping
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

// Obstacle geometry + the move each one demands.
const KINDS = {
  rock:     { w: 10, h: 7,  action: 'jump',  dur: 0.62, lead: 0.30 },
  wallLow:  { w: 11, h: 13, action: 'vault', dur: 0.68, lead: 0.32 },
  wallHigh: { w: 9,  h: 27, action: 'climb', dur: 1.05, lead: 0.34 },
  line:     { w: 22, h: 24, action: 'duck',  dur: 0.55, lead: 0.22 },
};
// Aerial moves get a landing absorb when they finish.
const AERIAL = new Set(['jump', 'vault', 'climb']);

// ── Shared ticker ───────────────────────────────────────────────────
// One rAF for the page. Stride phase / scroll / particles are PER-LANE
// (each habit has its own cadence) — see stateRef.
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
// Angles measured from straight-down, positive = forward (+x). The knee
// only folds BACKWARD (shin = thigh − flexion, flexion ≥ 0), and flexion
// peaks during recovery — never on the forward reach — which is what
// keeps the joint reading as a human knee.
function limb(ctx, oy, a1, a2, l1, l2, groundY) {
  const kx = Math.sin(a1) * l1, ky = Math.cos(a1) * l1;
  let fx = kx + Math.sin(a2) * l2, fy = oy + ky + Math.cos(a2) * l2;
  if (groundY != null && fy > groundY) fy = groundY; // never sink below the track
  ctx.beginPath();
  ctx.moveTo(0, oy);
  ctx.lineTo(kx, oy + ky);
  ctx.lineTo(fx, fy);
  ctx.stroke();
}

function drawRunner(ctx, x, groundY, colour, pose) {
  const { mode, p, t: tRaw, amp = 0.85, gait = 1, land = 0, shadow } = pose;
  const t = smooth(clamp01(tRaw)); // eased action curve
  let yOff = 0, crouch = 0, rot = 0;

  if (mode === 'jump')  yOff = -26 * 4 * t * (1 - t);
  if (mode === 'vault') yOff = -20 * Math.sin(Math.PI * t);
  if (mode === 'climb') {
    const top = -(KINDS.wallHigh.h + 5);
    if (t < 0.4)      yOff = top * smooth(t / 0.4);            // spring for the top
    else if (t < 0.7) yOff = top;                              // mantle, hanging on
    else              yOff = top * (1 - smooth((t - 0.7) / 0.3)); // drop the far side
  }
  if (mode === 'duck') crouch = 9 * Math.sin(Math.PI * t);
  if (mode === 'stumble') {
    rot = 0.7 * smooth(tRaw);          // pitch forward into the trip
    crouch = 5 * smooth(tRaw);         // and collapse a little
  }
  if (mode === 'celebrate') yOff = -3.5 * Math.max(0, Math.sin(p * 0.55)); // happy hops
  crouch += land * 3.5;                // landing absorb after aerial moves

  // Walk hips dip twice per cycle and barely move; a run lifts clear.
  const bob = mode === 'run'
    ? lerp(-0.35 * (1 - Math.cos(2 * p)) / 2, -1.6 * Math.abs(Math.sin(p)), gait)
    : 0;
  const lean = mode === 'run' ? lerp(0, 2.0, gait) : mode === 'stumble' ? 3 * smooth(tRaw) : 0;

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

  const hipY = groundY - 14 + yOff + bob + crouch;
  const shoulderY = hipY - 9 + crouch * 0.35;
  const headY = shoulderY - 5.6;

  ctx.save();
  ctx.translate(x, 0);
  if (rot) { ctx.translate(0, hipY); ctx.rotate(rot); ctx.translate(0, -hipY); }
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.arc(lean, headY, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(lean, shoulderY - 2);
  ctx.lineTo(0, hipY);
  ctx.stroke();

  const L1 = 7.5, L2 = 6.5, A1 = 6.5, A2 = 5.5;

  if (mode === 'jump') {
    limb(ctx, hipY,  0.75, 0.75 - 1.25, L1, L2);   // lead leg tucked
    limb(ctx, hipY, -0.55, -0.55 - 1.7,  L1, L2);  // trail leg folded
    limb(ctx, shoulderY, -1.5, -2.1, A1, A2);
    limb(ctx, shoulderY,  0.9,  1.5, A1, A2);
  } else if (mode === 'vault') {
    // One hand plants on the wall, both legs swing through to the side.
    limb(ctx, hipY, 1.15, 1.15 - 0.5, L1, L2);
    limb(ctx, hipY, 0.75, 0.75 - 0.9, L1, L2);
    limb(ctx, shoulderY, 0.25, 0.15, A1, A2 + (groundY - shoulderY) * 0.18); // planting arm
    limb(ctx, shoulderY, -1.7, -2.2, A1, A2);
  } else if (mode === 'climb') {
    const pulling = t >= 0.4 && t < 0.7;
    limb(ctx, hipY,  0.45, 0.45 - (pulling ? 1.6 : 0.9), L1, L2);
    limb(ctx, hipY, -0.25, -0.25 - (pulling ? 1.9 : 1.2), L1, L2);
    limb(ctx, shoulderY, -0.35, -0.5, A1, A2);   // both arms overhead, gripping
    limb(ctx, shoulderY,  0.35,  0.5, A1, A2);
  } else if (mode === 'duck') {
    limb(ctx, hipY,  0.95, 0.95 - 1.15, L1, L2);
    limb(ctx, hipY, -0.75, -0.75 - 1.0,  L1, L2, groundY);
    limb(ctx, shoulderY,  1.25, 1.55, A1, A2);
    limb(ctx, shoulderY, -1.0, -1.4, A1, A2);
  } else if (mode === 'celebrate') {
    limb(ctx, shoulderY, -2.5, -2.95, A1, A2);
    limb(ctx, shoulderY,  2.5,  2.95, A1, A2);
    limb(ctx, hipY, -0.32, -0.2, L1, L2, groundY);
    limb(ctx, hipY,  0.32,  0.2, L1, L2, groundY);
  } else if (mode === 'stumble') {
    limb(ctx, shoulderY, -1.9, -2.45, A1, A2);
    limb(ctx, shoulderY,  1.2,  1.9,  A1, A2);
    limb(ctx, hipY, -0.95, -0.35, L1, L2, groundY);
    limb(ctx, hipY,  0.7,   1.35, L1, L2, groundY);
  } else {
    // run / idle — gait blends every joint together
    const ph = mode === 'run' ? p : 0.9;
    const flexAmt = lerp(0.42, 1.35, gait); // walk barely folds; run drives the heel up
    const armAmp  = lerp(0.20, 0.62, gait);
    const elbow   = lerp(0.10, 0.50, gait);

    for (const off of [0, Math.PI]) {
      const th = amp * Math.sin(ph + off);
      const flex = flexAmt * (1 + Math.cos(ph + off)) / 2;
      limb(ctx, hipY, th, th - flex, L1, L2, groundY);
    }
    ctx.save();
    ctx.translate(lean, 0);
    for (const off of [0, Math.PI]) {
      const a = -armAmp * Math.sin(ph + off);
      limb(ctx, shoulderY, a, a - elbow, A1, A2);
    }
    ctx.restore();
  }
  ctx.restore();
}

// Obstacles draw in the RED danger tone so they read at a glance —
// they're the things the streak has to clear.
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
    // clothesline: a bar at head height on a single post
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
export default function HabitRunner({ progress, days, colour, done, stumbleKey }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({
    obstacles: [], action: null, spawnGap: 170,
    stumbleStart: 0, phase: 0, scroll: 0,
    particles: [], stepCount: 0, land: 0,
  });
  // Live props without restarting the loop on every tick.
  const propsRef = useRef({ progress, days, colour, done });
  propsRef.current = { progress, days, colour, done };

  // A relapse bumps stumbleKey — play the tumble, then the streak is 0.
  useEffect(() => {
    if (stumbleKey) {
      stateRef.current.stumbleStart = performance.now();
      stateRef.current.obstacles = [];
      stateRef.current.action = null;
    }
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

    // Themed colours, re-read when the scheme/theme changes. The danger
    // red is fixed per theme (there's no --danger token): deeper on
    // cream, lifted on dark so it doesn't vanish into the ground.
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
        const { progress: pr, days: dy, colour: col, done: dn } = propsRef.current;
        const prm = paramsForDays(dy);
        const still = reduced.matches;

        const stumbleT = st.stumbleStart ? (now - st.stumbleStart) / 700 : 2;
        const stumbling = stumbleT < 1;

        if (!still && !stumbling) {
          st.phase += dt * prm.cadence;
          st.scroll = (st.scroll + prm.speed * dt) % 12;
        }
        const runnerX = Math.max(10, Math.min(w - 10, pr * w));

        // ── obstacles ──
        // Spawn gap shrinks as the stage fraction climbs — the "day 4/7"
        // multiplier applied to course density.
        if (!still && prm.kinds.length && !dn && !stumbling) {
          for (const o of st.obstacles) o.x -= prm.speed * dt;
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
                st.action = { mode: k.action, t: 0, dur: k.dur };
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
            // Cleared: spark burst + landing absorb for aerial moves.
            if (!still) {
              spawnParticles(st, runnerX, h - 3, 5, palette.gold, true);
              if (AERIAL.has(st.action.mode)) st.land = 1;
            }
            st.action = null;
          }
        }
        st.land = Math.max(0, st.land - dt * 6);

        // Footfall dust — twice per stride cycle, only at running gaits.
        if (!still && !dn && !stumbling && !st.action && prm.gait > 0.45) {
          const stepIdx = Math.floor(st.phase / Math.PI);
          if (stepIdx !== st.stepCount) {
            st.stepCount = stepIdx;
            spawnParticles(st, runnerX - 4, h - 2, 2, palette.ink, false);
          }
        }

        // ── particles ──
        for (const q of st.particles) {
          q.age += dt;
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.vy += 90 * dt; // gravity
        }
        st.particles = st.particles.filter(q => q.age < q.life);

        // ── draw ──
        const groundY = h - 1;
        ctx.clearRect(0, 0, w, h);

        const mode = stumbling ? 'stumble'
          : dn ? 'celebrate'
          : st.action ? st.action.mode
          : still ? 'idle'
          : 'run';

        // Ground dashes give the sense of speed — the runner's x encodes
        // progress, so it barely moves day to day.
        if (!still && !dn && !stumbling) {
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

        drawRunner(ctx, runnerX, groundY, dn ? palette.gold : col, {
          mode,
          p: st.phase,
          t: mode === 'stumble' ? clamp01(stumbleT) : (st.action ? Math.min(1, st.action.t) : 0),
          amp: prm.amp,
          gait: prm.gait,
          land: st.land,
          shadow: still ? null : palette.ink,
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
