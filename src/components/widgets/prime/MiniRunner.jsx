/**
 * The runner at the tip of a habit's streak bar, on the Habits prime card.
 *
 * ── The same figure as the Habits page ──────────────────────────────
 * It is drawn by HabitRunner's own drawRunner, with that lane's gait for
 * the days clean (paramsForDays): walk → brisk walk → jog → run, knees
 * folding on the recovery, elbows tightening as the pace picks up, the
 * body bobbing and leaning into it. One model, so the figure on the card
 * and the one on the page can never move differently.
 *
 * ── Where it sits, and its colour ──────────────────────────────────
 * Wholly inside the filled part, its leading foot just behind the tip —
 * never straddling the tip, so it reads as one figure in one colour. It
 * draws in white and the canvas blends with `difference`, so every pixel
 * is the inverse of the bar beneath it.
 *
 * ── Cost ────────────────────────────────────────────────────────────
 * One requestAnimationFrame for every mini runner on the page. A runner
 * stops drawing when it is off-screen, all of them stop while the tab is
 * hidden, and with reduced motion each draws one still frame and never
 * joins the loop.
 */
import { useEffect, useRef } from 'react';
import { drawRunner, paramsForDays } from '../../habits/HabitRunner';

// The figure's own units: hip 14 above the ground, head top ~33 above,
// arms and legs reaching ~12 either side. The box leaves room for the bob.
const BOX_W = 30;
const BOX_H = 36;
const GROUND = 35;

const lanes = new Set();
let raf = 0;
let last = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const lane of lanes) if (lane.visible) lane.step(dt);
  raf = lanes.size && !document.hidden ? requestAnimationFrame(frame) : 0;
}
function wake() {
  if (raf || !lanes.size || document.hidden) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function MiniRunner({ days, height = 18 }) {
  const ref = useRef(null);
  const daysRef = useRef(days);
  daysRef.current = days;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const k = height / BOX_H;                  // figure units → css px
    const w = Math.ceil(BOX_W * k);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(height * dpr);
    cv.style.width = `${w}px`;
    cv.style.height = `${height}px`;
    const ctx = cv.getContext('2d');
    if (!ctx) return undefined;

    let phase = Math.random() * Math.PI * 2;   // rows don't stride in lockstep
    const draw = still => {
      const g = paramsForDays(daysRef.current || 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
      drawRunner(ctx, BOX_W / 2, GROUND, '#fff', {
        mode: still ? 'idle' : 'run', p: phase, t: 0,
        amp: g.amp, gait: g.gait, land: 0, shadow: null, ob: null,
      });
    };

    if (reducedMotion()) { draw(true); return undefined; }

    const lane = {
      visible: true,
      step(dt) {
        phase += paramsForDays(daysRef.current || 0).cadence * dt;
        draw(false);
      },
    };
    draw(false);
    lanes.add(lane);
    let io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([e]) => { lane.visible = e.isIntersecting; if (lane.visible) wake(); });
      io.observe(cv);
    }
    wake();
    return () => {
      lanes.delete(lane);
      if (io) io.disconnect();
    };
  }, [height]);

  return <canvas ref={ref} className="pv-runner" aria-hidden="true" />;
}
