/**
 * ScheduleSection — owner-only shift rotation + training calendar.
 *
 * Renders the self-contained dashboard at
 * public/schedule/shift-rotation-2026.html in an iframe. The file is
 * copied verbatim into dist/ by Vite and synced into the native app
 * bundle by Capacitor, so it works offline on mobile too.
 *
 * Gating: the entry point (Settings → Tools) only renders for the
 * owner, and this section double-checks isOwner so a deep link /
 * command-palette jump shows nothing for other accounts. Owner
 * identity comes from VITE_OWNER_EMAIL (see useIsOwner) — UI gate
 * only; the schedule ships in the public bundle, so don't put
 * anything sensitive in the HTML.
 */
import { motion } from 'framer-motion';

export default function ScheduleSection({ active, isOwner }) {
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
        style={{ marginBottom: '20px' }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="eyebrow">Owner</div>
        <div className="sec-title">Rotation</div>
      </motion.div>

      <iframe
        src="/schedule/shift-rotation-2026.html"
        title="Shift rotation and training calendar"
        style={{
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
