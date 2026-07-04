/**
 * BackgroundCropModal — pan + zoom the just-picked image to choose
 * which slice gets shown as the section's full-viewport background.
 *
 * UX mirrors how Instagram / Discord handle profile photos: an editable
 * preview frame matching the destination's aspect ratio, drag to pan,
 * slider (or pinch) to zoom. On confirm we rasterise the visible slice
 * to a JPEG of the viewport aspect (compressed) so the saved blob stays
 * lightweight and rendering is trivial (background-size: cover).
 *
 * Props:
 *   src      data URL of the original picked image
 *   onCancel cancel (close)
 *   onConfirm(croppedDataUrl) — fired with the cropped+resized image
 */
import { useEffect, useRef, useState } from 'react';
import { backdropClose } from '../utils/backdropClose';

// Output cap so the cropped blob stays modest (~50-200 KB JPEG). The
// page background is full-viewport so longest edge matches realistic
// device resolution; rarely worth more than 1600 px.
const OUTPUT_MAX = 1600;
const OUTPUT_QUALITY = 0.78;

export default function BackgroundCropModal({ src, onCancel, onConfirm }) {
  // Frame = the on-screen crop window. Its aspect mirrors the viewport
  // so what the user sees in the modal is what they'll see as the
  // background. Width capped to fit the modal; height derived.
  const FRAME_W = Math.min(360, Math.round(window.innerWidth * 0.84));
  const FRAME_H = Math.round(FRAME_W * (window.innerHeight / window.innerWidth));

  const [img, setImg] = useState(null);          // HTMLImageElement (natural size)
  const [scale, setScale] = useState(1);         // 1 = "cover" baseline
  const [pos, setPos] = useState({ x: 0, y: 0 }); // offset from centre, in screen px
  const minScaleRef = useRef(1);

  // Drag handling — refs (not state) so we don't re-render every move.
  const dragging = useRef(false);
  const startPt = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const pinchStart = useRef(null);

  // Load the image and pick the "cover" baseline scale so it fills the
  // frame on first open. The user can zoom in further; not below cover.
  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      const coverScale = Math.max(FRAME_W / im.naturalWidth, FRAME_H / im.naturalHeight);
      minScaleRef.current = coverScale;
      setImg(im);
      setScale(coverScale);
      setPos({ x: 0, y: 0 });
    };
    im.src = src;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Keep the image covering the frame at the current scale so panning
  // never reveals empty edges. Called after every scale/drag change.
  function clamp(p, s) {
    if (!img) return p;
    const dispW = img.naturalWidth * s;
    const dispH = img.naturalHeight * s;
    const maxX = Math.max(0, (dispW - FRAME_W) / 2);
    const maxY = Math.max(0, (dispH - FRAME_H) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    };
  }

  // ── Pointer drag ──
  function onPointerDown(e) {
    if (!img) return;
    dragging.current = true;
    startPt.current = { x: e.clientX, y: e.clientY };
    startPos.current = pos;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging.current) return;
    const next = clamp({
      x: startPos.current.x + (e.clientX - startPt.current.x),
      y: startPos.current.y + (e.clientY - startPt.current.y),
    }, scale);
    setPos(next);
  }
  function onPointerUp(e) {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // ── Touch pinch (optional — slider also works) ──
  function dist(t1, t2) { return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY); }
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      pinchStart.current = { d: dist(e.touches[0], e.touches[1]), scale };
    }
  }
  function onTouchMove(e) {
    if (e.touches.length !== 2 || !pinchStart.current) return;
    e.preventDefault();
    const d = dist(e.touches[0], e.touches[1]);
    const nextScale = Math.max(minScaleRef.current, Math.min(minScaleRef.current * 4, pinchStart.current.scale * (d / pinchStart.current.d)));
    setScale(nextScale);
    setPos(p => clamp(p, nextScale));
  }
  function onTouchEnd(e) { if (e.touches.length < 2) pinchStart.current = null; }

  function onSliderChange(e) {
    const next = parseFloat(e.target.value);
    setScale(next);
    setPos(p => clamp(p, next));
  }

  // ── Confirm: render the visible slice to an output canvas ──
  // Output keeps the frame's aspect ratio; the longest output edge is
  // capped at OUTPUT_MAX so the saved blob stays a few hundred KB.
  function confirm() {
    if (!img) return;
    const aspect = FRAME_W / FRAME_H;
    let outW, outH;
    if (aspect >= 1) { outW = OUTPUT_MAX; outH = Math.round(OUTPUT_MAX / aspect); }
    else             { outH = OUTPUT_MAX; outW = Math.round(OUTPUT_MAX * aspect); }

    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');

    // Scale from screen (frame) pixels to output pixels.
    const k = outW / FRAME_W;
    const dispW = img.naturalWidth * scale * k;
    const dispH = img.naturalHeight * scale * k;
    // Image is centred + offset (in screen px) → translate to output px.
    const dx = (outW - dispW) / 2 + pos.x * k;
    const dy = (outH - dispH) / 2 + pos.y * k;
    ctx.drawImage(img, dx, dy, dispW, dispH);

    onConfirm(canvas.toDataURL('image/jpeg', OUTPUT_QUALITY));
  }

  return (
    <div
      className="modal-overlay open"
      {...backdropClose(() => onCancel())}
    >
      <div className="modal" style={{ maxWidth: FRAME_W + 56 }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.6,
          textTransform: 'uppercase', color: 'var(--em)', fontWeight: 700,
          marginBottom: 4,
        }}>// POSITION BACKGROUND</div>
        <h3 style={{ margin: '0 0 14px' }}>Crop & position</h3>

        {/* Crop frame — drag the image inside this window. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            position: 'relative',
            width: FRAME_W, height: FRAME_H,
            margin: '0 auto',
            borderRadius: 10, overflow: 'hidden',
            background: '#000',
            cursor: dragging.current ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
            boxShadow: '0 1px 0 rgba(255,255,255,.05) inset, 0 8px 28px rgba(0,0,0,.25)',
          }}
        >
          {img && (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                position: 'absolute',
                left: '50%', top: '50%',
                width: img.naturalWidth * scale,
                height: img.naturalHeight * scale,
                transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
                pointerEvents: 'none',
              }}
            />
          )}
          {/* Subtle rule-of-thirds guide */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background:
              'linear-gradient(to right, transparent calc(33.333% - 0.5px), rgba(255,255,255,.18) calc(33.333% - 0.5px), rgba(255,255,255,.18) calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px)),' +
              'linear-gradient(to right, transparent calc(66.666% - 0.5px), rgba(255,255,255,.18) calc(66.666% - 0.5px), rgba(255,255,255,.18) calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px)),' +
              'linear-gradient(to bottom, transparent calc(33.333% - 0.5px), rgba(255,255,255,.18) calc(33.333% - 0.5px), rgba(255,255,255,.18) calc(33.333% + 0.5px), transparent calc(33.333% + 0.5px)),' +
              'linear-gradient(to bottom, transparent calc(66.666% - 0.5px), rgba(255,255,255,.18) calc(66.666% - 0.5px), rgba(255,255,255,.18) calc(66.666% + 0.5px), transparent calc(66.666% + 0.5px))',
          }} />
        </div>

        {/* Zoom slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)' }}>−</span>
          <input
            type="range"
            min={minScaleRef.current || 0.1}
            max={(minScaleRef.current || 0.1) * 4}
            step="0.01"
            value={scale}
            onChange={onSliderChange}
            style={{ flex: 1, accentColor: 'var(--em)' }}
            aria-label="Zoom"
          />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)' }}>+</span>
        </div>

        <p style={{
          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)',
          margin: '10px 0 0', textAlign: 'center', letterSpacing: 0.4,
        }}>
          Drag to reposition · pinch or use the slider to zoom
        </p>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!img} onClick={confirm}>Use this crop</button>
        </div>
      </div>
    </div>
  );
}
