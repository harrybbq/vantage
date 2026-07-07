import { useRef, useEffect, useState } from 'react';

/**
 * CameraScanner — camera viewfinder for product-code scanning.
 *
 * Detection engines, in preference order:
 *   1. BarcodeDetector (Chrome 88+ / Android WebView) — native, fast.
 *      We acquire the stream ourselves and run a rAF detect loop.
 *   2. @zxing/browser (dynamic import) — everywhere else, including
 *      iOS Safari and desktop webcams. On this path ZXing OWNS the
 *      camera (decodeFromVideoDevice acquires + plays + decodes) —
 *      letting it manage the stream avoids the iOS black-frame bugs
 *      that come from two owners fighting over one <video>.
 *
 * iOS Safari specifics handled here:
 *   - React never renders the `muted` ATTRIBUTE (only the property),
 *     and iOS requires the attribute for inline camera autoplay — so
 *     muted/playsinline/autoplay are set imperatively before play.
 *   - If frames still aren't flowing shortly after start (videoWidth
 *     stays 0), a "Tap to start camera" overlay retries play() from
 *     a real user gesture, which iOS always honours.
 *
 * Both engines read 1D barcodes (EAN/UPC) and QR codes. A QR is only
 * accepted when it resolves to a product GTIN (GS1 Digital Link);
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

export default function CameraScanner({ onBarcode, onAIResult, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detectorRef = useRef(null);
  const zxingControlsRef = useRef(null);
  const foundRef = useRef(false);

  const [status, setStatus] = useState('starting'); // starting | scanning | found | identifying | error
  const [msg, setMsg] = useState('');
  const [scannerLive, setScannerLive] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [diag, setDiag] = useState('');

  // Home-screen PWA (iOS "standalone") — the environment where iOS
  // most often grants the camera but never delivers frames.
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

    // iOS: these must exist as ATTRIBUTES before play — React only
    // sets the muted property, which Safari ignores for autoplay
    // gating. Belt and braces for every engine path.
    video.setAttribute('muted', '');
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');

    function watchFrames() {
      const check = () => {
        if (!mounted || foundRef.current) return;
        const track = video.srcObject?.getVideoTracks?.()[0];
        // Diagnostics line — owner-only surface, so it can be frank.
        setDiag(
          `${detectorRef.current ? 'native' : 'zxing'} · ${video.videoWidth}×${video.videoHeight} · rs${video.readyState}` +
          ` · track ${track ? `${track.readyState}${track.muted ? '/muted' : ''}` : 'none'}${isStandalone ? ' · standalone' : ''}`
        );
        if (video.videoWidth === 0) {
          if (isStandalone) {
            // A tap won't help when iOS itself withholds frames from
            // home-screen apps — say so instead of a dead-end button.
            setNeedsTap(false);
            setMsg('iOS is not delivering camera frames to the home-screen app — open Vantage in Safari to scan.');
          } else {
            setNeedsTap(true);
          }
        } else {
          setNeedsTap(false);
        }
      };
      setTimeout(check, 1200);
      setTimeout(check, 3200);
      video.addEventListener('playing', () => { if (mounted) { setNeedsTap(false); setStatus(s => (s === 'starting' ? 'scanning' : s)); } });
    }

    // Simplest constraints iOS reliably honours — width/height ideals
    // have produced black frames on some iOS builds, so ask only for
    // the rear camera and take whatever resolution comes.
    const CONSTRAINTS = { video: { facingMode: { ideal: 'environment' } }, audio: false };

    function watchTrack(stream) {
      const track = stream?.getVideoTracks?.()[0];
      if (!track) return;
      // iOS mutes the track at the hardware level in some states
      // (standalone PWAs, camera contention) — frames go black while
      // the permission indicator stays on. Surface it honestly.
      const report = () => {
        if (!mounted) return;
        if (track.muted) {
          setMsg(isStandalone
            ? 'iOS is blocking camera frames in home-screen apps — open Vantage in Safari to scan.'
            : 'Camera paused by iOS — reopen this sheet to retry.');
        }
      };
      track.addEventListener('mute', report);
      if (track.muted) report();
    }

    async function startNative() {
      const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      video.srcObject = stream;
      try { await video.play(); } catch { setNeedsTap(true); }
      setStatus('scanning');
      setScannerLive(true);
      watchTrack(stream);
      watchFrames();
      startScanLoop();
    }

    async function startZXing() {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      if (!mounted) return;
      const reader = new BrowserMultiFormatReader();
      // decodeFromConstraints so we control the getUserMedia request
      // (decodeFromVideoDevice(undefined) asks for `video: true`,
      // which opens the FRONT camera on iPhones).
      const controls = await reader.decodeFromConstraints(CONSTRAINTS, video, (result) => {
        if (result) handleRawScan(result.getText());
      });
      if (!mounted) { controls.stop(); return; }
      zxingControlsRef.current = controls;
      setStatus('scanning');
      setScannerLive(true);
      watchTrack(video.srcObject);
      watchFrames();
    }

    (detectorRef.current ? startNative() : startZXing()).catch((e) => {
      if (!mounted) return;
      const errMsg = e?.name === 'NotAllowedError'
        ? 'Camera permission denied — allow camera access in your browser settings.'
        : 'Could not access the camera. Use name or barcode search instead.';
      setStatus('error');
      setMsg(errMsg);
      onError?.(errMsg);
    });

    return () => {
      mounted = false;
      stopAll();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAll() {
    cancelAnimationFrame(rafRef.current);
    try { zxingControlsRef.current?.stop(); } catch { /* already stopped */ }
    streamRef.current?.getTracks().forEach(t => t.stop());
    const v = videoRef.current;
    if (v?.srcObject) {
      try { v.srcObject.getTracks().forEach(t => t.stop()); } catch { /* detached */ }
    }
  }

  async function handleTapToStart() {
    try {
      await videoRef.current?.play();
      setNeedsTap(false);
    } catch {
      setMsg('Camera still blocked — check Settings > Safari > Camera.');
    }
  }

  // Shared: a raw payload came off the camera. Returns true if it was
  // a usable product code (scanning stops), false to keep scanning.
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

  function startScanLoop() {
    async function loop() {
      if (foundRef.current || !videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      try {
        const codes = await detectorRef.current.detect(videoRef.current);
        if (codes.length > 0 && handleRawScan(codes[0].rawValue)) return;
      } catch { /* transient decode error — keep looping */ }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
  }

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
      {/* Video */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: status === 'error' ? 'none' : 'block' }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Scan guide */}
      {status === 'scanning' && scannerLive && !needsTap && (
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

      {/* iOS gesture fallback — frames not flowing yet */}
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

      {/* Diagnostics line — tiny, top-left, owner-only surface */}
      {diag && status !== 'error' && (
        <div style={{ position: 'absolute', top: 6, left: 8, fontFamily: 'var(--mono)', fontSize: '9px', color: 'rgba(255,255,255,.55)', background: 'rgba(0,0,0,.45)', padding: '2px 7px', borderRadius: 6, pointerEvents: 'none' }}>
          {diag}
        </div>
      )}

      {/* No decoder notice — only if BOTH engines failed to start */}
      {status === 'scanning' && !scannerLive && (
        <div style={{ position: 'absolute', top: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <span style={{ background: 'rgba(0,0,0,.65)', color: 'rgba(255,255,255,.8)', padding: '4px 12px', borderRadius: 'var(--radius-full)', fontSize: '11px', fontFamily: 'var(--mono)' }}>
            Auto-scan unavailable — use AI or text search
          </span>
        </div>
      )}

      {/* AI identify button */}
      {(status === 'scanning' || status === 'identifying') && !needsTap && (
        <button
          onClick={handleIdentify}
          disabled={status === 'identifying'}
          style={{
            position: 'absolute', bottom: msg ? '44px' : '14px', left: '50%', transform: 'translateX(-50%)',
            padding: '9px 20px', borderRadius: 'var(--radius-full)',
            background: status === 'identifying' ? 'rgba(26,122,74,.7)' : 'var(--em)',
            color: '#fff', border: 'none', cursor: status === 'identifying' ? 'default' : 'pointer',
            fontFamily: 'var(--sans)', fontSize: '13px', fontWeight: 600,
            boxShadow: '0 2px 12px rgba(0,0,0,.45)', whiteSpace: 'nowrap',
            opacity: status === 'identifying' ? 0.8 : 1,
          }}
        >
          {status === 'identifying' ? 'Identifying…' : 'Identify with AI'}
        </button>
      )}
    </div>
  );
}
