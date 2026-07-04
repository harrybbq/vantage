/**
 * ScheduleSection — owner-only shift rotation + training calendar.
 *
 * Renders the self-contained dashboard at
 * public/schedule/shift-rotation-2026.html in an iframe. The file is
 * copied verbatim into dist/ by Vite and synced into the native app
 * bundle by Capacitor, so it works offline on mobile too.
 *
 * Desktop: fixed-height framed panel (inner scroll is fine with a
 * wheel/trackpad). Mobile: nested iframe scrolling is a trap — you
 * can't tell whether a swipe moves the page or the calendar. The
 * frame is same-origin, so we measure its content and grow the
 * iframe to full height; the section then scrolls as one column
 * with the native momentum users expect, edge-to-edge for reading
 * width.
 *
 * Gating: the entry points (sidebar tab / More drawer / Settings →
 * Tools) only render for the owner, and this section double-checks
 * isOwner so a deep link shows nothing for other accounts. Owner
 * identity comes from VITE_OWNER_EMAIL (see useIsOwner) — UI gate
 * only; the schedule ships in the public bundle, so don't put
 * anything sensitive in the HTML.
 */
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useIsMobile } from '../hooks/useIsMobile';

export default function ScheduleSection({ active, isOwner }) {
  const isMobile = useIsMobile();
  const frameRef = useRef(null);

  // Mobile: size the iframe to its document so the outer page owns
  // scrolling. Re-measure on load, after webfonts settle, and on
  // viewport changes (orientation flips reflow the calendar grid).
  useEffect(() => {
    if (!isMobile || !isOwner) return undefined;
    const frame = frameRef.current;
    if (!frame) return undefined;

    function measure() {
      try {
        const doc = frame.contentDocument;
        if (doc?.documentElement) {
          frame.style.height = doc.documentElement.scrollHeight + 'px';
        }
      } catch { /* same-origin bundled asset — never throws in practice */ }
    }

    const timers = [setTimeout(measure, 300), setTimeout(measure, 1200)];
    frame.addEventListener('load', measure);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      timers.forEach(clearTimeout);
      frame.removeEventListener('load', measure);
      window.removeEventListener('resize', measure);
    };
  }, [isMobile, isOwner]);

  if (!isOwner) {
    return (
      <section id="schedule" className={`section${active ? ' active' : ''}`}>
        <div className="settings-empty">This page isn't available.</div>
      </section>
    );
  }

  return (
    <section id="schedule" className={`section${active ? ' active' : ''}`}>
      <motion.div
        style={{ marginBottom: isMobile ? '12px' : '20px' }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="eyebrow">Owner</div>
        <div className="sec-title">Rotation</div>
      </motion.div>

      <iframe
        ref={frameRef}
        src="/schedule/shift-rotation-2026.html"
        title="Shift rotation and training calendar"
        scrolling={isMobile ? 'no' : 'auto'}
        style={isMobile
          ? {
              // Edge-to-edge: cancel the mobile section's 16px gutters
              // so the calendar gets the full phone width. Height is
              // set imperatively to the document height above.
              width: 'calc(100% + 32px)',
              margin: '0 -16px',
              height: '1200px',
              border: 'none',
              background: '#0b0f14',
              display: 'block',
              overflow: 'hidden',
            }
          : {
              width: '100%',
              height: 'calc(100vh - 200px)',
              minHeight: '560px',
              border: '1px solid var(--border)',
              borderRadius: '14px',
              background: '#0b0f14',
              display: 'block',
            }}
      />
    </section>
  );
}
