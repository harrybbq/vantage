import { useEffect, useRef } from 'react';

/**
 * HabitRunner — the runner lane that sits above a habit's horizontal
 * progress bar (desktop Habits page only).
 *
 * A stick figure runs at the streak's position along the track. The
 * longer the streak, the harder it works: it speeds up, then starts
 * clearing obstacles — rocks, low walls, high walls, clotheslines.
 * The obstacle course IS the progress indicator, so a glance tells you
 * roughly how deep into a streak you are before you read any number.
 *
 * Rendering notes:
 *   - One shared rAF loop drives every lane on the page (see TICKER).
 *     A lane that scrolls out of view or a hidden tab stops drawing.
 *   - Canvas (not SVG) because it's per-frame limb maths, and the whole
 *     thing is a few strokes per frame.
 *   - prefers-reduced-motion freezes a static stride and stops the
 *     ground/obstacles: the bar underneath always carries the real
 *     value, so nothing is conveyed by motion alone.
 */

// ── Stage ladder ────────────────────────────────────────────────────
// Keyed off days clean. `kinds` is what can spawn at that stage.
const STAGES = [
  { at: 0,  label: 'Warming up',   speed: 34,  cadence: 4.6,  kinds: [] },
  { at: 1,  label: 'Jogging',      speed: 50,  cadence: 6.2,  kinds: [] },
  { at: 4,  label: 'Picking up',   speed: 66,  cadence: 7.6,  kinds: [] },
  { at: 7,  label: 'Running',      speed: 84,  cadence: 8.8,  kinds: ['rock'] },
  { at: 14, label: 'Vaulting',     speed: 100, cadence: 9.8,  kinds: ['rock', 'wallLow'] },
  { at: 30, label: 'Full parkour', speed: 118, cadence: 10.8, kinds: ['rock', 'wallLow', 'wallHigh', 'line'] },
];

export function stageForDays(days) {
  let s = STAGES[0];
  for (const st of STAGES) if (days >= st.at) s = st;
  return s;
}

// Obstacle geometry + the move each one demands.
const KINDS = {
  rock:     { w: 10, h: 7,  action: 'jump',  dur: 0.62, lead: 0.30 },
  wallLow:  { w: 11, h: 13, action: 'vault', dur: 0.68, lead: 0.32 },
  wallHigh: { w: 9,  h: 27, action: 'climb', dur: 1.05, lead: 0.34 },
  line:     { w: 22, h: 24, action: 'duck',  dur: 0.55, lead: 0.22 },
};

// ── Shared ticker ───────────────────────────────────────────────────
const TICKER = { lanes: new Set(), raf: 0, last: 0, phase: 0, scroll: 0 };

function startTicker() {
  if (TICKER.raf) return;
  TICKER.last = performance.now();
  const frame = now => {
    const dt = Math.min(0.05, (now - TICKER.last) / 1000);
    TICKER.last = now;
    for (const lane of TICKER.lanes) {
      if (lane.visible) lane.step(dt);
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
// Angles are measured from straight-down, positive = forward (+x).
// The knee only ever folds BACKWARD: shin = thigh − flexion, flexion ≥ 0.
// Flexion peaks during recovery (heel toward the backside) and falls to
// zero at mid-stance so the supporting leg is straight — getting that
// timing the wrong way round is what makes a runner's knees look
// hinged backwards.
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
  const { mode, p, t } = pose;
  let yOff = 0, crouch = 0;

  if (mode === 'jump')  yOff = -30 * 4 * t * (1 - t);
  if (mode === 'vault') yOff = -20 * Math.sin(Math.PI * t);
  if (mode === 'climb') {
    const top = -(KINDS.wallHigh.h + 5);
    if (t < 0.4)      yOff = top * (t / 0.4);              // spring for the top
    else if (t < 0.7) yOff = top;                          // mantle, hanging on
    else              yOff = top * (1 - (t - 0.7) / 0.3);  // drop down the far side
  }
  if (mode === 'duck') crouch = 9 * Math.sin(Math.PI * t);
  const bob = mode === 'run' ? -Math.abs(Math.sin(p)) * 1.5 : 0;

  const hipY = groundY - 14 + yOff + bob + crouch;
  const shoulderY = hipY - 9 + crouch * 0.35;
  const headY = shoulderY - 5.6;

  ctx.save();
  ctx.translate(x, 0);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.arc(0, headY, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, shoulderY - 2);
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
    // run / idle
    const ph = mode === 'run' ? p : 0.9;
    for (const off of [0, Math.PI]) {
      const th = 0.8 * Math.sin(ph + off);
      const flex = 1.35 * (1 + Math.cos(ph + off)) / 2;
      limb(ctx, hipY, th, th - flex, L1, L2, groundY);
    }
    for (const off of [0, Math.PI]) {
      const a = -0.62 * Math.sin(ph + off);
      limb(ctx, shoulderY, a, a - 0.5, A1, A2);
    }
  }
  ctx.restore();
}

function drawObstacle(ctx, o, groundY, colour) {
  const k = KINDS[o.kind];
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  if (o.kind === 'rock') {
    ctx.beginPath();
    ctx.moveTo(o.x - k.w / 2, groundY);
    ctx.lineTo(o.x - k.w * 0.22, groundY - k.h);
    ctx.lineTo(o.x + k.w * 0.28, groundY - k.h * 0.72);
    ctx.lineTo(o.x + k.w / 2, groundY);
    ctx.closePath();
    ctx.globalAlpha = 0.28; ctx.fill();
    ctx.globalAlpha = 1;    ctx.stroke();
  } else if (o.kind === 'line') {
    // clothesline: a bar at head height on a single post
    ctx.beginPath();
    ctx.moveTo(o.x - k.w / 2, groundY - k.h);
    ctx.lineTo(o.x + k.w / 2, groundY - k.h);
    ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(o.x + k.w / 2, groundY - k.h);
    ctx.lineTo(o.x + k.w / 2, groundY);
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.28;
    ctx.fillRect(o.x - k.w / 2, groundY - k.h, k.w, k.h);
    ctx.globalAlpha = 1;
    ctx.strokeRect(o.x - k.w / 2, groundY - k.h, k.w, k.h);
  }
  ctx.restore();
}

// ── Component ───────────────────────────────────────────────────────
export default function HabitRunner({ progress, days, colour, done, stumbleKey }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ obstacles: [], action: null, spawnGap: 170, stumbleUntil: 0 });
  // Live props without restarting the loop on every tick.
  const propsRef = useRef({ progress, days, colour, done });
  propsRef.current = { progress, days, colour, done };

  // A relapse bumps stumbleKey — play the trip, then the streak is 0 anyway.
  useEffect(() => {
    if (stumbleKey) {
      stateRef.current.stumbleUntil = performance.now() + 700;
      stateRef.current.obstacles = [];
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

    // Read themed colours lazily — they change with the scheme picker.
    let palette = null;
    const readPalette = () => {
      const s = getComputedStyle(document.documentElement);
      palette = {
        line: s.getPropertyValue('--border').trim() || '#ddd',
        gold: s.getPropertyValue('--gold').trim() || '#c8970a',
      };
    };
    readPalette();
    const mo = new MutationObserver(readPalette);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });

    const lane = {
      visible: true,
      step(dt) {
        const st = stateRef.current;
        const { progress: pr, days: dy, colour: col, done: dn } = propsRef.current;
        const stage = stageForDays(dy);
        const still = reduced.matches;

        if (!still) TICKER.phase += dt * stage.cadence;
        const runnerX = Math.max(10, Math.min(w - 10, pr * w));

        // ── obstacles ──
        if (!still && stage.kinds.length && !dn) {
          for (const o of st.obstacles) o.x -= stage.speed * dt;
          st.obstacles = st.obstacles.filter(o => o.x > -40);
          const last = st.obstacles[st.obstacles.length - 1];
          if (!last || last.x < w - st.spawnGap) {
            const kind = stage.kinds[Math.floor(Math.random() * stage.kinds.length)];
            st.obstacles.push({ kind, x: w + 24, acted: false });
            st.spawnGap = 130 + Math.random() * 130;
          }
          // trigger the move that clears whatever is arriving
          if (!st.action) {
            for (const o of st.obstacles) {
              if (o.acted) continue;
              const k = KINDS[o.kind];
              const d = o.x - runnerX;
              if (d <= stage.speed * k.lead && d > -14) {
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
          if (st.action.t >= 1) st.action = null;
        }
        if (!still) TICKER.scroll = (TICKER.scroll + stage.speed * dt) % 12;

        // ── draw ──
        const groundY = h - 1;
        ctx.clearRect(0, 0, w, h);

        const stumbling = performance.now() < st.stumbleUntil;
        const mode = stumbling ? 'stumble'
          : dn ? 'celebrate'
          : st.action ? st.action.mode
          : still ? 'idle'
          : 'run';

        // ground dashes give the sense of speed — the runner's x encodes
        // progress, so it barely moves day to day
        if (!still && !dn && !stumbling) {
          ctx.save();
          ctx.strokeStyle = palette.line;
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1.4;
          ctx.lineCap = 'round';
          for (let d = -12; d < w; d += 12) {
            const dx = d - TICKER.scroll;
            if (dx < runnerX - 48 || dx > runnerX + 34) continue;
            ctx.beginPath();
            ctx.moveTo(dx, groundY - 1.5);
            ctx.lineTo(dx + 5, groundY - 1.5);
            ctx.stroke();
          }
          ctx.restore();
        }

        for (const o of st.obstacles) drawObstacle(ctx, o, groundY, palette.line);

        drawRunner(ctx, runnerX, groundY, dn ? palette.gold : col, {
          mode,
          p: TICKER.phase,
          t: st.action ? Math.min(1, st.action.t) : 0,
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
