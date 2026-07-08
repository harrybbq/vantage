import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

/**
 * CameraScanner — camera viewfinder for product-code scanning.
 *
 * Architecture (deliberately conservative for iOS Safari):
 *   - getUserMedia is called ONCE, with the simplest constraints
 *     ({ facingMode: environment }). Nothing else ever touches the
 *     stream — no library-managed video, no automatic re-acquisition.
 *     iOS returns muted/black tracks when the camera is re-acquired
 *     rapidly, so every recovery path is a MANUAL tap (a real user
 *     gesture, which iOS privileges).
 *   - Decoding:
 *       1. BarcodeDetector (Chrome/Android) → rAF loop on the video.
 *       2. Everywhere else (iOS Safari, desktop) → we grab frames to
 *          a canvas every ~350ms and hand them to ZXing's
 *          decodeFromCanvas. ZXing never sees the stream.
 *   - iOS quirks handled: muted/playsinline/autoplay set as
 *     ATTRIBUTES before play (React only sets the property); track
 *     mute surfaces a notice + tap-to-retry; element pauses resume
 *     opportunistically when the track is healthy.
 *
 * Both engines read 1D barcodes (EAN/UPC) and QR codes. QRs are only
 * accepted when they resolve to a product GTIN (GS1 Digital Link);
 * other QRs show a hint and scanning continues.
 *
 * Callbacks:
 *   onBarcode(code)   — normalised GTIN/EAN digits
 *   onAIResult(food)  — AI-identified food (FoodLogSheet prefill shape)
 *   onError(msg)      — camera / AI error message
 */

/** Normalise a scan payload to plain GTIN digits, or null if the
 *  payload isn't a product code (e.g. a marketing QR). */
export function normalizeScan(raw) {
  const s = String(raw || '').trim();
  if (/^\d{8,14}$/.test(s)) {
    return s.length === 14 && s.startsWith('0') ? s.slice(1) : s;
  }
  const m = s.match(/\/01\/(\d{8,14})(?:[/?#]|$)/);
  if (m) {
    const g = m[1];
    return g.length === 14 && g.startsWith('0') ? g.slice(1) : g;
  }
  return null;
}

const DECODE_INTERVAL_MS = 350;
const DECODE_WIDTH = 1024; // downscale target for canvas decode — 1D
                           // barcodes need line-level detail, so err
                           // toward resolution over CPU at ~3 fps

const CameraScanner = forwardRef(function CameraScanner({ onBarcode, onAIResult, onError }, ref) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);      // AI capture canvas
  const decodeCanvasRef = useRef(null); // ZXing decode canvas
  const viewCanvasRef = useRef(null);  // visible viewfinder (see below)
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const paintRafRef = useRef(null);
  const intervalRef = useRef(0);
  const detectorRef = useRef(null);
  const zxingReaderRef = useRef(null);
  const foundRef = useRef(false);
  const bootRef = useRef(null);

  const [status, setStatus] = useState('starting'); // starting | scanning | found | identifying | error
  const [msg, setMsg] = useState('');
  const [needsTap, setNeedsTap] = useState(false);
  const [diag, setDiag] = useState('');

  const isStandalone = typeof navigator !== 'undefined' &&
    (navigator.standalone === true ||
     (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches));

  // Init BarcodeDetector where available
  useEffect(() => {
    if ('BarcodeDetector' in window) {
      try {
        detectorRef.current = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'code_128', 'code_39', 'itf'],
        });
      } catch { /* fall through to ZXing */ }
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const video = videoRef.current;
    if (!video) return undefined;

    // iOS requires these as ATTRIBUTES before play; React only sets
    // the muted property.
    video.setAttribute('muted', '');
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');

    function updateDiag() {
      if (!mounted) return;
      const track = video.srcObject?.getVideoTracks?.()[0];
      // Sample the actual pixel data so "frames flowing but black"
      // (capture-layer failure) is distinguishable from a paint bug.
      let luma = '';
      try {
        if (video.videoWidth > 0) {
          const s = document.createElement('canvas');
          s.width = 16; s.height = 16;
          const sctx = s.getContext('2d');
          sctx.drawImage(video, 0, 0, 16, 16);
          const d = sctx.getImageData(0, 0, 16, 16).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
          luma = ` · luma ${Math.round(sum / (d.length / 4))}`;
        }
      } catch { /* tainted/none */ }
      setDiag(
        `${detectorRef.current ? 'native' : 'zxing'} · ${video.videoWidth}×${video.videoHeight} · rs${video.readyState}` +
        ` · track ${track ? `${track.readyState}${track.muted ? '/muted' : ''}` : 'none'}${luma}${isStandalone ? ' · standalone' : ''}`
      );
    }

    // ── Viewfinder painting ─────────────────────────────────────────
    // iOS Safari sometimes decodes the stream fine (readyState 4,
    // track live) but never PAINTS the <video> — a compositing bug,
    // typically inside animated/transformed ancestors like our
    // bottom sheet. So the visible viewfinder is a canvas we draw
    // ourselves every frame; the video element stays hidden (opacity
    // 0, still laid out so decoding continues).
    function paintLoop() {
      if (!mounted || foundRef.current) return;
      const v = videoRef.current;
      const c = viewCanvasRef.current;
      if (v && c && v.videoWidth > 0) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cw = Math.round(c.clientWidth * dpr);
        const ch = Math.round(c.clientHeight * dpr);
        if (cw && (c.width !== cw || c.height !== ch)) { c.width = cw; c.height = ch; }
        if (c.width) {
          const ctx = c.getContext('2d');
          // object-fit: cover, done by hand
          const scale = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
          const dw = v.videoWidth * scale;
          const dh = v.videoHeight * scale;
          ctx.drawImage(v, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
        }
      }
      paintRafRef.current = requestAnimationFrame(paintLoop);
    }

    async function boot() {
      // Higher resolution = decodable 1D barcodes. (The old fear that
      // size ideals caused black frames was disproven — that was the
      // paint bug.) iOS falls back gracefully if 1080p isn't available.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      video.srcObject = stream;
      try { await video.play(); } catch { setNeedsTap(true); }
      setStatus('scanning');

      const track = stream.getVideoTracks()[0];
      if (track) {
        track.addEventListener('mute', () => {
          if (!mounted || foundRef.current) return;
          updateDiag();
          setMsg('iOS paused the camera — tap the viewfinder to resume.');
          setNeedsTap(true);
        });
        track.addEventListener('unmute', () => {
          if (!mounted) return;
          updateDiag();
          setMsg('');
          setNeedsTap(false);
          video.play().catch(() => { /* needs gesture — overlay stays */ });
        });
      }
      // Resume opportunistically ONLY when the track is healthy — a
      // play() against a muted track does nothing useful.
      video.addEventListener('pause', () => {
        const t = video.srcObject?.getVideoTracks?.()[0];
        if (mounted && !foundRef.current && t && t.readyState === 'live' && !t.muted) {
          video.play().catch(() => {});
        }
      });

      setTimeout(updateDiag, 1200);
      setTimeout(updateDiag, 3200);
      setTimeout(() => {
        if (mounted && !foundRef.current && video.videoWidth === 0) setNeedsTap(true);
      }, 1500);

      cancelAnimationFrame(paintRafRef.current);
      paintRafRef.current = requestAnimationFrame(paintLoop);
      if (detectorRef.current) startNativeLoop();
      else startCanvasDecode();
    }
    bootRef.current = boot;

    boot().catch((e) => {
      if (!mounted) return;
      const errMsg = e?.name === 'NotAllowedError'
        ? 'Camera permission denied — allow camera access in your browser settings.'
        : 'Could not access the camera. Use name or barcode search instead.';
      setStatus('error');
      setMsg(errMsg);
      onError?.(errMsg);
    });

    function startNativeLoop() {
      async function loop() {
        if (!mounted || foundRef.current) return;
        if (videoRef.current && videoRef.current.readyState >= 2) {
          try {
            const codes = await detectorRef.current.detect(videoRef.current);
            if (codes.length > 0 && handleRawScan(codes[0].rawValue)) return;
          } catch { /* transient decode error */ }
        }
        rafRef.current = requestAnimationFrame(loop);
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    // ZXing decodes still frames we hand it — it never manages the
    // camera or the <video>, which is what kept breaking on iOS.
    async function startCanvasDecode() {
      try {
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (!mounted) return;
        const hints = new Map();
        hints.set(DecodeHintType.TRY_HARDER, true);
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39, BarcodeFormat.ITF,
        ]);
        zxingReaderRef.current = new BrowserMultiFormatReader(hints);
      } catch {
        return; // decoder unavailable — AI identify + text search still work
      }
      const dc = decodeCanvasRef.current;
      const ctx = dc.getContext('2d', { willReadFrequently: true });
      let attempts = 0;
      intervalRef.current = setInterval(() => {
        if (!mounted || foundRef.current) return;
        const v = videoRef.current;
        if (!v || v.readyState < 2 || v.videoWidth === 0) return;
        // Decode the CENTRAL region only (where the guide brackets
        // point) — the barcode fills more of the decoded image and
        // background clutter drops out. Crop: middle 86% × 60%.
        const sx = Math.round(v.videoWidth * 0.07);
        const sw = Math.round(v.videoWidth * 0.86);
        const sy = Math.round(v.videoHeight * 0.20);
        const sh = Math.round(v.videoHeight * 0.60);
        const scale = Math.min(1, DECODE_WIDTH / sw);
        dc.width = Math.round(sw * scale);
        dc.height = Math.round(sh * scale);
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, dc.width, dc.height);
        attempts++;
        try {
          const result = zxingReaderRef.current.decodeFromCanvas(dc);
          if (result) handleRawScan(result.getText());
        } catch { /* NotFound — keep scanning */ }
        // Heartbeat in the diag line so a silent decode loop is
        // visibly alive (and its input size inspectable).
        if (attempts % 6 === 0) {
          setDiag(d => d.replace(/ · scans .*$/, '') + ` · scans ${attempts} @${dc.width}×${dc.height}`);
        }
      }, DECODE_INTERVAL_MS);
    }

    return () => {
      mounted = false;
      stopAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAll() {
    cancelAnimationFrame(rafRef.current);
    cancelAnimationFrame(paintRafRef.current);
    clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    const v = videoRef.current;
    if (v?.srcObject) {
      try { v.srcObject.getTracks().forEach(t => t.stop()); } catch { /* detached */ }
    }
  }

  // Manual, gesture-driven recovery — the only kind iOS respects.
  async function handleTapToStart() {
    const video = videoRef.current;
    const track = video?.srcObject?.getVideoTracks?.()[0];
    setNeedsTap(false);
    setMsg('');
    if (!track || track.readyState === 'ended' || track.muted) {
      stopAll();
      try {
        await bootRef.current?.();
      } catch {
        setMsg('Camera still blocked — check Settings > Safari > Camera.');
        setNeedsTap(true);
      }
      return;
    }
    try { await video.play(); } catch {
      setMsg('Camera still blocked — check Settings > Safari > Camera.');
      setNeedsTap(true);
    }
  }

  function handleRawScan(raw) {
    if (foundRef.current) return true;
    const code = normalizeScan(raw);
    if (!code) {
      setMsg('That QR isn’t a product code — aim at the barcode.');
      return false;
    }
    foundRef.current = true;
    stopAll();
    setStatus('found');
    setMsg(`Code ${code}`);
    onBarcode?.(code);
    return true;
  }

  // Let the parent trigger AI identify from a button that lives OUTSIDE
  // the camera box (so it can't be hidden by camera state). No deps
  // array → the handle always points at the latest closure.
  useImperativeHandle(ref, () => ({ identify: handleIdentify }));

  async function handleIdentify() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.videoWidth) {
      setMsg('Camera hasn’t started yet — tap the viewfinder first.');
      setNeedsTap(true);
      return;
    }
    setStatus('identifying');
    setMsg('');
    try {
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];

      const res = await fetch('/.netlify/functions/ai-food-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const data = await res.json();

      if (!res.ok || data.error) throw new Error(data.error || 'AI detection failed');
      if (!data.food_name) throw new Error('Could not identify food — point at the packaging or dish');

      setStatus('scanning');
      setMsg('');
      onAIResult?.(data);
    } catch (e) {
      setStatus('scanning');
      setMsg(e.message || 'Identification failed — try again or use text search.');
    }
  }

  return (
    <div style={{ position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: '#000', width: '100%', aspectRatio: '4/3' }}>
      {/* Hidden but laid-out (opacity, not display:none — iOS keeps
          decoding). The visible preview is the canvas below, painted
          by us, because iOS sometimes never paints the video element
          itself despite healthy frames. */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.01, pointerEvents: 'none' }}
      />
      <canvas
        ref={viewCanvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: status === 'error' ? 'none' : 'block' }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <canvas ref={decodeCanvasRef} style={{ display: 'none' }} />

      {/* Scan guide */}
      {status === 'scanning' && !needsTap && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {[['8px','8px','borderTop','borderLeft'],['8px','auto','borderTop','borderRight'],['auto','8px','borderBottom','borderLeft'],['auto','auto','borderBottom','borderRight']].map(([t,r,bv,bh], i) => (
            <div key={i} style={{
              position: 'absolute', top: t === 'auto' ? 'auto' : '20%', bottom: t === 'auto' ? '20%' : 'auto',
              left: r === 'auto' ? 'auto' : '10%', right: r === 'auto' ? '10%' : 'auto',
              width: 24, height: 24, [bv]: '2px solid var(--em)', [bh]: '2px solid var(--em)',
            }} />
          ))}
          <div style={{
            position: 'absolute', left: '10%', right: '10%', height: '2px',
            background: 'var(--em)', boxShadow: '0 0 8px var(--em)',
            animation: 'cam-scan 2s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* Tap-to-resume overlay (manual recovery — the iOS-sanctioned path) */}
      {needsTap && status !== 'error' && (
        <button
          type="button"
          onClick={handleTapToStart}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,.55)', border: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            color: '#fff', fontFamily: 'var(--sans)',
          }}
        >
          <span style={{ width: 46, height: 46, borderRadius: '50%', border: '2px solid var(--em)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ width: 0, height: 0, borderLeft: '14px solid var(--em)', borderTop: '9px solid transparent', borderBottom: '9px solid transparent', marginLeft: 4 }} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Tap to start camera</span>
        </button>
      )}

      {/* Diagnostics line — tiny, top-left, owner-only surface */}
      {diag && status !== 'error' && (
        <div style={{ position: 'absolute', top: 6, left: 8, fontFamily: 'var(--mono)', fontSize: '9px', color: 'rgba(255,255,255,.55)', background: 'rgba(0,0,0,.45)', padding: '2px 7px', borderRadius: 6, pointerEvents: 'none' }}>
          {diag}
        </div>
      )}

      {/* Status message bar */}
      {msg && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.72)', padding: '8px 14px', fontSize: '12px', color: status === 'found' ? '#4dc485' : '#fff', fontFamily: 'var(--mono)', textAlign: 'center' }}>
          {msg}
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#e05252', fontFamily: 'var(--mono)', fontSize: '13px', lineHeight: 1.6 }}>
          {msg || 'Camera unavailable'}
        </div>
      )}

      {/* Starting spinner */}
      {status === 'starting' && !needsTap && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.6)', fontFamily: 'var(--mono)', fontSize: '12px' }}>
          Starting camera…
        </div>
      )}

      {/* Identifying overlay — the trigger button now lives in
          FoodSearch (always visible), so we just show progress here. */}
      {status === 'identifying' && (
        <div style={{ position: 'absolute', bottom: msg ? '44px' : '14px', left: '50%', transform: 'translateX(-50%)', padding: '8px 18px', borderRadius: 'var(--radius-full)', background: 'rgba(26,122,74,.85)', color: '#fff', fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600, boxShadow: '0 2px 12px rgba(0,0,0,.45)' }}>
          Identifying…
        </div>
      )}
    </div>
  );
});

export default CameraScanner;
